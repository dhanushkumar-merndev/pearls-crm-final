package com.pearl.crm.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * Server contract for `sync_pull(p_since jsonb default '{}', p_limit integer default 200)`.
 *
 * Request `p_since`: `{"<entity>": "<marker from the last pull>" | null}` (null = from scratch).
 * Response: `{"server_time": "…", "entities": {"<entity>": {"rows": [...], "removed": [...],
 * "next": "<opaque marker>", "has_more": bool}}}`. Every row has `id` (uuid) and `updated_at`.
 * `removed` lists ids the phone must delete (deleted, or no longer visible to this person,
 * e.g. a lead reassigned to someone else). The server answers only the entities it knows.
 */
@Serializable
data class SyncPullResponse(
    @SerialName("server_time") val serverTime: String? = null,
    val entities: Map<String, SyncEntityPage> = emptyMap(),
)

@Serializable
data class SyncEntityPage(
    val rows: List<JsonObject> = emptyList(),
    val removed: List<String> = emptyList(),
    val next: String? = null,
    @SerialName("has_more") val hasMore: Boolean = false,
)

/** Entity names used in `sync_pull` (more arrive with the leads and calls stages). */
object SyncEntityName {
    const val LOOKUP_VALUES = "lookup_values"
    const val LEADS = "leads"
    const val FOLLOWUPS = "followups"
    const val APPOINTMENTS = "appointments"
    const val CALL_LOGS = "call_logs"
    const val CRM_NUMBERS = "crm_numbers"
}
