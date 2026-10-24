package com.pearl.crm.core.data.security

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import javax.crypto.AEADBadTagException

/** Stands in for the Android Keystore (not available on the JVM): a reversible scramble. */
internal class FakeBox : SecretBox {
    var broken = false

    override fun seal(plain: ByteArray) = ByteArray(plain.size) { (plain[it].toInt() xor 0x5A).toByte() }

    override fun open(sealed: ByteArray): ByteArray {
        if (broken) throw AEADBadTagException("key lost")
        return ByteArray(sealed.size) { (sealed[it].toInt() xor 0x5A).toByte() }
    }
}

@RunWith(AndroidJUnit4::class)
class PinStoreTest {
    private lateinit var box: FakeBox
    private lateinit var prefs: SecurePrefs

    @Before
    fun setUp() {
        val shared = ApplicationProvider.getApplicationContext<Context>().getSharedPreferences("pin-test", Context.MODE_PRIVATE)
        shared.edit().clear().commit()
        box = FakeBox()
        prefs = SecurePrefs(shared, box)
    }

    @Test
    fun acceptsOnlyFourToSixDigits() {
        assertTrue(PinStore.isValidPin("1234"))
        assertTrue(PinStore.isValidPin("123456"))
        assertFalse(PinStore.isValidPin("123"))
        assertFalse(PinStore.isValidPin("1234567"))
        assertFalse(PinStore.isValidPin("12a4"))
        assertFalse(PinStore.isValidPin(" 1234"))
        assertThrows(IllegalArgumentException::class.java) { PinStore(prefs).setPin("12") }
    }

    @Test
    fun setThenCheck() {
        val store = PinStore(prefs)
        assertFalse(store.hasPin())
        assertEquals(PinCheck.NoPin, store.verify("1234"))
        store.setPin("2580")
        assertTrue(store.hasPin())
        assertEquals(PinCheck.Ok, store.verify("2580"))
        assertEquals(PinCheck.Wrong(4), store.verify("0852"))
    }

    @Test
    fun keepsOnlyASaltedHash() {
        val store = PinStore(prefs)
        store.setPin("2580")
        val first = prefs.getString("pin.hash")!!
        assertFalse(first.contains("2580"))
        store.setPin("2580")
        assertNotEquals(first, prefs.getString("pin.hash")) // new salt each time
        assertEquals(PinCheck.Ok, store.verify("2580"))
    }

    @Test
    fun wrongTriesCountDownThenTheFifthWipesThePin() {
        val store = PinStore(prefs)
        store.setPin("2580")
        assertEquals(
            listOf(PinCheck.Wrong(4), PinCheck.Wrong(3), PinCheck.Wrong(2), PinCheck.Wrong(1)),
            (1..4).map { store.verify("1111") },
        )
        assertEquals(PinCheck.LockedOut, store.verify("1111"))
        assertFalse(store.hasPin())
        // Even the right PIN no longer works: the person must log in again.
        assertEquals(PinCheck.NoPin, store.verify("2580"))
    }

    @Test
    fun theRightPinResetsTheCount() {
        val store = PinStore(prefs)
        store.setPin("2580")
        store.verify("1111")
        store.verify("1111")
        assertEquals(PinCheck.Ok, store.verify("2580"))
        assertEquals(PinCheck.Wrong(4), store.verify("1111"))
    }

    @Test
    fun wrongTriesSurviveAnAppRestart() {
        PinStore(prefs).apply {
            setPin("2580")
            verify("1111")
            verify("1111")
        }
        assertEquals(PinCheck.Wrong(2), PinStore(prefs).verify("1111"))
    }

    @Test
    fun aNewPinStartsWithFullTries() {
        val store = PinStore(prefs)
        store.setPin("2580")
        repeat(3) { store.verify("1111") }
        store.setPin("135790")
        assertEquals(PinCheck.Wrong(4), store.verify("1111"))
        assertEquals(PinCheck.Ok, store.verify("135790"))
    }

    @Test
    fun aRecordInAnUnknownFormatCountsAsNoPinAndIsRemoved() {
        prefs.putString("pin.hash", "v0:garbage")
        val store = PinStore(prefs)
        assertTrue(store.hasPin())
        assertEquals(PinCheck.NoPin, store.verify("1234"))
        assertFalse(store.hasPin())
    }

    @Test
    fun aRecordTheKeyCanNoLongerOpenCountsAsNoPin() {
        val store = PinStore(prefs)
        store.setPin("2580")
        box.broken = true // key lost after a backup restore / reinstall
        assertFalse(store.hasPin())
        assertEquals(PinCheck.NoPin, store.verify("2580"))
    }

    @Test
    fun clearForgetsThePin() {
        val store = PinStore(prefs)
        store.setPin("2580")
        store.clear()
        assertFalse(store.hasPin())
        assertEquals(PinCheck.NoPin, store.verify("2580"))
    }

    @Test
    fun controllerTracksWhetherAPinIsSet() = runTest {
        val controller = PinController(PinStore(prefs))
        assertFalse(controller.hasPin.value)

        controller.set("2580")
        assertTrue(controller.hasPin.value)
        assertEquals(PinCheck.Wrong(4), controller.verify("1111"))
        assertTrue(controller.hasPin.value)
        assertEquals(PinCheck.Ok, controller.verify("2580"))

        repeat(4) { controller.verify("1111") }
        assertTrue(controller.hasPin.value)
        assertEquals(PinCheck.LockedOut, controller.verify("1111"))
        assertFalse(controller.hasPin.value)

        controller.set("2580")
        controller.clear()
        assertFalse(controller.hasPin.value)
    }

    @Test
    fun controllerStartsFromWhatIsStored() {
        PinStore(prefs).setPin("2580")
        assertTrue(PinController(PinStore(prefs)).hasPin.value)
    }

    @Test
    fun controllerNoticesARecordThatCouldNotBeRead() = runTest {
        prefs.putString("pin.hash", "v0:garbage")
        val controller = PinController(PinStore(prefs))
        assertTrue(controller.hasPin.value)
        assertEquals(PinCheck.NoPin, controller.verify("1234"))
        assertFalse(controller.hasPin.value)
    }
}
