package com.pearl.crm.core.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pearl.crm.core.data.db.AppDatabase
import com.pearl.crm.core.data.net.FileUploader
import com.pearl.crm.core.data.net.PearlJson
import com.pearl.crm.core.model.Geo
import com.pearl.crm.core.model.RawPoint
import com.pearl.crm.core.model.RpcFailure
import com.pearl.crm.core.model.RpcTransport
import com.pearl.crm.core.model.UploadPlan
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

@RunWith(AndroidJUnit4::class)
class BdmRepositoryTest {
    private lateinit var db: AppDatabase
    private lateinit var repo: BdmRepository
    private lateinit var dir: File
    private var now = 1_800_000_000_000L // 15/01/2027 13:30 IST
    private val calls = mutableListOf<Pair<String, JsonObject>>()
    private var answer: (String, JsonObject) -> JsonElement = { fn, args ->
        when (fn) {
            "bdm_start_day" -> PearlJson.parseToJsonElement(
                """{"day":{"id":"${args.getValue("p").jsonObject.getValue("client_id").jsonPrimitive.content}","work_date":"2027-01-15","state":"in_office"},
                   "inside":true,"distance_m":42,"office":{"name":"Main office"}}""",
            )
            else -> JsonNull
        }
    }
    private val rpc = RpcTransport { fn, args ->
        calls += fn to args
        answer(fn, args)
    }
    private val uploads = mutableListOf<Pair<String, String>>() // purpose, clientId
    private val uploader = FileUploader { purpose, _, _, _, _, clientId ->
        uploads += purpose to clientId
        "file-$clientId"
    }

