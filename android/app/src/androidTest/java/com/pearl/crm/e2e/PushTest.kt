package com.pearl.crm.e2e

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.android.gms.tasks.Tasks
import com.google.firebase.messaging.FirebaseMessaging
import com.pearl.crm.push.Push
import org.junit.Assert.assertFalse
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.TimeUnit

/**
 * A-SYS-20: push needs android/app/google-services.json (Firebase) at build time; without it the
 * test is skipped and the app works without push. A push arriving and opening the right screen
 * is a manual check once Firebase is set up (TEST_CASES.md).
 */
@RunWith(AndroidJUnit4::class)
class PushTest {
    @Test
    fun thePhoneGetsAPushAddress() {
        Phone.skipUnless(Push.isAvailable(Phone.app), "push is off: no google-services.json in this build")
        val token = Tasks.await(FirebaseMessaging.getInstance().token, 30, TimeUnit.SECONDS)
        assertFalse(token.isNullOrBlank())
    }
}
