package com.pearl.crm.feature.sales

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Mic
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.pearl.crm.core.data.RecordingsRepository
import com.pearl.crm.core.data.audio.VoiceRecorder
import com.pearl.crm.core.ui.components.ButtonKind
import com.pearl.crm.core.ui.components.PearlButton
import com.pearl.crm.core.ui.components.StatusLabel
import com.pearl.crm.core.ui.components.StatusTone
import kotlinx.coroutines.delay
import java.io.File

/** A recorded voice note, before it is saved with the call notes. */
data class VoiceClip(val file: File, val seconds: Int)

/** Voice notes on this phone (the app provides it; screens without it just hide the button). */
class VoiceNotes(val recorder: VoiceRecorder, val recordings: RecordingsRepository)

val LocalVoiceNotes = staticCompositionLocalOf<VoiceNotes?> { null }

/** "Record why" for a lost lead: record → stop → keep or delete. Asks for the microphone first. */
@Composable
fun VoiceNoteRecorder(clip: VoiceClip?, onClip: (VoiceClip?) -> Unit) {
    val voice = LocalVoiceNotes.current ?: return
    val context = LocalContext.current
    var recording by remember { mutableStateOf(false) }
    var seconds by remember { mutableIntStateOf(0) }
    var failed by remember { mutableStateOf(false) }
    val start = {
        failed = false
        recording = runCatching { voice.recorder.start() }.isSuccess
        failed = !recording
        seconds = 0
    }
    val mic = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok -> if (ok) start() else failed = true }
    LaunchedEffect(recording) {
        while (recording) {
            delay(1_000)
            seconds++
            if (seconds * 1000 >= VoiceRecorder.MAX_MS) {
                recording = false
                onClip(voice.recorder.stop()?.let { (f, s) -> VoiceClip(f, s) })
            }
        }
    }
    DisposableEffect(Unit) { onDispose { if (voice.recorder.isRecording) voice.recorder.stopAndDiscard() } }

    when {
        recording -> Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            StatusLabel(stringResource(R.string.voice_recording, seconds / 60, seconds % 60), StatusTone.Warning)
            PearlButton(stringResource(R.string.voice_stop), Icons.Outlined.Stop, {
                recording = false
                onClip(voice.recorder.stop()?.let { (f, s) -> VoiceClip(f, s) })
            }, kind = ButtonKind.Secondary)
        }
        clip != null -> Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            StatusLabel(stringResource(R.string.voice_ready, clip.seconds / 60, clip.seconds % 60), StatusTone.Good)
            PearlButton(stringResource(R.string.voice_delete), Icons.Outlined.Delete, {
                clip.file.delete()
                onClip(null)
            }, kind = ButtonKind.Quiet)
        }
        else -> {
            PearlButton(stringResource(R.string.voice_record), Icons.Outlined.Mic, {
                if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) start()
                else mic.launch(Manifest.permission.RECORD_AUDIO)
            }, kind = ButtonKind.Secondary)
            if (failed) StatusLabel(stringResource(R.string.voice_failed), StatusTone.Critical)
        }
    }
}
