package com.pearl.crm.core.data

import android.content.SharedPreferences
import com.pearl.crm.core.model.ThemeMode
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** Small, non-secret app settings. */
class SettingsStore(private val prefs: SharedPreferences) {
    private val _theme = MutableStateFlow(readTheme())

    /** Dark by default (PLAN.md B5). */
    val theme: StateFlow<ThemeMode> = _theme.asStateFlow()

    fun setTheme(mode: ThemeMode) {
        prefs.edit().putString(KEY_THEME, mode.name).apply()
        _theme.value = mode
    }

    /** When the app last went to the background (epoch ms), for the 5-minute PIN rule. */
    var lastBackgroundAt: Long?
        get() = prefs.getLong(KEY_BACKGROUND, -1).takeIf { it >= 0 }
        set(value) {
            prefs.edit().apply { if (value == null) remove(KEY_BACKGROUND) else putLong(KEY_BACKGROUND, value) }.commit()
        }

    /** Whose data the local database holds; another person logging in starts from empty. */
    var databaseOwner: String?
        get() = prefs.getString(KEY_OWNER, null)
        set(value) {
            prefs.edit().putString(KEY_OWNER, value).commit()
        }

    /** The phone's call log has been imported up to here (epoch ms of the newest call seen). */
    var callLogImportedUntil: Long
        get() = prefs.getLong(KEY_CALL_LOG, 0L)
        set(value) {
            prefs.edit().putLong(KEY_CALL_LOG, value).apply()
        }

    /** The dialer's recordings folder the person chose (a content:// tree), or null. */
    var recordingFolder: String?
        get() = prefs.getString(KEY_REC_FOLDER, null)
        set(value) {
            prefs.edit().putString(KEY_REC_FOLDER, value).apply()
        }

    /** From the server's recording_tasks(): "sync_only" or "all_calls". */
    var recordingMode: String
        get() = prefs.getString(KEY_REC_MODE, null) ?: "sync_only"
        set(value) {
            prefs.edit().putString(KEY_REC_MODE, value).apply()
        }

    /** Only this many seconds of a call are uploaded. */
    var recordingMaxSeconds: Int
        get() = prefs.getInt(KEY_REC_MAX, 600)
        set(value) {
            prefs.edit().putInt(KEY_REC_MAX, value).apply()
        }

    /** The caller pop-up is on (the person can switch it off in Settings). */
    var callerPopup: Boolean
        get() = prefs.getBoolean(KEY_POPUP, true)
        set(value) {
            prefs.edit().putBoolean(KEY_POPUP, value).apply()
        }

    private fun readTheme(): ThemeMode =
        prefs.getString(KEY_THEME, null)?.let { name -> ThemeMode.entries.firstOrNull { it.name == name } } ?: ThemeMode.Dark

    private companion object {
        const val KEY_THEME = "theme"
        const val KEY_BACKGROUND = "last_background_at"
        const val KEY_OWNER = "database_owner"
        const val KEY_CALL_LOG = "call_log_imported_until"
        const val KEY_REC_FOLDER = "recording_folder"
        const val KEY_REC_MODE = "recording_mode"
        const val KEY_REC_MAX = "recording_max_seconds"
        const val KEY_POPUP = "caller_popup"
    }
}
