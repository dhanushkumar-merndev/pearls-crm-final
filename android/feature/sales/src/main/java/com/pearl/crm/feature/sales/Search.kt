package com.pearl.crm.feature.sales

import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map

@OptIn(FlowPreview::class)
internal fun Flow<String>.debouncedLeadSearch(): Flow<String> =
    debounce { if (it.isBlank()) 0L else 300L }.map { it.trim() }.distinctUntilChanged()
