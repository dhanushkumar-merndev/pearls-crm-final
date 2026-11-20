package com.pearl.crm.core.data.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException

/**
 * Files in the public "public-assets" bucket (the clinic logo set in Admin → Clinic profile), the
 * same address the web's print pages use. Returns null when offline or the file is missing, so a
 * PDF can still be made without it.
 */
class PublicAssets(private val config: SupabaseConfig, private val http: OkHttpClient) {
    suspend fun bytes(path: String): ByteArray? {
        if (!config.isConfigured || path.isBlank() || path.contains("..")) return null
        val url = config.endpoint("/storage/v1/object/public/public-assets/" + path.trimStart('/'))
        return withContext(Dispatchers.IO) {
            try {
                http.newCall(Request.Builder().url(url).get().build()).execute().use { r ->
                    val body = r.body
                    if (!r.isSuccessful || body == null || body.contentLength() > MAX_BYTES) null
                    else body.bytes().takeIf { it.size <= MAX_BYTES }
                }
            } catch (_: IOException) {
                null
            } catch (_: IllegalArgumentException) {
                null
            }
        }
    }

    private companion object {
        /** A logo is drawn down to 512 px when saved; anything far bigger is not a logo. */
        const val MAX_BYTES = 3L * 1024 * 1024
    }
}
