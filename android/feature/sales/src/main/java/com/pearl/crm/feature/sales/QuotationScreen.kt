package com.pearl.crm.feature.sales

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Save
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import com.pearl.crm.core.data.SalesRepository
import com.pearl.crm.core.data.newClientId
import com.pearl.crm.core.ui.components.failureMessage
import com.pearl.crm.core.model.LibraryItem
import com.pearl.crm.core.model.LibraryKind
import com.pearl.crm.core.model.LibrarySource
import com.pearl.crm.core.model.Money
import com.pearl.crm.core.model.QuoteLineDraft
import com.pearl.crm.core.model.QuoteProblem
import com.pearl.crm.core.model.QuoteRules
import com.pearl.crm.core.model.Quotation
import com.pearl.crm.core.ui.components.ButtonKind
import com.pearl.crm.core.ui.components.FieldError
import com.pearl.crm.core.ui.components.Muted
import com.pearl.crm.core.ui.components.PearlButton
import com.pearl.crm.core.ui.components.PearlCard
import com.pearl.crm.core.ui.components.PearlTopBar
import com.pearl.crm.core.ui.components.Section
import com.pearl.crm.core.ui.components.StatusLabel
import com.pearl.crm.core.ui.components.StatusTone
import com.pearl.crm.core.ui.library.LibraryPicker
import com.pearl.crm.core.ui.theme.Spacing
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

/** How long a quotation stays valid (chips); null = no date printed. */
private val VALID_DAYS = listOf(7, 15, 30, null)

/** The PDF's words, from this app's strings. */
fun quotePdfText(context: Context) = QuotePdfText(
    title = context.getString(R.string.quote_pdf_title),
    number = context.getString(R.string.quote_pdf_number),
    date = context.getString(R.string.quote_pdf_date),
    forLabel = context.getString(R.string.quote_pdf_for),
    validTill = context.getString(R.string.quote_pdf_valid_till),
    preparedBy = context.getString(R.string.quote_pdf_prepared_by),
    treatment = context.getString(R.string.quote_line_name),
    qty = context.getString(R.string.quote_line_qty),
    price = context.getString(R.string.quote_pdf_price),
    amount = context.getString(R.string.quote_pdf_amount),
    subtotal = context.getString(R.string.quote_pdf_subtotal),
    discount = context.getString(R.string.quote_discount),
    total = context.getString(R.string.quote_total),
    footer = context.getString(R.string.quote_pdf_footer),
)

/** Makes the PDF, opens WhatsApp on the lead's chat with it attached, and records it as sent. */
suspend fun shareQuotation(context: Context, sales: SalesRepository, q: Quotation) {
    val pdf = withContext(Dispatchers.IO) { buildQuotationPdf(context, q, quotePdfText(context)) }
    val viaWhatsApp = withContext(Dispatchers.Main.immediate) { shareQuotationPdf(context, q, pdf, context.getString(R.string.quote_share_with)) }
    sales.markQuotationSent(q, if (viaWhatsApp) "whatsapp_pdf" else "share")
}

/**
 * New quotation for a lead (owner, 20/11/2026): treatments from the price list (the price fills in
 * and can be changed), or typed; a discount; valid for 7/15/30 days; a note. Needs the internet
 * (the server numbers it and words the WhatsApp text). "Save & share PDF" opens WhatsApp on the
 * lead's chat with the PDF attached.
 */
