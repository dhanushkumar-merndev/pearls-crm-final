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

    private fun readTheme(): ThemeMode =
        prefs.getString(KEY_THEME, null)?.let { name -> ThemeMode.entries.firstOrNull { it.name == name } } ?: ThemeMode.Dark

    private companion object {
        const val KEY_THEME = "theme"
        const val KEY_BACKGROUND = "last_background_at"
        const val KEY_OWNER = "database_owner"
    }
}
