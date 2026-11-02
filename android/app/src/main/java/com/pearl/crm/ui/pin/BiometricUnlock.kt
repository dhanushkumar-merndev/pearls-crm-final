package com.pearl.crm.ui.pin

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

/**
 * Fingerprint or face instead of typing the PIN. The phone's own prompt does the check;
 * the PIN stays for when it fails, the person taps "Use PIN", or the phone has none set up.
 * It only opens the app lock: changing the PIN still asks for the current PIN.
 */
object BiometricUnlock {
    private const val ALLOWED = BiometricManager.Authenticators.BIOMETRIC_WEAK

    /** The phone has a fingerprint or face set up that apps may use. */
    fun available(context: Context): Boolean =
        BiometricManager.from(context).canAuthenticate(ALLOWED) == BiometricManager.BIOMETRIC_SUCCESS

    fun prompt(activity: FragmentActivity, title: String, subtitle: String, usePin: String, onSuccess: () -> Unit) {
        val callback = object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) = onSuccess()
            // Cancelled, "Use PIN" or too many tries: the PIN pad stays on screen.
        }
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .setNegativeButtonText(usePin)
            .setAllowedAuthenticators(ALLOWED)
            .setConfirmationRequired(false)
            .build()
        BiometricPrompt(activity, ContextCompat.getMainExecutor(activity), callback).authenticate(info)
    }
}
