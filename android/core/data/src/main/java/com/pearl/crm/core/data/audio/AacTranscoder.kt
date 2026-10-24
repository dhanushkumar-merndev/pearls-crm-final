package com.pearl.crm.core.data.audio

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
import android.net.Uri
import com.pearl.crm.core.data.AudioProcessor
import com.pearl.crm.core.model.Pcm
import com.pearl.crm.core.model.UploadPlan
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.nio.ByteOrder
import java.security.MessageDigest

/**
 * Shrinks a recording for upload with the phone's own codecs: decode → mono → 16 kHz →
 * AAC-LC at [UploadPlan.bitRate] in an .m4a, keeping only the first [UploadPlan.keepSeconds].
 * The original is only ever opened for reading.
 */
class AacTranscoder(private val context: Context, private val workDir: File) : AudioProcessor {
    override suspend fun sha256(uri: String): String = withContext(Dispatchers.IO) {
        val digest = MessageDigest.getInstance("SHA-256")
        open(uri).use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                digest.update(buf, 0, n)
            }
        }
        digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun open(uri: String): InputStream {
        val parsed = Uri.parse(uri)
        return if (parsed.scheme == "file") File(requireNotNull(parsed.path)).inputStream()
        else context.contentResolver.openInputStream(parsed) ?: throw IOException("cannot open $uri")
    }

    override suspend fun prepare(uri: String, plan: UploadPlan): File = withContext(Dispatchers.IO) {
        workDir.mkdirs()
        val out = File.createTempFile("rec-", ".m4a", workDir)
        try {
            transcode(Uri.parse(uri), out, plan)
            out
        } catch (e: Exception) {
            out.delete()
            throw e
        }
    }

    private fun transcode(source: Uri, out: File, plan: UploadPlan) {
        val extractor = MediaExtractor()
        var decoder: MediaCodec? = null
        var encoder: MediaCodec? = null
        var muxer: MediaMuxer? = null
        try {
            extractor.setDataSource(context, source, null)
            val track = (0 until extractor.trackCount).firstOrNull {
                extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
            } ?: throw IOException("no audio track")
            extractor.selectTrack(track)
            val inFormat = extractor.getTrackFormat(track)
            decoder = MediaCodec.createDecoderByType(inFormat.getString(MediaFormat.KEY_MIME)!!).apply {
                configure(inFormat, null, null, 0)
                start()
            }
            val outFormat = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, plan.sampleRate, plan.channels).apply {
                setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
                setInteger(MediaFormat.KEY_BIT_RATE, plan.bitRate)
                setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16 * 1024)
            }
            encoder = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC).apply {
                configure(outFormat, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                start()
            }
            muxer = MediaMuxer(out.path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
            pump(extractor, decoder, encoder, muxer, plan, inFormat)
        } finally {
            runCatching { decoder?.stop() }
            runCatching { decoder?.release() }
            runCatching { encoder?.stop() }
            runCatching { encoder?.release() }
            runCatching { muxer?.stop() }
            runCatching { muxer?.release() }
            extractor.release()
        }
    }

    private fun pump(extractor: MediaExtractor, decoder: MediaCodec, encoder: MediaCodec, muxer: MediaMuxer, plan: UploadPlan, inFormat: MediaFormat) {
        val limitUs = plan.keepSeconds * 1_000_000L
        val info = MediaCodec.BufferInfo()
        var pcmRate = inFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        var pcmChannels = inFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        var pending = ShortArray(0)
        var inputDone = false
        var decoderDone = false
        var encoderEosSent = false
        var encodedSamples = 0L
        var muxTrack = -1
        var finished = false

        while (!finished) {
            // 1. Compressed input → decoder (stop at the time limit).
            if (!inputDone) {
                val i = decoder.dequeueInputBuffer(TIMEOUT_US)
                if (i >= 0) {
                    val buf = decoder.getInputBuffer(i)!!
                    val size = extractor.readSampleData(buf, 0)
                    if (size < 0 || extractor.sampleTime >= limitUs) {
                        decoder.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                        inputDone = true
                    } else {
                        decoder.queueInputBuffer(i, 0, size, extractor.sampleTime, 0)
                        extractor.advance()
                    }
                }
            }
            // 2. Decoder → PCM, made mono and 16 kHz.
            if (!decoderDone) {
                val o = decoder.dequeueOutputBuffer(info, TIMEOUT_US)
                when {
                    o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        val f = decoder.outputFormat
                        pcmRate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                        pcmChannels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                        if (f.containsKey(MediaFormat.KEY_PCM_ENCODING) && f.getInteger(MediaFormat.KEY_PCM_ENCODING) != AudioFormat.ENCODING_PCM_16BIT) {
                            throw IOException("unsupported PCM encoding")
                        }
                    }
                    o >= 0 -> {
                        if (info.size > 0 && info.presentationTimeUs < limitUs) {
                            val shorts = decoder.getOutputBuffer(o)!!.order(ByteOrder.nativeOrder()).asShortBuffer()
                            val chunk = ShortArray(shorts.remaining()).also { shorts.get(it) }
                            val ready = Pcm.resample(Pcm.toMono(chunk, pcmChannels), pcmRate, plan.sampleRate)
                            pending += ready
                        }
                        decoder.releaseOutputBuffer(o, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) decoderDone = true
                    }
                }
            }
            // 3. PCM → encoder.
            if (!encoderEosSent && (pending.isNotEmpty() || decoderDone)) {
                val i = encoder.dequeueInputBuffer(TIMEOUT_US)
                if (i >= 0) {
                    val buf = encoder.getInputBuffer(i)!!.order(ByteOrder.nativeOrder())
                    val take = minOf(pending.size, buf.capacity() / 2)
                    val pts = encodedSamples * 1_000_000L / plan.sampleRate
                    if (take > 0) {
                        buf.asShortBuffer().put(pending, 0, take)
                        pending = pending.copyOfRange(take, pending.size)
                        encodedSamples += take
                        encoder.queueInputBuffer(i, 0, take * 2, pts, 0)
                    } else {
                        encoder.queueInputBuffer(i, 0, 0, pts, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                        encoderEosSent = true
                    }
                }
            }
            // 4. Encoder → .m4a.
            val o = encoder.dequeueOutputBuffer(info, TIMEOUT_US)
            when {
                o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                    muxTrack = muxer.addTrack(encoder.outputFormat)
                    muxer.start()
                }
                o >= 0 -> {
                    val isConfig = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
                    if (info.size > 0 && !isConfig && muxTrack >= 0) muxer.writeSampleData(muxTrack, encoder.getOutputBuffer(o)!!, info)
                    encoder.releaseOutputBuffer(o, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) finished = true
                }
            }
        }
        if (muxTrack < 0) throw IOException("nothing was encoded")
    }

    private companion object {
        const val TIMEOUT_US = 10_000L
    }
}
