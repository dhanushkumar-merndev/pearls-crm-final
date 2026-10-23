package com.pearl.crm.core.data.security

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

sealed interface PinCheck {
    data object Ok : PinCheck
    data class Wrong(val triesLeft: Int) : PinCheck

    /** Too many wrong tries: the PIN is wiped and the person must log in again. */
    data object LockedOut : PinCheck
    data object NoPin : PinCheck
}

/**
 * The app PIN (4–6 digits), asked when the app comes back after 5 minutes away. Only a salted
 * PBKDF2 hash is kept, and that record itself is encrypted ([SecurePrefs]). Five wrong tries
 * wipe it; the caller then signs the person out.
 */
class PinStore(private val prefs: SecurePrefs, private val random: SecureRandom = SecureRandom()) {
    fun hasPin(): Boolean = prefs.getString(KEY_HASH) != null

    fun setPin(pin: String) {
        require(isValidPin(pin)) { "PIN must be 4–6 digits" }
        val salt = ByteArray(16).also(random::nextBytes)
        val hash = derive(pin, salt, ITERATIONS)
        prefs.putString(KEY_HASH, listOf("v1", ITERATIONS, b64(salt), b64(hash)).joinToString(":"))
        prefs.putString(KEY_TRIES, "0")
    }

    fun verify(pin: String): PinCheck {
        val parts = prefs.getString(KEY_HASH)?.split(":") ?: return PinCheck.NoPin
        if (parts.size != 4 || parts[0] != "v1") {
            clear()
            return PinCheck.NoPin
        }
        val salt = Base64.getDecoder().decode(parts[2])
        val expected = Base64.getDecoder().decode(parts[3])
        val actual = derive(pin, salt, parts[1].toInt())
        if (MessageDigest.isEqual(expected, actual)) {
            prefs.putString(KEY_TRIES, "0")
            return PinCheck.Ok
        }
        val tries = (prefs.getString(KEY_TRIES)?.toIntOrNull() ?: 0) + 1
        if (tries >= MAX_TRIES) {
            clear()
            return PinCheck.LockedOut
        }
        prefs.putString(KEY_TRIES, tries.toString())
        return PinCheck.Wrong(MAX_TRIES - tries)
    }

    fun clear() = prefs.remove(KEY_HASH, KEY_TRIES)

    companion object {
        const val MAX_TRIES = 5
        const val MIN_LENGTH = 4
        const val MAX_LENGTH = 6
        private val PIN_PATTERN = Regex("^\\d{4,6}$")
        private const val ITERATIONS = 60_000
        private const val KEY_HASH = "pin.hash"
        private const val KEY_TRIES = "pin.tries"

        fun isValidPin(pin: String): Boolean = PIN_PATTERN.matches(pin)

        private fun derive(pin: String, salt: ByteArray, iterations: Int): ByteArray {
            val spec = PBEKeySpec(pin.toCharArray(), salt, iterations, 256)
            try {
                return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
            } finally {
                spec.clearPassword()
            }
        }

        private fun b64(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)
    }
}
