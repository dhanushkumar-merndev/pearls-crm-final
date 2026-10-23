package com.pearl.crm.core.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration

/**
 * The phone's database: every list on screen reads from here, and sync keeps it current.
 * Schemas are exported to core/data/schemas; each new version adds a [Migration] to
 * [MIGRATIONS] and a case to AppDatabaseMigrationTest (never a destructive fallback: unsent
 * work lives in the outbox).
 */
@Database(
    entities = [LookupValueEntity::class, OutboxItem::class, SyncMarker::class],
    version = 1,
    exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun lookupValues(): LookupValueDao
    abstract fun outbox(): OutboxDao
    abstract fun syncMarkers(): SyncMarkerDao

    companion object {
        const val NAME = "pearl.db"

        val MIGRATIONS: Array<Migration> = emptyArray()

        fun build(context: Context, name: String = NAME): AppDatabase =
            Room.databaseBuilder(context.applicationContext, AppDatabase::class.java, name)
                .addMigrations(*MIGRATIONS)
                .build()
    }
}
