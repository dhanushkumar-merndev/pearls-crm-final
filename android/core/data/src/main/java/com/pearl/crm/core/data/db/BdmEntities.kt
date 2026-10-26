package com.pearl.crm.core.data.db

import androidx.room.ColumnInfo
import androidx.room.Dao
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.PrimaryKey
import androidx.room.Query
import com.pearl.crm.core.model.RawPoint

/** One GPS reading waiting to be cleaned and packed into an upload chunk. */
@Entity(tableName = "track_points", indices = [Index(value = ["day_id", "t"])])
data class TrackPointEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    @ColumnInfo(name = "day_id") val dayId: String,
    val t: Long,
    val lat: Double,
    val lng: Double,
    val accuracy: Float,
    val mock: Boolean,
) {
    fun toRaw() = RawPoint(t, lat, lng, accuracy, mock)
}

@Dao
interface TrackPointDao {
    @Insert
    suspend fun insert(point: TrackPointEntity)

    @Query("SELECT * FROM track_points WHERE day_id = :dayId AND t <= :until ORDER BY t")
    suspend fun upTo(dayId: String, until: Long): List<TrackPointEntity>

    @Query("DELETE FROM track_points WHERE day_id = :dayId AND t <= :until")
    suspend fun deleteUpTo(dayId: String, until: Long)

    @Query("DELETE FROM track_points WHERE day_id <> :dayId")
    suspend fun deleteOtherDays(dayId: String)

    @Query("SELECT COUNT(*) FROM track_points")
    suspend fun count(): Int
}
