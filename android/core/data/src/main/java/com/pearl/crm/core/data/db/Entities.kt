package com.pearl.crm.core.data.db

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import com.pearl.crm.core.model.LibraryItem
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive

/** The phone's copy of `public.lookup_values` (lead sources, lost reasons, …), filled by sync. */
@Entity(
    tableName = "lookup_values",
    indices = [Index(value = ["kind", "active", "usage_count"])],
)
data class LookupValueEntity(
    @PrimaryKey val id: String,
    val kind: String,
    val label: String,
    val code: String?,
    val sort: Int,
    val active: Boolean,
    @ColumnInfo(name = "usage_count") val usageCount: Int,
    @ColumnInfo(name = "last_used_at") val lastUsedAt: String?,
    @ColumnInfo(name = "created_on_the_fly") val createdOnTheFly: Boolean,
    @ColumnInfo(name = "reviewed_at") val reviewedAt: String?,
    @ColumnInfo(name = "merged_into_id") val mergedIntoId: String?,
    @ColumnInfo(name = "updated_at") val updatedAt: String,
) {
    /** Same shape as private.library_item builds for lookup kinds. */
    fun toLibraryItem() = LibraryItem(
        id = id,
        label = label,
        subtitle = null,
        onTheFly = createdOnTheFly && reviewedAt == null,
        defaults = buildJsonObject { code?.let { put("code", JsonPrimitive(it)) } },
    )

    companion object {
        /** One `sync_pull` row (columns of public.lookup_values). */
        fun fromRow(row: JsonObject) = LookupValueEntity(
            id = row.text("id") ?: throw IllegalArgumentException("lookup_values row without id"),
            kind = row.text("kind").orEmpty(),
            label = row.text("label").orEmpty(),
            code = row.text("code"),
            sort = row["sort"]?.jsonPrimitive?.intOrNull ?: 100,
            active = row["active"]?.jsonPrimitive?.booleanOrNull ?: true,
            usageCount = row["usage_count"]?.jsonPrimitive?.intOrNull ?: 0,
            lastUsedAt = row.text("last_used_at"),
            createdOnTheFly = row["created_on_the_fly"]?.jsonPrimitive?.booleanOrNull ?: false,
            reviewedAt = row.text("reviewed_at"),
            mergedIntoId = row.text("merged_into_id"),
            updatedAt = row.text("updated_at").orEmpty(),
        )

        private fun JsonObject.text(key: String): String? = this[key]?.jsonPrimitive?.contentOrNull
    }
}

/**
 * A change made on the phone, waiting to be sent. [id] is made on the phone and is also the
 * RPC's `p_client_id`, so sending it twice can never create two rows on the server.
 * Items with the same [entityKey] are sent strictly in [seq] order.
 */
@Entity(
    tableName = "outbox",
    indices = [Index(value = ["entity_key", "seq"]), Index(value = ["state", "next_attempt_at"])],
)
data class OutboxItem(
    @PrimaryKey val id: String,
    /** Insertion order, assigned by [OutboxDao.enqueue]. */
    val seq: Long,
    val rpc: String,
    /** The RPC's arguments as a JSON object. */
    val args: String,
    @ColumnInfo(name = "entity_key") val entityKey: String,
    /** [OutboxKind] wire value. */
    val kind: String,
    @ColumnInfo(name = "created_at") val createdAt: Long,
    val attempts: Int,
    @ColumnInfo(name = "next_attempt_at") val nextAttemptAt: Long,
    @ColumnInfo(name = "last_error") val lastError: String?,
    /** [OutboxState] wire value. Sent items are deleted. */
    val state: String,
)

enum class OutboxState(val wire: String) { Pending("pending"), Failed("failed") }

enum class OutboxKind(val wire: String) {
    /** Something the person did: never dropped without them seeing it. */
    User("user"),

    /** Crash reports and similar: dropped quietly if the server refuses them. */
    Telemetry("telemetry"),
}

/** How far each synced entity has been pulled (`sync_pull` marker). */
@Entity(tableName = "sync_markers")
data class SyncMarker(
    @PrimaryKey val entity: String,
    val marker: String?,
    @ColumnInfo(name = "pulled_at") val pulledAt: Long,
)
