package com.pearl.crm.core.ui.theme

import androidx.compose.ui.unit.dp

/**
 * The only spacing values on the phone (compact scale, owner 26/10/2026). Screens use [screen]
 * at the edges, cards [card] inside, and [section] between blocks; nothing off this scale.
 */
object Spacing {
    val xs = 4.dp
    val s = 6.dp
    val m = 10.dp
    val l = 12.dp
    val xl = 20.dp

    /** Left/right (and top) padding of a screen. Sign-in and PIN screens use [xl]. */
    val screen = l

    /** Padding inside a card. */
    val card = l

    /** Gap between blocks on a screen. */
    val section = l

    /** Gap between rows of a list. */
    val item = s
}
