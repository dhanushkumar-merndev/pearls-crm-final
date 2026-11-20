package com.pearl.crm.feature.sales

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
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
    val terms: String = "Terms & Conditions",
    val gstin: String = "GSTIN",
    val llpin: String = "LLPIN",
    val phone: String = "Ph",
    val signFor: String = "For",
)

/** Draws on A4 pages, starting a new page when the next block will not fit. */
private class PdfPages(private val doc: PdfDocument, val w: Int, val h: Int, val margin: Float, private val logo: Bitmap?) {
    private val pages = mutableListOf<PdfDocument.Page>()
    lateinit var page: PdfDocument.Page
    val c: Canvas get() = page.canvas
    var y = 0f

    fun next() {
        if (pages.isNotEmpty()) doc.finishPage(page)
        page = doc.startPage(PdfDocument.PageInfo.Builder(w, h, pages.size + 1).create())
        pages += page
        y = margin + 10
        // The clinic logo, faint behind the page (like the printed bills).
        logo?.let { bmp ->
            val bw = w * 0.55f
            val bh = bw * bmp.height / bmp.width.coerceAtLeast(1)
            val left = (w - bw) / 2
            val top = (h - bh) / 2
            c.drawBitmap(bmp, null, RectF(left, top, left + bw, top + bh), Paint(Paint.FILTER_BITMAP_FLAG).apply { alpha = 18 })
        }
    }

    /** Room for [space] more points on this page, or a new page. */
    fun need(space: Float) {
        if (y + space > h - margin - 16) next()
    }

    fun finish() = doc.finishPage(page)
}

/**
 * Draws the quotation as an A4 PDF in the app's cache (white paper, black text, like the web's
 * print page): the clinic letterhead (logo, name, address, contacts, GSTIN / LLPIN) from the clinic
 * profile, the lead, the lines, the totals, the note, the clinic's quotation Terms & Conditions and
 * the signatory. Long quotations carry on to a second page.
 */
