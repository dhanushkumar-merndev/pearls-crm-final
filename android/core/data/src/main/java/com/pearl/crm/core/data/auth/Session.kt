package com.pearl.crm.core.data.auth

import com.pearl.crm.core.data.net.PearlJson
import com.pearl.crm.core.data.security.SecurePrefs
import com.pearl.crm.core.model.StaffRole
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import java.util.Base64

/** A signed-in person on this phone. */
@Serializable
data class Session(
    val accessToken: String,
    val refreshToken: String,
    /** Epoch milliseconds when [accessToken] stops working. */
    val expiresAtMs: Long,
    val staffId: String,
    val username: String,
    /** From the login token's `app_role` claim, then confirmed by `me()`. Wire value. */
    val role: String?,
    val active: Boolean,
) {
    val staffRole: StaffRole?
        get() = StaffRole.fromWire(role)
}

/** Claims the login-token hook adds (supabase/migrations/…_foundation.sql: app_role, staff_active). */
data class TokenClaims(val subject: String, val expiresAtMs: Long?, val role: String?, val active: Boolean)

object Jwt {
    /** Reads the payload without checking the signature: the server checks it on every call. */
    fun claims(token: String): TokenClaims {
        val payload = token.split(".").getOrNull(1) ?: throw IllegalArgumentException("not a JWT")
        val json = PearlJson.parseToJsonElement(String(Base64.getUrlDecoder().decode(payload), Charsets.UTF_8)).jsonObject
        return TokenClaims(
            subject = json.string("sub") ?: throw IllegalArgumentException("no subject"),
            expiresAtMs = json["exp"]?.jsonPrimitive?.longOrNull?.times(1000),
            role = json.string("app_role"),
            active = json["staff_active"]?.jsonPrimitive?.booleanOrNull ?: false,
        )
    }

    private fun JsonObject.string(key: String): String? = this[key]?.jsonPrimitive?.contentOrNull
}

/** Keeps the session encrypted on the phone. */
class SessionStore(private val prefs: SecurePrefs) {
    fun load(): Session? = prefs.getString(KEY)?.let {
        runCatching { PearlJson.decodeFromString(Session.serializer(), it) }.getOrNull()
    }

    fun save(session: Session) = prefs.putString(KEY, PearlJson.encodeToString(Session.serializer(), session))

    fun clear() = prefs.remove(KEY)

    private companion object {
        const val KEY = "session"
    }
}
