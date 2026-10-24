package com.pearl.crm.core.sync

import androidx.room.Room
import androidx.room.withTransaction
import androidx.test.core.app.ApplicationProvider
import com.pearl.crm.core.data.db.AppDatabase
import com.pearl.crm.core.model.RpcTransport
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import java.util.Collections

/** The server, as the sync code sees it: records every call and answers with [handler]. */
internal class FakeTransport(
    var handler: suspend (fn: String, args: JsonObject) -> JsonElement = { _, _ -> JsonNull },
) : RpcTransport {
    val calls: MutableList<Pair<String, JsonObject>> = Collections.synchronizedList(mutableListOf())

    val names: List<String> get() = synchronized(calls) { calls.map { it.first } }

    override suspend fun call(fn: String, args: JsonObject): JsonElement {
        calls += fn to args
        return handler(fn, args)
    }
}

internal fun inMemoryDb(): AppDatabase =
    Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), AppDatabase::class.java)
        .allowMainThreadQueries()
        .build()

internal fun AppDatabase.transactionRunner(): suspend (suspend () -> Unit) -> Unit =
    { block -> withTransaction { block() } }
