package com.pearl.crm.core.data

import androidx.room.withTransaction
import com.pearl.crm.core.data.db.AppDatabase
import com.pearl.crm.core.data.db.RecordingEntity
import com.pearl.crm.core.data.net.FileUploader
import com.pearl.crm.core.model.CallCandidate
import com.pearl.crm.core.model.RecordingFile
import com.pearl.crm.core.model.RecordingMatcher
import com.pearl.crm.core.model.RecordingNames
import com.pearl.crm.core.model.RpcFailure
import com.pearl.crm.core.model.RpcTransport
import com.pearl.crm.core.model.UploadPlan
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.io.File
import java.security.MessageDigest
import java.time.Instant

/** A file in the dialer's recordings folder. */
data class FoundFile(val uri: String, val name: String, val lastModified: Long, val sizeBytes: Long)

/** The recordings folder the person chose (Storage Access Framework on the phone). */
interface RecordingFolder {
    suspend fun list(modifiedAfter: Long): List<FoundFile>

    /** Length in ms, or null when the phone can't read it. */
    suspend fun durationMs(uri: String): Long?
}

/** Reads and shrinks audio. Never writes to the original. */
interface AudioProcessor {
    suspend fun sha256(uri: String): String

    /** A new temporary .m4a with the first [UploadPlan.keepSeconds], mono 16 kHz AAC. */
    suspend fun prepare(uri: String, plan: UploadPlan): File
}

/** Result of one upload round. */
data class UploadRound(val synced: Int, val failed: Int, val waiting: Int, val offline: Boolean)

object RecordingStatus {
    const val ON_PHONE = "on_phone"
    const val QUEUED = "queued"
    const val UPLOADING = "uploading"
    const val SYNCED = "synced"
    const val FAILED = "failed"
}

/**
 * Call recordings and voice notes on the phone (PLAN.md E3 row 12):
 * find → match to a CRM call → register ("On phone" for managers) → upload when the mode says
 * so, a manager asks, or the person taps Sync (first N minutes, compressed, original untouched).
 */
