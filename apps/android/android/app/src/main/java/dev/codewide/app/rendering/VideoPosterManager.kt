package dev.codewide.app.rendering

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.util.Size
import android.widget.ImageView
import com.facebook.react.bridge.Arguments
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.Event
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

class VideoPosterManager : SimpleViewManager<VideoPosterView>() {
  override fun getName() = "CodeWideVideoPoster"

  override fun createViewInstance(context: ThemedReactContext) =
    VideoPosterView(context) { view ->
      UIManagerHelper.getEventDispatcherForReactTag(context, view.id)?.dispatchEvent(
        PosterErrorEvent(UIManagerHelper.getSurfaceId(context), view.id),
      )
    }

  @ReactProp(name = "sourceUri")
  fun setSource(view: VideoPosterView, uri: String?) = view.bind(uri)

  override fun onDropViewInstance(view: VideoPosterView) {
    view.bind(null)
    super.onDropViewInstance(view)
  }

  override fun getExportedCustomDirectEventTypeConstants() = mutableMapOf<String, Any>(
    "topPosterError" to mapOf("registrationName" to "onPosterError"),
  )
}

private class PosterErrorEvent(surfaceId: Int, tag: Int) : Event<PosterErrorEvent>(surfaceId, tag) {
  override fun getEventName() = "topPosterError"
  override fun getEventData() = Arguments.createMap()
}

class VideoPosterView(context: Context, private val onFailure: (VideoPosterView) -> Unit) : ImageView(context) {
  private var source: String? = null
  private var requestedSize: Size? = null
  private var decode: Job? = null

  init { scaleType = ScaleType.CENTER_CROP }

  fun bind(uri: String?) {
    if (source == uri) return
    decode?.cancel()
    decode = null
    requestedSize = null
    source = uri
    setImageDrawable(null)
    requestFrame()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    requestFrame()
  }

  override fun onDetachedFromWindow() {
    if (decode != null) {
      decode?.cancel()
      decode = null
      requestedSize = null
    }
    super.onDetachedFromWindow()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    requestFrame()
  }

  private fun requestFrame() {
    val uri = source ?: return
    if (!isAttachedToWindow || width <= 0 || height <= 0) return
    val size = Size(width, height)
    if (size == requestedSize) return
    requestedSize = size
    decode?.cancel()
    decode = CoroutineScope(Dispatchers.Main.immediate).launch {
      val frame = withContext(posterDecoder) { readFirstFrame(context, uri, size) }
      decode = null
      if (frame != null) setImageBitmap(frame) else onFailure(this@VideoPosterView)
    }
  }
}

// Bound the concurrent native decoders even when a turn contains many videos.
private val posterDecoder = Dispatchers.IO.limitedParallelism(2)

private fun readFirstFrame(context: Context, source: String, size: Size): Bitmap? {
  try {
    val uri = Uri.parse(source)
    if (uri.scheme != "file" || !uri.authority.isNullOrEmpty()) return null
    val file = File(uri.path ?: return null).canonicalFile
    if (!file.toPath().startsWith(context.cacheDir.canonicalFile.toPath())) return null
    return file.inputStream().use { input ->
      MediaMetadataRetriever().use { retriever ->
        retriever.setDataSource(input.fd)
        retriever.getScaledFrameAtTime(0L, MediaMetadataRetriever.OPTION_CLOSEST, size.width, size.height)
      }
    }
  } catch (_: Exception) {
    // Decoding support and file availability can differ from the fullscreen player's.
    return null
  }
}
