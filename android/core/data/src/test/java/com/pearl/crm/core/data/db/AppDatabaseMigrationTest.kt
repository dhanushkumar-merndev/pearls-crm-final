package com.pearl.crm.core.data.db

import androidx.room.Room
import androidx.room.testing.MigrationTestHelper
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Database upgrades. Each new schema version adds a Migration to [AppDatabase.MIGRATIONS] and
 * a test here: create the old version from its exported JSON (core/data/schemas), insert rows
 * with plain SQL, run [MigrationTestHelper.runMigrationsAndValidate] to the new version, and
 * check the rows (above all unsent outbox writes) are still there.
 */
@RunWith(AndroidJUnit4::class)
class AppDatabaseMigrationTest {
    @get:Rule
    val helper = MigrationTestHelper(InstrumentationRegistry.getInstrumentation(), AppDatabase::class.java)

    @Test
    fun version1To2AddsTheSalesTablesAndKeepsQueuedWrites() = runTest {
        helper.createDatabase(DB, 1).apply {
            execSQL(
                "INSERT INTO outbox (id, seq, rpc, args, entity_key, kind, created_at, attempts, next_attempt_at, last_error, state) " +
                    "VALUES ('w1', 1, 'lead_note_add', '{}', 'lead:1', 'user', 0, 0, 0, NULL, 'pending')",
            )
            close()
        }
        // Validates the tables against the schema file …
        helper.runMigrationsAndValidate(DB, 2, true, *AppDatabase.MIGRATIONS).apply {
            execSQL(
                "INSERT INTO leads (id, name, phone_e164, phone_last10, stage, last_activity_at, updated_at, local_only, pending) " +
                    "VALUES ('l1', 'Test Lead', '+919800000001', '9800000001', 'new', 0, '', 0, 0)",
            )
            close()
        }

        // … and Room's own identity check against the compiled entities.
        val db = Room.databaseBuilder(ApplicationProvider.getApplicationContext(), AppDatabase::class.java, DB)
            .addMigrations(*AppDatabase.MIGRATIONS)
            .allowMainThreadQueries()
            .build()
        try {
            assertEquals("lead_note_add", db.outbox().get("w1")?.rpc)
            assertEquals("Test Lead", db.leads().get("l1")?.name)
        } finally {
            db.close()
        }
    }

    private companion object {
        const val DB = "migration-test.db"
    }
}
