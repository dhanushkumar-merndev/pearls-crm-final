package com.pearl.crm

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pearl.crm.core.ui.theme.PearlTheme
import com.pearl.crm.calls.AfterCallRequest
import com.pearl.crm.ui.AppRoot

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val container = (application as PearlApplication).container
        AfterCallRequest.from(intent)?.let { container.pendingAfterCall.value = it }
        setContent {
            val theme by container.settings.theme.collectAsStateWithLifecycle()
            PearlTheme(theme) {
                Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    AppRoot(container)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        AfterCallRequest.from(intent)?.let { (application as PearlApplication).container.pendingAfterCall.value = it }
    }
}
