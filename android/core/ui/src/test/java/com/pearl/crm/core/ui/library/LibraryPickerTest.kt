package com.pearl.crm.core.ui.library

import android.content.Context
import androidx.annotation.StringRes
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pearl.crm.core.model.LibraryItem
import com.pearl.crm.core.model.LibraryKind
import com.pearl.crm.core.model.LibraryPage
import com.pearl.crm.core.model.LibrarySource
import com.pearl.crm.core.model.RpcFailure
import com.pearl.crm.core.ui.R
import com.pearl.crm.core.ui.theme.PearlTheme
import kotlinx.serialization.json.JsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.Collections

/** Stands in for the server: 23 lead sources, 10 per page, "cursor" = offset. */
private class FakeLibrary : LibrarySource {
    val items = (1..20).map { LibraryItem("s$it", "Source %02d".format(it)) } +
        listOf(LibraryItem("r1", "Referral doctor"), LibraryItem("r2", "Referral friend"), LibraryItem("w1", "Walk-in"))

    /** (query, cursor) of every search, in order. */
    val searches: MutableList<Pair<String, String?>> = Collections.synchronizedList(mutableListOf())

    @Volatile
    var offline = false

    override suspend fun search(kind: String, query: String, cursor: String?, limit: Int): LibraryPage {
        searches += query to cursor
        if (offline) throw RpcFailure.Transient("offline")
        val matching = items.filter { query.isEmpty() || it.label.contains(query, ignoreCase = true) }
        val offset = cursor?.toInt() ?: 0
        val end = offset + limit
        return LibraryPage(matching.drop(offset).take(limit), if (end < matching.size) end.toString() else null)
    }

    override suspend fun create(kind: String, label: String, defaults: JsonObject) = LibraryItem("new", label, onTheFly = true)
}

@RunWith(AndroidJUnit4::class)
class LibraryPickerTest {
    @get:Rule
    val compose = createComposeRule()

    private val source = FakeLibrary()
    private val picked = mutableListOf<LibraryItem?>()

    private fun text(@StringRes id: Int) = ApplicationProvider.getApplicationContext<Context>().getString(id)

    private fun showPicker() {
        compose.setContent {
            PearlTheme {
                var value by remember { mutableStateOf<LibraryItem?>(null) }
                LibraryPicker(
                    kind = LibraryKind.LEAD_SOURCE,
                    value = value,
                    onChange = {
                        value = it
                        picked += it
                    },
                    source = source,
                    label = "Lead source",
                )
            }
        }
    }

    private fun open() {
        compose.onNodeWithText(text(R.string.picker_choose)).performClick()
    }

    private fun waitForText(text: String) =
        compose.waitUntil(5_000) { compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty() }

    private fun isShown(text: String) = compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty()

    @Test
    fun opensWithTheFirstPageFromTheSource() {
        showPicker()
        assertTrue(source.searches.isEmpty()) // nothing is loaded until the picker opens
        open()
        waitForText("Source 01")
        compose.onNodeWithText("Source 01").assertExists()
        assertEquals("" to null, source.searches.first())
    }

    @Test
    fun typingSearchesTheSourceWithTheQuery() {
        showPicker()
        open()
        waitForText("Source 01")

        compose.onNode(hasSetTextAction()).performTextInput("Referral")
        waitForText("Referral friend")

        assertTrue(source.searches.contains("Referral" to null))
        compose.onNodeWithText("Referral doctor").assertExists()
        assertTrue(!isShown("Source 01"))
        assertTrue(!isShown(text(R.string.picker_more))) // only two matches
    }

    @Test
    fun loadMoreAppendsTheNextPage() {
        showPicker()
        open()
        waitForText("Source 01")
        val more = text(R.string.picker_more)
        assertTrue(!isShown("Source 11"))

        compose.onNode(hasScrollAction()).performScrollToNode(hasText(more))
        compose.onNodeWithText(more).performClick()
        compose.waitUntil(5_000) { source.searches.size == 2 }
        compose.onNode(hasScrollAction()).performScrollToNode(hasText("Source 20"))

        assertEquals("" to "10", source.searches[1])
        compose.onNodeWithText("Source 20").assertExists()
        // Still more after the second page (23 in all).
        compose.onNode(hasScrollAction()).performScrollToNode(hasText(more))
        compose.onNode(hasScrollAction()).performScrollToNode(hasText("Source 01"))
        compose.onNodeWithText("Source 01").assertExists() // appended, not replaced
    }

    @Test
    fun pickingAnItemReportsItAndClosesThePicker() {
        showPicker()
        open()
        waitForText("Source 02")

        compose.onNodeWithText("Source 02").performClick()
        compose.waitForIdle()

        assertEquals(listOf("s2"), picked.map { it?.id })
        assertTrue(!isShown(text(R.string.picker_search))) // the search screen is gone
        compose.onNodeWithText("Source 02").assertExists() // shown in the field
    }

    @Test
    fun offlineShowsTheOfflineMessageAndTryAgainWorks() {
        source.offline = true
        showPicker()
        open()
        val offline = text(R.string.common_offline)
        waitForText(offline)
        assertTrue(!isShown("Source 01"))

        source.offline = false
        compose.onNodeWithText(text(R.string.common_try_again)).performClick()
        waitForText("Source 01")
        assertTrue(!isShown(offline))
    }
}
