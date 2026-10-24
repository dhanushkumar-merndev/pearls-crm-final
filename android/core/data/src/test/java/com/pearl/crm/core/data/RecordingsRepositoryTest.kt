package com.pearl.crm.core.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pearl.crm.core.data.db.AppDatabase
import com.pearl.crm.core.data.db.CallLogEntity
import com.pearl.crm.core.data.net.FileUploader
import com.pearl.crm.core.data.net.PearlJson
import com.pearl.crm.core.model.RpcFailure
import com.pearl.crm.core.model.RpcTransport
import com.pearl.crm.core.model.UploadPlan
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.time.LocalDateTime
import com.pearl.crm.core.model.IstDates

@RunWith(AndroidJUnit4::class)
class RecordingsRepositoryTest {
    private lateinit var db: AppDatabase
    private lateinit var settings: SettingsStore
    private lateinit var repo: RecordingsRepository
    private lateinit var tmp: File
    private val callAt = LocalDateTime.of(2027, 1, 15, 11, 0, 0).atZone(IstDates.ZONE).toInstant().toEpochMilli()
    private var now = callAt + 3_600_000

    private val rpcCalls = mutableListOf<Pair<String, JsonObject>>()
    private var rpcAnswer: (String, JsonObject) -> JsonElement = { _, _ -> JsonNull }
    private val rpc = RpcTransport { fn, args ->
        rpcCalls += fn to args
        rpcAnswer(fn, args)
    }

    private val uploads = mutableListOf<Triple<String, String, Long>>() // purpose, clientId, size
    private var uploadFails: RpcFailure? = null
    private val uploader = FileUploader { purpose, _, file, sha256, _, clientId ->
        assertEquals(64, sha256.length)
        uploadFails?.let { uploadFails = null; throw it }
        uploads += Triple(purpose, clientId, file.length())
        "file-$clientId"
    }

    /** Fake codec: the "compressed" file has [preparedSize] bytes; [plans] records what was asked. */
    private var preparedSize = 400_000
    private var originalChanges = false
    private val plans = mutableListOf<UploadPlan>()
    private val prepared = mutableListOf<File>()
    private val audio = object : AudioProcessor {
        var reads = 0
        override suspend fun sha256(uri: String): String {
            reads++
            return if (originalChanges && reads % 2 == 0) "changed" else "original"
        }

        override suspend fun prepare(uri: String, plan: UploadPlan): File {
            plans += plan
            return File.createTempFile("prep", ".m4a", tmp).also {
                it.writeBytes(ByteArray(preparedSize))
                prepared += it
            }
        }
    }

    private val files = mutableListOf<FoundFile>()
    private val durations = mutableMapOf<String, Long>()
    private val folder = object : RecordingFolder {
        override suspend fun list(modifiedAfter: Long) = files.filter { it.lastModified > modifiedAfter }
        override suspend fun durationMs(uri: String) = durations[uri]
    }

