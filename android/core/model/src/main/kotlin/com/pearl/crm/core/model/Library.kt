package com.pearl.crm.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/** Library kinds as `library_search` / `library_create` name them (private.library_spec). */
object LibraryKind {
    const val SERVICE = "service"
    const val TREATMENT_TEMPLATE = "treatment_template"
    const val ROOM_TYPE = "room_type"
    const val PHARMACY_ITEM = "pharmacy_item"
    const val SUPPLIER = "supplier"
    const val DOCTOR = "doctor"
    const val LEAD_SOURCE = "lead_source"
    const val LOST_REASON = "lost_reason"
    const val REFERRAL_NAME = "referral_name"
    const val BILL_CATEGORY = "bill_category"
    const val PAYMENT_MODE = "payment_mode"
    const val RELATION = "relation"
    const val DOCUMENT_KIND = "document_kind"
    const val QUICK_REPLY = "quick_reply"
    const val BREAK_TYPE = "break_type"

    /** Kinds stored in `lookup_values`: these are synced to the phone and work offline. */
    val LOOKUP = setOf(
        LEAD_SOURCE, LOST_REASON, REFERRAL_NAME, BILL_CATEGORY, PAYMENT_MODE,
        RELATION, DOCUMENT_KIND, QUICK_REPLY, BREAK_TYPE,
    )
}

/** One picker row, as private.library_item builds it. */
@Serializable
data class LibraryItem(
    val id: String,
    val label: String,
    val subtitle: String? = null,
    @SerialName("on_the_fly") val onTheFly: Boolean = false,
    val defaults: JsonObject = JsonObject(emptyMap()),
)

/** `library_search` result: up to `limit` items and the cursor for "Load 10 more". */
@Serializable
data class LibraryPage(
    val items: List<LibraryItem> = emptyList(),
    @SerialName("next_cursor") val nextCursor: String? = null,
)

/** Where the picker gets its items (the server, or the phone's copy when offline). */
interface LibrarySource {
    suspend fun search(kind: String, query: String, cursor: String?, limit: Int = 10): LibraryPage

    /** Adds an item on the fly; the admin reviews it later ("New items to review"). */
    suspend fun create(kind: String, label: String, defaults: JsonObject = JsonObject(emptyMap())): LibraryItem
}
