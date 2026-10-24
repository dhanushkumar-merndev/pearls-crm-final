package com.pearl.crm.core.data.net

import com.pearl.crm.core.model.RpcFailure
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import java.io.File

class SignedUploaderTest {
    private val storage = MockWebServer()
    private val calls = mutableListOf<JsonObject>()
    private var alreadyUploaded = false
    private lateinit var file: File

    private val functions = FunctionTransport { fn, body ->
        assertEquals("files-sign", fn)
        calls += body
        when (body.getValue("op").jsonPrimitive.content) {
            "put" -> PearlJson.parseToJsonElement(
                if (alreadyUploaded) """{"file_id":"F1","status":"uploaded"}"""
                else """{"file_id":"F1","status":"pending","upload":{"url":"${storage.url("/bucket/key")}","method":"PUT","headers":{"content-type":"audio/mp4"}}}""",
            )
            else -> PearlJson.parseToJsonElement("""{"file_id":"F1","status":"uploaded"}""")
        }
    }
    private val uploader by lazy { SignedUploader(functions, OkHttpClient()) }

    @Before
    fun setUp() {
        storage.start()
        file = File.createTempFile("upload", ".m4a").apply { writeBytes(ByteArray(1234) { 7 }) }
    }

    @After
    fun tearDown() {
        storage.shutdown()
        file.delete()
    }

    private suspend fun upload() = uploader.upload("call_recording", "audio/mp4", file, "a".repeat(64), mapOf("lead_id" to "L1"), "REC-1")

    @Test
    fun putThenUploadThenConfirm() = runTest {
        storage.enqueue(MockResponse().setResponseCode(200))
        assertEquals("F1", upload())
        assertEquals(listOf("put", "confirm"), calls.map { it.getValue("op").jsonPrimitive.content })
        assertEquals("REC-1", calls[0].getValue("client_id").jsonPrimitive.content)
        assertEquals("1234", calls[0].getValue("size").jsonPrimitive.content)
        val put = storage.takeRequest()
        assertEquals("PUT", put.method)
        assertEquals("audio/mp4", put.getHeader("content-type"))
        assertEquals(1234L, put.bodySize)
    }

    @Test
    fun aFileTheServerAlreadyHasIsNotSentAgain() = runTest {
        alreadyUploaded = true
        assertEquals("F1", upload())
        assertEquals(0, storage.requestCount)
        assertEquals(listOf("put"), calls.map { it.getValue("op").jsonPrimitive.content })
    }

    @Test
    fun storageTroubleIsATemporaryFailure() = runTest {
        storage.enqueue(MockResponse().setResponseCode(503))
        try {
            upload()
            fail("no failure")
        } catch (e: RpcFailure.Transient) {
            assertTrue(e.message!!.contains("503"))
        }
        assertEquals(listOf("put"), calls.map { it.getValue("op").jsonPrimitive.content }) // never confirmed
    }

    @Test
    fun functionErrorsKeepTheirCode() {
        try {
            EdgeClient.interpret(HttpResult(400, """{"error":"file_too_large"}"""))
            fail("no failure")
        } catch (e: RpcFailure.Permanent) {
            assertEquals("file_too_large", e.code)
        }
        try {
            EdgeClient.interpret(HttpResult(502, ""))
            fail("no failure")
        } catch (_: RpcFailure.Transient) {
        }
        try {
            EdgeClient.interpret(HttpResult(401, ""))
            fail("no failure")
        } catch (e: RpcFailure.SignedOut) {
            assertEquals("not_signed_in", e.code)
        }
    }
}
