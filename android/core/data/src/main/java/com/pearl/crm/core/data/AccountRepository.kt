package com.pearl.crm.core.data

import com.pearl.crm.core.data.auth.SessionManager
import com.pearl.crm.core.data.db.OutboxKind
import com.pearl.crm.core.model.RpcTransport
import com.pearl.crm.core.model.StaffProfile
import com.pearl.crm.core.model.StaffRole
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

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