@Composable
fun QuotationScreen(
    leadId: String,
    leadName: String,
    sales: SalesRepository,
    library: LibrarySource,
    onBack: () -> Unit,
    onSaved: (String) -> Unit,
) {
    val context = LocalContext.current
    val lines = remember { mutableStateListOf<QuoteLineDraft>() }
    var pick by remember { mutableStateOf<LibraryItem?>(null) }
    var discount by rememberSaveable { mutableStateOf("") }
    var validDays by rememberSaveable { mutableStateOf<Int?>(15) }
    var note by rememberSaveable { mutableStateOf("") }
    var problems by remember { mutableStateOf<Map<Int, Set<QuoteProblem>>>(emptyMap()) }
    var discountError by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf<Throwable?>(null) }
    // Same id for every retry: a lost answer never saves it twice.
    val clientId = rememberSaveable { newClientId() }
    val scope = rememberCoroutineScope()
    val today = remember { istToday() }
    val discountPaise = rupeesToPaise(discount)
    val subtotal = QuoteRules.subtotal(lines)
    val total = (subtotal - (discountPaise ?: 0)).coerceAtLeast(0)
    val savedText = stringResource(R.string.quote_saved)
    val sharedText = stringResource(R.string.quote_shared)

    fun addLine(item: LibraryItem?) {
        val price = item?.defaults?.get("price_paise")?.jsonPrimitive?.longOrNull
        lines += QuoteLineDraft(treatmentId = item?.id, name = item?.label.orEmpty(), qty = "1", pricePaise = price)
        problems = problems - (-1)
    }

    fun save(share: Boolean) {
        val bad = discount.isNotBlank() && discountPaise == null
        discountError = bad
        val valid = validDays?.let { today.plusDays(it.toLong()).toString() }
        val found = QuoteRules.check(lines, discountPaise, valid, today.toString(), note)
        problems = found
        if (found.isNotEmpty() || bad) return
        busy = true
        failure = null
        scope.launch {
            try {
                val q = sales.saveQuotation(clientId, leadId, lines.toList(), discountPaise, valid, note)
                if (share) shareQuotation(context, sales, q)
                withContext(Dispatchers.Main.immediate) { onSaved(if (share) sharedText else savedText) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                failure = e
            } finally {
                busy = false
            }
        }
    }

    val formProblems = problems[-1].orEmpty()
    Scaffold(
        contentWindowInsets = WindowInsets(0),
        topBar = { PearlTopBar(stringResource(R.string.quote_new), subtitle = leadName, onBack = onBack) },
        bottomBar = {
            Column(Modifier.imePadding()) {
                BottomActionBar {
                    failure?.let { StatusLabel(failureMessage(it), StatusTone.Critical, Modifier.testTag("quote-failure")) }
                    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
                        PearlButton(stringResource(R.string.quote_save), Icons.Outlined.Save, { save(false) }, Modifier.weight(1f).testTag("quote-save"), kind = ButtonKind.Secondary, busy = busy)
                        PearlButton(stringResource(R.string.quote_save_share), Icons.Outlined.Share, { save(true) }, Modifier.weight(1.4f).testTag("quote-save-share"), busy = busy)
                    }
                }
            }
        },
    ) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(horizontal = Spacing.screen, vertical = Spacing.xs),
            verticalArrangement = Arrangement.spacedBy(Spacing.section),
        ) {
            Muted(stringResource(R.string.quote_hint))
            LibraryPicker(
                kind = LibraryKind.TREATMENT_TEMPLATE,
                value = pick,
                onChange = { item ->
                    pick = null
                    if (item != null) addLine(item)
                },
                source = library,
                label = stringResource(R.string.quote_add_treatment),
                modifier = Modifier.testTag("quote-pick"),
            )
            PearlButton(stringResource(R.string.quote_add_other), Icons.Outlined.Add, { addLine(null) }, kind = ButtonKind.Tonal, small = true, modifier = Modifier.testTag("quote-add-other"))
            if (QuoteProblem.NoLines in formProblems) FieldError(R.string.quote_no_lines, "quote-no-lines")

            lines.forEachIndexed { i, l ->
                val p = problems[i].orEmpty()
                PearlCard(Modifier.testTag("quote-line-$i"), verticalSpacing = Spacing.s) {
                    OutlinedTextField(
                        value = l.name,
                        onValueChange = {
                            lines[i] = l.copy(name = it.take(200))
                            problems = problems - i
                        },
                        label = { Text(stringResource(R.string.quote_line_name)) },
                        isError = QuoteProblem.LineName in p,
                        supportingText = if (QuoteProblem.LineName in p) ({ Text(stringResource(R.string.quote_line_name_required)) }) else null,
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth().testTag("quote-name-$i"),
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.s), verticalAlignment = Alignment.Top) {
                        OutlinedTextField(
                            value = l.qty,
                            onValueChange = {
                                lines[i] = l.copy(qty = it.filter(Char::isDigit).take(3))
                                problems = problems - i
                            },
                            label = { Text(stringResource(R.string.quote_line_qty)) },
                            isError = QuoteProblem.LineQty in p,
                            supportingText = if (QuoteProblem.LineQty in p) ({ Text(stringResource(R.string.quote_line_qty_bad)) }) else null,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                            singleLine = true,
                            modifier = Modifier.weight(0.35f).testTag("quote-qty-$i"),
                        )
                        var priceText by remember(l.treatmentId, i) { mutableStateOf(paiseToRupeesText(l.pricePaise)) }
                        OutlinedTextField(
                            value = priceText,
                            onValueChange = {
                                priceText = it.take(14)
                                lines[i] = l.copy(pricePaise = rupeesToPaise(it))
                                problems = problems - i
                            },
                            label = { Text(stringResource(R.string.quote_line_price)) },
                            prefix = { Text("₹") },
                            isError = QuoteProblem.LinePrice in p,
                            supportingText = if (QuoteProblem.LinePrice in p) ({ Text(stringResource(R.string.quote_line_price_bad)) }) else null,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                            singleLine = true,
                            modifier = Modifier.weight(0.65f).testTag("quote-price-$i"),
                        )
                    }
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
                        val amount = (l.qty.toIntOrNull() ?: 0).toLong() * (l.pricePaise ?: 0)
                        Text(Money.formatInr(amount), style = MaterialTheme.typography.bodyMedium)
                        PearlButton(stringResource(R.string.quote_remove), Icons.Outlined.Delete, {
                            lines.removeAt(i)
                            problems = emptyMap()
                        }, kind = ButtonKind.Quiet, small = true)
                    }
                }
            }

            OutlinedTextField(
                value = discount,
                onValueChange = {
                    discount = it.take(14)
                    discountError = false
                    problems = problems - (-1)
                },
                label = { Text(stringResource(R.string.quote_discount)) },
                prefix = { Text("₹") },
                isError = discountError || QuoteProblem.DiscountTooBig in formProblems,
                supportingText = when {
                    discountError -> ({ Text(stringResource(R.string.quote_line_price_bad)) })
                    QuoteProblem.DiscountTooBig in formProblems -> ({ Text(stringResource(R.string.quote_discount_too_big)) })
                    else -> null
                },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("quote-discount"),
            )
            Section(stringResource(R.string.quote_valid_for)) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.s)) {
                    VALID_DAYS.forEach { d ->
                        FilterChip(
                            selected = validDays == d,
                            onClick = { validDays = d },
                            label = { Text(if (d == null) stringResource(R.string.quote_valid_none) else stringResource(R.string.quote_valid_days, d)) },
                        )
                    }
                }
            }
            OutlinedTextField(
                value = note,
                onValueChange = {
                    note = it.take(QuoteRules.MAX_NOTE)
                    problems = problems - (-1)
                },
                label = { Text(stringResource(R.string.quote_note)) },
                placeholder = { Text(stringResource(R.string.quote_note_hint)) },
                minLines = 2,
                modifier = Modifier.fillMaxWidth().testTag("quote-note"),
            )
            PearlCard {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text(stringResource(R.string.quote_total), style = MaterialTheme.typography.titleSmall)
                    Text(Money.formatInr(total), style = MaterialTheme.typography.titleSmall, modifier = Modifier.testTag("quote-total"))
                }
            }
        }
    }
}
