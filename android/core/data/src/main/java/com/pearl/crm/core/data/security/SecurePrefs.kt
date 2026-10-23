package com.pearl.crm.core.data.security

import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Encrypts small values before they touch the disk. */
interface SecretBox {
    fun seal(plain: ByteArray): ByteArray
    fun open(sealed: ByteArray): ByteArray
}

/**
 * AES-256-GCM with a key that never leaves the Android Keystore (hardware-backed on most
 * phones). Output = 12-byte IV followed by the ciphertext and tag.
 */
class KeystoreSecretBox(private val alias: String = "pearl.secure-prefs") : SecretBox {
    private fun key(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (keyStore.getKey(alias, null) as? SecretKey)?.let { return it }
        val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE).run {
            init(spec)
            generateKey()
        }
    }

    override fun seal(plain: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORMATION).apply { init(Cipher.ENCRYPT_MODE, key()) }
        return cipher.iv + cipher.doFinal(plain)
    }

    override fun open(sealed: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, sealed, 0, IV_BYTES))
        return cipher.doFinal(sealed, IV_BYTES, sealed.size - IV_BYTES)
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_BYTES = 12
    }
}

/**
 * SharedPreferences whose values are sealed by a [SecretBox]. A value that can't be opened
 * (key lost after a backup restore or reinstall) reads as absent and is removed.
 */
class SecurePrefs(private val prefs: SharedPreferences, private val box: SecretBox) {
    fun getString(key: String): String? {
        val stored = prefs.getString(key, null) ?: return null
        return try {
            String(box.open(Base64.decode(stored, Base64.NO_WRAP)), Charsets.UTF_8)
        } catch (_: GeneralSecurityException) {
            remove(key)
            null
        } catch (_: IllegalArgumentException) {
            remove(key)
            null
        }
    }

    /** Written synchronously: these values (session, PIN tries) must survive a crash right after. */
    fun putString(key: String, value: String) {
        val sealed = Base64.encodeToString(box.seal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
        prefs.edit().putString(key, sealed).commit()
    }

    fun remove(vararg keys: String) {
        val editor = prefs.edit()
        keys.forEach { editor.remove(it) }
        editor.commit()
    }
}
