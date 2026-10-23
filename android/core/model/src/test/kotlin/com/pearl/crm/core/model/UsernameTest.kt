package com.pearl.crm.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Same cases as packages/shared/tests/auth.test.ts. */
class UsernameTest {
    @Test
    fun mapsUsernameToTheReservedInternalDomain() {
        assertEquals("reception2@staff.invalid", Username.toLoginEmail("  Reception2 "))
    }

    @Test
    fun acceptsOnlySimpleUsernames() {
        assertTrue(Username.isValid("asha.admin"))
        assertTrue(Username.isValid("Rekha_2"))
        assertFalse(Username.isValid("ab"))
        assertFalse(Username.isValid("rekha@example.com"))
        assertFalse(Username.isValid("has space"))
        assertFalse(Username.isValid("a".repeat(33)))
    }

    @Test
    fun rolesRoundTripAndOnlySalesAndFieldStaffUseTheApp() {
        for (role in StaffRole.entries) assertEquals(role, StaffRole.fromWire(role.wire))
        assertEquals(null, StaffRole.fromWire("owner"))
        assertEquals(
            setOf(StaffRole.SalesExecutive, StaffRole.SalesManager, StaffRole.Bdm),
            StaffRole.entries.filter { it.usesAndroidApp }.toSet(),
        )
    }
}
