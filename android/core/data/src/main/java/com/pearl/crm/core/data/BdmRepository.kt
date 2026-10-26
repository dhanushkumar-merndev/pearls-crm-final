package com.pearl.crm.core.data

import android.content.SharedPreferences
import androidx.room.withTransaction
import com.pearl.crm.core.data.db.AppDatabase
import com.pearl.crm.core.data.db.TrackPointEntity
import com.pearl.crm.core.data.net.FileUploader
import com.pearl.crm.core.data.net.PearlJson
import com.pearl.crm.core.model.IstDates
import com.pearl.crm.core.model.RawPoint
import com.pearl.crm.core.model.RpcFailure
import com.pearl.crm.core.model.RpcTransport
import com.pearl.crm.core.model.TrackChunk
import com.pearl.crm.core.model.TrackFilter
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.io.File
import java.time.Instant
import java.time.LocalDate

/** bdm_state on the server. */
object BdmState {
    const val OFF_DUTY = "off_duty"
    const val IN_OFFICE = "in_office"
    const val TRAVELLING = "travelling"
    const val AT_VISIT = "at_visit"
    const val ON_BREAK = "on_break"
}

/** What the BDM screens show about today, kept on the phone (works offline). */
@Serializable
data class BdmDay(
    val dayId: String? = null,
    val workDate: String? = null,
    val state: String = BdmState.OFF_DUTY,
    val ended: Boolean = false,
    val visitId: String? = null,
    val visitDestination: String? = null,
    val visitReached: Boolean = false,
    val breakOpen: Boolean = false,
    /** Office geofence result at day start (null = unknown). */
    val startedInOffice: Boolean? = null,
) {
    val open: Boolean get() = dayId != null && !ended
}

/** The new-visit-complete form. */
data class VisitResult(
    val outcome: String,
    val contactName: String?,
    val contactPhone: String?,
    val contactDesignation: String?,
    /** hot / warm / cold / none. */
    val interest: String?,
    val lead: NewLead?,
)

data class NewLead(val name: String, val phoneE164: String, val treatment: String?)

/** Start-of-day answer. */
data class StartDayResult(val inside: Boolean?, val distanceM: Int?, val officeName: String?)

/** What the heartbeat tells the phone. */
data class HeartbeatReply(val locateNow: Boolean, val heartbeatMinutes: Int, val uploadMinutes: Int)

/** The phone's status sent with each heartbeat. */
data class PhoneStatus(
    val fix: RawPoint?,
    val battery: Int?,
    val charging: Boolean?,
    val gpsOn: Boolean,
    val network: String?,
    val appVersion: String,
)

@Serializable
data class BdmTodayTiles(
    val visits: Int = 0,
    @kotlinx.serialization.SerialName("visits_done") val visitsDone: Int = 0,
    val leads: Int = 0,
    @kotlinx.serialization.SerialName("distance_m") val distanceM: Long = 0,
    @kotlinx.serialization.SerialName("actual_m") val actualM: Long = 0,
    @kotlinx.serialization.SerialName("est_m") val estM: Long = 0,
    @kotlinx.serialization.SerialName("estimates_pending") val estimatesPending: Int = 0,
    @kotlinx.serialization.SerialName("travel_s") val travelS: Long = 0,
    @kotlinx.serialization.SerialName("meeting_s") val meetingS: Long = 0,
    @kotlinx.serialization.SerialName("break_s") val breakS: Long = 0,
    @kotlinx.serialization.SerialName("break_allowed_s") val breakAllowedS: Long = 0,
    @kotlinx.serialization.SerialName("office_s") val officeS: Long = 0,
)

@Serializable
data class BdmMonth(val days: Int = 0, val visits: Int = 0, val leads: Int = 0, val conversions: Int = 0, val km: Double = 0.0)

@Serializable
data class BdmDashboard(val today: BdmTodayTiles? = null, val month: BdmMonth = BdmMonth(), val flags: List<String>? = null)

/** One visit in today's list (from the server's timeline). */
@Serializable
data class BdmVisit(
    val id: String,
    val destination: String,
    val purpose: String? = null,
    @kotlinx.serialization.SerialName("travel_started_at") val travelStartedAt: String? = null,
    @kotlinx.serialization.SerialName("reached_at") val reachedAt: String? = null,
    @kotlinx.serialization.SerialName("completed_at") val completedAt: String? = null,
    val outcome: String? = null,
    @kotlinx.serialization.SerialName("actual_m") val actualM: Int? = null,
    @kotlinx.serialization.SerialName("est_distance_m") val estDistanceM: Int? = null,
    @kotlinx.serialization.SerialName("estimate_status") val estimateStatus: String? = null,
    @kotlinx.serialization.SerialName("flag_long_route") val flagLongRoute: Boolean = false,
)

