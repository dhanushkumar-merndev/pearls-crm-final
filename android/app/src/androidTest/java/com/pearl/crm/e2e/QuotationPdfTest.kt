package com.pearl.crm.e2e

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.pearl.crm.core.model.QuoteClinic
import com.pearl.crm.core.model.QuoteItem
import com.pearl.crm.core.model.Quotation
import com.pearl.crm.feature.sales.buildQuotationPdf
import com.pearl.crm.feature.sales.quotePdfText
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * The quotation PDF (owner, 20/11/2026: "no logo, apply the terms"): drawn with the clinic logo,
 * GSTIN and the quotation's Terms & Conditions; a long one carries on to a second page. Made on the
 * phone itself, no backend; the page pictures are kept in the app's files for a look.
 */
@RunWith(AndroidJUnit4::class)
class QuotationPdfTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun logo(): Bitmap = Bitmap.createBitmap(200, 200, Bitmap.Config.ARGB_8888).apply {
        val c = Canvas(this)
        c.drawColor(Color.WHITE)
        c.drawCircle(100f, 100f, 90f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(200, 140, 40) })
        c.drawText("D", 70f, 135f, Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; textSize = 100f })
    }

    private fun quotation(lines: Int, terms: Int) = Quotation(
        id = "q1", leadId = "l1", quoteNo = 2,
        items = (1..lines).map { QuoteItem(name = "Demo treatment $it with a longer name to wrap onto two lines when needed", qty = 1, pricePaise = 1_500_000) },
        subtotalPaise = lines * 1_500_000L, discountPaise = 100_000, totalPaise = lines * 1_500_000L - 100_000,
        validUntil = "2026-12-05", note = "EMI available.", message = "x", createdAt = "2026-11-20T10:15:30.123456+00:00",
        leadName = "Demo Lead", leadPhone = "+919800000000", leadSlNo = 7, createdByName = "Demo Sales",
        clinic = QuoteClinic(
            name = "Demo Aesthetic Clinic", legalName = "Demo Aesthetics LLP", gstin = "29ABCDE1234F1Z5", llpin = "AAA-0000",
            addressLines = listOf("1st Floor, Demo Building", "100 Feet Road"), city = "Bengaluru", state = "Karnataka", pincode = "560001",
            phones = listOf("+91 90000 00000"), email = "clinic@example.com", website = "https://example.com",
            signatoryLabel = "Authorized Signatory",
            terms = (1..terms).map { "Demo term $it: prices include the listed sessions only; extra sessions are charged as per the price list at the time." },
        ),
    )

    private fun pages(pdf: File, keepAs: String): Int {
        val out = File(context.getExternalFilesDir(null), "pdf-check").apply { mkdirs() }
        ParcelFileDescriptor.open(pdf, ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
            PdfRenderer(fd).use { r ->
                for (i in 0 until r.pageCount) {
                    r.openPage(i).use { page ->
                        val bmp = Bitmap.createBitmap(page.width * 2, page.height * 2, Bitmap.Config.ARGB_8888)
                        bmp.eraseColor(Color.WHITE)
                        page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
                        File(out, "$keepAs-${i + 1}.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
                    }
                }
                return r.pageCount
            }
        }
    }

    @Test
    fun aShortQuotationIsOnePageWithLogoGstinAndTerms() {
        val pdf = buildQuotationPdf(context, quotation(lines = 2, terms = 9), quotePdfText(context), logo())
        assertTrue(pdf.length() > 1000)
        assertEquals(1, pages(pdf, "short"))
    }

    @Test
    fun aLongQuotationCarriesOnToASecondPage() {
        val pdf = buildQuotationPdf(context, quotation(lines = 20, terms = 9), quotePdfText(context), logo())
        assertEquals(2, pages(pdf, "long"))
    }

    @Test
    fun withoutALogoOrTermsItStillWorks() {
        val q = quotation(lines = 1, terms = 0).let { it.copy(clinic = it.clinic.copy(gstin = null, llpin = null, signatoryLabel = null)) }
        assertEquals(1, pages(buildQuotationPdf(context, q, quotePdfText(context), null), "plain"))
    }
}
