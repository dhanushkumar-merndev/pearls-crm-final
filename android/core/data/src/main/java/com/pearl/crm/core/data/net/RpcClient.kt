package com.pearl.crm.core.data.net

import com.pearl.crm.core.data.auth.SessionManager
import com.pearl.crm.core.data.auth.SignOutReason
import com.pearl.crm.core.model.ErrorCodes
import com.pearl.crm.core.model.RpcFailure
import com.pearl.crm.core.model.RpcTransport
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException

/** PostgREST's error body. For our RPCs `code` is "P0001" and `message` the stable code. */
@Serializable
internal data class PostgrestError(
    val code: String? = null,
    val message: String? = null,
    val details: String? = null,
)

/**
 * Calls Postgres RPC functions as the signed-in person. Sorts every failure into
 * [RpcFailure.Transient] (try later), [RpcFailure.Permanent] (refused) or
 * [RpcFailure.SignedOut] (log in again; the session is ended here).
 */
class RpcClient(
    private val config: SupabaseConfig,
    private val http: OkHttpClient,
    private val sessions: SessionManager,
) : RpcTransport {
    override suspend fun call(fn: String, args: JsonObject): JsonElement {
        val token = sessions.accessToken() ?: throw RpcFailure.SignedOut(ErrorCodes.NOT_SIGNED_IN)
        var result = post(fn, args, token)
        if (result.status == 401) {
            val fresh = sessions.refreshAfterUnauthorized(token)
                ?: throw RpcFailure.SignedOut(ErrorCodes.NOT_SIGNED_IN)
            result = post(fn, args, fresh)
            if (result.status == 401) {
                sessions.signOut(SignOutReason.SessionEnded)
                throw RpcFailure.SignedOut(ErrorCodes.NOT_SIGNED_IN)
            }
        }
        return try {
            interpret(result)
        } catch (e: RpcFailure.SignedOut) {
            sessions.signOut(if (e.code == ErrorCodes.STAFF_INACTIVE) SignOutReason.Inactive else SignOutReason.SessionEnded)
            throw e
        }
    }

    private suspend fun post(fn: String, args: JsonObject, token: String): HttpResult {
        val request = Request.Builder()
            .url(config.endpoint("/rest/v1/rpc/$fn"))
            .header("apikey", config.anonKey)
            .header("Authorization", "Bearer $token")
            .post(args.toString().toRequestBody(JSON_MEDIA))
            .build()
        return try {
            http.send(request)
        } catch (e: IOException) {
            throw RpcFailure.Transient("network: ${e.javaClass.simpleName}", e)
        }
    }

    companion object {
        /** Turns one HTTP answer into a result or the right [RpcFailure]. Public for tests. */
        internal fun interpret(result: HttpResult): JsonElement {
            val (status, body) = result
            if (status in 200..299) return if (body.isBlank()) JsonNull else PearlJson.parseToJsonElement(body)
            if (status >= 500 || status == 408 || status == 429) throw RpcFailure.Transient("HTTP $status")
            val error = runCatching { PearlJson.decodeFromString(PostgrestError.serializer(), body) }.getOrNull()
            // The function isn't on the server yet (the app was updated first): try again later.
            if (error?.code == "PGRST202") throw RpcFailure.Transient("function not on the server yet")
            if (error?.code == "P0001") {
                val code = error.message?.takeIf { it.isNotBlank() } ?: ErrorCodes.UNKNOWN
                if (code in ErrorCodes.SIGN_OUT_CODES) throw RpcFailure.SignedOut(code)
                throw RpcFailure.Permanent(code, error.details)
            }
            ErrorCodes.SQLSTATE_CODES[error?.code]?.let { throw RpcFailure.Permanent(it, error?.message) }
            if (status == 403) throw RpcFailure.Permanent(ErrorCodes.NOT_ALLOWED, error?.message)
            throw RpcFailure.Permanent(ErrorCodes.UNKNOWN, error?.message ?: "HTTP $status")
        }
    }
}
