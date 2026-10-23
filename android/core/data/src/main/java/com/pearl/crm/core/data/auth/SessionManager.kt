package com.pearl.crm.core.data.auth

import com.pearl.crm.core.model.ErrorCodes
import com.pearl.crm.core.model.RpcFailure
import com.pearl.crm.core.model.Username
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

enum class SignOutReason {
    /** The person tapped "Sign out". */
    UserChoice,

    /** The login expired or was ended elsewhere (e.g. password reset by the admin). */
    SessionEnded,

    /** The admin switched the account off. */
    Inactive,

    /** Five wrong PIN tries. */
    PinLockout,

    /** "Forgot PIN": log in again with the password to set a new one. */
    ForgotPin,
}

/**
 * The one place that holds the login. Tokens are refreshed shortly before they expire, and at
 * most once when several calls hit 401 together. An account switched off, or a refresh token
 * the server no longer accepts, ends the session on the next call.
 */
class SessionManager(
    private val auth: AuthApi,
    private val store: SessionStore,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private val mutex = Mutex()
    private val _session = MutableStateFlow(store.load())
    val session: StateFlow<Session?> = _session.asStateFlow()

    private val _lastSignOut = MutableStateFlow<SignOutReason?>(null)

    /** Why the last session ended (shown on the login screen); null after a fresh login. */
    val lastSignOut: StateFlow<SignOutReason?> = _lastSignOut.asStateFlow()

    /** Throws [AuthFailure]. */
    suspend fun signIn(username: String, password: String): Session {
        val tokens = auth.signIn(username, password)
        val session = toSession(tokens, Username.normalize(username))
        if (!session.active) {
            auth.signOut(tokens.accessToken)
            throw AuthFailure.NotActive()
        }
        mutex.withLock {
            store.save(session)
            _session.value = session
            _lastSignOut.value = null
        }
        return session
    }

    /**
     * A token good for at least the next minute (refreshed if needed), or null when nobody is
     * signed in. Throws [RpcFailure.Transient] when it has expired and the phone is offline,
     * [RpcFailure.SignedOut] when the server ended the session.
     */
    suspend fun accessToken(): String? {
        val current = _session.value ?: return null
        if (current.expiresAtMs - clock() > REFRESH_MARGIN_MS) return current.accessToken
        return refresh(current.accessToken, force = false)
    }

    /** The server answered 401 to [staleToken]: refresh once, shared by every caller that saw it. */
    suspend fun refreshAfterUnauthorized(staleToken: String): String? = refresh(staleToken, force = true)

    private suspend fun refresh(staleToken: String, force: Boolean): String? = mutex.withLock {
        val current = _session.value ?: return null
        if (current.accessToken != staleToken) return current.accessToken
        if (!force && current.expiresAtMs - clock() > REFRESH_MARGIN_MS) return current.accessToken
        val next = try {
            toSession(auth.refresh(current.refreshToken), current.username)
        } catch (e: AuthFailure.Offline) {
            if (!force && current.expiresAtMs > clock()) return current.accessToken
            throw RpcFailure.Transient("can't refresh the login while offline", e)
        } catch (e: AuthFailure) {
            val reason = if (e is AuthFailure.NotActive) SignOutReason.Inactive else SignOutReason.SessionEnded
            endLocked(reason)
            throw RpcFailure.SignedOut(if (e is AuthFailure.NotActive) ErrorCodes.STAFF_INACTIVE else ErrorCodes.NOT_SIGNED_IN)
        }
        if (!next.active) {
            endLocked(SignOutReason.Inactive)
            throw RpcFailure.SignedOut(ErrorCodes.STAFF_INACTIVE)
        }
        store.save(next)
        _session.value = next
        next.accessToken
    }

    /** `me()` is the authority on the role; the token's claim may be up to an hour old. */
    suspend fun confirmRole(role: String?) = mutex.withLock {
        val current = _session.value ?: return@withLock
        if (current.role != role) {
            val next = current.copy(role = role)
            store.save(next)
            _session.value = next
        }
    }

    /** Ends the session on this phone (and on the server when the person chose to sign out). */
    suspend fun signOut(reason: SignOutReason) {
        val token = mutex.withLock {
            val token = _session.value?.accessToken
            endLocked(reason)
            token
        }
        if (reason == SignOutReason.UserChoice && token != null) auth.signOut(token)
    }

    private fun endLocked(reason: SignOutReason) {
        store.clear()
        _session.value = null
        _lastSignOut.value = reason
    }

    private fun toSession(tokens: TokenResponse, username: String): Session {
        val claims = Jwt.claims(tokens.accessToken)
        val expiresAt = claims.expiresAtMs
            ?: tokens.expiresAt?.times(1000)
            ?: (clock() + tokens.expiresIn * 1000)
        return Session(
            accessToken = tokens.accessToken,
            refreshToken = tokens.refreshToken,
            expiresAtMs = expiresAt,
            staffId = claims.subject,
            username = username,
            role = claims.role,
            active = claims.active,
        )
    }

    private companion object {
        const val REFRESH_MARGIN_MS = 60_000L
    }
}
