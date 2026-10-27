package com.pearl.crm.core.ui.components

import androidx.compose.runtime.staticCompositionLocalOf

/**
 * Whether the phone is online right now (the app provides it). Screens that show numbers from
 * the server reload when it turns true after a failed load, so nobody has to pull to refresh.
 */
val LocalOnline = staticCompositionLocalOf { true }
