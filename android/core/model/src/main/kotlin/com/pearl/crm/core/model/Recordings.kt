package com.pearl.crm.core.model

import java.time.LocalDateTime
import java.time.ZoneId
import kotlin.math.abs
import kotlin.math.roundToLong

/** What a dialer's file name tells us: the other person's number (if written) and when the call was. */
data class ParsedRecordingName(
    /** Last 10 digits of the number in the name, or null (many dialers write the contact's name instead). */
    val phoneLast10: String?,
    /** Call time from the name (epoch ms), or null. */
    val recordedAt: Long?,
)

/**
 * File names of the dialers' own call recordings. Seen on the phones we support:
 * - Samsung One UI: `Call recording Asha_241024_153045.m4a`, `Call recording +91 98450 12345_241024_153045.m4a`
 * - Samsung (older): `Asha_9845012345_20241024153045.m4a`
 * - Xiaomi / Redmi (MIUI): `Asha(+919845012345)_20241024153045.mp3`, `Call@Asha(09845012345)_20241024153045.mp3`
 * - OnePlus / Oppo / Realme (ColorOS): `Asha 9845012345_2024-10-24-15-30-45.m4a`
 * - Vivo: `9845012345_241024153045.m4a`, `Asha 2024-10-24 15-30-45.m4a`
 * Google Phone app recordings stay inside the dialer and never reach these folders (PLAN.md A1 question 10).
 */
object RecordingNames {
    val AUDIO_EXTENSIONS = setOf("m4a", "mp3", "amr", "aac", "3gp", "ogg", "opus", "wav")

    private data class Pattern(val regex: Regex, val twoDigitYear: Boolean)

    // Most specific first; each match is checked as a real date and time.
    private val PATTERNS = listOf(
        Pattern(Regex("""(?<!\d)(\d{4})-(\d{2})-(\d{2})[ _-](\d{2})[-:.](\d{2})[-:.](\d{2})(?!\d)"""), false),
        Pattern(Regex("""(?<!\d)(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})(?!\d)"""), false),
        Pattern(Regex("""(?<!\d)(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?!\d)"""), false),
        Pattern(Regex("""(?<!\d)(\d{2})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})(?!\d)"""), true),
        Pattern(Regex("""(?<!\d)(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?!\d)"""), true),
    )
    private val PHONE = Regex("""\+?\d[\d \-]{7,17}\d""")

    fun isAudio(fileName: String): Boolean = fileName.substringAfterLast('.', "").lowercase() in AUDIO_EXTENSIONS

    fun parse(fileName: String, zone: ZoneId = IstDates.ZONE): ParsedRecordingName {
        var rest = fileName.substringBeforeLast('.')
        var at: Long? = null
        for (p in PATTERNS) {
            val m = p.regex.findAll(rest).firstNotNullOfOrNull { m -> toMillis(m, p.twoDigitYear, zone)?.let { m to it } } ?: continue
            at = m.second
            rest = rest.removeRange(m.first.range).let { " $it " }
            break
        }
        val phone = PHONE.findAll(rest)
            .map { it.value.filter(Char::isDigit) }
            .filter { it.length in 10..13 }
            .mapNotNull { digits -> Phones.normalize(if (digits.length > 10 && !digits.startsWith("0")) "+$digits" else digits) }
            .firstOrNull()
        return ParsedRecordingName(phone?.last10, at)
    }

    private fun toMillis(m: MatchResult, twoDigitYear: Boolean, zone: ZoneId): Long? {
        val g = m.groupValues.drop(1).map { it.toInt() }
        val year = if (twoDigitYear) 2000 + g[0] else g[0]
        if (year !in 2015..2099) return null
        return runCatching { LocalDateTime.of(year, g[1], g[2], g[3], g[4], g[5]).atZone(zone).toInstant().toEpochMilli() }.getOrNull()
    }
}

/** A recording file found in the dialer's folder. */
data class RecordingFile(
    val name: String,
    /** When the file was last written (≈ the end of the call). */
    val lastModified: Long,
    /** Length in ms when the phone could read it, else null. */
    val durationMs: Long?,
    val sizeBytes: Long,
)

/** A call the file may belong to (the app's call notes or the phone's call log). */
data class CallCandidate(
    val id: String,
    val phoneLast10: String?,
    val startedAt: Long,
    val durationS: Int,
    val leadId: String?,
)

data class RecordingMatch(val call: CallCandidate, val confidence: Double, val needsReview: Boolean)

