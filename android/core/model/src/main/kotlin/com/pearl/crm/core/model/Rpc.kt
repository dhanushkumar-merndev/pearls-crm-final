package com.pearl.crm.core.model

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/** Calls one Postgres RPC function (PostgREST `POST /rest/v1/rpc/<fn>`). Throws [RpcFailure]. */
fun interface RpcTransport {
    suspend fun call(fn: String, args: JsonObject): JsonElement
}

/** Why a call failed, in the three ways the app reacts to. */
sealed class RpcFailure(message: String, cause: Throwable? = null) : Exception(message, cause) {
    /** No connection, timeout, server busy (5xx, 408, 429) or not updated yet: try again later. */
    class Transient(message: String, cause: Throwable? = null) : RpcFailure(message, cause)

    /**
     * The server refused for good. [code] is a stable code from packages/shared/src/errors.ts
     * (or "unknown"); [detail] is the server's extra text, for logs only.
     */
    class Permanent(val code: String, val detail: String? = null) : RpcFailure(code)

    /** The login is no longer valid (refresh failed, account switched off): sign in again. */
    class SignedOut(val code: String) : RpcFailure(code)
}

object ErrorCodes {
    const val UNKNOWN = "unknown"
    const val NOT_SIGNED_IN = "not_signed_in"
    const val STAFF_INACTIVE = "staff_inactive"
    const val NOT_ALLOWED = "not_allowed"

    /** Codes that mean "this login is over" rather than "this action was refused". */
    val SIGN_OUT_CODES = setOf(NOT_SIGNED_IN, STAFF_INACTIVE)

    /**
     * Postgres errors that reach the app from table writes. Same table as SQLSTATE_CODES in
     * packages/shared/src/errors.ts.
     */
    val SQLSTATE_CODES = mapOf(
        "23P01" to "overlap",
        "23505" to "duplicate",
        "23503" to "in_use",
        "23514" to "invalid_input",
        "22P02" to "invalid_input",
        "42501" to NOT_ALLOWED,
    )
}
