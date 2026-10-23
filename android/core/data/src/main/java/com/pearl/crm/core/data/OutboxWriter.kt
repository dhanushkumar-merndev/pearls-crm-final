package com.pearl.crm.core.data

import com.pearl.crm.core.data.db.OutboxDao
import com.pearl.crm.core.data.db.OutboxItem
import com.pearl.crm.core.data.db.OutboxKind
import com.pearl.crm.core.data.db.OutboxState
import kotlinx.serialization.json.JsonObject
import java.util.UUID

/** New id for a record made on the phone (also its `p_client_id`). */
fun newClientId(): String = UUID.randomUUID().toString()

/**
 * Queues a write for the server. Screens save locally first, then call [enqueue]; the sync
 * worker sends it when there is a connection. [onEnqueued] asks for a send soon.
 */
class OutboxWriter(
    private val dao: OutboxDao,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    @Volatile
    var onEnqueued: () -> Unit = {}

    /**
     * [clientId] must be the same id the [args] carry as `p_client_id` (when the RPC takes one).
     * [entityKey] groups writes that must arrive in order, e.g. "lead:<id>".
     */
    suspend fun enqueue(
        rpc: String,
        args: JsonObject,
        entityKey: String,
        clientId: String = newClientId(),
        kind: OutboxKind = OutboxKind.User,
    ): String {
        val now = clock()
        dao.enqueue(
            OutboxItem(
                id = clientId,
                seq = 0,
                rpc = rpc,
                args = args.toString(),
                entityKey = entityKey,
                kind = kind.wire,
                createdAt = now,
                attempts = 0,
                nextAttemptAt = now,
                lastError = null,
                state = OutboxState.Pending.wire,
            ),
        )
        onEnqueued()
        return clientId
    }
}
