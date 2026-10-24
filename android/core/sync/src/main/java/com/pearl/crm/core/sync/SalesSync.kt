package com.pearl.crm.core.sync

import com.pearl.crm.core.data.db.AppointmentDao
import com.pearl.crm.core.data.db.AppointmentEntity
import com.pearl.crm.core.data.db.CallLogDao
import com.pearl.crm.core.data.db.CallLogEntity
import com.pearl.crm.core.data.db.CrmNumberDao
import com.pearl.crm.core.data.db.CrmNumberEntity
import com.pearl.crm.core.data.db.FollowupDao
import com.pearl.crm.core.data.db.FollowupEntity
import com.pearl.crm.core.data.db.LeadDao
import com.pearl.crm.core.data.db.LeadEntity
import com.pearl.crm.core.model.SyncEntityName
import kotlinx.serialization.json.JsonObject

/**
 * The sales entities of `sync_pull`. A malformed row is skipped rather than blocking every
 * later pull; `removed` ids (deleted, or no longer this person's — e.g. a lead reassigned to
 * someone else) are deleted from the phone.
 */
private inline fun <T> parse(rows: List<JsonObject>, from: (JsonObject) -> T): List<T> =
    rows.mapNotNull { runCatching { from(it) }.getOrNull() }

class LeadsSync(private val dao: LeadDao) : SyncEntity {
    override val name = SyncEntityName.LEADS

    override suspend fun apply(rows: List<JsonObject>, removed: List<String>) {
        dao.upsert(parse(rows, LeadEntity::fromRow))
        removed.chunked(MAX_SQL_ARGS).forEach { dao.deleteByIds(it) }
    }
}

class FollowupsSync(private val dao: FollowupDao) : SyncEntity {
    override val name = SyncEntityName.FOLLOWUPS

    override suspend fun apply(rows: List<JsonObject>, removed: List<String>) {
        dao.upsert(parse(rows, FollowupEntity::fromRow))
        removed.chunked(MAX_SQL_ARGS).forEach { dao.deleteByIds(it) }
    }
}

class AppointmentsSync(private val dao: AppointmentDao) : SyncEntity {
    override val name = SyncEntityName.APPOINTMENTS

    override suspend fun apply(rows: List<JsonObject>, removed: List<String>) {
        dao.upsert(parse(rows, AppointmentEntity::fromRow))
        removed.chunked(MAX_SQL_ARGS).forEach { dao.deleteByIds(it) }
    }
}

class CallLogsSync(private val dao: CallLogDao) : SyncEntity {
    override val name = SyncEntityName.CALL_LOGS

    override suspend fun apply(rows: List<JsonObject>, removed: List<String>) {
        dao.upsert(parse(rows, CallLogEntity::fromRow))
        removed.chunked(MAX_SQL_ARGS).forEach { dao.deleteByIds(it) }
    }
}

/** The numbers the caller pop-up and the call-log import look for. */
class CrmNumbersSync(private val dao: CrmNumberDao) : SyncEntity {
    override val name = SyncEntityName.CRM_NUMBERS

    override suspend fun apply(rows: List<JsonObject>, removed: List<String>) {
        dao.upsert(parse(rows, CrmNumberEntity::fromRow))
        removed.chunked(MAX_SQL_ARGS).forEach { dao.deleteByIds(it) }
    }
}
