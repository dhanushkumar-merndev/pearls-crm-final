package com.pearl.crm

import android.os.Build
import com.pearl.crm.core.data.OutboxWriter
import com.pearl.crm.core.data.db.OutboxKind
import com.pearl.crm.core.data.net.PearlJson
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import java.io.File

/**
 * Uncaught errors are written to a small file at once (the process is about to die, so no
 * database or network), then sent to `report_client_error` through the outbox on the next
 * start once someone is signed in. At most [MAX_FILES] reports wait at a time.
 */
class CrashReporter(private val dir: File, private val appVersion: String) {
    fun install() {
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { thread, error ->
            runCatching { save(thread.name, error) }
            previous?.uncaughtException(thread, error)
        }
    }

    internal fun save(threadName: String, error: Throwable, now: Long = System.currentTimeMillis()) {
        dir.mkdirs()
        if ((dir.list()?.size ?: 0) >= MAX_FILES) return
        val report = buildJsonObject {
            put("p_app", "android")
            put("p_message", error.toString().take(2000))
            put("p_stack", error.stackTraceToString().take(8000))
            put(
                "p_context",
                buildJsonObject {
                    put("thread", threadName)
                    put("at", now)
                    put("device", "${Build.MANUFACTURER} ${Build.MODEL}")
                    put("sdk", Build.VERSION.SDK_INT)
                },
            )
            put("p_app_version", appVersion)
        }
        File(dir, "crash-$now.json").writeText(report.toString())
    }

    /** Moves saved reports into the outbox (they are dropped quietly if the server refuses). */
    suspend fun flush(outbox: OutboxWriter) = withContext(Dispatchers.IO) {
        val files = dir.listFiles { file -> file.name.endsWith(".json") }?.sortedBy { it.name } ?: return@withContext
        for (file in files) {
            val args = runCatching { PearlJson.parseToJsonElement(file.readText()).jsonObject }.getOrNull()
            if (args != null) outbox.enqueue("report_client_error", JsonObject(args), entityKey = "telemetry", kind = OutboxKind.Telemetry)
            file.delete()
        }
    }

    private companion object {
        const val MAX_FILES = 20
    }
}
