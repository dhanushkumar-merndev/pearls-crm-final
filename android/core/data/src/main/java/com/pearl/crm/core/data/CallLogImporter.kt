package com.pearl.crm.core.data

import androidx.room.withTransaction
import com.pearl.crm.core.data.db.AppDatabase
import com.pearl.crm.core.data.db.CallLogEntity
import com.pearl.crm.core.model.CallDirection
import com.pearl.crm.core.model.CallOutcome
import com.pearl.crm.core.model.Phones
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.Instant
import java.util.UUID
import kotlin.math.abs

/** One row of the phone's call log. */
data class DeviceCall(
    /** The call log's own id: the same call always has the same key. */
    val key: String,
    val number: String,
    /** [CallDirection] value. */
    val direction: String,
    val startedAt: Long,
    val durationS: Int,
)

/** Reads the phone's call log, oldest first, calls after [afterMs] (needs READ_CALL_LOG). */
fun interface CallLogSource {
    suspend fun read(afterMs: Long, limit: Int): List<DeviceCall>
}

/**
 * Copies calls with CRM numbers from the phone's call log to the server (`import_call_log`).
 * Every other call is skipped and never leaves the phone. Safe to run any number of times:
 * the server keeps one row per (person, call log key), and so does the phone.
 */
class CallLogImporter(
    private val source: CallLogSource,
    private val db: AppDatabase,
    private val outbox: OutboxWriter,
    private val settings: SettingsStore,
    private val staffId: () -> String?,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    /** Returns how many calls were queued for the server. */
    suspend fun import(): Int {
        val staff = staffId() ?: return 0
        val crm = db.crmNumbers().allLast10().toHashSet()
        // Before the first sync brought the CRM numbers there is nothing to compare with: try later.
        if (crm.isEmpty()) return 0
        val after = settings.callLogImportedUntil.takeIf { it > 0 } ?: (clock() - FIRST_IMPORT_DAYS * DAY_MS)
        val calls = source.read(after, BATCH)
        if (calls.isEmpty()) return 0

        val rows = mutableListOf<CallLogEntity>()
        for (call in calls) {
            val phone = Phones.normalize(call.number) ?: continue
            if (phone.last10 !in crm) continue
            if (db.callLogs().countByDeviceKey(call.key) > 0) continue
            // Notes already saved from the app for this call (before the import saw it): keep those.
            val nearby = db.callLogs().between(call.startedAt - SAME_CALL_MS, call.startedAt + SAME_CALL_MS)
            if (nearby.any { it.phoneE164?.takeLast(10) == phone.last10 && abs(it.startedAt - call.startedAt) <= SAME_CALL_MS }) continue
            rows += CallLogEntity(
                id = idFor(staff, call.key),
                leadId = db.crmNumbers().card(phone.last10)?.leadId,
                phoneE164 = phone.e164,
                direction = call.direction,
                startedAt = call.startedAt,
                durationS = call.durationS,
                outcome = outcomeOf(call),
                notes = null,
                updatedAt = "",
                pending = true,
                deviceCallKey = call.key,
            )
        }
        db.withTransaction {
            if (rows.isNotEmpty()) {
                db.callLogs().insertIgnore(rows)
                outbox.enqueue(
                    "import_call_log",
                    buildJsonObject {
                        put(
                            "p_rows",
                            buildJsonArray {
                                rows.forEach { r ->
                                    add(
                                        buildJsonObject {
                                            put("client_id", r.id)
                                            put("device_call_key", r.deviceCallKey)
                                            put("phone", r.phoneE164)
                                            put("direction", r.direction)
                                            put("started_at", Instant.ofEpochMilli(r.startedAt).toString())
                                            put("duration_s", r.durationS)
                                        },
                                    )
                                }
                            },
                        )
                    },
                    entityKey = "call-import",
                )
            }
            settings.callLogImportedUntil = calls.maxOf { it.startedAt }
        }
        return rows.size
    }

    companion object {
        const val BATCH = 500
        const val FIRST_IMPORT_DAYS = 7L
        private const val DAY_MS = 86_400_000L

        /** The app's own notes and the call log can describe the same call a little apart in time. */
        const val SAME_CALL_MS = 120_000L

        /** Same call → same id on the phone and on the server. */
        fun idFor(staffId: String, key: String): String = UUID.nameUUIDFromBytes("$staffId|call-log|$key".toByteArray()).toString()

        /** Same rule as import_call_log on the server. */
        fun outcomeOf(call: DeviceCall): String? = when {
            call.direction == CallDirection.MISSED -> null
            call.durationS > 0 -> CallOutcome.CONNECTED
            else -> CallOutcome.NO_ANSWER
        }
    }
}