    @Before
    fun open() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
        settings = SettingsStore(context.getSharedPreferences("rec-test", Context.MODE_PRIVATE)).also {
            it.recordingMode = "sync_only"
            it.recordingMaxSeconds = 600
        }
        tmp = File(context.cacheDir, "rec-test").apply { mkdirs() }
        repo = RecordingsRepository(rpc, db, OutboxWriter(db.outbox()) { now }, uploader, audio, settings) { now }
    }

    @After
    fun close() {
        db.close()
        tmp.deleteRecursively()
        ApplicationProvider.getApplicationContext<Context>().getSharedPreferences("rec-test", Context.MODE_PRIVATE).edit().clear().commit()
    }

    private suspend fun crmCall(id: String = "C1", durationS: Int = 300, phone: String = "+919845012345") =
        db.callLogs().upsert(listOf(CallLogEntity(id, "L1", phone, "outgoing", callAt, durationS, "connected", null, "x")))

    private fun dialerFile(name: String, durationS: Int = 300, uri: String = "content://rec/$name") {
        files += FoundFile(uri, name, callAt + durationS * 1000L + 2_000, 600_000)
        durations[uri] = durationS * 1000L
    }

    private suspend fun sendOutbox() {
        db.outbox().dueHeads(Long.MAX_VALUE, 100).forEach { db.outbox().delete(it.id) }
    }

    @Test
    fun onlyRecordingsOfCrmCallsAreKeptAndEachOnlyOnce() = runTest {
        crmCall()
        dialerFile("Call recording +91 98450 12345_270115_110000.m4a")
        dialerFile("Call recording +91 99999 88888_270115_110000.m4a") // someone not in the CRM
        dialerFile("notes.txt")

        assertEquals(1, repo.scan(folder))
        assertEquals(0, repo.scan(folder)) // again: nothing new

        val rec = repo.observe().first().single().recording
        assertTrue(rec.uri.contains("98450"))
        assertEquals("on_phone", rec.status) // sync_only: waits for a request
        assertEquals("C1", rec.callLogId)
        val queued = db.outbox().dueHeads(Long.MAX_VALUE, 10).single()
        assertEquals("recording_register", queued.rpc)
        assertEquals(rec.id, queued.id)
        assertEquals("lead:L1", queued.entityKey)
        val sent = PearlJson.parseToJsonElement(queued.args).jsonObject.getValue("p_rows").jsonArray.single().jsonObject
        assertEquals("C1", sent.getValue("call_log_id").jsonPrimitive.content)
    }

    @Test
    fun allCallsModeQueuesStraightAway() = runTest {
        settings.recordingMode = "all_calls"
        crmCall()
        dialerFile("9845012345_20270115110000.mp3")
        repo.scan(folder)
        assertEquals(1, db.recordings().queued(5).size)
    }

    @Test
    fun aManagersRequestQueuesTheRecording() = runTest {
        crmCall()
        dialerFile("9845012345_20270115110000.mp3")
        repo.scan(folder)
        val id = db.outbox().dueHeads(Long.MAX_VALUE, 10).single().id
        rpcAnswer = { fn, _ ->
            assertEquals("recording_tasks", fn)
            PearlJson.parseToJsonElement("""{"mode":"sync_only","max_seconds":300,"requested":["$id"]}""")
        }
        assertEquals(1, repo.applyServerTasks())
        assertEquals(300, settings.recordingMaxSeconds)
        assertEquals(id, db.recordings().queued(5).single().id)
    }

    @Test
    fun uploadWaitsUntilTheServerKnowsTheRecordingThenAttachesIt() = runTest {
        settings.recordingMode = "all_calls"
        crmCall(durationS = 14 * 60)
        dialerFile("9845012345_20270115110000.mp3", durationS = 14 * 60)
        repo.scan(folder)
        val id = db.recordings().queued(5).single().id

        // Its register call hasn't gone yet.
        assertEquals(0, repo.uploadQueued().synced)
        assertTrue(uploads.isEmpty())

        sendOutbox()
        val round = repo.uploadQueued()
        assertEquals(1, round.synced)
        // 14-minute call → the first 10 minutes, marked as cut.
        assertEquals(600, plans.single().keepSeconds)
        assertTrue(plans.single().trimmed)
        assertEquals(Triple("call_recording", id, 400_000L), uploads.single())
        val attach = rpcCalls.single { it.first == "recording_attach" }.second
        assertEquals("600", attach.getValue("p_uploaded_s").jsonPrimitive.content)
        assertEquals("true", attach.getValue("p_trimmed").jsonPrimitive.content)
        val rec = db.recordings().get(id)!!
        assertEquals("synced", rec.status)
        assertEquals("file-$id", rec.fileId)
        assertTrue(rec.trimmed)
        assertFalse("temporary copy removed", prepared.single().exists())
    }

    @Test
    fun aRetryAfterNoConnectionUsesTheSameIdsSoNothingIsStoredTwice() = runTest {
        settings.recordingMode = "all_calls"
        crmCall()
        dialerFile("9845012345_20270115110000.mp3")
        repo.scan(folder)
        sendOutbox()
        uploadFails = RpcFailure.Transient("offline")

        val first = repo.uploadQueued()
        assertTrue(first.offline)
        val id = db.recordings().queued(5).single().id
        assertEquals("queued", db.recordings().get(id)!!.status)

        assertEquals(1, repo.uploadQueued().synced)
        assertEquals(listOf(id), uploads.map { it.second })
        assertEquals(0, db.recordings().get(id)!!.attempts) // no connection isn't the file's fault
    }

    @Test
    fun theOriginalMustNotChange() = runTest {
        settings.recordingMode = "all_calls"
        originalChanges = true
        crmCall()
        dialerFile("9845012345_20270115110000.mp3")
        repo.scan(folder)
        sendOutbox()
        val round = repo.uploadQueued()
        assertEquals(1, round.failed)
        val rec = repo.observe().first().single().recording
        assertEquals("failed", rec.status)
        assertEquals("original_changed", rec.error)
        assertTrue(uploads.isEmpty())
    }

    @Test
    fun aFileOverTheServersLimitIsNotSent() = runTest {
        settings.recordingMode = "all_calls"
        preparedSize = (UploadPlan.MAX_BYTES + 1).toInt()
        crmCall()
        dialerFile("9845012345_20270115110000.mp3")
        repo.scan(folder)
        sendOutbox()
        assertEquals(1, repo.uploadQueued().failed)
        assertTrue(uploads.isEmpty())
        assertEquals("file_too_large", rpcCalls.single { it.first == "recording_failed" }.second.getValue("p_error").jsonPrimitive.content)
    }

    @Test
    fun aLostLeadVoiceNoteIsAlwaysUploaded() = runTest {
        val clip = File(tmp, "voice.m4a").apply { writeBytes(ByteArray(10_000)) }
        val id = repo.addVoiceNote("L1", clip, 25, lostNote = true)
        val row = PearlJson.parseToJsonElement(db.outbox().get(id)!!.args).jsonObject.getValue("p_rows").jsonArray.single().jsonObject
        assertEquals("voice_note", row.getValue("kind").jsonPrimitive.content)
        assertEquals("true", row.getValue("lost_note").jsonPrimitive.content)
        sendOutbox()
        assertEquals(1, repo.uploadQueued().synced)
        assertEquals("voice_note", uploads.single().first)
    }

    @Test
    fun syncNowQueuesOnlyWhatIsStillOnThePhone() = runTest {
        crmCall()
        dialerFile("9845012345_20270115110000.mp3")
        repo.scan(folder)
        val id = db.outbox().dueHeads(Long.MAX_VALUE, 10).single().id
        assertEquals(1, repo.syncNow(listOf(id, "unknown")))
        assertEquals(0, repo.syncNow(listOf(id))) // already queued
        assertNull(db.recordings().get("unknown"))
    }
}