/**
 * The BDM's day (PLAN.md E3 row 13). Starting the day needs the internet (the server checks the
 * office geofence and the selfie); every later action is saved on the phone and queued, so it
 * works with no signal. GPS points are cleaned and packed into chunks every few minutes.
 */
class BdmRepository(
    private val rpc: RpcTransport,
    private val db: AppDatabase,
    private val outbox: OutboxWriter,
    private val uploader: FileUploader,
    private val recordings: RecordingsRepository,
    private val prefs: SharedPreferences,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val _day = MutableStateFlow(readDay())
    val day: StateFlow<BdmDay> = _day.asStateFlow()

    private fun today(): String = Instant.ofEpochMilli(clock()).atZone(IstDates.ZONE).toLocalDate().toString()

    private fun readDay(): BdmDay {
        val stored = prefs.getString(KEY_DAY, null)?.let { runCatching { PearlJson.decodeFromString(BdmDay.serializer(), it) }.getOrNull() }
        // Yesterday's day is over on the phone too (the server auto-ends it).
        return if (stored == null || stored.workDate != today()) BdmDay() else stored
    }

    private fun save(day: BdmDay) {
        prefs.edit().putString(KEY_DAY, PearlJson.encodeToString(BdmDay.serializer(), day)).apply()
        _day.value = day
    }

    private fun update(change: (BdmDay) -> BdmDay) = save(change(_day.value))

    var heartbeatMinutes: Int
        get() = prefs.getInt(KEY_HEARTBEAT, 5)
        private set(v) = prefs.edit().putInt(KEY_HEARTBEAT, v).apply()

    var uploadMinutes: Int
        get() = prefs.getInt(KEY_UPLOAD, 5)
        private set(v) = prefs.edit().putInt(KEY_UPLOAD, v).apply()

    private val dayKey get() = "bdm-day:${_day.value.dayId}"

    private fun JsonObjectBuilder.fix(p: RawPoint?) {
        put("device_at", Instant.ofEpochMilli(p?.t ?: clock()).toString())
        if (p != null) {
            put("lat", p.lat)
            put("lng", p.lng)
            put("accuracy", p.accuracyM)
        }
    }

    /** After a restart or a new install: today's state from the server (online). */
    suspend fun refreshFromServer() {
        val r = rpc.call("bdm_today", JsonObject(emptyMap())).jsonObject
        (r["settings"] as? JsonObject)?.let { s ->
            s["heartbeat_minutes"]?.jsonPrimitive?.intOrNull?.let { heartbeatMinutes = it }
            s["upload_minutes"]?.jsonPrimitive?.intOrNull?.let { uploadMinutes = it }
        }
        val day = r["day"] as? JsonObject
        if (day == null) {
            save(BdmDay())
            return
        }
        val visit = r["visit"] as? JsonObject
        val dayId = day.str("id")
        // Keep the chunk numbering going after the last one the server has.
        r["last_seq"]?.jsonPrimitive?.intOrNull?.let { if (nextSeq(dayId) <= it) prefs.edit().putInt(KEY_SEQ + dayId, it + 1).apply() }
        save(
            BdmDay(
                dayId = dayId,
                workDate = day.str("work_date"),
                state = day.str("state") ?: BdmState.IN_OFFICE,
                ended = day.str("ended_at") != null,
                visitId = visit?.str("id"),
                visitDestination = visit?.str("destination"),
                visitReached = visit?.str("reached_at") != null,
                breakOpen = r["break"] is JsonObject,
                startedInOffice = day["start_in_geofence"]?.jsonPrimitive?.booleanOrNull,
            ),
        )
    }

    /** Online only: the selfie is uploaded, then the server decides (office geofence). */
    suspend fun startDay(selfie: File?, fix: RawPoint, clientId: String): StartDayResult {
        val selfieId = selfie?.let {
            uploader.upload("selfie", "image/webp", it, RecordingsRepository.sha256(it), emptyMap(), clientId = selfieClientId(clientId))
        }
        val r = rpc.call(
            "bdm_start_day",
            buildJsonObject {
                put("p", buildJsonObject {
                    put("client_id", clientId)
                    put("selfie_file_id", selfieId)
                    put("is_mock", fix.mock)
                    fix(fix)
                })
            },
        ).jsonObject
        val day = r.getValue("day").jsonObject
        val inside = r["inside"]?.jsonPrimitive?.booleanOrNull
        save(
            BdmDay(
                dayId = day.str("id"), workDate = day.str("work_date") ?: today(),
                state = day.str("state") ?: BdmState.IN_OFFICE, ended = day.str("ended_at") != null, startedInOffice = inside,
            ),
        )
        db.trackPoints().deleteOtherDays(day.str("id")!!)
        return StartDayResult(inside, r["distance_m"]?.jsonPrimitive?.intOrNull, (r["office"] as? JsonObject)?.str("name"))
    }

    private fun requireOpen(): BdmDay {
        val d = _day.value
        if (d.dayId == null) throw RpcFailure.Permanent("day_not_started")
        if (d.ended) throw RpcFailure.Permanent("day_ended")
        return d
    }

    private suspend fun queue(rpcName: String, args: JsonObject, clientId: String = newClientId()) =
        outbox.enqueue(rpcName, args, dayKey, clientId = clientId)

    suspend fun atOffice(fix: RawPoint?) {
        requireOpen()
        val id = newClientId()
        queue("bdm_event", buildJsonObject {
            put("p", buildJsonObject {
                put("client_id", id)
                put("kind", "office")
                fix(fix)
            })
        }, id)
        update { it.copy(state = BdmState.IN_OFFICE) }
    }

    /** Things the phone notices: gps_off, gps_on, permission_lost, battery_saver, mock_location. */
    suspend fun reportEvent(kind: String, fix: RawPoint? = null) {
        if (!_day.value.open) return
        val id = newClientId()
        queue("bdm_event", buildJsonObject {
            put("p", buildJsonObject {
                put("client_id", id)
                put("kind", kind)
                fix(fix)
            })
        }, id)
    }

    suspend fun startTravel(destination: String, purpose: String?, fix: RawPoint?): String {
        val d = requireOpen()
        if (d.visitId != null) throw RpcFailure.Permanent("visit_open")
        if (d.breakOpen) throw RpcFailure.Permanent("break_open")
        val name = destination.trim()
        require(name.isNotEmpty()) { "destination" }
        val id = newClientId()
        db.withTransaction {
            queue("bdm_travel_start", buildJsonObject {
                put("p", buildJsonObject {
                    put("client_id", id)
                    put("destination", name.take(200))
                    put("purpose", purpose?.trim()?.takeIf { it.isNotEmpty() }?.take(500))
                    fix(fix)
                })
            }, id)
        }
        update { it.copy(state = BdmState.TRAVELLING, visitId = id, visitDestination = name, visitReached = false) }
        return id
    }

    /** Arrived. The photo (if any) uploads separately when there is signal, then is attached. */
    suspend fun reached(fix: RawPoint?, photo: File?) {
        val d = requireOpen()
        val visit = d.visitId ?: throw RpcFailure.Permanent("not_found")
        queue("bdm_reached", buildJsonObject {
            put("p", buildJsonObject {
                put("visit_id", visit)
                fix(fix)
            })
        })
        if (photo != null) addPendingPhoto(visit, photo)
        update { it.copy(state = BdmState.AT_VISIT, visitReached = true) }
    }

    /** [audio] = a recording of the meeting (the BDM told the person it is being recorded). */
    suspend fun completeVisit(result: VisitResult, audio: File? = null, audioSeconds: Int = 0) {
        val d = requireOpen()
        val visit = d.visitId ?: throw RpcFailure.Permanent("not_found")
        require(result.outcome.isNotBlank()) { "outcome" }
        val recordingId = audio?.let {
            recordings.addRecording(kind = "visit", leadId = null, file = it, durationS = audioSeconds, lostNote = false, entityKey = dayKey)
        }
        queue("bdm_visit_complete", buildJsonObject {
            put("p", buildJsonObject {
                put("visit_id", visit)
                put("outcome", result.outcome.trim().take(2000))
                put("contact_name", result.contactName?.trim()?.takeIf { it.isNotEmpty() })
                put("contact_phone", result.contactPhone)
                put("contact_designation", result.contactDesignation?.trim()?.takeIf { it.isNotEmpty() })
                put("interest", result.interest)
                put("recording_id", recordingId)
                result.lead?.let { lead ->
                    put("create_lead", buildJsonObject {
                        put("name", lead.name.trim())
                        put("phone", lead.phoneE164)
                        put("treatment_text", lead.treatment?.trim()?.takeIf { it.isNotEmpty() })
                    })
                }
                put("device_at", Instant.ofEpochMilli(clock()).toString())
            })
        })
        update { it.copy(state = BdmState.TRAVELLING, visitId = null, visitDestination = null, visitReached = false) }
    }

    suspend fun startBreak(typeId: String?, plannedMinutes: Int) {
        val d = requireOpen()
        if (d.breakOpen) throw RpcFailure.Permanent("break_open")
        val id = newClientId()
        queue("bdm_break", buildJsonObject {
            put("p", buildJsonObject {
                put("client_id", id)
                put("action", "start")
                put("type_id", typeId)
                put("planned_minutes", plannedMinutes.coerceIn(5, 180))
                put("device_at", Instant.ofEpochMilli(clock()).toString())
            })
        }, id)
        update { it.copy(breakOpen = true, state = BdmState.ON_BREAK) }
    }

    suspend fun endBreak() {
        val d = requireOpen()
        if (!d.breakOpen) return
        queue("bdm_break", buildJsonObject {
            put("p", buildJsonObject {
                put("action", "end")
                put("device_at", Instant.ofEpochMilli(clock()).toString())
            })
        })
        update {
            it.copy(
                breakOpen = false,
                state = when {
                    it.visitReached -> BdmState.AT_VISIT
                    it.visitId != null -> BdmState.TRAVELLING
                    else -> BdmState.IN_OFFICE
                },
            )
        }
    }

    suspend fun endDay(fix: RawPoint?) {
        requireOpen()
        flushTrack(force = true)
        queue("bdm_end_day", buildJsonObject {
            put("p", buildJsonObject { fix(fix) })
        })
        update { it.copy(ended = true, state = BdmState.OFF_DUTY, breakOpen = false) }
    }

    // ---- Track ----

    suspend fun recordPoint(p: RawPoint) {
        val d = _day.value
        if (!d.open) return
        db.trackPoints().insert(TrackPointEntity(dayId = d.dayId!!, t = p.t, lat = p.lat, lng = p.lng, accuracy = p.accuracyM, mock = p.mock))
    }

    private fun nextSeq(dayId: String?): Int = prefs.getInt(KEY_SEQ + dayId, 0)

    private fun lastKept(dayId: String): RawPoint? =
        prefs.getString(KEY_LAST + dayId, null)?.split('|')?.takeIf { it.size == 4 }?.let {
            RawPoint(it[0].toLong(), it[1].toDouble(), it[2].toDouble(), it[3].toFloat())
        }

    /**
     * Packs the points recorded so far into one chunk and queues it. Points older than a
     * minute are packed (or all of them when [force], e.g. at end of day). Returns the number
     * of points kept after cleaning (0 = nothing to send).
     */
    suspend fun flushTrack(force: Boolean = false): Int {
        val d = _day.value
        val dayId = d.dayId ?: return 0
        val until = if (force) Long.MAX_VALUE else clock() - 60_000
        val raw = db.trackPoints().upTo(dayId, until)
        if (raw.isEmpty()) return 0
        val last = lastKept(dayId)
        val kept = TrackFilter.filter(raw.map { it.toRaw() }, last)
        val cutoff = raw.maxOf { it.t }
        val chunk = TrackChunk.of(kept, last)
        db.withTransaction {
            if (chunk != null) {
                val seq = nextSeq(dayId)
                val id = newClientId()
                outbox.enqueue(
                    "bdm_upload_chunks",
                    buildJsonObject {
                        put("p_chunks", buildJsonArray {
                            add(buildJsonObject {
                                put("id", id)
                                put("day_id", dayId)
                                put("seq", seq)
                                put("started_at", Instant.ofEpochMilli(chunk.startedAt).toString())
                                put("ended_at", Instant.ofEpochMilli(chunk.endedAt).toString())
                                put("polyline", chunk.polyline)
                                put("offsets", buildJsonArray { chunk.offsets.forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) } })
                                put("accuracies", buildJsonArray { chunk.accuracies.forEach { add(kotlinx.serialization.json.JsonPrimitive(it)) } })
                                put("distance_m", chunk.distanceM)
                                if (raw.any { it.mock }) put("flags", buildJsonArray { add(kotlinx.serialization.json.JsonPrimitive("mock_location")) })
                            })
                        })
                    },
                    entityKey = "bdm-track:$dayId",
                    clientId = id,
                )
                val k = kept.last()
                prefs.edit().putInt(KEY_SEQ + dayId, seq + 1).putString(KEY_LAST + dayId, "${k.t}|${k.lat}|${k.lng}|${k.accuracyM}").apply()
            }
            db.trackPoints().deleteUpTo(dayId, cutoff)
        }
        return kept.size
    }

    // ---- Heartbeat, photos, screens ----

    /** Online: tells the admin's map where the phone is and how it is doing. */
    suspend fun heartbeat(status: PhoneStatus): HeartbeatReply {
        val r = rpc.call(
            "bdm_heartbeat",
            buildJsonObject {
                put("p", buildJsonObject {
                    status.fix?.let {
                        put("lat", it.lat)
                        put("lng", it.lng)
                        put("accuracy", it.accuracyM)
                    }
                    put("battery", status.battery)
                    put("charging", status.charging)
                    put("gps_on", status.gpsOn)
                    put("network", status.network)
                    put("app_version", status.appVersion)
                })
            },
        ).jsonObject
        val reply = HeartbeatReply(
            locateNow = r["locate_now"]?.jsonPrimitive?.booleanOrNull ?: false,
            heartbeatMinutes = r["heartbeat_minutes"]?.jsonPrimitive?.intOrNull ?: heartbeatMinutes,
            uploadMinutes = r["upload_minutes"]?.jsonPrimitive?.intOrNull ?: uploadMinutes,
        )
        heartbeatMinutes = reply.heartbeatMinutes
        uploadMinutes = reply.uploadMinutes
        return reply
    }

    private fun addPendingPhoto(visitId: String, photo: File) {
        val set = prefs.getStringSet(KEY_PHOTOS, emptySet()).orEmpty() + "$visitId|${photo.path}"
        prefs.edit().putStringSet(KEY_PHOTOS, set).apply()
    }

    /** Uploads punch photos taken without signal, then attaches each to its visit. */
    suspend fun uploadPendingPhotos(): Int {
        val pending = prefs.getStringSet(KEY_PHOTOS, emptySet()).orEmpty()
        // The visits must be on the server first: wait until the day's queued actions are sent.
        if (pending.isEmpty() || db.outbox().countForEntity(dayKey) > 0) return 0
        var done = 0
        for (entry in pending) {
            val (visitId, path) = entry.split('|', limit = 2).let { it[0] to it[1] }
            val file = File(path)
            if (file.exists()) {
                val fileId = uploader.upload("punch_photo", "image/webp", file, RecordingsRepository.sha256(file), emptyMap(), clientId = photoClientId(visitId))
                rpc.call("bdm_attach_photo", buildJsonObject {
                    put("p_visit_id", visitId)
                    put("p_file_id", fileId)
                })
                file.delete()
                done++
            }
            prefs.edit().putStringSet(KEY_PHOTOS, prefs.getStringSet(KEY_PHOTOS, emptySet()).orEmpty() - entry).apply()
        }
        return done
    }

    /** Online: today's tiles and the month. */
    suspend fun dashboard(): BdmDashboard =
        PearlJson.decodeFromJsonElement(BdmDashboard.serializer(), rpc.call("dashboard_bdm", JsonObject(emptyMap())))

    /** Online: today's visits with km driven vs expected. */
    suspend fun visitsToday(staffId: String): List<BdmVisit> {
        val r = rpc.call("bdm_day_timeline", buildJsonObject {
            put("p_staff_id", staffId)
            put("p_date", LocalDate.parse(today()).toString())
        }).jsonObject
        val visits = r["visits"] ?: return emptyList()
        if (visits is JsonNull) return emptyList()
        return PearlJson.decodeFromJsonElement(kotlinx.serialization.builtins.ListSerializer(BdmVisit.serializer()), visits)
    }

    /** Sign-out / another person: forget the day on this phone. */
    fun clear() {
        prefs.edit().clear().apply()
        _day.value = BdmDay()
    }

    private fun JsonObject.str(key: String): String? = (this[key] as? JsonElement)?.let { if (it is JsonNull) null else it.jsonPrimitive.contentOrNull }

    companion object {
        private const val KEY_DAY = "day"
        private const val KEY_SEQ = "seq:"
        private const val KEY_LAST = "last:"
        private const val KEY_PHOTOS = "photos"
        private const val KEY_HEARTBEAT = "heartbeat_minutes"
        private const val KEY_UPLOAD = "upload_minutes"

        /** Retries of the same upload reuse the same file id on the server. */
        fun selfieClientId(dayClientId: String): String = java.util.UUID.nameUUIDFromBytes("selfie|$dayClientId".toByteArray()).toString()

        fun photoClientId(visitId: String): String = java.util.UUID.nameUUIDFromBytes("punch|$visitId".toByteArray()).toString()
    }
}
