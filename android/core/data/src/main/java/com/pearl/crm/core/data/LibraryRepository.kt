package com.pearl.crm.core.data

import com.pearl.crm.core.data.db.LookupValueDao
import com.pearl.crm.core.data.net.PearlJson
import com.pearl.crm.core.model.LibraryItem
import com.pearl.crm.core.model.LibraryKind
import com.pearl.crm.core.model.LibraryPage
import com.pearl.crm.core.model.LibrarySource
import com.pearl.crm.core.model.RpcFailure
import com.pearl.crm.core.model.RpcTransport
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Picker data: the server's `library_search` / `library_create`. When offline, lookup kinds
 * (lead sources, lost reasons, …) are searched in the phone's synced copy instead. Adding a
 * new item needs the connection (the server may already have one with that name).
 */
class LibraryRepository(
    private val rpc: RpcTransport,
    private val lookups: LookupValueDao,
) : LibrarySource {
    override suspend fun search(kind: String, query: String, cursor: String?, limit: Int): LibraryPage {
        if (cursor != null && cursor.startsWith(LOCAL_CURSOR)) return searchLocal(kind, query, cursor, limit)
        val args = buildJsonObject {
            put("p_kind", kind)
            put("p_q", query.trim())
            put("p_cursor", cursor)
            put("p_limit", limit)
        }
        return try {
            PearlJson.decodeFromJsonElement(LibraryPage.serializer(), rpc.call("library_search", args))
        } catch (e: RpcFailure.Transient) {
            if (kind !in LibraryKind.LOOKUP) throw e
            searchLocal(kind, query, null, limit)
        }
    }

    override suspend fun create(kind: String, label: String, defaults: JsonObject): LibraryItem {
        val args = buildJsonObject {
            put("p_kind", kind)
            put("p_payload", JsonObject(defaults + ("label" to JsonPrimitive(label.trim()))))
            put("p_client_id", newClientId())
        }
        return PearlJson.decodeFromJsonElement(LibraryItem.serializer(), rpc.call("library_create", args))
    }

    private suspend fun searchLocal(kind: String, query: String, cursor: String?, limit: Int): LibraryPage {
        val offset = cursor?.removePrefix(LOCAL_CURSOR)?.toIntOrNull() ?: 0
        val rows = lookups.search(kind, escapeLike(query.trim()), limit + 1, offset)
        return LibraryPage(
            items = rows.take(limit).map { it.toLibraryItem() },
            nextCursor = if (rows.size > limit) "$LOCAL_CURSOR${offset + limit}" else null,
        )
    }

    private companion object {
        /** Cursors from the offline copy; never sent to the server. */
        const val LOCAL_CURSOR = "local:"

        fun escapeLike(text: String): String =
            text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    }
}
