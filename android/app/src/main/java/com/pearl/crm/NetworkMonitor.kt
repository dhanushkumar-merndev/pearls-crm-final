package com.pearl.crm

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Whether the phone has a working internet connection right now, so the offline strip shows the
 * moment signal goes (a sync only finds out on its next run) and a sync starts when it comes back.
 */
class NetworkMonitor(context: Context, private val onBack: () -> Unit) {
    private val manager = context.getSystemService(ConnectivityManager::class.java)
    private val _online = MutableStateFlow(isOnline())
    val online: StateFlow<Boolean> = _online.asStateFlow()

    init {
        manager?.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = update(caps.hasInternet())
            override fun onLost(network: Network) = update(false)
        })
    }

    private fun update(now: Boolean) {
        val was = _online.value
        _online.value = now
        if (now && !was) onBack()
    }

    private fun isOnline(): Boolean =
        manager?.let { m -> m.getNetworkCapabilities(m.activeNetwork)?.hasInternet() } ?: true

    private fun NetworkCapabilities.hasInternet() =
        hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) && hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
}