/**
 * File ↔ call. A number in the file name must be the call's number; then the time decides.
 * Without a number (the dialer wrote the contact's name) only a close time and length match,
 * and the manager is told to check it ("matched by time only").
 */
object RecordingMatcher {
    /** The recording starts within this of the call (ringing, answer delay, clocks). */
    const val START_WINDOW_MS = 3 * 60_000L

    /** Without a number in the name the time must be much closer. */
    const val TIME_ONLY_WINDOW_MS = 90_000L

    fun match(file: RecordingFile, calls: List<CallCandidate>, zone: ZoneId = IstDates.ZONE): RecordingMatch? {
        val parsed = RecordingNames.parse(file.name, zone)
        val durationS = file.durationMs?.let { (it / 1000.0).roundToLong() }
        // The file's own start: from its name, else its end time minus its length.
        val start = parsed.recordedAt ?: durationS?.let { file.lastModified - it * 1000 } ?: file.lastModified
        val scored = calls.mapNotNull { call ->
            val gap = abs(call.startedAt - start)
            val lengthOk = durationS == null || call.durationS == 0 ||
                abs(call.durationS - durationS) <= maxOf(20L, call.durationS / 5L)
            when {
                parsed.phoneLast10 != null -> {
                    if (call.phoneLast10 != parsed.phoneLast10 || gap > START_WINDOW_MS) null
                    else RecordingMatch(call, if (lengthOk) 0.95 else 0.8, needsReview = false) to gap
                }
                gap <= TIME_ONLY_WINDOW_MS && lengthOk && durationS != null ->
                    RecordingMatch(call, 0.6, needsReview = true) to gap
                else -> null
            }
        }
        if (scored.isEmpty()) return null
        val best = scored.minWith(compareByDescending<Pair<RecordingMatch, Long>> { it.first.confidence }.thenBy { it.second })
        // Two calls equally close by time alone: don't guess.
        val tie = scored.count { it.first.confidence == best.first.confidence && abs(it.second - best.second) < 15_000 } > 1
        return if (tie && best.first.needsReview) null else best.first
    }
}

/** What gets uploaded for one recording (PLAN.md: first N minutes, mono 16 kHz, small). */
data class UploadPlan(
    /** Seconds to keep from the start. */
    val keepSeconds: Int,
    val trimmed: Boolean,
    val sampleRate: Int = SAMPLE_RATE,
    val channels: Int = 1,
    val bitRate: Int = BIT_RATE,
) {
    /** Expected file size (AAC at [bitRate] plus container overhead). */
    val estimatedBytes: Long get() = keepSeconds.toLong() * bitRate / 8 + 16_384

    companion object {
        const val SAMPLE_RATE = 16_000
        const val BIT_RATE = 24_000

        /** The server's limit for one call recording (files_begin_upload). */
        const val MAX_BYTES = 3L * 1024 * 1024

        fun forDuration(durationS: Int, maxSeconds: Int): UploadPlan {
            val keep = durationS.coerceAtLeast(1).coerceAtMost(maxSeconds.coerceAtLeast(1))
            return UploadPlan(keepSeconds = keep, trimmed = durationS > maxSeconds)
        }
    }
}

/** Plain PCM helpers used by the compressor (kept here so they can be tested without a phone). */
object Pcm {
    /** Interleaved 16-bit samples with [channels] channels → one channel (the average). */
    fun toMono(samples: ShortArray, channels: Int): ShortArray {
        if (channels <= 1) return samples
        val frames = samples.size / channels
        return ShortArray(frames) { f ->
            var sum = 0
            for (c in 0 until channels) sum += samples[f * channels + c]
            (sum / channels).toShort()
        }
    }

    /** Linear resampling of mono 16-bit samples (good enough for speech). */
    fun resample(samples: ShortArray, fromRate: Int, toRate: Int): ShortArray {
        if (fromRate == toRate || samples.isEmpty()) return samples
        val outSize = (samples.size.toLong() * toRate / fromRate).toInt()
        val step = fromRate.toDouble() / toRate
        return ShortArray(outSize) { i ->
            val pos = i * step
            val left = pos.toInt().coerceAtMost(samples.size - 1)
            val right = (left + 1).coerceAtMost(samples.size - 1)
            val frac = pos - left
            (samples[left] + (samples[right] - samples[left]) * frac).toInt().toShort()
        }
    }
}
