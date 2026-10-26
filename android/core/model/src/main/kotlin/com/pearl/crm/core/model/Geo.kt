package com.pearl.crm.core.model

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.roundToLong
import kotlin.math.sin
import kotlin.math.sqrt

/** Same maths as packages/shared/src/geo.ts (golden vectors in test-vectors/geo.json). */
object Geo {
    const val EARTH_RADIUS_M = 6_371_000.0

    private fun rad(d: Double) = Math.toRadians(d)

    fun distanceM(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val dLat = rad(lat2 - lat1)
        val dLng = rad(lng2 - lng1)
        val h = sin(dLat / 2).let { it * it } + cos(rad(lat1)) * cos(rad(lat2)) * sin(dLng / 2).let { it * it }
        return 2 * EARTH_RADIUS_M * asin(min(1.0, sqrt(h)))
    }

    fun insideGeofence(centerLat: Double, centerLng: Double, radiusM: Double, lat: Double, lng: Double): Boolean =
        distanceM(centerLat, centerLng, lat, lng) <= radiusM + 1e-6

    private fun StringBuilder.encodeValue(v: Long) {
        var n = if (v < 0) (v shl 1).inv() else v shl 1
        while (n >= 0x20) {
            append(((0x20L or (n and 0x1f)) + 63).toInt().toChar())
            n = n shr 5
        }
        append((n + 63).toInt().toChar())
    }

    /** Google's encoded polyline, precision 5. */
    fun encodePolyline(points: List<Pair<Double, Double>>): String = buildString {
        var lat = 0L
        var lng = 0L
        for ((a, b) in points) {
            val la = (a * 1e5).roundToLong()
            val lg = (b * 1e5).roundToLong()
            encodeValue(la - lat)
            encodeValue(lg - lng)
            lat = la
            lng = lg
        }
    }

    fun decodePolyline(encoded: String): List<Pair<Double, Double>> {
        val out = mutableListOf<Pair<Double, Double>>()
        var i = 0
        var lat = 0L
        var lng = 0L
        fun next(): Long {
            var shift = 0
            var result = 0L
            var b: Int
            do {
                require(i < encoded.length) { "bad polyline" }
                b = encoded[i++].code - 63
                result = result or ((b and 0x1f).toLong() shl shift)
                shift += 5
            } while (b >= 0x20)
            return if (result and 1L != 0L) (result shr 1).inv() else result shr 1
        }
        while (i < encoded.length) {
            lat += next()
            lng += next()
            out += lat / 1e5 to lng / 1e5
        }
        return out
    }
}

/** One GPS reading from the phone. */
data class RawPoint(
    /** Epoch ms. */
    val t: Long,
    val lat: Double,
    val lng: Double,
    val accuracyM: Float,
    val mock: Boolean = false,
)

/**
 * Cleans a BDM's GPS track before it is stored (PLAN.md E3 row 13):
 * - readings worse than 50 m are dropped;
 * - a reading that would mean moving faster than 150 km/h from the last good one is a spike;
 * - while standing still, readings closer than the GPS's own error (at least 15 m) are jitter;
 * - fake ("mock") locations are dropped (and flagged elsewhere).
 */
object TrackFilter {
    const val MAX_ACCURACY_M = 50f
    const val MAX_SPEED_KMH = 150.0
    const val MIN_MOVE_M = 15.0

    /** [last] = the last point kept in an earlier chunk, so chunks join up without a gap. */
    fun filter(points: List<RawPoint>, last: RawPoint? = null): List<RawPoint> {
        val kept = mutableListOf<RawPoint>()
        var prev = last
        for (p in points.sortedBy { it.t }) {
            if (p.mock || p.accuracyM > MAX_ACCURACY_M || p.accuracyM <= 0f) continue
            val before = prev
            if (before != null) {
                val seconds = (p.t - before.t) / 1000.0
                if (seconds <= 0) continue
                val d = Geo.distanceM(before.lat, before.lng, p.lat, p.lng)
                if (d / seconds * 3.6 > MAX_SPEED_KMH) continue
                if (d < maxOf(MIN_MOVE_M, (p.accuracyM + before.accuracyM) / 2.0)) continue
            }
            kept += p
            prev = p
        }
        return kept
    }

    /** Length of the kept path in metres (joined to [last] when given). */
    fun distanceM(kept: List<RawPoint>, last: RawPoint? = null): Double =
        (listOfNotNull(last) + kept).zipWithNext { a, b -> Geo.distanceM(a.lat, a.lng, b.lat, b.lng) }.sum()
}

/** What one upload carries (location_chunks): a few minutes of the cleaned track. */
data class TrackChunk(
    val startedAt: Long,
    val endedAt: Long,
    val polyline: String,
    /** Seconds after [startedAt] for each point. */
    val offsets: List<Int>,
    val accuracies: List<Int>,
    val distanceM: Int,
) {
    companion object {
        /** Null when nothing survived the filter. */
        fun of(kept: List<RawPoint>, last: RawPoint?): TrackChunk? {
            if (kept.isEmpty()) return null
            val start = kept.first().t
            return TrackChunk(
                startedAt = start,
                endedAt = kept.last().t,
                polyline = Geo.encodePolyline(kept.map { it.lat to it.lng }),
                offsets = kept.map { ((it.t - start) / 1000).toInt().coerceIn(0, Short.MAX_VALUE.toInt()) },
                accuracies = kept.map { it.accuracyM.toInt().coerceIn(0, Short.MAX_VALUE.toInt()) },
                distanceM = TrackFilter.distanceM(kept, last).toInt(),
            )
        }
    }
}
