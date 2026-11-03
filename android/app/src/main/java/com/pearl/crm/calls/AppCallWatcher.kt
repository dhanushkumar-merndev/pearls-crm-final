package com.pearl.crm.calls

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.pearl.crm.AppContainer
import com.pearl.crm.feature.sales.AfterCallWatcher
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/**
 * [CallStateReceiver] as the sales screens see it: when it will open the notes sheet after a CRM
 * call, a call started from the app leaves the sheet to it (one sheet, with the real call length).
 */
class AppCallWatcher(private val context: Context, private val container: AppContainer) : AfterCallWatcher {
    override fun active(): Boolean =
        container.settings.callerPopup &&
            granted(Manifest.permission.READ_PHONE_STATE) &&
            granted(Manifest.permission.READ_CALL_LOG) &&
            CallerOverlay.canShow(context)

    override val pendingLeadId: StateFlow<String?> =
        container.pendingAfterCall.map { it?.leadId }.stateIn(container.scope, SharingStarted.Eagerly, container.pendingAfterCall.value?.leadId)

    private fun granted(permission: String) =
        ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED
}
