package com.pearl.crm.core.data.device

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.CancellationSignal
import android.os.Looper
import com.pearl.crm.core.model.RawPoint
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import java.io.File
import kotlin.coroutines.resume

/** The phone's GPS through LocationManager (no Google Play services needed). */
class DeviceLocation(private val context: Context) {
    private val manager = context.getSystemService(LocationManager::class.java)

    fun permitted(): Boolean =
        context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    /** Location switched on in the phone's settings. */
    fun enabled(): Boolean = manager?.let {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) it.isLocationEnabled
        else it.isProviderEnabled(LocationManager.GPS_PROVIDER) || it.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
    } == true

    /** One fresh reading (or a recent one when none comes in time). */
    @SuppressLint("MissingPermission") // permitted() is checked first
    suspend fun current(timeoutMs: Long = 20_000): RawPoint? {
        if (!permitted() || manager == null) return null
        val fresh = withTimeoutOrNull(timeoutMs) {
            suspendCancellableCoroutine { cont ->
                val signal = CancellationSignal()
                cont.invokeOnCancellation { signal.cancel() }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    manager.getCurrentLocation(LocationManager.GPS_PROVIDER, signal, context.mainExecutor) { loc ->
                        if (cont.isActive) cont.resume(loc)
                    }
                } else {
                    val listener = object : LocationListener {
                        override fun onLocationChanged(location: Location) {
                            manager.removeUpdates(this)
                            if (cont.isActive) cont.resume(location)
                        }
                    }
                    @Suppress("DEPRECATION")
                    manager.requestSingleUpdate(LocationManager.GPS_PROVIDER, listener, Looper.getMainLooper())
                    cont.invokeOnCancellation { manager.removeUpdates(listener) }
                }
            }
        }
        val loc = fresh ?: listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            .mapNotNull { runCatching { manager.getLastKnownLocation(it) }.getOrNull() }
            .filter { System.currentTimeMillis() - it.time < 2 * 60_000 }
            .minByOrNull { it.accuracy }
        return loc?.toRaw()
    }

    /** Continuous readings for the day's track. Returns a function that stops them. */
    @SuppressLint("MissingPermission")
    fun track(intervalMs: Long, minDistanceM: Float, onPoint: (RawPoint) -> Unit): () -> Unit {
        if (!permitted() || manager == null) return {}
        val listener = LocationListener { onPoint(it.toRaw()) }
        manager.requestLocationUpdates(LocationManager.GPS_PROVIDER, intervalMs, minDistanceM, listener, Looper.getMainLooper())
        return { manager.removeUpdates(listener) }
    }

    companion object {
        fun Location.toRaw() = RawPoint(
            t = time,
            lat = latitude,
            lng = longitude,
            accuracyM = if (hasAccuracy()) accuracy else 999f,
            mock = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) isMock else @Suppress("DEPRECATION") isFromMockProvider,
        )
    }
}

/** Photos for upload: at most [maxSide] px, WebP, under the server's 500 KB limit. */
object Photos {
    const val MAX_BYTES = 500_000

    suspend fun toWebp(source: File, out: File, maxSide: Int = 1280): File = withContext(Dispatchers.IO) {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(source.path, bounds)
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
        val decoded = BitmapFactory.decodeFile(source.path, BitmapFactory.Options().apply { inSampleSize = sample })
            ?: error("not an image")
        val scale = maxSide.toFloat() / maxOf(decoded.width, decoded.height)
        val bitmap = if (scale < 1f) Bitmap.createScaledBitmap(decoded, (decoded.width * scale).toInt(), (decoded.height * scale).toInt(), true) else decoded
        var quality = 80
        while (true) {
            out.outputStream().use { stream ->
                @Suppress("DEPRECATION")
                val format = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) Bitmap.CompressFormat.WEBP_LOSSY else Bitmap.CompressFormat.WEBP
                bitmap.compress(format, quality, stream)
            }
            if (out.length() <= MAX_BYTES || quality <= 30) break
            quality -= 15
        }
        out
    }
}
