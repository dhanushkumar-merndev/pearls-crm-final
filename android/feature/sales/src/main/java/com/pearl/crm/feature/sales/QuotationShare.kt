package com.pearl.crm.feature.sales

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import androidx.core.content.FileProvider
import com.pearl.crm.core.model.IstDates
import com.pearl.crm.core.model.Money
import com.pearl.crm.core.model.Quotation
import java.io.File
import java.time.Instant
import java.time.LocalDate

/** WhatsApp and WhatsApp Business, in the order tried. */
private val WHATSAPP_APPS = listOf("com.whatsapp", "com.whatsapp.w4b")

/** The words printed on the PDF (from the app's strings, so nothing is hard-coded here). */
data class QuotePdfText(
    val title: String,
    val number: String,
    val date: String,
    val forLabel: String,
    val validTill: String,
    val preparedBy: String,
    val treatment: String,
    val qty: String,
    val price: String,
    val amount: String,
    val subtotal: String,
    val discount: String,
    val total: String,
    val footer: String,
)

/**
 * Draws the quotation as an A4 PDF in the app's cache (white paper, black text, like the web's
 * print page): clinic header from the clinic profile, the lead, the lines, the totals, the note.
 */
fun buildQuotationPdf(context: Context, q: Quotation, text: QuotePdfText): File {
    val doc = PdfDocument()
    val w = 595
    val h = 842
    val margin = 40f
    val page = doc.startPage(PdfDocument.PageInfo.Builder(w, h, 1).create())
    val c = page.canvas
    val regular = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 10f; color = android.graphics.Color.BLACK }
    val soft = Paint(regular).apply { color = android.graphics.Color.DKGRAY; textSize = 9f }
    val bold = Paint(regular).apply { typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD) }
    val big = Paint(bold).apply { textSize = 16f }
    val right = Paint(regular).apply { textAlign = Paint.Align.RIGHT }
    val rightBold = Paint(bold).apply { textAlign = Paint.Align.RIGHT }
    val line = Paint().apply { color = android.graphics.Color.LTGRAY; strokeWidth = 0.7f }
    var y = margin + 10

    // Clinic header.
    c.drawText(q.clinic.name, margin, y, big)
    y += 16
    val address = (q.clinic.addressLines + listOfNotNull(listOfNotNull(q.clinic.city, q.clinic.state, q.clinic.pincode).joinToString(", ").ifEmpty { null }))
    address.forEach { c.drawText(it, margin, y, soft); y += 12 }
    listOfNotNull(q.clinic.phones.joinToString(" · ").ifEmpty { null }, q.clinic.email, q.clinic.website).forEach { c.drawText(it, margin, y, soft); y += 12 }
    y += 6
    c.drawLine(margin, y, w - margin, y, line)
    y += 24

    // Title and reference.
    c.drawText(text.title, margin, y, big)
    c.drawText("${text.number}: ${q.reference}", w - margin, y - 8, right)
    val created = Instant.parse(normaliseIso(q.createdAt)).toEpochMilli()
    c.drawText("${text.date}: ${IstDates.formatDate(created)}", w - margin, y + 6, right)
    y += 26
    c.drawText(text.forLabel, margin, y, soft)
    y += 14
    c.drawText(q.leadName, margin, y, bold)
    y += 13
    c.drawText(q.leadPhone, margin, y, regular)
    q.validUntil?.let { c.drawText("${text.validTill}: ${formatDay(it)}", w - margin, y - 13, right) }
    q.createdByName?.let { c.drawText("${text.preparedBy}: $it", w - margin, y, right) }
    y += 24

    // Lines.
    val colQty = w - margin - 200
    val colPrice = w - margin - 100
    c.drawText("#", margin, y, bold)
    c.drawText(text.treatment, margin + 22, y, bold)
    c.drawText(text.qty, colQty, y, rightBold)
    c.drawText(text.price, colPrice, y, rightBold)
    c.drawText(text.amount, w - margin, y, rightBold)
    y += 6
    c.drawLine(margin, y, w - margin, y, line)
    y += 16
    q.items.forEachIndexed { i, item ->
        c.drawText("${i + 1}", margin, y, regular)
        wrap(item.name, regular, colQty - margin - 60).forEachIndexed { n, part ->
            c.drawText(part, margin + 22, y + n * 12, regular)
        }
        c.drawText(item.qty.toString(), colQty, y, right)
        c.drawText(Money.formatInr(item.pricePaise).removePrefix("₹"), colPrice, y, right)
        c.drawText(Money.formatInr(item.amountPaise).removePrefix("₹"), w - margin, y, right)
        y += 12 * wrap(item.name, regular, colQty - margin - 60).size + 6
    }
    c.drawLine(margin, y, w - margin, y, line)
    y += 18

    // Totals.
    c.drawText(text.subtotal, colPrice, y, right)
    c.drawText(Money.formatInr(q.subtotalPaise), w - margin, y, right)
    if (q.discountPaise > 0) {
        y += 14
        c.drawText(text.discount, colPrice, y, right)
        c.drawText("−" + Money.formatInr(q.discountPaise), w - margin, y, right)
    }
    y += 18
    c.drawText(text.total, colPrice, y, rightBold.apply { textSize = 12f })
    c.drawText(Money.formatInr(q.totalPaise), w - margin, y, rightBold)
    y += 28

    q.note?.let { note ->
        note.lines().flatMap { wrap(it, regular, w - 2 * margin) }.forEach { c.drawText(it, margin, y, regular); y += 13 }
        y += 10
    }
    wrap(text.footer, soft, w - 2 * margin).forEach { c.drawText(it, margin, y, soft); y += 11 }

    doc.finishPage(page)
    val dir = File(context.cacheDir, "quotes").apply { mkdirs() }
    // Old ones go: only the one being shared is kept.
    dir.listFiles()?.forEach { it.delete() }
    val file = File(dir, "${text.title}-${q.reference}.pdf".replace(Regex("[^A-Za-z0-9._-]"), "_"))
    file.outputStream().use { doc.writeTo(it) }
    doc.close()
    return file
}

