package com.pearl.crm.core.data

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pearl.crm.core.data.db.AppDatabase
import com.pearl.crm.core.data.db.FollowupEntity
import com.pearl.crm.core.data.db.LeadEntity
import com.pearl.crm.core.data.net.PearlJson
import com.pearl.crm.core.model.CallOutcome
import com.pearl.crm.core.model.FreeSlot
import com.pearl.crm.core.model.LeadStage
import com.pearl.crm.core.model.RpcFailure
import com.pearl.crm.core.model.RpcTransport
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
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
import java.time.LocalDate

@RunWith(AndroidJUnit4::class)
class SalesRepositoryTest {
    private lateinit var db: AppDatabase
    private lateinit var repo: SalesRepository
    private val now = 1_800_000_000_000L
    private val calls = mutableListOf<Pair<String, JsonObject>>()
    private var answer: (String, JsonObject) -> JsonElement = { _, _ -> JsonNull }
    private val transport = RpcTransport { fn, args ->
        calls += fn to args
        answer(fn, args)
    }

    @Before
    fun open() {
        db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AppDatabase::class.java)
            .allowMainThreadQueries()
            .build()
        repo = SalesRepository(transport, db, OutboxWriter(db.outbox()) { now }) { now }
    }

    @After
    fun close() = db.close()

    private fun lead(id: String, stage: String = LeadStage.NEW, next: Long? = null, phone: String = "+919845012345") = LeadEntity(
        id = id, slNo = 1, name = "Lead $id", phoneE164 = phone, phoneLast10 = phone.takeLast(10), altPhoneE164 = null,
        email = null, treatmentText = null, sourceId = null, stage = stage, leadDate = null, nextFollowupAt = next,
        amountQuotedPaise = null, amountFinalisedPaise = null, comments1 = null, comments2 = null, assignedTo = "me",
        patientId = null, lostReasonId = null, lastActivityAt = 0, updatedAt = "x",
    )

    private fun task(id: String, leadId: String, dueAt: Long) = FollowupEntity(
        id = id, kind = "followup", leadId = leadId, patientId = null, dueDate = "2027-01-15", dueAt = dueAt,
        reason = "Call back", status = "open", outcome = null, assignedTo = "me", updatedAt = "x",
    )

    private fun draft(leadId: String?, next: NextStep, outcome: String = CallOutcome.CONNECTED, stage: String? = null, reason: String? = null) =
        CallDraft(
            leadId = leadId, phoneE164 = "+919845012345", outcome = outcome, notes = "  Wants a quote  ", next = next,
            startedAt = now - 60_000, durationS = 60, stage = stage, lostReasonId = reason,
        )

    @Test
    fun aCallLoggedOfflineIsOneLocalRowAndOneQueuedWriteWithTheSameId() = runTest {
        db.leads().upsert(listOf(lead("L1")))

        val id = repo.logCall(draft("L1", NextStep.CallAgain(now + 86_400_000)))

        val row = db.callLogs().get(id)!!
        assertTrue(row.pending)
        assertEquals("Wants a quote", row.notes)
        val queued = db.outbox().get(id)!!
        assertEquals("log_call", queued.rpc)
        assertEquals("lead:L1", queued.entityKey)
        val args = PearlJson.parseToJsonElement(queued.args).jsonObject.getValue("p_call").jsonObject
        assertEquals(id, args.getValue("client_id").jsonPrimitive.content)
        assertEquals("connected", args.getValue("outcome").jsonPrimitive.content)
        assertEquals("2027-01-16T08:00:00Z", args.getValue("next_followup_at").jsonPrimitive.content)
        assertEquals(1, db.outbox().unsentCount())
        assertTrue(calls.isEmpty()) // nothing went to the network
        // The lead shows what the server will do: contacted, next call tomorrow.
        val lead = db.leads().get("L1")!!
        assertEquals(LeadStage.CONTACTED, lead.stage)
        assertEquals(now + 86_400_000, lead.nextFollowupAt)
        assertTrue(lead.pending)
    }

    @Test
    fun withoutANextDateTheCallClosesTheDueFollowupOnly() = runTest {
        db.leads().upsert(listOf(lead("L1", next = now - 1000)))
        db.followups().upsert(listOf(task("due", "L1", now - 1000), task("later", "L1", now + 999_999)))

        val id = repo.logCall(draft("L1", NextStep.CloseDue, outcome = CallOutcome.NO_ANSWER))

        assertEquals("done", db.followups().get("due")!!.status)
        assertEquals("open", db.followups().get("later")!!.status)
        assertNull(db.leads().get("L1")!!.nextFollowupAt)
        assertEquals(LeadStage.NEW, db.leads().get("L1")!!.stage) // no answer: stage stays
        val args = PearlJson.parseToJsonElement(db.outbox().get(id)!!.args).jsonObject.getValue("p_call").jsonObject
        assertFalse("next_followup_at" in args) // absent = "this call was the follow-up" on the server too
    }

    @Test
    fun noMoreCallsSendsAnExplicitNull() = runTest {
        db.leads().upsert(listOf(lead("L1", next = now + 5000)))
        val id = repo.logCall(draft("L1", NextStep.NoMore))
        val args = PearlJson.parseToJsonElement(db.outbox().get(id)!!.args).jsonObject.getValue("p_call").jsonObject
        assertEquals(JsonNull, args["next_followup_at"])
        assertNull(db.leads().get("L1")!!.nextFollowupAt)
    }

    @Test
    fun lostNeedsAReasonAndClearsTheFollowup() = runTest {
        db.leads().upsert(listOf(lead("L1", next = now + 5000)))
        try {
            repo.logCall(draft("L1", NextStep.CloseDue, stage = LeadStage.LOST))
            fail("lost without a reason was accepted")
        } catch (_: IllegalArgumentException) {
        }
        assertEquals(0, db.outbox().unsentCount())

        repo.logCall(draft("L1", NextStep.CallAgain(now + 5000), stage = LeadStage.LOST, reason = "R1"))
        val lead = db.leads().get("L1")!!
        assertEquals(LeadStage.LOST, lead.stage)
        assertEquals("R1", lead.lostReasonId)
        assertNull(lead.nextFollowupAt)
    }

    @Test
    fun aNewLeadShowsAtOnceAndGoesAwayIfTheServerDidNotSendItBack() = runTest {
        val id = repo.createLead(LeadDraft("  Asha  ", "098450-12345", "Hair transplant", null, ""))

        val lead = db.leads().get(id)!!
        assertEquals("Asha", lead.name)
        assertEquals("+919845012345", lead.phoneE164)
        assertTrue(lead.localOnly)
        val args = PearlJson.parseToJsonElement(db.outbox().get(id)!!.args).jsonObject
        assertEquals(id, args.getValue("p_client_id").jsonPrimitive.content)
        val p = args.getValue("p_lead").jsonObject
        assertEquals("true", p.getValue("force").jsonPrimitive.content)
        assertEquals("android", p.getValue("via").jsonPrimitive.content)

        // Still queued: the tidy-up keeps it.
        repo.tidyAfterPull()
        assertTrue(db.leads().get(id) != null)
        // Sent (the queue item is gone) but the pull didn't return it (e.g. given to someone else).
        db.outbox().delete(id)
        repo.tidyAfterPull()
        assertNull(db.leads().get(id))
    }

    @Test
    fun aBadNumberIsRefusedBeforeAnythingIsSaved() = runTest {
        try {
            repo.createLead(LeadDraft("Asha", "12345", null, null, null))
            fail("bad phone accepted")
        } catch (e: RpcFailure.Permanent) {
            assertEquals("invalid_input", e.code)
        }
        assertEquals(0, db.outbox().unsentCount())
    }

    @Test
    fun notesAndStagesAreQueuedPerLeadInOrder() = runTest {
        db.leads().upsert(listOf(lead("L1")))
        val note = repo.addNote("L1", " Called from the clinic ")
        repo.setStage("L1", LeadStage.INTERESTED, null)

        val heads = db.outbox().dueHeads(now, 10)
        assertEquals(listOf(note), heads.map { it.id }) // the stage waits behind the note
        assertEquals("add_lead_note", heads.single().rpc)
        assertEquals(LeadStage.INTERESTED, db.leads().get("L1")!!.stage)
    }

    @Test
    fun doneOnATaskClosesItAndTheLeadsMatchingDate() = runTest {
        db.leads().upsert(listOf(lead("L1", next = now - 10)))
        db.followups().upsert(listOf(task("T1", "L1", now - 10)))
        repo.completeFollowup("T1", null)
        assertEquals("done", db.followups().get("T1")!!.status)
        assertNull(db.leads().get("L1")!!.nextFollowupAt)
        assertEquals("complete_followup", db.outbox().dueHeads(now, 10).single().rpc)
    }

    @Test
    fun searchByTypedNumberMatchesTheStoredE164() = runTest {
        db.leads().upsert(listOf(lead("L1"), lead("L2", phone = "+919900011122")))
        assertEquals(listOf("L1"), repo.observeLeads(LeadFilter.All, "98450 12345").first().map { it.id })
        assertEquals(listOf("L2"), repo.observeLeads(LeadFilter.All, "Lead L2").first().map { it.id })
        assertEquals("L1", repo.findByPhone("+91 98450-12345")?.id)
    }

    @Test
    fun dueFilterShowsOnlyLeadsToCallNow() = runTest {
        db.leads().upsert(listOf(lead("due", next = now - 1), lead("later", next = now + 60_000), lead("none")))
        assertEquals(listOf("due"), repo.observeLeads(LeadFilter.Due, "").first().map { it.id })
    }

    @Test
    fun bookingSavesTheServersRowAndMovesTheLeadOn() = runTest {
        db.leads().upsert(listOf(lead("L1", stage = LeadStage.INTERESTED)))
        answer = { fn, args ->
            assertEquals("book_appointment", fn)
            PearlJson.parseToJsonElement(
                """{"id":"${args.getValue("p_client_id").jsonPrimitive.content}","lead_id":"L1","doctor_id":"D1",
                   "appt_date":"2027-01-16","slot_start":"2027-01-16T05:30:00+00:00","status":"pending_confirmation",
                   "mode":"offline","version":1,"updated_at":"x","repeat":false}""",
            )
        }
        val row = repo.book("B1", "L1", "D1", "Dr. Test", FreeSlot(start = "2027-01-16T05:30:00+00:00", left = 1), online = false, confirmed = false)

        assertEquals("B1", row.id)
        assertEquals("Dr. Test", row.doctor)
        assertEquals(LeadStage.CONSULTATION_BOOKED, db.leads().get("L1")!!.stage)
        val booking = calls.single().second.getValue("p_booking").jsonObject
        assertEquals("android", booking.getValue("booked_from").jsonPrimitive.content)
        assertEquals("2027-01-16T05:30:00+00:00", booking.getValue("slot_start").jsonPrimitive.content)
    }

    @Test
    fun aFullSlotComesBackAsItsCode() = runTest {
        answer = { _, _ -> throw RpcFailure.Permanent("slot_full") }
        try {
            repo.book("B1", "L1", "D1", null, FreeSlot(start = "2027-01-16T05:30:00+00:00", left = 1), online = false, confirmed = false)
            fail("booked a full slot")
        } catch (e: RpcFailure.Permanent) {
            assertEquals("slot_full", e.code)
        }
        assertTrue(db.appointments().observeForLead("L1").first().isEmpty())
    }

    @Test
    fun freeSlotsAndDashboardAreReadFromTheServersShape() = runTest {
        answer = { fn, _ ->
            PearlJson.parseToJsonElement(
                if (fn == "get_free_slots") {
                    """[{"start":"2027-01-16T05:30:00+00:00","end":"2027-01-16T05:45:00+00:00","capacity":2,"booked":2,"left":0,"blocked_reason":null},
                        {"start":"2027-01-16T05:45:00+00:00","capacity":2,"booked":0,"left":2,"blocked_reason":"leave"},
                        {"start":"2027-01-16T06:00:00+00:00","capacity":1,"booked":0,"left":1,"blocked_reason":null}]"""
                } else {
                    """{"date":"2027-01-15","from":"2027-01-01","to":"2027-01-15",
                        "today":{"calls":12,"connected":7,"talk_s":900,"followups_due":3,"followups_overdue":1,"booked":2,"pending_confirmations":4},
                        "month":{"x":1},"target":null,"calls_per_day":[{"day":"2027-01-14","calls":5,"connected":2},{"day":"2027-01-15","calls":12,"connected":7}],
                        "funnel":[]}"""
                },
            )
        }
        val slots = repo.freeSlots("D1", LocalDate.of(2027, 1, 16))
        assertEquals(listOf(false, false, true), slots.map { it.bookable })
        assertEquals("2027-01-16", calls.last().second.getValue("p_date").jsonPrimitive.content)

        val d = repo.dashboard()
        assertEquals(12, d.today.calls)
        assertEquals(4, d.today.pendingConfirmations)
        assertEquals(listOf(5, 12), d.callsPerDay.map { it.calls })
    }
}