class RecordingsRepository(
    private val rpc: RpcTransport,
    private val db: AppDatabase,
    private val outbox: OutboxWriter,
    private val uploader: FileUploader,
    private val audio: AudioProcessor,
    private val settings: SettingsStore,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val recordings = db.recordings()

    fun observe(limit: Int = 200) = recordings.observeAll(limit)

    fun observeWaiting() = recordings.observeWaitingCount()

    /** Looks for new recordings of CRM calls. Files of other calls are ignored and never stored. Returns how many were found. */
    suspend fun scan(folder: RecordingFolder): Int {
        val known = recordings.knownUris().toHashSet()
        val files = folder.list(clock() - SCAN_DAYS * DAY_MS).filter { RecordingNames.isAudio(it.name) && it.uri !in known }
        var found = 0
        for (f in files) {
            val durationMs = folder.durationMs(f.uri)
            val calls = db.callLogs()
                .between(f.lastModified - (durationMs ?: 0L) - WINDOW_MS, f.lastModified + WINDOW_MS)
                .filter { it.leadId != null }
                .map { CallCandidate(it.id, it.phoneE164?.takeLast(10), it.startedAt, it.durationS, it.leadId) }
            val match = RecordingMatcher.match(RecordingFile(f.name, f.lastModified, durationMs, f.sizeBytes), calls) ?: continue
            val parsedAt = RecordingNames.parse(f.name).recordedAt
            val row = RecordingEntity(
                id = newClientId(), kind = "call", uri = f.uri, fileName = f.name, sizeBytes = f.sizeBytes,
                recordedAt = parsedAt ?: match.call.startedAt,
                durationS = ((durationMs ?: (match.call.durationS * 1000L)) / 1000).toInt(),
                callLogId = match.call.id, leadId = match.call.leadId, confidence = match.confidence,
                needsReview = match.needsReview,
                status = if (settings.recordingMode == "all_calls") RecordingStatus.QUEUED else RecordingStatus.ON_PHONE,
                fileId = null, uploadedS = null, trimmed = false, error = null, attempts = 0, lostNote = false, createdAt = clock(),
            )
            if (register(row)) found++
        }
        return found
    }

    /** A voice note recorded in the app (e.g. why a lead was lost). Always uploaded. Returns its id. */
    suspend fun addVoiceNote(leadId: String, file: File, durationS: Int, lostNote: Boolean): String =
        addRecording("voice_note", leadId, file, durationS, lostNote, entityKey = "lead:$leadId")

    /**
     * A recording made in the app (voice note, or a BDM's visit). Always uploaded. [entityKey]
     * orders its registration before the call that refers to it (e.g. the visit's completion).
     */
    suspend fun addRecording(kind: String, leadId: String?, file: File, durationS: Int, lostNote: Boolean, entityKey: String): String {
        val row = RecordingEntity(
            id = newClientId(), kind = kind, uri = file.toURI().toString(), fileName = file.name, sizeBytes = file.length(),
            recordedAt = clock() - durationS * 1000L, durationS = durationS, callLogId = null, leadId = leadId, confidence = null,
            needsReview = false, status = RecordingStatus.QUEUED, fileId = null, uploadedS = null, trimmed = false, error = null,
            attempts = 0, lostNote = lostNote, createdAt = clock(),
        )
        register(row, entityKey)
        return row.id
    }

    private suspend fun register(row: RecordingEntity, entityKey: String? = null): Boolean {
        var added = false
        db.withTransaction {
            if (recordings.insert(row) == -1L) return@withTransaction
            added = true
            outbox.enqueue(
                "recording_register",
                buildJsonObject {
                    put(
                        "p_rows",
                        buildJsonArray {
                            add(
                                buildJsonObject {
                                    put("id", row.id)
                                    put("kind", row.kind)
                                    put("call_log_id", row.callLogId)
                                    put("lead_id", row.leadId)
                                    put("recorded_at", Instant.ofEpochMilli(row.recordedAt).toString())
                                    put("duration_s", row.durationS)
                                    row.confidence?.let { put("match_confidence", it) }
                                    put("needs_review", row.needsReview)
                                    put("lost_note", row.lostNote)
                                },
                            )
                        },
                    )
                },
                // After the call's own notes, so the server knows the call first.
                entityKey = entityKey ?: row.leadId?.let { "lead:$it" } ?: "recording:${row.id}",
                clientId = row.id,
            )
        }
        return added
    }

    /** The person taps Sync on recordings in the "On phone" list. */
    suspend fun syncNow(ids: List<String>): Int = recordings.queue(ids)

    /** Online: upload mode, minutes kept, and recordings a manager asked for. Returns how many were asked for. */
    suspend fun applyServerTasks(): Int {
        val tasks = rpc.call("recording_tasks", JsonObject(emptyMap())).jsonObject
        tasks["mode"]?.jsonPrimitive?.contentOrNull?.let { settings.recordingMode = it }
        tasks["max_seconds"]?.jsonPrimitive?.intOrNull?.let { settings.recordingMaxSeconds = it }
        val requested = tasks["requested"]?.jsonArray?.mapNotNull { it.jsonPrimitive.contentOrNull }.orEmpty()
        return if (requested.isEmpty()) 0 else recordings.queue(requested)
    }

    /** Uploads queued recordings one by one. Stops at the first sign of no connection. */
    suspend fun uploadQueued(): UploadRound {
        recordings.requeueInterrupted()
        var synced = 0
        var failed = 0
        var offline = false
        for (rec in recordings.queued(MAX_ATTEMPTS)) {
            // The server must know the recording first (its register call is still queued).
            if (outbox.isQueued(rec.id)) continue
            recordings.setStatus(rec.id, RecordingStatus.UPLOADING, null)
            var prepared: File? = null
            try {
                // Visits are kept whole (up to the visit limit); calls are cut to the clinic's setting.
                val plan = UploadPlan.forDuration(rec.durationS, if (rec.kind == "visit") VISIT_MAX_SECONDS else settings.recordingMaxSeconds)
                val before = audio.sha256(rec.uri)
                prepared = audio.prepare(rec.uri, plan)
                if (audio.sha256(rec.uri) != before) throw RpcFailure.Permanent("original_changed")
                if (prepared.length() > maxBytes(rec.kind)) throw RpcFailure.Permanent("file_too_large")
                val fileId = uploader.upload(
                    purpose = purposeOf(rec.kind),
                    mime = "audio/mp4",
                    file = prepared,
                    sha256 = sha256(prepared),
                    link = rec.leadId?.let { mapOf("lead_id" to it) }.orEmpty(),
                    clientId = rec.id,
                )
                rpc.call(
                    "recording_attach",
                    buildJsonObject {
                        put("p_id", rec.id)
                        put("p_file_id", fileId)
                        put("p_uploaded_s", plan.keepSeconds)
                        put("p_trimmed", plan.trimmed)
                    },
                )
                recordings.markSynced(rec.id, fileId, plan.keepSeconds, plan.trimmed)
                synced++
            } catch (e: CancellationException) {
                recordings.setStatus(rec.id, RecordingStatus.QUEUED, null)
                throw e
            } catch (e: RpcFailure.Transient) {
                recordings.setStatus(rec.id, RecordingStatus.QUEUED, "offline")
                offline = true
                break
            } catch (e: RpcFailure.SignedOut) {
                recordings.setStatus(rec.id, RecordingStatus.QUEUED, null)
                break
            } catch (e: RpcFailure.Permanent) {
                fail(rec.id, e.code)
                failed++
            } catch (e: Exception) {
                // The file couldn't be read or converted: try again later, a few times.
                recordings.setStatus(rec.id, RecordingStatus.QUEUED, e.javaClass.simpleName, addAttempt = 1)
                if ((recordings.get(rec.id)?.attempts ?: 0) >= MAX_ATTEMPTS) {
                    fail(rec.id, "unreadable")
                    failed++
                }
            } finally {
                prepared?.delete()
            }
        }
        return UploadRound(synced, failed, recordings.queued(MAX_ATTEMPTS).size, offline)
    }

    private suspend fun fail(id: String, code: String) {
        recordings.setStatus(id, RecordingStatus.FAILED, code, addAttempt = 1)
        // Tell managers why (best effort; the list on the phone shows it either way).
        runCatching {
            rpc.call("recording_failed", buildJsonObject {
                put("p_id", id)
                put("p_error", code)
            })
        }
    }

    companion object {
        const val MAX_ATTEMPTS = 5

        /** A visit recording at 24 kbps fits the server's 8 MB visit limit up to ~45 minutes. */
        const val VISIT_MAX_SECONDS = 45 * 60

        fun purposeOf(kind: String) = when (kind) {
            "voice_note" -> "voice_note"
            "visit" -> "visit_recording"
            else -> "call_recording"
        }

        /** The server's size limits (files_begin_upload). */
        fun maxBytes(kind: String): Long = when (kind) {
            "voice_note" -> 1L * 1024 * 1024
            "visit" -> 8L * 1024 * 1024
            else -> UploadPlan.MAX_BYTES
        }
        const val SCAN_DAYS = 2L
        private const val DAY_MS = 86_400_000L

        /** How far from a file's time to look for its call. */
        private const val WINDOW_MS = 10 * 60_000L

        fun sha256(file: File): String {
            val digest = MessageDigest.getInstance("SHA-256")
            file.inputStream().use { input ->
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    digest.update(buf, 0, n)
                }
            }
            return digest.digest().joinToString("") { "%02x".format(it) }
        }
    }
}