fun buildQuotationPdf(context: Context, q: Quotation, text: QuotePdfText, logo: Bitmap? = null): File {
    val doc = PdfDocument()
    val p = PdfPages(doc, 595, 842, 40f, logo)
    val w = p.w
    val margin = p.margin
    val regular = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = 10f; color = android.graphics.Color.BLACK }
    val soft = Paint(regular).apply { color = android.graphics.Color.DKGRAY; textSize = 9f }
    val softRight = Paint(soft).apply { textAlign = Paint.Align.RIGHT }
    val small = Paint(regular).apply { textSize = 8.5f }
    val bold = Paint(regular).apply { typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD) }
    val big = Paint(bold).apply { textSize = 15f }
    val right = Paint(regular).apply { textAlign = Paint.Align.RIGHT }
    val rightBold = Paint(bold).apply { textAlign = Paint.Align.RIGHT }
    val line = Paint().apply { color = android.graphics.Color.LTGRAY; strokeWidth = 0.7f }
    val clinic = q.clinic
    p.next()
    val c = { p.c }

    // Letterhead: logo, name, legal name, address on the left; contacts on the right.
    val top = p.y - 10
    var textLeft = margin
    logo?.let { bmp ->
        val lh = 48f
        val lw = lh * bmp.width / bmp.height.coerceAtLeast(1)
        c().drawBitmap(bmp, null, RectF(margin, top, margin + lw, top + lh), Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG))
        textLeft = margin + lw + 10
    }
    var ly = top + 14
    c().drawText(clinic.name, textLeft, ly, big)
    ly += 13
    clinic.legalName?.takeIf { it != clinic.name && it.isNotBlank() }?.let { c().drawText(it, textLeft, ly, soft); ly += 11 }
    val place = listOfNotNull(clinic.city, clinic.state).joinToString(", ")
    val address = listOfNotNull(
        clinic.addressLines.joinToString(", ").ifEmpty { null },
        listOf(place, clinic.pincode.orEmpty()).filter { it.isNotEmpty() }.joinToString(" - ").ifEmpty { null },
    )
    val leftWidth = w - margin - textLeft - 170
    address.flatMap { wrap(it, soft, leftWidth) }.forEach { c().drawText(it, textLeft, ly, soft); ly += 11 }
    var ry = top + 14
    listOfNotNull(
        clinic.phones.joinToString(" · ").ifEmpty { null }?.let { "${text.phone}: $it" },
        clinic.email,
        clinic.website,
    ).forEach { c().drawText(it, w - margin, ry, softRight); ry += 11 }
    p.y = maxOf(ly, ry, top + 48f) + 6
    val ids = listOfNotNull(
        clinic.gstin?.let { "${text.gstin}: $it" },
        clinic.llpin?.takeIf { it.isNotBlank() }?.let { "${text.llpin}: $it" },
    )
    if (ids.isNotEmpty()) {
        c().drawLine(margin, p.y, w - margin, p.y, line)
        p.y += 12
        c().drawText(ids.joinToString("   ·   "), margin, p.y, soft)
        p.y += 6
    }
    c().drawLine(margin, p.y, w - margin, p.y, line)
    p.y += 24

    // Title and reference.
    c().drawText(text.title, margin, p.y, big)
    c().drawText("${text.number}: ${q.reference}", w - margin, p.y - 8, right)
    val created = Instant.parse(normaliseIso(q.createdAt)).toEpochMilli()
    c().drawText("${text.date}: ${IstDates.formatDate(created)}", w - margin, p.y + 6, right)
    p.y += 26
    c().drawText(text.forLabel, margin, p.y, soft)
    p.y += 14
    c().drawText(q.leadName, margin, p.y, bold)
    p.y += 13
    c().drawText(q.leadPhone, margin, p.y, regular)
    q.validUntil?.let { c().drawText("${text.validTill}: ${formatDay(it)}", w - margin, p.y - 13, right) }
    q.createdByName?.let { c().drawText("${text.preparedBy}: $it", w - margin, p.y, right) }
    p.y += 24

    // Lines.
    val colQty = w - margin - 200
    val colPrice = w - margin - 100
    fun heads() {
        c().drawText("#", margin, p.y, bold)
        c().drawText(text.treatment, margin + 22, p.y, bold)
        c().drawText(text.qty, colQty, p.y, rightBold)
        c().drawText(text.price, colPrice, p.y, rightBold)
        c().drawText(text.amount, w - margin, p.y, rightBold)
        p.y += 6
        c().drawLine(margin, p.y, w - margin, p.y, line)
        p.y += 16
    }
    heads()
    q.items.forEachIndexed { i, item ->
        val parts = wrap(item.name, regular, colQty - margin - 60)
        val rowHeight = 12f * parts.size + 6
        if (p.y + rowHeight > p.h - margin - 16) {
            p.next()
            heads()
        }
        c().drawText("${i + 1}", margin, p.y, regular)
        parts.forEachIndexed { n, part -> c().drawText(part, margin + 22, p.y + n * 12, regular) }
        c().drawText(item.qty.toString(), colQty, p.y, right)
        c().drawText(Money.formatInr(item.pricePaise).removePrefix("₹"), colPrice, p.y, right)
        c().drawText(Money.formatInr(item.amountPaise).removePrefix("₹"), w - margin, p.y, right)
        p.y += rowHeight
    }
    c().drawLine(margin, p.y, w - margin, p.y, line)
    p.y += 18

    // Totals (kept together).
    p.need(if (q.discountPaise > 0) 60f else 46f)
    c().drawText(text.subtotal, colPrice, p.y, right)
    c().drawText(Money.formatInr(q.subtotalPaise), w - margin, p.y, right)
    if (q.discountPaise > 0) {
        p.y += 14
        c().drawText(text.discount, colPrice, p.y, right)
        c().drawText("−" + Money.formatInr(q.discountPaise), w - margin, p.y, right)
    }
    p.y += 18
    c().drawText(text.total, colPrice, p.y, Paint(rightBold).apply { textSize = 12f })
    c().drawText(Money.formatInr(q.totalPaise), w - margin, p.y, Paint(rightBold).apply { textSize = 12f })
    p.y += 28

    q.note?.let { note ->
        note.lines().flatMap { wrap(it, regular, w - 2 * margin) }.forEach { p.need(13f); c().drawText(it, margin, p.y, regular); p.y += 13 }
        p.y += 10
    }
    wrap(text.footer, soft, w - 2 * margin).forEach { p.need(11f); c().drawText(it, margin, p.y, soft); p.y += 11 }
    p.y += 14

    // Terms & Conditions (Admin → Clinic profile → Terms → Quotation), numbered like the bills.
    if (clinic.terms.isNotEmpty()) {
        p.need(40f)
        c().drawText(text.terms, margin, p.y, bold)
        p.y += 14
        clinic.terms.forEachIndexed { i, term ->
            val num = "${i + 1}."
            val parts = wrap(term, small, w - 2 * margin - 16)
            p.need(11f * parts.size)
            c().drawText(num, margin, p.y, small)
            parts.forEach { c().drawText(it, margin + 16, p.y, small); p.y += 11 }
            p.y += 2
        }
        p.y += 10
    }

    // Signatory, bottom right.
    clinic.signatoryLabel?.takeIf { it.isNotBlank() }?.let { label ->
        p.need(56f)
        c().drawText("${text.signFor} ${clinic.name}", w - margin, p.y, right)
        p.y += 30
        c().drawLine(w - margin - 150, p.y, w - margin, p.y, Paint(line).apply { color = android.graphics.Color.GRAY })
        p.y += 12
        c().drawText(label, w - margin, p.y, rightBold)
    }

    p.finish()
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
