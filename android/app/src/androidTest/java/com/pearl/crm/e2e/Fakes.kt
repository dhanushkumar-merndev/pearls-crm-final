package com.pearl.crm.e2e

import android.app.Activity
import android.app.Instrumentation
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.location.Location
import android.location.LocationManager
import android.net.Uri
import android.os.SystemClock
import android.provider.MediaStore
import androidx.core.content.IntentCompat
import androidx.test.espresso.intent.Intents
import androidx.test.espresso.intent.matcher.IntentMatchers.hasAction

/**
 * A pretend GPS: an Android "test provider" the app may use (app-op mock_location, the same as
 * picking a mock-location app in Developer options). It repeats the position every second, as a
 * real GPS does. Android marks these readings as mock, so the app flags them; that is tested too.
 */
class FakeGps(lat: Double, lng: Double) : AutoCloseable {
    private val manager = Phone.app.getSystemService(LocationManager::class.java)

    @Volatile
    private var at = lat to lng

    @Volatile
    private var running = true

    private val ticker = Thread {
        while (running) {
            runCatching { manager.setTestProviderLocation(GPS, reading()) }
            Thread.sleep(1_000)
        }
    }

    init {
        Phone.shell("appops set ${Phone.app.packageName} android:mock_location allow")
        // Location switched on (both forms: the command is Android 12+).
        Phone.shell("cmd location set-location-enabled true")
        Phone.shell("settings put secure location_mode 3")
        runCatching { manager.removeTestProvider(GPS) }
        @Suppress("DEPRECATION") // Criteria's constants are ProviderProperties' (same values) before Android 12.
        manager.addTestProvider(
            GPS, false, false, false, false, true, true, true,
            android.location.Criteria.POWER_LOW, android.location.Criteria.ACCURACY_FINE,
        )
        manager.setTestProviderEnabled(GPS, true)
        manager.setTestProviderLocation(GPS, reading())
        ticker.start()
    }

    /** Jumps to a new position (the next reading is there). */
    fun moveTo(lat: Double, lng: Double) {
        at = lat to lng
        runCatching { manager.setTestProviderLocation(GPS, reading()) }
    }

    private fun reading() = Location(GPS).apply {
        latitude = at.first
        longitude = at.second
        accuracy = 5f
        altitude = 900.0
        time = System.currentTimeMillis()
        elapsedRealtimeNanos = SystemClock.elapsedRealtimeNanos()
    }

    override fun close() {
        running = false
        ticker.join(3_000)
        runCatching { manager.setTestProviderEnabled(GPS, false) }
        runCatching { manager.removeTestProvider(GPS) }
        Phone.shell("appops set ${Phone.app.packageName} android:mock_location default")
    }

    companion object {
        private const val GPS = LocationManager.GPS_PROVIDER
    }
}

/**
 * A pretend camera: "take a photo" gets a small JPEG written where the app asked, with no camera
 * app opened (espresso-intents answers the IMAGE_CAPTURE request). Call [close] after the test.
 */
class FakeCamera : AutoCloseable {
    var photos = 0
        private set

    init {
        Intents.init()
        Intents.intending(hasAction(MediaStore.ACTION_IMAGE_CAPTURE)).respondWithFunction { request ->
            val out = IntentCompat.getParcelableExtra(request, MediaStore.EXTRA_OUTPUT, Uri::class.java)
            if (out == null) {
                Instrumentation.ActivityResult(Activity.RESULT_CANCELED, null)
            } else {
                val picture = Bitmap.createBitmap(640, 480, Bitmap.Config.ARGB_8888)
                Canvas(picture).drawColor(Color.rgb(90, 140, 200))
                Phone.app.contentResolver.openOutputStream(out)!!.use { picture.compress(Bitmap.CompressFormat.JPEG, 85, it) }
                photos++
                Instrumentation.ActivityResult(Activity.RESULT_OK, null)
            }
        }
    }

    override fun close() = Intents.release()
}
