package com.pearl.crm.core.data

import com.pearl.crm.core.data.auth.SessionManager
import com.pearl.crm.core.data.db.OutboxKind
import com.pearl.crm.core.model.RpcTransport
import com.pearl.crm.core.model.StaffProfile
import com.pearl.crm.core.model.StaffRole
import java.time.OffsetDateTime
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** One alert (the web's bell), from `my_notifications`. [link] is a web path, e.g. "/appointments?auto=1". */
data class Alert(
    val id: String,
    val type: String,
    val title: String,
    val body: String?,
    val link: String?,
    val read: Boolean,
    val createdAt: Long?,
)

/** The signed-in person's profile and device registration. */
class AccountRepository(
    private val rpc: RpcTransport,
    private val sessions: SessionManager,
    private val outbox: OutboxWriter,
) {
    /** `me()`: confirms the role (and that the account is still active — else it signs out). */
    suspend fun refreshProfile(): StaffProfile {
        val json = rpc.call("me", JsonObject(emptyMap())).jsonObject
        fun text(key: String) = json[key]?.jsonPrimitive?.contentOrNull
        val role = text("role")
        sessions.confirmRole(role)
        return StaffProfile(
            id = text("id").orEmpty(),
            role = StaffRole.fromWire(role),
            fullName = text("full_name").orEmpty(),
            username = text("username"),
        )
    }

    /** Newest alerts first (online only). */
    suspend fun alerts(limit: Int = 50): List<Alert> =
        rpc.call("my_notifications", buildJsonObject { put("p_limit", limit) }).jsonArray.mapNotNull { element ->
            val o = element as? JsonObject ?: return@mapNotNull null
            fun text(key: String) = o[key]?.jsonPrimitive?.contentOrNull
            Alert(
                id = text("id") ?: return@mapNotNull null,
                type = text("type").orEmpty(),
                title = text("title").orEmpty(),
                body = text("body"),
                link = text("link"),
                read = o["read"]?.jsonPrimitive?.booleanOrNull ?: false,
                createdAt = text("created_at")?.let { runCatching { OffsetDateTime.parse(it).toInstant().toEpochMilli() }.getOrNull() },
            )
        }

    /** Marks these alerts read (null = all of mine). Online only. */
    suspend fun markAlertsRead(ids: List<String>?) {
        val list = ids?.let { JsonArray(it.map(::JsonPrimitive)) } ?: JsonNull
        rpc.call("mark_notifications_read", JsonObject(mapOf("p_ids" to list)))
    }

    /** Push token for this phone (`register_device`); queued, so it also works offline. */
    suspend fun registerPushToken(token: String, appVersion: String) {
        val args = buildJsonObject {
            put("p_token", token)
            put("p_platform", "android")
            put("p_app_version", appVersion)
        }
        outbox.enqueue("register_device", args, entityKey = "device", kind = OutboxKind.Telemetry)
    }
}
