package com.pearl.crm.core.sync

import com.pearl.crm.core.data.db.LookupValueDao
import com.pearl.crm.core.data.db.LookupValueEntity
import com.pearl.crm.core.data.db.SyncMarker
import com.pearl.crm.core.data.db.SyncMarkerDao
import com.pearl.crm.core.data.net.PearlJson
import com.pearl.crm.core.model.RpcTransport
import com.pearl.crm.core.model.SyncEntityName
import com.pearl.crm.core.model.SyncPullResponse
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * One kind of row the phone keeps a copy of. Adding leads, follow-ups, … later = one
 * [SyncEntity] + its DAO, registered in the app's list.
 */
interface SyncEntity {
    /** Name in the `sync_pull` contract (see [SyncEntityName]). */
    val name: String

    /** Saves one page: upsert [rows], delete [removed] ids. Runs inside a transaction. */
    suspend fun apply(rows: List<JsonObject>, removed: List<String>)
}

/** `lookup_values` (lead sources, lost reasons, referral names, …). */
class LookupValuesSync(private val dao: LookupValueDao) : SyncEntity {
    override val name = SyncEntityName.LOOKUP_VALUES

    override suspend fun apply(rows: List<JsonObject>, removed: List<String>) {
        // A malformed row is skipped rather than blocking every later pull.
        dao.upsert(rows.mapNotNull { runCatching { LookupValueEntity.fromRow(it) }.getOrNull() })
        removed.chunked(MAX_SQL_ARGS).forEach { dao.deleteByIds(it) }
    }
}

/** SQLite on older phones allows 999 bound values per statement. */
internal const val MAX_SQL_ARGS = 500

/**
 * Pulls what changed since the last sync for every registered entity, page by page, until
 * the server says there is no more. Each entity page and its marker are saved in one
 * transaction, so a crash mid-way never skips rows.
 */
class PullEngine(
    private val transport: RpcTransport,
    private val entities: List<SyncEntity>,
    private val markers: SyncMarkerDao,
    private val inTransaction: suspend (suspend () -> Unit) -> Unit,
    private val clock: () -> Long = System::currentTimeMillis,
    private val pageSize: Int = 200,
) {
    data class Outcome(val rounds: Int, val rows: Int, val removed: Int)

    /** Throws [com.pearl.crm.core.model.RpcFailure] when a round fails (earlier rounds stay saved). */
    suspend fun pull(): Outcome {
        val byName = entities.associateBy { it.name }
        var wanted = byName.keys.toList()
        var rounds = 0
        var rows = 0
        var removed = 0
        while (wanted.isNotEmpty() && rounds < MAX_ROUNDS) {
            rounds++
            val before = wanted.associateWith { markers.marker(it) }
            val args = buildJsonObject {
                put("p_since", buildJsonObject { before.forEach { (entity, marker) -> put(entity, marker) } })
                put("p_limit", pageSize)
            }
            val response = PearlJson.decodeFromJsonElement(SyncPullResponse.serializer(), transport.call("sync_pull", args))
            val again = mutableListOf<String>()
            for ((name, page) in response.entities) {
                val entity = byName[name] ?: continue
                inTransaction {
                    entity.apply(page.rows, page.removed)
                    markers.set(SyncMarker(name, page.next ?: markers.marker(name), clock()))
                }
                rows += page.rows.size
                removed += page.removed.size
                // Ask again only if the server moved the marker (protects against a loop).
                if (page.hasMore && name in before && page.next != null && page.next != before[name]) again += name
            }
            wanted = again
        }
        return Outcome(rounds, rows, removed)
    }

    private companion object {
        /** 200 rows × 100 rounds per entity per sync; the next sync carries on from the marker. */
        const val MAX_ROUNDS = 100
    }
}
