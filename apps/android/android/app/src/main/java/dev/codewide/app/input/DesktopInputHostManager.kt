package dev.codewide.app.input

import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableType
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.views.view.ReactViewGroup
import com.facebook.react.views.view.ReactViewManager

/** React props and commands remain validated at the native input boundary. */
class DesktopInputHostManager : ReactViewManager() {
  override fun getName(): String = "CodeWideDesktopInput"
  override fun createViewInstance(context: ThemedReactContext): DesktopInputHost = DesktopInputHost(context)

  @ReactProp(name = "inputEnabled", defaultBoolean = false)
  fun setInputEnabled(view: ReactViewGroup, value: Boolean) { if (view is DesktopInputHost) view.setInputEnabled(value) }
  @ReactProp(name = "modifiers", defaultInt = 0)
  fun setModifiers(view: ReactViewGroup, value: Int) { if (view is DesktopInputHost) view.setModifiers(value) }
  @ReactProp(name = "heldButton", defaultInt = 0)
  fun setHeldButton(view: ReactViewGroup, value: Int) { if (view is DesktopInputHost) view.setHeldButton(value) }
  @ReactProp(name = "sensitivity", defaultFloat = 1f)
  fun setSensitivity(view: ReactViewGroup, value: Float) { if (view is DesktopInputHost) view.setSensitivity(value) }
  @ReactProp(name = "sessionKey")
  fun setSessionKey(view: ReactViewGroup, value: String?) { if (view is DesktopInputHost) view.setSessionKey(value) }

  override fun getExportedViewConstants(): MutableMap<String, Any> =
    (super.getExportedViewConstants() ?: mutableMapOf()).apply {
      put("mouseButtonsAvailable", DesktopMouseEventButtons.available)
    }

  override fun receiveCommand(view: ReactViewGroup, command: String, args: ReadableArray?) {
    if (view !is DesktopInputHost) return
    when (command) {
      "keyboard" -> if (args == null || args.size() == 0) view.keyboard()
      "click" -> if (numeric(args, 1)) view.click(args!!.getInt(0))
      "key" -> if (numeric(args, 2)) view.key(args!!.getInt(0), args.getInt(1))
    }
  }
  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> = (super.getExportedCustomDirectEventTypeConstants() ?: mutableMapOf()).apply {
    put("topInputReset", mapOf("registrationName" to "onInputReset"))
  }
  override fun onDropViewInstance(view: ReactViewGroup) { if (view is DesktopInputHost) view.finish(); super.onDropViewInstance(view) }

  private fun numeric(args: ReadableArray?, size: Int): Boolean =
    args != null && args.size() == size && (0 until size).all {
      args.getType(it) == ReadableType.Number && args.getDouble(it).isFinite() && args.getDouble(it) == args.getInt(it).toDouble()
    }
}
