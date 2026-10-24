package com.pearl.crm.core.data.net

import com.pearl.crm.core.data.auth.SessionManager
import com.pearl.crm.core.model.ErrorCodes
import com.pearl.crm.core.model.RpcFailure
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.File
import java.io.IOException

/** Calls one Edge Function as the signed-in person. Same failure kinds as [RpcClient]. */
fun interface FunctionTransport {
    suspend fun call(fn: String, body: JsonObject): JsonElement
}

class EdgeClient(
    private val config: SupabaseConfig,
    private val http: OkHttpClient,
    private val sessions: SessionManager,
) : FunctionTransport {
    override suspend fun call(fn: String, body: JsonObject): JsonElement {
        val token = sessions.accessToken() ?: throw RpcFailure.SignedOut(ErrorCodes.NOT_SIGNED_IN)
        var result = post(fn, body, token)
        if (result.status == 401) {
            val fresh = sessions.refreshAfterUnauthorized(token) ?: throw RpcFailure.SignedOut(ErrorCodes.NOT_SIGNED_IN)
            result = post(fn, body, fresh)
        }
        return interpret(result)
    }

    private suspend fun post(fn: String, body: JsonObject, token: String): HttpResult {
        val request = Request.Builder()
            .url(config.endpoint("/functions/v1/$fn"))
            .header("apikey", config.anonKey)
            .header("Authorization", "Bearer $token")
            .post(body.toString().toRequestBody(JSON_MEDIA))
            .build()
        return try {
            http.send(request)
        } catch (e: IOException) {
            throw RpcFailure.Transient("network: ${e.javaClass.simpleName}", e)
        }
    }

    companion object {
        /** Our functions answer `{"error": "<stable code>"}` when they refuse. */
        internal fun interpret(result: HttpResult): JsonElement {
            val (status, body) = result
            if (status in 200..299) return if (body.isBlank()) JsonNull else PearlJson.parseToJsonElement(body)
            if (status >= 500 || status == 408 || status == 429) throw RpcFailure.Transient("HTTP $status")
            val code = runCatching { PearlJson.parseToJsonElement(body).jsonObject["error"]?.jsonPrimitive?.contentOrNull }.getOrNull()
                ?: if (status == 401) ErrorCodes.NOT_SIGNED_IN else if (status == 403) ErrorCodes.NOT_ALLOWED else ErrorCodes.UNKNOWN
            if (code in ErrorCodes.SIGN_OUT_CODES) throw RpcFailure.SignedOut(code)
            throw RpcFailure.Permanent(code, "HTTP $status")
        }
    }
}

/** Puts one file in private storage and returns its file id (`files-sign` put → PUT → confirm). */
fun interface FileUploader {
    suspend fun upload(purpose: String, mime: String, file: File, sha256: String, link: Map<String, String>, clientId: String): String
}

/**
 * The same [clientId] always means the same file on the server: a retry after a lost answer
 * gets the same file id back (and skips the PUT when the server already has it), so a
 * recording is never stored twice.
 */
class SignedUploader(private val functions: FunctionTransport, private val http: OkHttpClient) : FileUploader {
    override suspend fun upload(purpose: String, mime: String, file: File, sha256: String, link: Map<String, String>, clientId: String): String {
        val put = functions.call(
            "files-sign",
            buildJsonObject {
                put("op", "put")
                put("purpose", purpose)
                put("mime", mime)
                put("size", file.length())
                put("sha256", sha256)
                put("link", JsonObject(link.mapValues { kotlinx.serialization.json.JsonPrimitive(it.value) }))
                put("client_id", clientId)
            },
        ).jsonObject
        val fileId = put["file_id"]?.jsonPrimitive?.contentOrNull ?: throw RpcFailure.Permanent(ErrorCodes.UNKNOWN, "no file id")
        if (put["status"]?.jsonPrimitive?.contentOrNull == "uploaded") return fileId
        val upload = put["upload"]?.jsonObject ?: throw RpcFailure.Permanent(ErrorCodes.UNKNOWN, "no upload link")
        val url = upload["url"]?.jsonPrimitive?.contentOrNull ?: throw RpcFailure.Permanent(ErrorCodes.UNKNOWN, "no upload link")
        val request = Request.Builder().url(url).put(file.asRequestBody(mime.toMediaType())).apply {
            upload["headers"]?.jsonObject?.forEach { (k, v) -> v.jsonPrimitive.contentOrNull?.let { header(k, it) } }
        }.build()
        val result = try {
            http.send(request)
        } catch (e: IOException) {
            throw RpcFailure.Transient("upload: ${e.javaClass.simpleName}", e)
        }
        if (result.status !in 200..299) {
            if (result.status >= 500 || result.status == 408 || result.status == 429) throw RpcFailure.Transient("upload HTTP ${result.status}")
            throw RpcFailure.Permanent("upload_incomplete", "HTTP ${result.status}")
        }
        functions.call("files-sign", buildJsonObject {
            put("op", "confirm")
            put("file_id", fileId)
        })
        return fileId
    }
}
