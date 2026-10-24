package com.pearl.crm.core.data

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.pearl.crm.core.data.db.AppDatabase
import com.pearl.crm.core.data.db.CallLogEntity
import com.pearl.crm.core.data.db.CrmNumberEntity
import com.pearl.crm.core.data.net.PearlJson
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class CallLogImporterTest {
    private lateinit var db: AppDatabase
    private lateinit var settings: SettingsStore
    private lateinit var importer: CallLogImporter
    private val now = 1_800_000_000_000L
    private val phoneLog = mutableListOf<DeviceCall>()
    private val reads = mutableListOf<Long>()
    private val source = CallLogSource { after, limit ->
        reads += after
        phoneLog.filter { it.startedAt > after }.sortedBy { it.startedAt }.take(limit)
    }

    @Before
    fun open() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        db = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
        settings = SettingsStore(context.getSharedPreferences("import-test", Context.MODE_PRIVATE))
        importer = CallLogImporter(source, db, OutboxWriter(db.outbox()) { now }, settings, { "staff-1" }) { now }
    }

    @After
    fun close() {
        db.close()
        ApplicationProvider.getApplicationContext<Context>().getSharedPreferences("import-test", Context.MODE_PRIVATE).edit().clear().commit()
    }

    private suspend fun crm(vararg last10: String) =
        db.crmNumbers().upsert(last10.map { CrmNumberEntity("n$it", "lead-$it", it, null, null, "x") })

    private fun call(key: String, number: String, minutesAgo: Int, durationS: Int = 60, direction: String = "outgoing") =
        DeviceCall(key, number, direction, now - minutesAgo * 60_000L, durationS)

    @Test
    fun onlyCallsWithCrmNumbersLeaveThePhone() = runTest {
        crm("9845012345")
        phoneLog += call("1", "+91 98450 12345", 30)
        phoneLog += call("2", "9900011122", 20) // a personal call
        phoneLog += call("3", "09845012345", 10, durationS = 0, direction = "missed")

        assertEquals(2, importer.import())

        val queued = db.outbox().dueHeads(Long.MAX_VALUE, 10).single()
        assertEquals("import_call_log", queued.rpc)
        val rows = PearlJson.parseToJsonElement(queued.args).jsonObject.getValue("p_rows").jsonArray.map { it.jsonObject }
        assertEquals(listOf("1", "3"), rows.map { it.getValue("device_call_key").jsonPrimitive.content })
        assertEquals("+919845012345", rows[0].getValue("phone").jsonPrimitive.content)
        assertEquals(CallLogImporter.idFor("staff-1", "1"), rows[0].getValue("client_id").jsonPrimitive.content)
        // On the phone too, linked to the lead, waiting to be confirmed by the server.
        val local = db.callLogs().get(CallLogImporter.idFor("staff-1", "1"))!!
        assertEquals("lead-9845012345", local.leadId)
        assertEquals("connected", local.outcome)
        assertNull(db.callLogs().get(CallLogImporter.idFor("staff-1", "3"))!!.outcome) // missed
        assertNull(db.callLogs().get(CallLogImporter.idFor("staff-1", "2")))
        assertEquals(now - 10 * 60_000L, settings.callLogImportedUntil)
    }

    @Test
    fun runningAgainImportsNothingTwice() = runTest {
        crm("9845012345")
        phoneLog += call("1", "9845012345", 30)
        importer.import()
        assertEquals(0, importer.import())
        // Even if the marker were lost, the key keeps it to one row.
        settings.callLogImportedUntil = 0
        assertEquals(0, importer.import())
        assertEquals(1, db.outbox().dueHeads(Long.MAX_VALUE, 10).size)
    }

    @Test
    fun aCallAlreadyNotedInTheAppIsNotImportedAgain() = runTest {
        crm("9845012345")
        db.callLogs().upsert(listOf(CallLogEntity("app-call", "lead-9845012345", "+919845012345", "outgoing", now - 30 * 60_000L + 40_000, 55, "connected", "Spoke", "")))
        phoneLog += call("1", "9845012345", 30)
        assertEquals(0, importer.import())
    }

    @Test
    fun nothingHappensBeforeTheCrmNumbersHaveSynced() = runTest {
        phoneLog += call("1", "9845012345", 30)
        assertEquals(0, importer.import())
        assertEquals(0L, settings.callLogImportedUntil)
        assertEquals(emptyList<Long>(), reads) // the call log isn't even read
    }

    @Test
    fun theFirstImportLooksBackOneWeek() = runTest {
        crm("9845012345")
        phoneLog += call("old", "9845012345", 60 * 24 * 10)
        phoneLog += call("new", "9845012345", 60)
        assertEquals(1, importer.import())
        assertEquals(now - CallLogImporter.FIRST_IMPORT_DAYS * 86_400_000L, reads.single())
    }
}