    @Before
    fun open() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
        dir = File(context.cacheDir, "bdm-test").apply { mkdirs() }
        val settings = SettingsStore(context.getSharedPreferences("bdm-test-settings", Context.MODE_PRIVATE))
        val audio = object : AudioProcessor {
            override suspend fun sha256(uri: String) = "x"
            override suspend fun prepare(uri: String, plan: UploadPlan) = File(dir, "p.m4a").apply { writeBytes(ByteArray(10)) }
        }
        val outbox = OutboxWriter(db.outbox()) { now }
        val recordings = RecordingsRepository(rpc, db, outbox, uploader, audio, settings) { now }
        repo = BdmRepository(rpc, db, outbox, uploader, recordings, context.getSharedPreferences("bdm-test", Context.MODE_PRIVATE)) { now }
    }

    @After
    fun close() {
        db.close()
        dir.deleteRecursively()
        val context = ApplicationProvider.getApplicationContext<Context>()
        listOf("bdm-test", "bdm-test-settings").forEach { context.getSharedPreferences(it, Context.MODE_PRIVATE).edit().clear().commit() }
    }

    private fun fix(sec: Int = 0, lat: Double = 12.9716, lng: Double = 77.5946) = RawPoint(now + sec * 1000L, lat, lng, 10f)

    private suspend fun started(): String {
        val selfie = File(dir, "selfie.webp").apply { writeBytes(ByteArray(100)) }
        repo.startDay(selfie, fix(), "DAY-1")
        calls.clear()
        uploads.clear()
        return "DAY-1"
    }

    @Test
    fun startingTheDayUploadsTheSelfieThenAsksTheServer() = runTest {
        val selfie = File(dir, "selfie.webp").apply { writeBytes(ByteArray(100)) }
        val r = repo.startDay(selfie, fix(), "DAY-1")
        assertEquals(true, r.inside)
        assertEquals("Main office", r.officeName)
        assertEquals("selfie", uploads.single().first)
        assertEquals(BdmRepository.selfieClientId("DAY-1"), uploads.single().second)
        val p = calls.single().second.getValue("p").jsonObject
        assertEquals("DAY-1", p.getValue("client_id").jsonPrimitive.content)
        assertEquals("file-${BdmRepository.selfieClientId("DAY-1")}", p.getValue("selfie_file_id").jsonPrimitive.content)
        assertEquals("12.9716", p.getValue("lat").jsonPrimitive.content)
        assertTrue(repo.day.value.open)
        assertEquals(BdmState.IN_OFFICE, repo.day.value.state)
    }

    @Test
    fun outsideTheOfficeTheServerSaysSoAndNothingIsSaved() = runTest {
        answer = { _, _ -> throw RpcFailure.Permanent("outside_office") }
        try {
            repo.startDay(null, fix(), "DAY-1")
            fail("started outside the office")
        } catch (e: RpcFailure.Permanent) {
            assertEquals("outside_office", e.code)
        }
        assertFalse(repo.day.value.open)
    }

    @Test
    fun aVisitWorksWithNoSignalAndIsSentInOrder() = runTest {
        started()
        val visit = repo.startTravel("City Hospital", "Tie-up", fix(60))
        repo.reached(fix(900), null)
        repo.completeVisit(VisitResult("Interested", "Dr Rao", "+919811900001", "Director", "hot", NewLead("Dr Rao referral", "+919811900002", "Hair")))

        assertTrue(calls.isEmpty()) // nothing needed the network
        assertEquals(BdmState.TRAVELLING, repo.day.value.state)
        assertNull(repo.day.value.visitId)
        // One queue for the day: only the first is ready to send; the rest wait behind it.
        val heads = db.outbox().dueHeads(Long.MAX_VALUE, 100)
        assertEquals(listOf("bdm_travel_start"), heads.map { it.rpc })
        assertEquals(visit, heads.single().id)
        assertEquals(3, db.outbox().countForEntity("bdm-day:DAY-1"))
        // The lead travels with the completion.
        db.outbox().delete(visit)
        db.outbox().delete(db.outbox().dueHeads(Long.MAX_VALUE, 1).single().id) // reached
        val complete = PearlJson.parseToJsonElement(db.outbox().dueHeads(Long.MAX_VALUE, 1).single().args).jsonObject.getValue("p").jsonObject
        assertEquals("Dr Rao referral", complete.getValue("create_lead").jsonObject.getValue("name").jsonPrimitive.content)
        assertEquals(visit, complete.getValue("visit_id").jsonPrimitive.content)
    }

    @Test
    fun oneVisitAndOneBreakAtATime() = runTest {
        started()
        repo.startTravel("A", null, null)
        try {
            repo.startTravel("B", null, null)
            fail("two visits")
        } catch (e: RpcFailure.Permanent) {
            assertEquals("visit_open", e.code)
        }
        repo.reached(null, null)
        repo.startBreak(null, 30)
        assertEquals(BdmState.ON_BREAK, repo.day.value.state)
        try {
            repo.startBreak(null, 15)
            fail("two breaks")
        } catch (e: RpcFailure.Permanent) {
            assertEquals("break_open", e.code)
        }
        repo.endBreak()
        assertEquals(BdmState.AT_VISIT, repo.day.value.state) // back where they were
    }

    @Test
    fun nothingBeforeTheDayStarts() = runTest {
        try {
            repo.startTravel("A", null, null)
            fail("travel without a day")
        } catch (e: RpcFailure.Permanent) {
            assertEquals("day_not_started", e.code)
        }
    }

    @Test
    fun theTrackIsCleanedPackedNumberedAndJoined() = runTest {
        started()
        // 3 minutes of driving north at ~36 km/h, one reading every 10 s, plus a bad one.
        (0..18).forEach { i -> repo.recordPoint(fix(i * 10, lat = 12.9716 + i * 0.0009)) }
        repo.recordPoint(RawPoint(now + 95_000, 12.99, 77.6, 120f))
        now += 4 * 60_000
        assertTrue(repo.flushTrack() > 10)
        val first = db.outbox().dueHeads(Long.MAX_VALUE, 10).single { it.rpc == "bdm_upload_chunks" }
        val c1 = PearlJson.parseToJsonElement(first.args).jsonObject.getValue("p_chunks").jsonArray.single().jsonObject
        assertEquals("0", c1.getValue("seq").jsonPrimitive.content)
        assertEquals(first.id, c1.getValue("id").jsonPrimitive.content) // the chunk id is the retry key
        val expected = Geo.distanceM(12.9716, 77.5946, 12.9716 + 18 * 0.0009, 77.5946)
        assertEquals(expected, c1.getValue("distance_m").jsonPrimitive.content.toDouble(), expected * 0.05)
        assertEquals(0, db.trackPoints().count())

        // The next chunk starts where the last one ended (no gap, no double counting).
        repo.recordPoint(fix(0, lat = 12.9716 + 19 * 0.0009))
        repo.flushTrack(force = true)
        db.outbox().delete(first.id)
        val c2 = PearlJson.parseToJsonElement(db.outbox().dueHeads(Long.MAX_VALUE, 10).single { it.rpc == "bdm_upload_chunks" }.args)
            .jsonObject.getValue("p_chunks").jsonArray.single().jsonObject
        assertEquals("1", c2.getValue("seq").jsonPrimitive.content)
        assertEquals(100.0, c2.getValue("distance_m").jsonPrimitive.content.toDouble(), 5.0)
    }

    @Test
    fun aLongDriveIsSentInPiecesTheServerAccepts() = runTest {
        started()
        // One reading a second at ~80 km/h: every reading is kept.
        (1..2500).forEach { i -> repo.recordPoint(fix(i, lat = 12.9716 + i * 0.0002)) }
        assertEquals(2500, repo.flushTrack(force = true))
        val chunks = mutableListOf<JsonObject>()
        while (true) {
            val head = db.outbox().dueHeads(Long.MAX_VALUE, 10).singleOrNull { it.rpc == "bdm_upload_chunks" } ?: break
            chunks += PearlJson.parseToJsonElement(head.args).jsonObject.getValue("p_chunks").jsonArray.single().jsonObject
            db.outbox().delete(head.id)
        }
        assertEquals(listOf("0", "1", "2"), chunks.map { it.getValue("seq").jsonPrimitive.content })
        assertEquals(listOf(1000, 1000, 500), chunks.map { it.getValue("offsets").jsonArray.size })
        // Each piece is joined to the one before, so the distances add up to the whole drive.
        val expected = Geo.distanceM(12.9716, 77.5946, 12.9716 + 2500 * 0.0002, 77.5946)
        assertEquals(expected, chunks.sumOf { it.getValue("distance_m").jsonPrimitive.content.toDouble() }, expected * 0.01)
    }

    @Test
    fun standingStillSendsNothing() = runTest {
        started()
        (0..30).forEach { i -> repo.recordPoint(fix(i * 10, lat = 12.9716 + (if (i % 2 == 0) 0.00003 else -0.00003))) }
        now += 10 * 60_000
        repo.flushTrack()
        val chunk = db.outbox().dueHeads(Long.MAX_VALUE, 10).single { it.rpc == "bdm_upload_chunks" }
        val c = PearlJson.parseToJsonElement(chunk.args).jsonObject.getValue("p_chunks").jsonArray.single().jsonObject
        assertEquals("0", c.getValue("distance_m").jsonPrimitive.content)
        assertEquals(1, c.getValue("offsets").jsonArray.size)
    }

    @Test
    fun aPunchPhotoWaitsForItsVisitThenIsAttached() = runTest {
        started()
        val visit = repo.startTravel("City Hospital", null, null)
        val photo = File(dir, "punch.webp").apply { writeBytes(ByteArray(200)) }
        repo.reached(null, photo)

        assertEquals(0, repo.uploadPendingPhotos()) // the visit isn't on the server yet
        assertTrue(uploads.isEmpty())

        while (db.outbox().countForEntity("bdm-day:DAY-1") > 0) db.outbox().delete(db.outbox().dueHeads(Long.MAX_VALUE, 1).single().id)
        assertEquals(1, repo.uploadPendingPhotos())
        assertEquals("punch_photo" to BdmRepository.photoClientId(visit), uploads.single())
        val attach = calls.single { it.first == "bdm_attach_photo" }.second
        assertEquals(visit, attach.getValue("p_visit_id").jsonPrimitive.content)
        assertFalse(photo.exists())
        assertEquals(0, repo.uploadPendingPhotos())
    }

    @Test
    fun aMeetingRecordingIsRegisteredBeforeTheVisitThatPointsToIt() = runTest {
        started()
        repo.startTravel("A", null, null)
        repo.reached(null, null)
        val audio = File(dir, "meeting.m4a").apply { writeBytes(ByteArray(1000)) }
        repo.completeVisit(VisitResult("Met the director", null, null, null, null, null), audio, 600)
        val day = (1..3).map { db.outbox().dueHeads(Long.MAX_VALUE, 1).single().also { db.outbox().delete(it.id) } }.last()
        assertEquals("recording_register", day.rpc)
        val complete = db.outbox().dueHeads(Long.MAX_VALUE, 1).single()
        assertEquals("bdm_visit_complete", complete.rpc)
        val p = PearlJson.parseToJsonElement(complete.args).jsonObject.getValue("p").jsonObject
        assertEquals(day.id, p.getValue("recording_id").jsonPrimitive.content)
    }

    @Test
    fun afterAReinstallTheServerTellsTheDay() = runTest {
        answer = { _, _ ->
            PearlJson.parseToJsonElement(
                """{"day":{"id":"D9","work_date":"2027-01-15","state":"at_visit","ended_at":null,"start_in_geofence":true},
                   "visit":{"id":"V9","destination":"Clinic","reached_at":"2027-01-15T08:00:00Z"},"break":null,"last_seq":4,
                   "settings":{"heartbeat_minutes":3,"upload_minutes":7}}""",
            )
        }
        repo.refreshFromServer()
        val d = repo.day.value
        assertEquals("D9", d.dayId)
        assertEquals("V9", d.visitId)
        assertTrue(d.visitReached)
        assertEquals(3, repo.heartbeatMinutes)
        assertEquals(7, repo.uploadMinutes)
        // Chunk numbering continues after the server's last one.
        repo.recordPoint(fix(0))
        repo.recordPoint(fix(30, lat = 12.9736))
        now += 5 * 60_000
        repo.flushTrack()
        val c = PearlJson.parseToJsonElement(db.outbox().dueHeads(Long.MAX_VALUE, 10).single { it.rpc == "bdm_upload_chunks" }.args)
            .jsonObject.getValue("p_chunks").jsonArray.single().jsonObject
        assertEquals("5", c.getValue("seq").jsonPrimitive.content)
    }

    @Test
    fun endingTheDayPacksTheLastPointsAndStops() = runTest {
        started()
        repo.recordPoint(fix(0))
        repo.recordPoint(fix(30, lat = 12.9736))
        repo.endDay(fix(40))
        assertTrue(repo.day.value.ended)
        assertEquals(BdmState.OFF_DUTY, repo.day.value.state)
        assertEquals(0, db.trackPoints().count())
        assertEquals(listOf("bdm_upload_chunks"), db.outbox().dueHeads(Long.MAX_VALUE, 10).map { it.rpc }.filter { it == "bdm_upload_chunks" })
        repo.recordPoint(fix(50)) // ignored after the end
        assertEquals(0, db.trackPoints().count())
    }
}
