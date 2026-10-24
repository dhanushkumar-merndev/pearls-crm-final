package com.pearl.crm.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Same cases as packages/shared/tests/phone.test.ts. */
class PhonesTest {
    @Test
    fun indianFormats() {
        for (typed in listOf("+91 98450 12345", "098450-12345", "9845012345", "0091 9845012345", "919845012345")) {
            assertEquals(typed, "+919845012345", Phones.normalize(typed)?.e164)
        }
        assertEquals("9845012345", Phones.normalize("9845012345")?.last10)
        assertEquals(true, Phones.normalize("9845012345")?.isIndianMobile)
        assertEquals(false, Phones.normalize("044 2345 6789")?.isIndianMobile)
        // A Bengaluru landline looks like a mobile by digits alone (a hint only, as on the web).
        assertEquals("+918041234567", Phones.normalize("080 4123 4567")?.e164)
        assertEquals(true, Phones.normalize("080 4123 4567")?.isIndianMobile)
    }

    @Test
    fun internationalKept() {
        assertEquals("+14155552671", Phones.normalize("+1 415 555 2671")?.e164)
    }

    @Test
    fun rejectsJunk() {
        for (typed in listOf("", "   ", "12345", "0123456789", "+1 23", "abc")) assertNull(typed, Phones.normalize(typed))
    }
}
