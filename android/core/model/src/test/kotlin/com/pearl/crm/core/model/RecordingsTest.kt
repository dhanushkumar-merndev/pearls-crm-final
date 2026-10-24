package com.pearl.crm.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDateTime

class RecordingsTest {
    private val at = LocalDateTime.of(2024, 10, 24, 15, 30, 45).atZone(IstDates.ZONE).toInstant().toEpochMilli()

    private fun parsed(name: String) = RecordingNames.parse(name)

    @Test
    fun samsungOneUi() {
        assertEquals(ParsedRecordingName(null, at), parsed("Call recording Asha_241024_153045.m4a"))
        assertEquals(ParsedRecordingName("9845012345", at), parsed("Call recording +91 98450 12345_241024_153045.m4a"))
        assertEquals(ParsedRecordingName("9845012345", at), parsed("Call recording 09845012345_241024_153045.m4a"))
    }

    @Test
    fun samsungOlder() {
        assertEquals(ParsedRecordingName("9845012345", at), parsed("Asha_9845012345_20241024153045.m4a"))
    }

    @Test
    fun xiaomi() {
        assertEquals(ParsedRecordingName("9845012345", at), parsed("Asha(+919845012345)_20241024153045.mp3"))
        assertEquals(ParsedRecordingName("9845012345", at), parsed("Call@Asha(09845012345)_20241024153045.mp3"))
        assertEquals(ParsedRecordingName("9845012345", at), parsed("9845012345_20241024153045.mp3"))
    }

    @Test
    fun colorOsOnePlusOppoRealme() {
        assertEquals(ParsedRecordingName("9845012345", at), parsed("Asha 9845012345_2024-10-24-15-30-45.m4a"))
        assertEquals(ParsedRecordingName("9845012345", at), parsed("9845012345_20241024_153045.amr"))
    }

    @Test
    fun vivo() {
        assertEquals(ParsedRecordingName("9845012345", at), parsed("9845012345_241024153045.m4a"))
        assertEquals(ParsedRecordingName(null, at), parsed("Asha 2024-10-24 15-30-45.m4a"))
    }

    @Test
    fun aTwelveDigitNumberIsNotMistakenForATime() {
        // 91 98 45 01 23 45 is not a valid date (month 98), so it stays the phone number.
        assertEquals(ParsedRecordingName("9845012345", at), parsed("919845012345_241024_153045.m4a"))
    }

    @Test
    fun namesWithoutTimeOrNumber() {
        assertEquals(ParsedRecordingName(null, null), parsed("Asha.m4a"))
        assertEquals(ParsedRecordingName("9845012345", null), parsed("9845012345.m4a"))
        assertTrue(RecordingNames.isAudio("x.M4A"))
        assertFalse(RecordingNames.isAudio("notes.txt"))
    }

    private fun call(id: String, phone: String? = "9845012345", startOffsetS: Int = 0, durationS: Int = 300) =
        CallCandidate(id, phone, at + startOffsetS * 1000L, durationS, "lead-$id")

    @Test
    fun aNumberInTheNameMustBeTheCallsNumber() {
        val file = RecordingFile("Call recording +91 98450 12345_241024_153045.m4a", at + 300_000, 300_000, 500_000)
        val m = RecordingMatcher.match(file, listOf(call("other", phone = "9900011122"), call("right", startOffsetS = -20)))
        assertEquals("right", m?.call?.id)
        assertEquals(0.95, m!!.confidence, 0.001)
        assertFalse(m.needsReview)
        assertNull(RecordingMatcher.match(file, listOf(call("other", phone = "9900011122"))))
    }

    @Test
    fun tooFarApartInTimeIsNoMatch() {
        val file = RecordingFile("9845012345_20241024153045.mp3", at + 300_000, 300_000, 500_000)
        assertNull(RecordingMatcher.match(file, listOf(call("late", startOffsetS = 600))))
    }

    @Test
    fun nameOnlyFilesMatchByTimeAndLengthAndAskForAReview() {
        val file = RecordingFile("Call recording Asha_241024_153045.m4a", at + 300_000, 298_000, 500_000)
        val m = RecordingMatcher.match(file, listOf(call("a", phone = null, startOffsetS = 10), call("b", startOffsetS = 3600)))
        assertEquals("a", m?.call?.id)
        assertTrue(m!!.needsReview)
        // A call of a very different length is not it.
        assertNull(RecordingMatcher.match(file, listOf(call("short", startOffsetS = 10, durationS = 30))))
    }

    @Test
    fun twoCallsAtTheSameTimeByTimeAloneIsNotGuessed() {
        val file = RecordingFile("Asha 2024-10-24 15-30-45.m4a", at + 300_000, 300_000, 500_000)
        assertNull(RecordingMatcher.match(file, listOf(call("a", startOffsetS = 5), call("b", startOffsetS = -5))))
    }

    @Test
    fun withoutATimeInTheNameTheFileTimeIsUsed() {
        // Written at the end of the call: end − length = start.
        val file = RecordingFile("Asha.m4a", at + 300_000, 300_000, 500_000)
        assertNotNull(RecordingMatcher.match(file, listOf(call("a", phone = null))))
    }

    @Test
    fun aLongCallKeepsTheFirstTenMinutesUnderTheSizeLimit() {
        val plan = UploadPlan.forDuration(durationS = 14 * 60, maxSeconds = 600)
        assertEquals(600, plan.keepSeconds)
        assertTrue(plan.trimmed)
        assertEquals(1, plan.channels)
        assertEquals(16_000, plan.sampleRate)
        assertTrue("${plan.estimatedBytes} bytes", plan.estimatedBytes < UploadPlan.MAX_BYTES)
        // Even the largest setting (60 minutes) is checked against the limit by the uploader, not assumed.
        assertFalse(UploadPlan.forDuration(5 * 60, 600).trimmed)
        assertEquals(300, UploadPlan.forDuration(5 * 60, 600).keepSeconds)
    }

    @Test
    fun pcmHelpers() {
        assertEquals(listOf<Short>(150, -50), Pcm.toMono(shortArrayOf(100, 200, -100, 0), 2).toList())
        val one = ShortArray(48_000) { 1000 }
        val out = Pcm.resample(one, 48_000, 16_000)
        assertEquals(16_000, out.size)
        assertTrue(out.all { it == 1000.toShort() })
        // 2 → 3 samples: in-between values are interpolated.
        assertEquals(listOf<Short>(0, 66, 100), Pcm.resample(shortArrayOf(0, 100), 2, 3).toList())
    }
}
