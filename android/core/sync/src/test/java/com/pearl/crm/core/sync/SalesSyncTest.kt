package com.pearl.crm.core.sync

import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pearl.crm.core.data.db.AppDatabase
import com.pearl.crm.core.data.net.PearlJson
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** The sales entities of sync_pull, end to end through the PullEngine. */
@RunWith(AndroidJUnit4::class)
class SalesSyncTest {
    private lateinit var db: AppDatabase
    private val server = FakeTransport()

    @Before
    fun open() {
        db = inMemoryDb()
    }

    @After
    fun close() = db.close()

    private fun engine() = PullEngine(
        transport = server,
        entities = listOf(
            LeadsSync(db.leads()), FollowupsSync(db.followups()), AppointmentsSync(db.appointments()), CallLogsSync(db.callLogs()),
            CrmNumbersSync(db.crmNumbers()),
        ),
        markers = db.syncMarkers(),
        inTransaction = db.transactionRunner(),
    )

    private fun respond(json: String) {
        var sent = false
        server.handler = { _, _ ->
            // One page, then nothing new.
            PearlJson.parseToJsonElement(if (sent) """{"entities":{}}""" else json.also { sent = true })
        }
    }

    private fun leadRow(id: String, name: String, next: String? = null) =
        """{"id":"$id","sl_no":7,"name":"$name","phone_e164":"+919845012345","stage":"contacted",
            "next_followup_at":${next?.let { "\"$it\"" } ?: "null"},"last_activity_at":"2027-01-15T06:50:00.225+00:00",
            "updated_at":"2027-01-15T06:50:00.225+00:00","assigned_to":"me"}"""

    @Test
    fun rowsOfAllFourKindsAreSaved() = runTest {
        respond(
            """{"entities":{
              "leads":{"rows":[${leadRow("L1", "Asha", "2027-01-16T05:30:00+00:00")}],"removed":[],"next":"m1","has_more":false},
              "followups":{"rows":[{"id":"F1","kind":"followup","lead_id":"L1","due_date":"2027-01-16","due_at":"2027-01-16T05:30:00+00:00",
                 "reason":"Call back","status":"open","assigned_to":"me","updated_at":"x"}],"removed":[],"next":"m2","has_more":false},
              "appointments":{"rows":[{"id":"A1","lead_id":"L1","doctor_id":"D1","doctor":"Dr. Test","appt_date":"2027-01-20",
                 "slot_start":"2027-01-20T05:30:00+00:00","status":"pending_confirmation","mode":"offline","version":2,"updated_at":"x"}],
                 "removed":[],"next":"m3","has_more":false},
              "call_logs":{"rows":[{"id":"C1","lead_id":"L1","phone_e164":"+919845012345","direction":"outgoing",
                 "started_at":"2027-01-15T06:00:00+00:00","duration_s":95,"outcome":"connected","notes":"ok","updated_at":"x"}],
                 "removed":[],"next":"m4","has_more":false}}}""",
        )

        engine().pull()

        val lead = db.leads().get("L1")!!
        assertEquals("Asha", lead.name)
        assertEquals("9845012345", lead.phoneLast10)
        assertEquals(java.time.Instant.parse("2027-01-16T05:30:00Z").toEpochMilli(), lead.nextFollowupAt)
        assertEquals("Call back", db.followups().get("F1")!!.reason)
        assertEquals(2, db.appointments().observeForLead("L1").first().single().version)
        assertEquals(95, db.callLogs().get("C1")!!.durationS)
        // The call's lead name comes through the join used by the Calls list.
        assertEquals("Asha", db.callLogs().observeRecentWithLead(10).first().single().leadName)
    }

    @Test
    fun aLeadReassignedToSomeoneElseDisappearsFromThisPhone() = runTest {
        respond("""{"entities":{"leads":{"rows":[${leadRow("L1", "Asha")},${leadRow("L2", "Ravi")}],"next":"m1"}}}""")
        engine().pull()
        assertEquals(2, db.leads().observeList(true, emptyList(), null, "", 0, 50).first().size)

        respond("""{"entities":{"leads":{"rows":[],"removed":["L1"],"next":"m2"}}}""")
        engine().pull()

        assertNull(db.leads().get("L1"))
        assertEquals("Ravi", db.leads().get("L2")!!.name)
    }

    @Test
    fun aMalformedRowIsSkipped() = runTest {
        respond("""{"entities":{"leads":{"rows":[{"name":"no id or phone"},${leadRow("L3", "Kiran")}],"next":"m1"}}}""")
        engine().pull()
        assertTrue(db.leads().get("L3") != null)
        assertEquals(1, db.leads().observeList(true, emptyList(), null, "", 0, 50).first().size)
    }

    @Test
    fun crmNumbersFeedTheCallerLookup() = runTest {
        respond(
            """{"entities":{
              "leads":{"rows":[${leadRow("L1", "Asha", "2027-01-16T05:30:00+00:00")}],"next":"m1"},
              "crm_numbers":{"rows":[{"id":"L1","lead_id":"L1","phone_last10":"9845012345","alt_phone_last10":"9900011122","updated_at":"x"}],"next":"c1"}}}""",
        )
        engine().pull()
        assertEquals(setOf("9845012345", "9900011122"), db.crmNumbers().allLast10().toSet())
        val card = db.crmNumbers().card("9900011122")!!
        assertEquals("Asha", card.name)
        assertEquals("contacted", card.stage)

        respond("""{"entities":{"crm_numbers":{"rows":[],"removed":["L1"],"next":"c2"}}}""")
        engine().pull()
        assertNull(db.crmNumbers().card("9845012345"))
    }

    @Test
    fun theSinceMarkersAreSentPerEntity() = runTest {
        respond("""{"entities":{"leads":{"rows":[],"next":"lead-marker"}}}""")
        engine().pull()
        respond("""{"entities":{}}""")
        engine().pull()
        val since = server.calls.last().second.getValue("p_since").jsonObject
        assertEquals("\"lead-marker\"", since.getValue("leads").toString())
    }
}
