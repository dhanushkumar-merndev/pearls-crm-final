package com.pearl.crm.core.ui.components

import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BrokenImage
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.CloudOff
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.WarningAmber
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pearl.crm.core.ui.R
import com.pearl.crm.core.ui.theme.Pearl
import com.pearl.crm.core.ui.theme.Spacing
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Accent colours for icons and tiles, in the fixed chart order from tokens.json (never raw hex).
 * Used for meaning-free decoration only; status keeps [StatusTone] (icon + label).
 */
enum class Accent(internal val index: Int) { Blue(0), Orange(1), Teal(2), Amber(3), Pink(4), Violet(6) }

@Composable
fun accentColor(accent: Accent): Color = Pearl.palette.chartSeries[accent.index % Pearl.palette.chartSeries.size]

/** A small icon on a soft tinted square: gives a card or a tile something to look at. */
@Composable
fun IconBadge(icon: ImageVector, color: Color, modifier: Modifier = Modifier, size: Dp = 36.dp, iconSize: Dp = 18.dp) {
    Box(
        modifier.size(size).clip(RoundedCornerShape(size * 0.3f)).background(color.copy(alpha = 0.16f)),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(iconSize))
    }
}

/** The first letters of up to two words ("Priya Sharma" → "PS"), for [Avatar]. */
fun initialsOf(name: String): String {
    val words = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() && it.first().isLetterOrDigit() }
    return when {
        words.isEmpty() -> "?"
        words.size == 1 -> words[0].take(1).uppercase()
        else -> (words[0].take(1) + words[1].take(1)).uppercase()
    }
}

/** A round letter mark for a person. The colour comes from the name, so it stays the same everywhere. */
@Composable
fun Avatar(name: String, modifier: Modifier = Modifier, size: Dp = 40.dp) {
    val series = Pearl.palette.chartSeries
    val color = series[Math.floorMod(name.trim().lowercase().hashCode(), series.size)]
    Box(
        modifier.size(size).clip(CircleShape).background(color.copy(alpha = 0.20f)),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            initialsOf(name),
            color = color,
            fontWeight = FontWeight.SemiBold,
            fontSize = (size.value * 0.36f).sp,
            maxLines = 1,
        )
    }
}

/** A status as a small tinted pill: still an icon and a label (never colour alone). */
@Composable
fun StatusPill(text: String, tone: StatusTone, modifier: Modifier = Modifier) {
    val palette = Pearl.palette
    val (icon, color) = when (tone) {
        StatusTone.Good -> Icons.Outlined.CheckCircle to palette.goodText
        StatusTone.Info -> Icons.Outlined.Info to palette.textSecondary
        StatusTone.Warning -> Icons.Outlined.WarningAmber to palette.warning
        StatusTone.Critical -> Icons.Outlined.ErrorOutline to palette.badText
        StatusTone.Offline -> Icons.Outlined.CloudOff to palette.textSecondary
    }
    Row(
        modifier
            .clip(CircleShape)
            .background(color.copy(alpha = 0.14f))
            .padding(horizontal = Spacing.m, vertical = 3.dp),
        horizontalArrangement = Arrangement.spacedBy(Spacing.xs),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(14.dp))
        Text(text, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurface, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** A neutral label pill, e.g. a lead's stage. */
@Composable
fun Tag(text: String, modifier: Modifier = Modifier, color: Color = Pearl.palette.textSecondary) {
    Text(
        text,
        style = MaterialTheme.typography.labelMedium,
        color = color,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = modifier
            .clip(CircleShape)
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, CircleShape)
            .padding(horizontal = Spacing.m, vertical = 2.dp),
    )
}

/** One number tile: an accent icon, the number, and its label. */
@Immutable
data class StatItem(val label: String, val value: String, val icon: ImageVector, val accent: Accent)

@Composable
fun AccentStatTile(item: StatItem, modifier: Modifier = Modifier) {
    val color = accentColor(item.accent)
    PearlCard(
        modifier.semantics(mergeDescendants = true) {},
        contentPadding = PaddingValues(horizontal = Spacing.l, vertical = Spacing.m),
        verticalSpacing = Spacing.s,
    ) {
        IconBadge(item.icon, color, size = 30.dp, iconSize = 16.dp)
        Column(verticalArrangement = Arrangement.spacedBy(0.dp)) {
            Text(item.value, style = MaterialTheme.typography.titleLarge, maxLines = 1)
            Text(item.label, color = Pearl.palette.textSecondary, style = MaterialTheme.typography.bodySmall, maxLines = 2)
        }
    }
}

/** Three tiles to a row, each the same width, with accent icons. */
@Composable
fun StatTiles(items: List<StatItem>, modifier: Modifier = Modifier, perRow: Int = 3) {
    FlowRow(
        modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(Spacing.s),
        verticalArrangement = Arrangement.spacedBy(Spacing.s),
        maxItemsInEachRow = perRow,
    ) {
        items.forEach { AccentStatTile(it, Modifier.weight(1f)) }
        repeat((perRow - items.size % perRow) % perRow) { Box(Modifier.weight(1f)) }
    }
}

/**
 * A card that leads with an icon badge and a title (and a line under it), then [content].
 * Flat like every card (ChatGPT style, owner 03/11/2026: no gradients): raised colour, hairline border.
 */
@Composable
fun HeroCard(
    title: String,
    icon: ImageVector,
    accent: Color,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    trailing: (@Composable RowScope.() -> Unit)? = null,
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
        color = Pearl.palette.raised,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
    ) {
        Column(
            Modifier.padding(Spacing.card),
            verticalArrangement = Arrangement.spacedBy(Spacing.m),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
                IconBadge(icon, accent, size = 40.dp, iconSize = 20.dp)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(title, style = MaterialTheme.typography.titleMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    subtitle?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Pearl.palette.textSecondary, maxLines = 4, overflow = TextOverflow.Ellipsis) }
                }
                trailing?.invoke(this)
            }
            content?.invoke(this)
        }
    }
}

