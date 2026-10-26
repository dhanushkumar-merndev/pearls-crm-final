package com.pearl.crm.core.model

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import kotlin.math.abs
import kotlin.math.cos
import kotlin.random.Random

class GeoTest {
    /** The same golden vectors as Vitest and pgTAP. */
    private val vectors: JsonObject = Json.parseToJsonElement(
        File("../../../packages/shared/test-vectors/geo.json").readText(),
    ).jsonObject

    private fun pair(o: JsonObject, key: String) = o.getValue(key).jsonArray.let { it[0].jsonPrimitive.double to it[1].jsonPrimitive.double }

    @Test
    fun distanceVectors() {
        for (v in vectors.getValue("distance").jsonArray.map { it.jsonObject }) {
            val (a, b) = pair(v, "a") to pair(v, "b")
            assertEquals(v["name"].toString(), v.getValue("m").jsonPrimitive.double, Geo.distanceM(a.first, a.second, b.first, b.second), 0.5)
        }
    }

    @Test
    fun geofenceVectors() {
        for (v in vectors.getValue("geofence").jsonArray.map { it.jsonObject }) {
            val (o, p) = pair(v, "office") to pair(v, "point")
            assertEquals(
                v["name"].toString(),
                v.getValue("inside").jsonPrimitive.boolean,
                Geo.insideGeofence(o.first, o.second, v.getValue("radius_m").jsonPrimitive.double, p.first, p.second),
            )
        }
    }

    @Test
    fun polylineVectors() {
        for (v in vectors.getValue("polyline").jsonArray.map { it.jsonObject }) {
            val pts = v.getValue("points").jsonArray.map { it.jsonArray.let { a -> a[0].jsonPrimitive.double to a[1].jsonPrimitive.double } }
            val encoded = v.getValue("encoded").jsonPrimitive.content
            assertEquals(encoded, Geo.encodePolyline(pts))
            Geo.decodePolyline(encoded).zip(pts).forEach { (got, want) ->
                assertEquals(want.first, got.first, 1e-5)
                assertEquals(want.second, got.second, 1e-5)
            }
        }
    }

    private val t0 = 1_800_000_000_000L
    private fun p(sec: Int, lat: Double, lng: Double, acc: Float = 10f, mock: Boolean = false) = RawPoint(t0 + sec * 1000L, lat, lng, acc, mock)

    @Test
    fun poorReadingsAreDropped() {
        val kept = TrackFilter.filter(listOf(p(0, 12.9716, 77.5946), p(10, 12.9726, 77.5946, acc = 51f), p(20, 12.9736, 77.5946, acc = 50f)))
        assertEquals(listOf(0, 20), kept.map { ((it.t - t0) / 1000).toInt() })
    }

    @Test
    fun speedSpikesAreDropped() {
        // 2 km in 10 s = 720 km/h: a GPS jump, not a drive.
        val kept = TrackFilter.filter(listOf(p(0, 12.9716, 77.5946), p(10, 12.9896, 77.5946), p(20, 12.9725, 77.5946)))
        assertEquals(listOf(0, 20), kept.map { ((it.t - t0) / 1000).toInt() })
    }

    @Test
    fun standingStillJitterIsRemoved() {
        val rnd = Random(7)
        val still = (0 until 30).map { p(it * 10, 12.9716 + rnd.nextDouble(-6e-5, 6e-5), 77.5946 + rnd.nextDouble(-6e-5, 6e-5), acc = 12f) }
        val kept = TrackFilter.filter(still)
        assertEquals(1, kept.size)
        assertEquals(0.0, TrackFilter.distanceM(kept), 0.0)
    }

    @Test
    fun mockLocationsAreDropped() {
        assertTrue(TrackFilter.filter(listOf(p(0, 12.9716, 77.5946, mock = true))).isEmpty())
    }

    @Test
    fun aRecordedDriveMeasuresWithinFivePercent() {
        // A 12 km city route with turns, driven at ~30 km/h, GPS every 10 s with ±5 m noise,
        // a 6-minute stop with jitter, poor readings and two spikes thrown in.
        val corners = listOf(12.9716 to 77.5946, 12.9900 to 77.5946, 12.9900 to 77.6200, 12.9600 to 77.6200, 12.9600 to 77.6000)
        val trueM = corners.zipWithNext { a, b -> Geo.distanceM(a.first, a.second, b.first, b.second) }.sum()
        val rnd = Random(42)
        val metresPerDegLat = 111_195.0
        val raw = mutableListOf<RawPoint>()
        var sec = 0
        val stepM = 30_000.0 / 3600 * 10 // 30 km/h, every 10 s
        corners.zipWithNext().forEachIndexed { leg, (a, b) ->
            val legM = Geo.distanceM(a.first, a.second, b.first, b.second)
            val steps = (legM / stepM).toInt()
            for (i in 0 until steps) {
                val f = i.toDouble() / steps
                val lat = a.first + (b.first - a.first) * f
                val lng = a.second + (b.second - a.second) * f
                val noise = { rnd.nextDouble(-5.0, 5.0) }
                raw += p(sec, lat + noise() / metresPerDegLat, lng + noise() / (metresPerDegLat * cos(Math.toRadians(lat))), acc = rnd.nextInt(5, 16).toFloat())
                sec += 10
                if (i % 40 == 7) raw += p(sec - 5, lat, lng, acc = 80f) // a poor reading
                if (i == 20 && leg == 1) raw += p(sec - 3, lat + 0.02, lng) // a spike
            }
            if (leg == 1) {
                // A 6-minute stop at the corner.
                repeat(36) {
                    raw += p(sec, b.first + rnd.nextDouble(-8.0, 8.0) / metresPerDegLat, b.second + rnd.nextDouble(-8.0, 8.0) / metresPerDegLat, acc = 12f)
                    sec += 10
                }
            }
        }
        raw += p(sec, corners.last().first, corners.last().second)

        // Uploaded in 5-minute chunks, each joined to the last kept point of the one before.
        var last: RawPoint? = null
        var measured = 0.0
        raw.groupBy { ((it.t - t0) / 300_000) }.toSortedMap().values.forEach { chunk ->
            val kept = TrackFilter.filter(chunk, last)
            measured += TrackFilter.distanceM(kept, last)
            if (kept.isNotEmpty()) last = kept.last()
        }
        val error = abs(measured - trueM) / trueM
        assertTrue("measured %.0f m vs %.0f m (%.1f%%)".format(measured, trueM, error * 100), error <= 0.05)
    }

    @Test
    fun chunksCarryOffsetsAndAccuracies() {
        val kept = TrackFilter.filter(listOf(p(0, 12.9716, 77.5946), p(30, 12.9736, 77.5946, acc = 20f)))
        val chunk = TrackChunk.of(kept, null)!!
        assertEquals(listOf(0, 30), chunk.offsets)
        assertEquals(listOf(10, 20), chunk.accuracies)
        assertEquals(Geo.decodePolyline(chunk.polyline).size, 2)
        assertTrue(chunk.distanceM in 220..225)
        assertEquals(null, TrackChunk.of(emptyList(), null))
    }
}
