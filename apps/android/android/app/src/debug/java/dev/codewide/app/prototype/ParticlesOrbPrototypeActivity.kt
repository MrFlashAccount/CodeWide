package dev.codewide.app.prototype

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import dev.codewide.app.rendering.VoiceAssistantOrbState

/** Debug-only light/dark contrast harness for the real system-overlay surface. */
class ParticlesOrbPrototypeActivity : Activity() {
  private lateinit var overlay: ParticlesOrbPrototypeOverlay
  private lateinit var stateLabel: TextView
  private lateinit var permissionButton: Button

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    overlay = ParticlesOrbPrototypeOverlay(this, ::showState)
    setContentView(createHarness())
  }

  override fun onResume() {
    super.onResume()
    val granted = Settings.canDrawOverlays(this)
    permissionButton.visibility = if (granted) View.GONE else View.VISIBLE
    if (granted) overlay.show()
  }

  override fun onDestroy() {
    overlay.hide()
    super.onDestroy()
  }

  private fun createHarness(): View {
    val root = FrameLayout(this)
    val comparison = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      addView(createBackdrop(light = true), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
      addView(createBackdrop(light = false), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.MATCH_PARENT, 1f))
    }
    root.addView(comparison, FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)

    val controls = LinearLayout(this).apply {
      gravity = Gravity.CENTER
      orientation = LinearLayout.VERTICAL
      setPadding(dp(12), dp(12), dp(12), dp(12))
      setBackgroundColor(0xD91A1C22.toInt())
    }
    stateLabel = TextView(this).apply {
      gravity = Gravity.CENTER
      setTextColor(Color.WHITE)
      textSize = 16f
    }
    controls.addView(stateLabel, LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
    controls.addView(TextView(this).apply {
      gravity = Gravity.CENTER
      setPadding(0, dp(4), 0, dp(8))
      setTextColor(0xFFB8BCC8.toInt())
      text = "76 dp window / 66 dp orb · drag across both screens · tap the orb to cycle"
      textSize = 12f
    })
    controls.addView(createStateButtons())
    permissionButton = Button(this).apply {
      text = "Allow display over other apps"
      setOnClickListener { openOverlaySettings() }
    }
    controls.addView(permissionButton)
    root.addView(
      controls,
      FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT).apply {
        gravity = Gravity.BOTTOM
        setMargins(dp(12), dp(12), dp(12), dp(24))
      },
    )
    showState(VoiceAssistantOrbState.IDLE)
    return root
  }

  private fun createStateButtons(): View = LinearLayout(this).apply {
    gravity = Gravity.CENTER
    orientation = LinearLayout.HORIZONTAL
    for (state in listOf(
      VoiceAssistantOrbState.IDLE,
      VoiceAssistantOrbState.LISTENING,
      VoiceAssistantOrbState.SPEAKING,
    )) {
      addView(Button(this@ParticlesOrbPrototypeActivity).apply {
        text = state.name.lowercase()
        setOnClickListener { this@ParticlesOrbPrototypeActivity.overlay.setState(state) }
      })
    }
  }

  private fun createBackdrop(light: Boolean): View = LinearLayout(this).apply {
    gravity = Gravity.CENTER
    orientation = LinearLayout.VERTICAL
    setPadding(dp(14), dp(24), dp(14), dp(160))
    setBackgroundColor(if (light) 0xFFF5F6F8.toInt() else 0xFF101217.toInt())
    addView(TextView(this@ParticlesOrbPrototypeActivity).apply {
      setTextColor(if (light) 0xFF16181D.toInt() else 0xFFF1F3F7.toInt())
      text = if (light) "LIGHT\nInbox\n\nBuild finished\nReview requested\n3 files changed" else "DARK\nTerminal\n\n$ pnpm validate\nPASS 214 tests\nready"
      textSize = 15f
    })
  }

  private fun showState(state: VoiceAssistantOrbState) {
    if (::stateLabel.isInitialized) {
      stateLabel.text = "Particles Orb · ${state.name.lowercase()}"
    }
  }

  private fun openOverlaySettings() {
    startActivity(
      Intent(
        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
        Uri.parse("package:$packageName"),
      ),
    )
  }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
