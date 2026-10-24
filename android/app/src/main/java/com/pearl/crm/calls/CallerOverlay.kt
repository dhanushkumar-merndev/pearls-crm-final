package com.pearl.crm.calls

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.provider.Settings
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import androidx.compose.ui.graphics.toArgb
import com.pearl.crm.R
import com.pearl.crm.core.data.db.CallerCard
import com.pearl.crm.core.model.IstDates
import com.pearl.crm.core.ui.theme.PearlColors

/**
 * The floating caller bubble: who is calling (lead name, stage, next call, last note), drawn
 * over the dialer while the call lasts. Needs "Display over other apps"; without it the app
 * just asks for notes afterwards. Tap to hide; drag to move.
 */
// Holds only views made from the application context, never an activity: nothing to leak.
@SuppressLint("StaticFieldLeak")
object CallerOverlay {
    private var view: View? = null

    fun canShow(context: Context): Boolean = Settings.canDrawOverlays(context)

    @SuppressLint("ClickableViewAccessibility")
    fun show(context: Context, card: CallerCard, stageLabel: String?) {
        if (!canShow(context)) return
        hide(context)
        val app = context.applicationContext
        val wm = app.getSystemService(WindowManager::class.java) ?: return
        val dp = { v: Int -> TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), app.resources.displayMetrics).toInt() }
        val box = LinearLayout(app).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(12), dp(16), dp(12))
            background = GradientDrawable().apply {
                cornerRadius = dp(16).toFloat()
                setColor(PearlColors.Dark.Raised.toArgb())
                setStroke(dp(1), PearlColors.Dark.BorderStrong.toArgb())
            }
            contentDescription = app.getString(R.string.caller_bubble_description)
        }
        fun line(text: String, sizeSp: Float, color: Int) = TextView(app).apply {
            this.text = text
            setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
            setTextColor(color)
            maxLines = 2
        }
        box.addView(line(app.getString(R.string.caller_bubble_from_crm), 13f, PearlColors.Dark.TextSecondary.toArgb()))
        box.addView(line(card.name ?: app.getString(R.string.caller_bubble_lead), 18f, PearlColors.Dark.Text.toArgb()))
        listOfNotNull(stageLabel, card.nextFollowupAt?.let { app.getString(R.string.caller_bubble_next, IstDates.formatDateTime(it)) })
            .joinToString(" · ").takeIf { it.isNotEmpty() }
            ?.let { box.addView(line(it, 15f, PearlColors.Dark.Text.toArgb())) }
        card.lastNote?.let { box.addView(line(app.getString(R.string.caller_bubble_last_note, it), 14f, PearlColors.Dark.TextSecondary.toArgb())) }

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP
            y = dp(96)
            horizontalMargin = 0.04f
        }
        var downY = 0f
        var startY = 0
        var moved = false
        box.setOnTouchListener { v, e ->
            when (e.action) {
                MotionEvent.ACTION_DOWN -> {
                    downY = e.rawY
                    startY = params.y
                    moved = false
                }
                MotionEvent.ACTION_MOVE -> {
                    val dy = (e.rawY - downY).toInt()
                    if (kotlin.math.abs(dy) > dp(8)) moved = true
                    params.y = (startY + dy).coerceAtLeast(0)
                    runCatching { wm.updateViewLayout(v, params) }
                }
                MotionEvent.ACTION_UP -> if (!moved) hide(app)
            }
            true
        }
        runCatching { wm.addView(box, params) }.onSuccess { view = box }
    }

    fun hide(context: Context) {
        val v = view ?: return
        view = null
        runCatching { context.applicationContext.getSystemService(WindowManager::class.java)?.removeView(v) }
    }
}
