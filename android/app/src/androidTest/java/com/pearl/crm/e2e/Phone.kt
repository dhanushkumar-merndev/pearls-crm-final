package com.pearl.crm.e2e

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.ParcelFileDescriptor
import androidx.annotation.StringRes
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.AndroidComposeTestRule
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.printToString
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import com.pearl.crm.AppContainer
import com.pearl.crm.PearlApplication
import com.pearl.crm.core.data.LeadDraft
import com.pearl.crm.core.data.net.RpcClient
import com.pearl.crm.core.data.net.defaultHttpClient
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Assume.assumeTrue
import java.util.UUID

/**
 * Shared helpers for the on-device tests. They run against the online staging project with its
 * fake logins (sales, bdm); `pnpm phone:test` passes the password and options as instrumentation
 * arguments, so nothing secret is in the code.
 */
object Phone {
    const val PIN = "2468"
    private val instrumentation get() = InstrumentationRegistry.getInstrumentation()

    fun arg(name: String): String? = InstrumentationRegistry.getArguments().getString(name)?.takeIf { it.isNotBlank() }

    val password: String get() = arg("e2ePassword") ?: error("Run these with `pnpm phone:test` (it passes the staging test password).")
    val app: PearlApplication get() = ApplicationProvider.getApplicationContext()
    val c: AppContainer get() = app.container
    val device: UiDevice get() = UiDevice.getInstance(instrumentation)

    /** The app's own server client, as the signed-in person (to check what reached the server). */
    val rpc: RpcClient by lazy { RpcClient(c.config, defaultHttpClient(), c.sessions) }

    fun text(@StringRes id: Int, vararg args: Any): String = app.getString(id, *args)

    /** A shell command with the phone's shell rights (permissions, app-ops, airplane mode). */
    fun shell(command: String): String {
        val fd = instrumentation.uiAutomation.executeShellCommand(command)
        return ParcelFileDescriptor.AutoCloseInputStream(fd).bufferedReader().use { it.readText() }
    }

    fun grant(vararg permissions: String) = permissions.forEach { shell("pm grant ${app.packageName} $it") }

    /** A unique, valid Indian mobile for test data (9 + 9 digits). */
    fun uniquePhone(): String = "9" + (UUID.randomUUID().mostSignificantBits and Long.MAX_VALUE).toString().takeLast(9).padStart(9, '1')

    /** Signed in as [username] with a PIN set and the app unlocked; lists synced. Logs in only when needed. */
    fun signedIn(username: String) = runBlocking {
        val now = c.sessions.session.value
        if (now?.username != username) {
            if (now != null) c.signOutByChoice()
            c.sessions.signIn(username, password)
        }
        if (!c.pins.hasPin.value) c.pins.set(PIN)
        c.settings.lastBackgroundAt = System.currentTimeMillis()
        c.lock.unlock()
        // A change an earlier test left refused would make every later "all sent" check wait forever.
        c.db.outbox().observeFailed().first().forEach { c.db.outbox().delete(it.id) }
        c.syncRunner.runOnce()
    }

    /** Syncs until nothing is waiting to be sent (a just-tapped save may queue a moment later). */
    fun sentAll(timeoutMs: Long = 60_000) = runBlocking {
        val deadline = System.currentTimeMillis() + timeoutMs
        do {
            c.syncRunner.runOnce()
            if (c.db.outbox().pendingCount() == 0 && c.db.outbox().unsentCount() == 0) return@runBlocking
            Thread.sleep(1_000)
        } while (System.currentTimeMillis() < deadline)
        error("still ${c.db.outbox().unsentCount()} change(s) not sent after ${timeoutMs / 1000} s")
    }

    fun signedOut() = runBlocking { if (c.sessions.session.value != null) c.signOutByChoice() }

