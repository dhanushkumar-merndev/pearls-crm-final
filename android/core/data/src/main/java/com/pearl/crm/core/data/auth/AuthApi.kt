package com.pearl.crm.core.data.auth

import com.pearl.crm.core.data.net.HttpResult
import com.pearl.crm.core.data.net.JSON_MEDIA
import com.pearl.crm.core.data.net.PearlJson
import com.pearl.crm.core.data.net.SupabaseConfig
import com.pearl.crm.core.data.net.send
import com.pearl.crm.core.model.Username
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

@Serializable
data class TokenResponse(
    @SerialName("access_token") val accessToken: String,
    @SerialName("refresh_token") val refreshToken: String,
    @SerialName("expires_in") val expiresIn: Long = 3600,
    @SerialName("expires_at") val expiresAt: Long? = null,
)

/** Why logging in (or refreshing the login) failed. */
sealed class AuthFailure(message: String, cause: Throwable? = null) : Exception(message, cause) {
    class WrongCredentials : AuthFailure("wrong username or password")
    class TooManyTries : AuthFailure("rate limited")
    class NotActive : AuthFailure("account switched off")

    /** The refresh token no longer works: log in again. */
    class SessionEnded : AuthFailure("session ended")

    /** No connection or the server is busy: nothing is wrong with the login itself. */
    class Offline(cause: Throwable? = null) : AuthFailure("offline", cause)
}

@Serializable
private data class GoTrueError(
    val code: String? = null,
    @SerialName("error_code") val errorCode: String? = null,
    val error: String? = null,
)

/** Supabase Auth (GoTrue) password grant, refresh and logout — nothing else is used. */
class AuthApi(private val config: SupabaseConfig, private val http: OkHttpClient) {
    suspend fun signIn(username: String, password: String): TokenResponse {
        val body = buildJsonObject {
            put("email", Username.toLoginEmail(username))
            put("password", password)
        }
        return token("password", body.toString(), refreshing = false)
    }

    suspend fun refresh(refreshToken: String): TokenResponse {
        val body = buildJsonObject { put("refresh_token", refreshToken) }
        return token("refresh_token", body.toString(), refreshing = true)
    }

    /** Ends the session on the server too (best effort: signing out works offline). */
    suspend fun signOut(accessToken: String) {
        val request = Request.Builder()
            .url(config.endpoint("/auth/v1/logout?scope=local"))
            .header("apikey", config.anonKey)
            .header("Authorization", "Bearer $accessToken")
            .post(ByteArray(0).toRequestBody(null))
            .build()
        try {
            http.send(request)
        } catch (_: IOException) {
            // Offline: the tokens are deleted on the phone anyway and expire on their own.
        }
    }

    private suspend fun token(grant: String, json: String, refreshing: Boolean): TokenResponse {
        val request = Request.Builder()
            .url(config.endpoint("/auth/v1/token?grant_type=$grant"))
            .header("apikey", config.anonKey)
            .post(json.toRequestBody(JSON_MEDIA))
            .build()
        val result = try {
            http.send(request)
        } catch (e: IOException) {
            throw AuthFailure.Offline(e)
        }
        if (result.status in 200..299) return PearlJson.decodeFromString(TokenResponse.serializer(), result.body)
        throw failure(result, refreshing)
    }

    private fun failure(result: HttpResult, refreshing: Boolean): AuthFailure {
        if (result.status >= 500 || result.status == 408) return AuthFailure.Offline()
        val error = runCatching { PearlJson.decodeFromString(GoTrueError.serializer(), result.body) }.getOrNull()
        val code = error?.errorCode ?: error?.error ?: error?.code
        return when {
            result.status == 429 || code == "over_request_rate_limit" -> AuthFailure.TooManyTries()
            code == "user_banned" -> AuthFailure.NotActive()
            refreshing -> AuthFailure.SessionEnded()
            else -> AuthFailure.WrongCredentials()
        }
    }
}
