package com.pearl.crm.core.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pearl.crm.core.model.ThemeMode

/** Colours Material has no slot for (secondary text, links, status), from the same tokens. */
@Immutable
data class PearlPalette(
    val page: Color,
    val sidebar: Color,
    val raised: Color,
    val text: Color,
    val textSecondary: Color,
    val textMuted: Color,
    val link: Color,
    val goodText: Color,
    val badText: Color,
    val chartSeries: List<Color>,
    val good: Color = PearlColors.Status.Good,
    val warning: Color = PearlColors.Status.Warning,
    val serious: Color = PearlColors.Status.Serious,
    val critical: Color = PearlColors.Status.Critical,
)

private val DarkPalette = with(PearlColors.Dark) {
    PearlPalette(Page, Sidebar, Raised, Text, TextSecondary, TextMuted, Link, GoodText, BadText, ChartSeries)
}

private val LightPalette = with(PearlColors.Light) {
    PearlPalette(Page, Sidebar, Raised, Text, TextSecondary, TextMuted, Link, GoodText, BadText, ChartSeries)
}

private val DarkScheme = with(PearlColors.Dark) {
    darkColorScheme(
        primary = Primary,
        onPrimary = PrimaryText,
        primaryContainer = Raised,
        onPrimaryContainer = Text,
        secondary = Link,
        onSecondary = PrimaryText,
        secondaryContainer = RaisedHover,
        onSecondaryContainer = Text,
        background = Page,
        onBackground = Text,
        surface = Page,
        onSurface = Text,
        surfaceVariant = Raised,
        onSurfaceVariant = TextSecondary,
        surfaceContainerLowest = Page,
        surfaceContainerLow = Sidebar,
        surfaceContainer = Sidebar,
        surfaceContainerHigh = Raised,
        surfaceContainerHighest = RaisedHover,
        outline = BorderStrong,
        outlineVariant = Border,
        error = Danger,
        onError = DangerText,
        scrim = Overlay,
    )
}

private val LightScheme = with(PearlColors.Light) {
    lightColorScheme(
        primary = Primary,
        onPrimary = PrimaryText,
        primaryContainer = Hover,
        onPrimaryContainer = Text,
        secondary = Link,
        onSecondary = PrimaryText,
        secondaryContainer = RaisedHover,
        onSecondaryContainer = Text,
        background = Page,
        onBackground = Text,
        surface = Page,
        onSurface = Text,
        surfaceVariant = Hover,
        onSurfaceVariant = TextSecondary,
        surfaceContainerLowest = Page,
        surfaceContainerLow = Sidebar,
        surfaceContainer = Sidebar,
        surfaceContainerHigh = Hover,
        surfaceContainerHighest = RaisedHover,
        outline = BorderStrong,
        outlineVariant = Border,
        error = Danger,
        onError = DangerText,
        scrim = Overlay,
    )
}

/** Big, readable text (PLAN.md B5: 16–18 px; tokens.json base 17). */
private val PearlTypography = Typography().run {
    copy(
        bodyLarge = bodyLarge.copy(fontSize = 17.sp, lineHeight = 26.sp),
        bodyMedium = bodyMedium.copy(fontSize = 16.sp, lineHeight = 24.sp),
        bodySmall = bodySmall.copy(fontSize = 15.sp, lineHeight = 22.sp),
        labelLarge = labelLarge.copy(fontSize = 17.sp, fontWeight = FontWeight.Medium),
        labelMedium = labelMedium.copy(fontSize = 15.sp),
        labelSmall = labelSmall.copy(fontSize = 14.sp),
        titleLarge = TextStyle(fontSize = 24.sp, lineHeight = 32.sp, fontWeight = FontWeight.SemiBold),
        titleMedium = titleMedium.copy(fontSize = 19.sp, fontWeight = FontWeight.SemiBold),
        titleSmall = titleSmall.copy(fontSize = 17.sp, fontWeight = FontWeight.SemiBold),
    )
}

private val PearlShapes = Shapes(
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(12.dp),
    large = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(24.dp),
)

val LocalPearlPalette = staticCompositionLocalOf { DarkPalette }

/** Dark by default (ChatGPT-style, PLAN.md B5), Light, or follow the phone. */
@Composable
fun PearlTheme(mode: ThemeMode = ThemeMode.Dark, content: @Composable () -> Unit) {
    val dark = when (mode) {
        ThemeMode.Dark -> true
        ThemeMode.Light -> false
        ThemeMode.System -> isSystemInDarkTheme()
    }
    CompositionLocalProvider(LocalPearlPalette provides if (dark) DarkPalette else LightPalette) {
        MaterialTheme(
            colorScheme = if (dark) DarkScheme else LightScheme,
            typography = PearlTypography,
            shapes = PearlShapes,
            content = content,
        )
    }
}

object Pearl {
    val palette: PearlPalette
        @Composable get() = LocalPearlPalette.current
}
