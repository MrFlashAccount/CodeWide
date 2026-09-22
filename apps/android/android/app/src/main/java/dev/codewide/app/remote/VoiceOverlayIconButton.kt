package dev.codewide.app.remote

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import org.json.JSONObject
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.view.View

internal enum class VoiceOverlayIcon(val glyphName: String) {
  MIC_OFF("mic-off-outline"), MIC_ON("mic-outline"), OPEN_APP("open-outline"),
  SETTINGS("settings-outline"), STOP("stop"),
  CHAT("chatbubble-ellipses-outline"),
}

internal class VoiceOverlayIconButton(
  context: Context,
  private var icon: VoiceOverlayIcon,
  accessibilityLabel: String,
  onClick: () -> Unit,
) : View(context) {
  private val iconPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }

  private val typeface by lazy { Typeface.createFromAsset(context.assets, "fonts/ionicons.ttf") }
  private val glyphs by lazy {
    JSONObject(context.assets.open("fonts/Ionicons.json").bufferedReader().use { it.readText() })
  }

  init {
    setIcon(icon, accessibilityLabel)
    isClickable = true
    isFocusable = true
    elevation = dp(4).toFloat()
    background = RippleDrawable(ColorStateList.valueOf(0x33FFFFFF), GradientDrawable().apply {
      shape = GradientDrawable.OVAL
      setColor(Color.rgb(34, 34, 39))
      setStroke(dp(1), Color.rgb(84, 84, 94))
    }, null)
    setOnClickListener { onClick() }
  }

  fun setIcon(nextIcon: VoiceOverlayIcon, accessibilityLabel: String) {
    icon = nextIcon
    contentDescription = accessibilityLabel
    stateDescription = when (nextIcon) {
      VoiceOverlayIcon.MIC_OFF -> "Microphone off"
      VoiceOverlayIcon.MIC_ON -> "Microphone on"
      else -> null
    }
    invalidate()
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    // The same bundled Ionicons font and glyph map as ComposerMicrophone / AppListRow.
    iconPaint.typeface = typeface
    iconPaint.textSize = 20f * resources.displayMetrics.density
    iconPaint.textAlign = Paint.Align.CENTER
    val glyph = String(Character.toChars(glyphs.getInt(icon.glyphName)))
    val baseline = height / 2f - (iconPaint.ascent() + iconPaint.descent()) / 2f
    canvas.drawText(glyph, width / 2f, baseline, iconPaint)
  }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

}
