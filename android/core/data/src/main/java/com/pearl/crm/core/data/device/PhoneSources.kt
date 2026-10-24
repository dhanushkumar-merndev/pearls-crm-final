package com.pearl.crm.core.data.device

import android.content.ContentResolver
import android.content.Context
import android.database.Cursor
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.CallLog
import android.provider.DocumentsContract
import com.pearl.crm.core.data.CallLogSource
import com.pearl.crm.core.data.DeviceCall
import com.pearl.crm.core.data.FoundFile
import com.pearl.crm.core.data.RecordingFolder
import com.pearl.crm.core.model.CallDirection
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** The phone's call log (READ_CALL_LOG). Voicemail and blocked calls are left out. */
class ContentCallLogSource(private val context: Context) : CallLogSource {
    override suspend fun read(afterMs: Long, limit: Int): List<DeviceCall> = withContext(Dispatchers.IO) {
        val projection = arrayOf(CallLog.Calls._ID, CallLog.Calls.NUMBER, CallLog.Calls.TYPE, CallLog.Calls.DATE, CallLog.Calls.DURATION)
        val selection = "${CallLog.Calls.DATE} > ?"
        val args = arrayOf(afterMs.toString())
        val cursor: Cursor? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            context.contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                projection,
                Bundle().apply {
                    putString(ContentResolver.QUERY_ARG_SQL_SELECTION, selection)
                    putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, args)
                    putString(ContentResolver.QUERY_ARG_SQL_SORT_ORDER, "${CallLog.Calls.DATE} ASC")
                    putInt(ContentResolver.QUERY_ARG_LIMIT, limit)
                },
                null,
            )
        } else {
            context.contentResolver.query(CallLog.Calls.CONTENT_URI, projection, selection, args, "${CallLog.Calls.DATE} ASC LIMIT $limit")
        }
        cursor?.use { c ->
            buildList {
                while (c.moveToNext() && size < limit) {
                    val direction = when (c.getInt(2)) {
                        CallLog.Calls.INCOMING_TYPE -> CallDirection.INCOMING
                        CallLog.Calls.OUTGOING_TYPE -> CallDirection.OUTGOING
                        CallLog.Calls.MISSED_TYPE, CallLog.Calls.REJECTED_TYPE -> CallDirection.MISSED
                        else -> null
                    } ?: continue
                    val number = c.getString(1) ?: continue
                    add(DeviceCall(key = c.getLong(0).toString(), number = number, direction = direction, startedAt = c.getLong(3), durationS = c.getInt(4)))
                }
            }
        }.orEmpty()
    }

    /** The newest call with [last10] (for the after-call sheet: its real length and key). */
    suspend fun latestFor(last10: String, since: Long): DeviceCall? =
        read(since, 50).lastOrNull { it.number.filter(Char::isDigit).takeLast(10) == last10 }
}

/**
 * The recordings folder the person picked once (Storage Access Framework tree). Looks in the
 * folder and one level of subfolders (Samsung keeps calls in "Recordings/Call").
 */
class SafRecordingFolder(private val context: Context, private val treeUri: Uri) : RecordingFolder {
    override suspend fun list(modifiedAfter: Long): List<FoundFile> = withContext(Dispatchers.IO) {
        val root = DocumentsContract.getTreeDocumentId(treeUri)
        buildList {
            children(root).forEach { child ->
                if (child.isDir) children(child.id).filter { !it.isDir }.forEach { add(it) } else add(child)
            }
        }.filter { it.lastModified > modifiedAfter }.map {
            FoundFile(DocumentsContract.buildDocumentUriUsingTree(treeUri, it.id).toString(), it.name, it.lastModified, it.size)
        }
    }

    override suspend fun durationMs(uri: String): Long? = withContext(Dispatchers.IO) {
        val r = MediaMetadataRetriever()
        try {
            r.setDataSource(context, Uri.parse(uri))
            r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
        } catch (_: Exception) {
            null
        } finally {
            runCatching { r.release() }
        }
    }

    private data class Doc(val id: String, val name: String, val lastModified: Long, val size: Long, val isDir: Boolean)

    private fun children(parentId: String): List<Doc> {
        val uri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, parentId)
        val projection = arrayOf(
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_LAST_MODIFIED,
            DocumentsContract.Document.COLUMN_SIZE,
            DocumentsContract.Document.COLUMN_MIME_TYPE,
        )
        return context.contentResolver.query(uri, projection, null, null, null)?.use { c ->
            buildList {
                while (c.moveToNext()) {
                    add(
                        Doc(
                            id = c.getString(0),
                            name = c.getString(1).orEmpty(),
                            lastModified = c.getLong(2),
                            size = c.getLong(3),
                            isDir = c.getString(4) == DocumentsContract.Document.MIME_TYPE_DIR,
                        ),
                    )
                }
            }
        }.orEmpty()
    }
}