    /** Airplane mode on (offline) or off; waits until the phone really is offline / online again. */
    fun online(on: Boolean) {
        shell("cmd connectivity airplane-mode ${if (on) "disable" else "enable"}")
        if (on) {
            // Wi-Fi may stay off after airplane mode on some phones.
            shell("svc wifi enable")
            shell("svc data enable")
        }
        val cm = app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val deadline = System.currentTimeMillis() + 45_000
        while (System.currentTimeMillis() < deadline) {
            val caps = cm.getNetworkCapabilities(cm.activeNetwork)
            val up = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) == true
            if (up == on) return
            Thread.sleep(500)
        }
        error("The phone did not go ${if (on) "online" else "offline"} within 45 s")
    }

    /**
     * This person's leads with that number, straight from the server: `sync_pull` from the start,
     * the phone's own copy untouched (a background sync may be running at the same time).
     */
    fun serverLeads(last10: String): List<JsonObject> = runBlocking {
        val found = mutableListOf<JsonObject>()
        var since: JsonElement = JsonNull
        repeat(50) {
            val args = buildJsonObject {
                put("p_since", buildJsonObject { put("leads", since) })
                put("p_limit", 500)
            }
            val page = rpc.call("sync_pull", args).jsonObject["entities"]?.jsonObject?.get("leads")?.jsonObject ?: return@runBlocking found
            val rows = page["rows"]?.jsonArray.orEmpty()
            rows.map { it.jsonObject }.filterTo(found) { row ->
                row["phone_last10"]?.jsonPrimitive?.contentOrNull == last10 ||
                    row["phone_e164"]?.jsonPrimitive?.contentOrNull?.endsWith(last10) == true
            }
            val next = page["next"]?.takeUnless { it is JsonNull }
            if (rows.isEmpty() || next == null || next == since) return@runBlocking found
            since = next
        }
        found
    }

    fun serverLeadCount(last10: String): Int = serverLeads(last10).size

    /** A lead made the quick way (repository + sync), for tests about what comes after. Returns (id, 10-digit phone). */
    fun leadOnServer(name: String = "E2E Phone ${System.currentTimeMillis()}", phone: String = uniquePhone()): Pair<String, String> = runBlocking {
        val id = c.sales.createLead(LeadDraft(name, phone, null, null, null))
        sentAll()
        id to phone
    }

    fun skipUnless(condition: Boolean, why: String) = assumeTrue(why, condition)
}

/** The clickable thing showing [label] (its text or its name for screen readers), once it is on screen. */
fun <A : androidx.activity.ComponentActivity> AndroidComposeTestRule<*, A>.button(label: String, timeoutMs: Long = 20_000): SemanticsNodeInteraction {
    val m = (hasText(label) or hasContentDescription(label)) and hasClickAction()
    waitUntil(timeoutMs) { exists(m) }
    return onAllNodes(m).onFirst()
}

fun <A : androidx.activity.ComponentActivity> AndroidComposeTestRule<*, A>.exists(matcher: SemanticsMatcher) =
    onAllNodes(matcher).fetchSemanticsNodes().isNotEmpty()

/** Waits (up to [timeoutMs]) until some node shows [text]. */
fun <A : androidx.activity.ComponentActivity> AndroidComposeTestRule<*, A>.waitForText(text: String, timeoutMs: Long = 20_000, substring: Boolean = false) =
    waitUntil(timeoutMs) { exists(hasText(text, substring = substring)) }

/**
 * On a failed test: a screenshot and the screen's element tree, copied to /data/local/tmp/e2e-failures
 * on the phone (it outlives the app, which is removed after the run); `pnpm phone:test` pulls them.
 */
class FailureCapture(private val compose: AndroidComposeTestRule<*, *>) : org.junit.rules.TestWatcher() {
    override fun failed(e: Throwable?, description: org.junit.runner.Description) {
        val dir = java.io.File(Phone.app.getExternalFilesDir(null), "e2e-failures").apply { mkdirs() }
        val name = "${description.testClass.simpleName}.${description.methodName}"
        runCatching { java.io.File(dir, "$name.txt").writeText(compose.onRoot().printToString(maxDepth = Int.MAX_VALUE)) }
        Phone.shell("mkdir -p $DIR")
        Phone.shell("screencap -p $DIR/$name.png")
        Phone.shell("cp ${dir.absolutePath}/$name.txt $DIR/")
    }

    companion object {
        const val DIR = "/data/local/tmp/e2e-failures"
    }
}
