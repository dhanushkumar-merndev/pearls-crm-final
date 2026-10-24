package com.pearl.crm.core.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

/**
 * The phone's database: every list on screen reads from here, and sync keeps it current.
 * Schemas are exported to core/data/schemas; each new version adds a [Migration] to
 * [MIGRATIONS] and a case to AppDatabaseMigrationTest (never a destructive fallback: unsent
 * work lives in the outbox).
 */
@Database(
    entities = [
        LookupValueEntity::class, OutboxItem::class, SyncMarker::class,
        LeadEntity::class, FollowupEntity::class, AppointmentEntity::class, CallLogEntity::class,
    ],
    version = 2,
    exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun lookupValues(): LookupValueDao
    abstract fun outbox(): OutboxDao
    abstract fun syncMarkers(): SyncMarkerDao
    abstract fun leads(): LeadDao
    abstract fun followups(): FollowupDao
    abstract fun appointments(): AppointmentDao
    abstract fun callLogs(): CallLogDao

    companion object {
        const val NAME = "pearl.db"

        /** 1 → 2 (Phase 11): the sales tables. SQL copied from schemas/…/2.json. */
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("CREATE TABLE IF NOT EXISTS `leads` (`id` TEXT NOT NULL, `sl_no` INTEGER, `name` TEXT NOT NULL, `phone_e164` TEXT NOT NULL, `phone_last10` TEXT NOT NULL, `alt_phone_e164` TEXT, `email` TEXT, `treatment_text` TEXT, `source_id` TEXT, `stage` TEXT NOT NULL, `lead_date` TEXT, `next_followup_at` INTEGER, `amount_quoted_paise` INTEGER, `amount_finalised_paise` INTEGER, `comments1` TEXT, `comments2` TEXT, `assigned_to` TEXT, `patient_id` TEXT, `lost_reason_id` TEXT, `last_activity_at` INTEGER NOT NULL, `updated_at` TEXT NOT NULL, `local_only` INTEGER NOT NULL, `pending` INTEGER NOT NULL, PRIMARY KEY(`id`))")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_leads_stage` ON `leads` (`stage`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_leads_next_followup_at` ON `leads` (`next_followup_at`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_leads_phone_last10` ON `leads` (`phone_last10`)")
                db.execSQL("CREATE TABLE IF NOT EXISTS `followups` (`id` TEXT NOT NULL, `kind` TEXT NOT NULL, `lead_id` TEXT, `patient_id` TEXT, `due_date` TEXT NOT NULL, `due_at` INTEGER, `reason` TEXT NOT NULL, `status` TEXT NOT NULL, `outcome` TEXT, `assigned_to` TEXT, `updated_at` TEXT NOT NULL, `pending` INTEGER NOT NULL, PRIMARY KEY(`id`))")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_followups_status_due_date` ON `followups` (`status`, `due_date`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_followups_lead_id` ON `followups` (`lead_id`)")
                db.execSQL("CREATE TABLE IF NOT EXISTS `appointments` (`id` TEXT NOT NULL, `lead_id` TEXT, `patient_id` TEXT, `doctor_id` TEXT, `doctor` TEXT, `appt_date` TEXT NOT NULL, `slot_start` INTEGER, `status` TEXT NOT NULL, `mode` TEXT, `version` INTEGER NOT NULL, `updated_at` TEXT NOT NULL, `pending` INTEGER NOT NULL, PRIMARY KEY(`id`))")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_appointments_lead_id` ON `appointments` (`lead_id`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_appointments_status_slot_start` ON `appointments` (`status`, `slot_start`)")
                db.execSQL("CREATE TABLE IF NOT EXISTS `call_logs` (`id` TEXT NOT NULL, `lead_id` TEXT, `phone_e164` TEXT, `direction` TEXT NOT NULL, `started_at` INTEGER NOT NULL, `duration_s` INTEGER NOT NULL, `outcome` TEXT, `notes` TEXT, `updated_at` TEXT NOT NULL, `pending` INTEGER NOT NULL, PRIMARY KEY(`id`))")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_call_logs_lead_id_started_at` ON `call_logs` (`lead_id`, `started_at`)")
                db.execSQL("CREATE INDEX IF NOT EXISTS `index_call_logs_started_at` ON `call_logs` (`started_at`)")
            }
        }

        val MIGRATIONS: Array<Migration> = arrayOf(MIGRATION_1_2)

        fun build(context: Context, name: String = NAME): AppDatabase =
            Room.databaseBuilder(context.applicationContext, AppDatabase::class.java, name)
                .addMigrations(*MIGRATIONS)
                .build()
    }
}