/** A quiet line with a small icon in front: for secondary numbers under the tiles. */
@Composable
fun InfoLine(icon: ImageVector, text: String, modifier: Modifier = Modifier, small: Boolean = false, color: Color? = null) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(if (small) Spacing.s else Spacing.m), verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, tint = color ?: Pearl.palette.textMuted, modifier = Modifier.size(if (small) 14.dp else 16.dp))
        Text(
            text,
            style = if (small) MaterialTheme.typography.bodySmall else MaterialTheme.typography.bodyMedium,
            color = color ?: Pearl.palette.textSecondary,
            maxLines = if (small) 1 else Int.MAX_VALUE,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f, fill = false),
        )
    }
}

/** Today in IST, e.g. "Monday, 03/11/2026" (dates are DD/MM/YYYY everywhere). */
fun todayLine(today: LocalDate = LocalDate.now(ZoneId.of("Asia/Kolkata")), locale: Locale = Locale.getDefault()): String =
    today.format(DateTimeFormatter.ofPattern("EEEE, dd/MM/yyyy", locale))

/** The top of a home tab: the greeting, today's date, and the person's letter mark. */
@Composable
fun GreetingHeader(greeting: String, name: String, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.m)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(greeting, style = MaterialTheme.typography.titleLarge, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.semantics { heading() })
            Text(todayLine(), style = MaterialTheme.typography.bodySmall, color = Pearl.palette.textSecondary)
        }
        Avatar(name, size = 40.dp)
    }
}

/** A gently pulsing placeholder: the shared look of everything that is still loading. */
@Composable
fun rememberPulseAlpha(): Float {
    val transition = rememberInfiniteTransition(label = "pulse")
    val alpha by transition.animateFloat(
        initialValue = 0.35f,
        targetValue = 0.75f,
        animationSpec = infiniteRepeatable(tween(900, easing = FastOutSlowInEasing), RepeatMode.Reverse),
        label = "pulse-alpha",
    )
    return alpha
}

/** Reads a photo file into a bitmap no wider/taller than [maxPx], turned upright. Off the main thread. */
suspend fun loadPhoto(file: File, maxPx: Int = 720): ImageBitmap? = withContext(Dispatchers.IO) {
    try {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, bounds)
        if (bounds.outWidth <= 0) return@withContext null
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxPx) sample *= 2
        val decoded = BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: return@withContext null
        val degrees = runCatching {
            when (ExifInterface(file.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                else -> 0f
            }
        }.getOrDefault(0f)
        val upright = if (degrees == 0f) decoded else android.graphics.Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, Matrix().apply { postRotate(degrees) }, true)
        upright.asImageBitmap()
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        null
    }
}

/**
 * A photo with a loader: a pulsing placeholder and a spinner until the picture is ready, then
 * it fades in. [busy] keeps a spinner over the photo (e.g. while it uploads); a photo that
 * can't be read shows a broken-image mark. Give either a [file] (read here) or a ready [bitmap].
 */
@Composable
fun PhotoPreview(
    modifier: Modifier = Modifier,
    file: File? = null,
    bitmap: ImageBitmap? = null,
    contentDescription: String? = null,
    busy: Boolean = false,
    busyText: String? = null,
    height: Dp = 180.dp,
) {
    var loaded by remember(file) { mutableStateOf<ImageBitmap?>(null) }
    var failed by remember(file) { mutableStateOf(false) }
    LaunchedEffect(file) {
        if (file != null) {
            loaded = loadPhoto(file)
            failed = loaded == null
        }
    }
    val image = bitmap ?: loaded
    val loading = image == null && !failed
    val loadingText = stringResource(R.string.common_loading_photo)
    Box(
        modifier
            .fillMaxWidth()
            .height(height)
            .clip(MaterialTheme.shapes.medium)
            .background(MaterialTheme.colorScheme.surfaceContainerHighest.copy(alpha = 0.5f))
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, MaterialTheme.shapes.medium)
            .testTag(if (loading) "photo-loading" else "photo")
            .semantics { if (loading) this.contentDescription = loadingText else contentDescription?.let { this.contentDescription = it } },
        contentAlignment = Alignment.Center,
    ) {
        Crossfade(targetState = image, label = "photo") { img ->
            when {
                img != null -> Image(img, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
                failed -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.BrokenImage, null, tint = Pearl.palette.textMuted, modifier = Modifier.size(32.dp))
                }
                else -> {
                    val pulse = rememberPulseAlpha()
                    Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.surfaceContainerHighest.copy(alpha = pulse)), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 2.5.dp, color = Pearl.palette.textSecondary)
                    }
                }
            }
        }
        if (busy && image != null) {
            Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.scrim), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(Spacing.s)) {
                    CircularProgressIndicator(Modifier.size(28.dp), strokeWidth = 2.5.dp, color = Color.White)
                    busyText?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = Color.White) }
                }
            }
        }
    }
}

/** A round icon-only action on a soft tint of [color] (e.g. Call / WhatsApp on a row). 40 dp to tap. */
@Composable
fun TintedIconButton(icon: ImageVector, label: String, color: Color, onClick: () -> Unit, modifier: Modifier = Modifier) {
    androidx.compose.material3.IconButton(
        onClick = onClick,
        modifier = modifier.size(MinTouchTarget),
        colors = androidx.compose.material3.IconButtonDefaults.iconButtonColors(containerColor = color.copy(alpha = 0.14f), contentColor = color),
    ) {
        Icon(icon, contentDescription = label, modifier = Modifier.size(18.dp))
    }
}