/**
 * Opens the salesperson's own WhatsApp on the lead's chat with the PDF attached and the message
 * as its caption (one tap: they press Send). Without WhatsApp, the phone's share sheet opens.
 * Returns true when WhatsApp itself was opened.
 */
fun shareQuotationPdf(context: Context, q: Quotation, pdf: File, chooserTitle: String): Boolean {
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", pdf)
    fun intent(pkg: String?) = Intent(Intent.ACTION_SEND).apply {
        type = "application/pdf"
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_TEXT, q.message)
        clipData = ClipData.newRawUri(pdf.name, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        if (pkg != null) {
            setPackage(pkg)
            // Straight to this patient's chat (WhatsApp's own extra), not the contact list.
            putExtra("jid", q.leadPhone.filter(Char::isDigit) + "@s.whatsapp.net")
        }
    }
    for (pkg in WHATSAPP_APPS) {
        try {
            context.startActivity(intent(pkg))
            return true
        } catch (_: ActivityNotFoundException) {
            // Not installed: try the next one.
        }
    }
    context.startActivity(Intent.createChooser(intent(null), chooserTitle).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    return false
}

/** The quotation as text in WhatsApp (no file): the chat opens with it typed in. */
fun sendQuotationText(context: Context, q: Quotation) = openWhatsApp(context, q.leadPhone, q.message)

private fun formatDay(iso: String): String = LocalDate.parse(iso).let { "%02d/%02d/%04d".format(it.dayOfMonth, it.monthValue, it.year) }

/** Postgres gives "2026-11-20T10:15:30.123456+00:00"; Instant.parse wants an ISO instant. */
internal fun normaliseIso(text: String): String = java.time.OffsetDateTime.parse(text.replace(' ', 'T')).toInstant().toString()

private fun wrap(text: String, paint: Paint, width: Float): List<String> {
    val words = text.split(' ')
    val out = mutableListOf<String>()
    var cur = ""
    for (word in words) {
        val next = if (cur.isEmpty()) word else "$cur $word"
        if (paint.measureText(next) <= width || cur.isEmpty()) cur = next else {
            out += cur
            cur = word
        }
    }
    if (cur.isNotEmpty() || out.isEmpty()) out += cur
    return out
}
