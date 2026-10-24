package com.pearl.crm.core.data.audio

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import com.pearl.crm.core.model.UploadPlan
import java.io.File

/**
 * Records a short voice note (RECORD_AUDIO) straight into the upload format: AAC mono 16 kHz
 * .m4a, so nothing needs converting later. One recording at a time.
 */
class VoiceRecorder(private val context: Context, private val dir: File) {
    private var recorder: MediaRecorder? = null
    private var file: File? = null
    private var startedAt = 0L

    val isRecording: Boolean get() = recorder != null

    fun start(): File {
        stopAndDiscard()
        dir.mkdirs()
        val out = File(dir, "voice-${System.currentTimeMillis()}.m4a")
        val r = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()
        r.setAudioSource(MediaRecorder.AudioSource.MIC)
        r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
        r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
        r.setAudioChannels(1)
        r.setAudioSamplingRate(UploadPlan.SAMPLE_RATE)
        r.setAudioEncodingBitRate(UploadPlan.BIT_RATE)
        r.setMaxDuration(MAX_MS)
        r.setOutputFile(out.path)
        r.prepare()
        r.start()
        recorder = r
        file = out
        startedAt = System.currentTimeMillis()
        return out
    }

    /** Stops and returns the file and its length in seconds (null when nothing usable was recorded). */
    fun stop(): Pair<File, Int>? {
        val r = recorder ?: return null
        val out = file
        val seconds = ((System.currentTimeMillis() - startedAt) / 1000).toInt()
        recorder = null
        file = null
        val ok = runCatching { r.stop() }.isSuccess
        r.release()
        if (!ok || out == null || seconds < 1) {
            out?.delete()
            return null
        }
        return out to seconds
    }

    fun stopAndDiscard() {
        stop()?.first?.delete()
    }

    companion object {
        /** Voice notes are short: 3 minutes at most (the server's voice note limit is 1 MB). */
        const val MAX_MS = 3 * 60_000
    }
}
