package com.pearl.crm.core.data.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

/** Where the backend is. Both values are browser-safe (they also ship in the web app). */
data class SupabaseConfig(val url: String, val anonKey: String) {
    val isConfigured: Boolean
        get() = (url.startsWith("https://") || url.startsWith("http://")) && anonKey.isNotBlank()

    fun endpoint(path: String): String = url.trimEnd('/') + path
}

/** One JSON setup for the whole app: tolerant of fields the server adds later. */
val PearlJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = false
    encodeDefaults = true
}

internal val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

fun defaultHttpClient(): OkHttpClient = OkHttpClient.Builder()
    .connectTimeout(15, TimeUnit.SECONDS)
    .readTimeout(30, TimeUnit.SECONDS)
    .writeTimeout(30, TimeUnit.SECONDS)
    .build()

/** Status + body text of one HTTP exchange (the body is read fully; responses are small JSON). */
internal data class HttpResult(val status: Int, val body: String)

/** Runs the request off the main thread. Throws IOException when the network fails. */
internal suspend fun OkHttpClient.send(request: Request): HttpResult = withContext(Dispatchers.IO) {
    newCall(request).execute().use { HttpResult(it.code, it.body?.string().orEmpty()) }
}
