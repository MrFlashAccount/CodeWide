package dev.codewide.app.input

internal enum class DesktopPointerAction { DOWN, PRESS, MOVE, HOVER, SCROLL, RELEASE, UP }

internal data class DesktopPointerFrame(
  val action: DesktopPointerAction,
  val x: Float,
  val y: Float,
  val buttons: Int,
  val changedButton: Int = 0,
  val horizontalScroll: Float = 0f,
  val verticalScroll: Float = 0f,
)

/** Publishes complete mouse sequences required by Chromium, including changed-button events. */
internal class DesktopPointerState(private val emit: (DesktopPointerFrame) -> Unit) {
  var x = 0f
    private set
  var y = 0f
    private set
  var buttons = 0
    private set
  private var width = 0f
  private var height = 0f

  fun viewport(width: Float, height: Float) {
    val firstLayout = this.width == 0f || this.height == 0f
    this.width = width.coerceAtLeast(0f)
    this.height = height.coerceAtLeast(0f)
    if (firstLayout) { x = this.width / 2f; y = this.height / 2f }
    clamp()
  }

  fun move(dx: Float, dy: Float) {
    x += dx
    y += dy
    clamp()
    frame(if (buttons == 0) DesktopPointerAction.HOVER else DesktopPointerAction.MOVE)
  }

  fun setButtons(requested: Int) {
    require(requested in 0..7)
    for (button in intArrayOf(1, 2, 4)) {
      if (buttons and button != 0 && requested and button == 0) {
        buttons = buttons and button.inv()
        frame(DesktopPointerAction.RELEASE, button)
        if (buttons == 0) frame(DesktopPointerAction.UP)
      }
    }
    for (button in intArrayOf(1, 2, 4)) {
      if (buttons and button == 0 && requested and button != 0) {
        val first = buttons == 0
        buttons = buttons or button
        if (first) frame(DesktopPointerAction.DOWN)
        frame(DesktopPointerAction.PRESS, button)
      }
    }
  }

  fun click(button: Int) {
    require(button == 1 || button == 2 || button == 4)
    if (buttons and button != 0) return
    val retained = buttons
    setButtons(retained or button)
    setButtons(retained)
  }

  fun scroll(horizontal: Float, vertical: Float) {
    emit(DesktopPointerFrame(DesktopPointerAction.SCROLL, x, y, buttons, 0, horizontal, vertical))
  }

  fun release() = setButtons(0)

  private fun frame(action: DesktopPointerAction, changedButton: Int = 0) {
    emit(DesktopPointerFrame(action, x, y, buttons, changedButton))
  }

  private fun clamp() {
    x = x.coerceIn(0f, (width - 1f).coerceAtLeast(0f))
    y = y.coerceIn(0f, (height - 1f).coerceAtLeast(0f))
  }
}
