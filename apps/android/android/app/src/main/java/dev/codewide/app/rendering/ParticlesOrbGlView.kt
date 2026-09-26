package dev.codewide.app.rendering

import android.content.Context
import android.graphics.SurfaceTexture
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLSurface
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Choreographer
import android.view.Surface
import android.view.TextureView
import java.util.concurrent.CountDownLatch
import java.util.concurrent.atomic.AtomicBoolean

internal data class ParticlesOrbRenderInput(
  val backdropEnabled: Boolean,
  val generation: Long,
  val inputLevel: Float?,
  val orbState: VoiceAssistantOrbState,
  val playbackLevel: Float?,
  val reducedMotion: Boolean,
)

/** Owns the transparent GL surface while all animation and projection stay off the app UI thread. */
internal class ParticlesOrbGlView(context: Context) : TextureView(context), TextureView.SurfaceTextureListener {
  private val inputLock = Any()
  @Volatile private var input = ParticlesOrbRenderInput(
    backdropEnabled = false,
    generation = 0L,
    inputLevel = null,
    orbState = VoiceAssistantOrbState.IDLE,
    playbackLevel = null,
    reducedMotion = false,
  )
  private var renderThread: ParticlesOrbRenderThread? = null

  init {
    isOpaque = false
    surfaceTextureListener = this
  }

  fun setAudioLevels(inputLevel: Float?, playbackLevel: Float?) {
    updateInput { current ->
      current.copy(inputLevel = inputLevel, playbackLevel = playbackLevel)
    }
  }

  fun setBackdropEnabled(enabled: Boolean) {
    updateInput { current -> current.copy(backdropEnabled = enabled) }
  }

  fun setOrbState(state: VoiceAssistantOrbState) {
    updateInput { current -> current.copy(orbState = state) }
  }

  fun setReducedMotion(reduced: Boolean) {
    updateInput { current -> current.copy(reducedMotion = reduced) }
  }

  override fun onSurfaceTextureAvailable(surfaceTexture: SurfaceTexture, width: Int, height: Int) {
    check(renderThread == null) { "Particles GL render thread is already active" }
    renderThread = ParticlesOrbRenderThread(
      density = resources.displayMetrics.density,
      input = { input },
      surface = Surface(surfaceTexture),
    ).also(Thread::start)
  }

  override fun onSurfaceTextureSizeChanged(surfaceTexture: SurfaceTexture, width: Int, height: Int) = Unit

  override fun onSurfaceTextureDestroyed(surfaceTexture: SurfaceTexture): Boolean {
    renderThread?.stopAndWait()
    renderThread = null
    return true
  }

  override fun onSurfaceTextureUpdated(surfaceTexture: SurfaceTexture) = Unit

  private fun updateInput(transform: (ParticlesOrbRenderInput) -> ParticlesOrbRenderInput) {
    synchronized(inputLock) {
      val next = transform(input)
      input = next.copy(generation = input.generation + 1L)
    }
  }
}

private class ParticlesOrbRenderThread(
  private val density: Float,
  private val input: () -> ParticlesOrbRenderInput,
  private val surface: Surface,
) : Thread("CodeWide Particles GL") {
  private val ready = CountDownLatch(1)
  private val stopRequested = AtomicBoolean(false)
  @Volatile private var handler: Handler? = null
  @Volatile private var choreographer: Choreographer? = null
  @Volatile private var frameCallback: Choreographer.FrameCallback? = null

  override fun run() {
    Looper.prepare()
    val threadLooper = requireNotNull(Looper.myLooper())
    handler = Handler(threadLooper)
    if (stopRequested.get()) {
      ready.countDown()
      surface.release()
      return
    }

    var egl: ParticlesOrbEglSession? = null
    var renderer: ParticlesOrbGlRenderer? = null
    try {
      egl = ParticlesOrbEglSession(surface)
      renderer = ParticlesOrbGlRenderer(density, input())
      val frameClock = Choreographer.getInstance()
      choreographer = frameClock
      val callback = object : Choreographer.FrameCallback {
        override fun doFrame(frameTimeNanos: Long) {
          if (stopRequested.get()) return
          try {
            val width = egl.width
            val height = egl.height
            if (width > 0 && height > 0) {
              if (renderer.draw(input(), frameTimeNanos, width, height)) {
                egl.swapBuffers()
              }
            }
            frameClock.postFrameCallback(this)
          } catch (error: RuntimeException) {
            Log.e(LOG_TAG, "Particles GL frame failed", error)
            stopRequested.set(true)
            threadLooper.quitSafely()
          }
        }
      }
      frameCallback = callback
      ready.countDown()
      frameClock.postFrameCallback(callback)
      Looper.loop()
    } catch (error: RuntimeException) {
      Log.e(LOG_TAG, "Particles GL renderer failed to start", error)
      ready.countDown()
    } finally {
      frameCallback?.let { callback -> choreographer?.removeFrameCallback(callback) }
      renderer?.close()
      egl?.close()
      surface.release()
      handler = null
      choreographer = null
      frameCallback = null
    }
  }

  fun stopAndWait() {
    stopRequested.set(true)
    try {
      ready.await()
      handler?.post {
        frameCallback?.let { callback -> choreographer?.removeFrameCallback(callback) }
        Looper.myLooper()?.quitSafely()
      }
      join()
    } catch (error: InterruptedException) {
      currentThread().interrupt()
      Log.w(LOG_TAG, "Interrupted while stopping Particles GL renderer", error)
    }
  }

  private companion object {
    const val LOG_TAG = "CodeWideParticlesGL"
  }
}

/** EGL 3 window session confined to the Particles render thread. */
private class ParticlesOrbEglSession(surface: Surface) : AutoCloseable {
  private val display: EGLDisplay
  private val context: EGLContext
  private val windowSurface: EGLSurface

  val width: Int
    get() = querySurface(EGL14.EGL_WIDTH)
  val height: Int
    get() = querySurface(EGL14.EGL_HEIGHT)

  init {
    display = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
    check(display != EGL14.EGL_NO_DISPLAY) { "EGL display is unavailable" }
    val version = IntArray(2)
    check(EGL14.eglInitialize(display, version, 0, version, 1)) { eglFailure("initialize") }

    val configs = arrayOfNulls<EGLConfig>(1)
    val configCount = IntArray(1)
    val configAttributes = intArrayOf(
      EGL14.EGL_RED_SIZE, 8,
      EGL14.EGL_GREEN_SIZE, 8,
      EGL14.EGL_BLUE_SIZE, 8,
      EGL14.EGL_ALPHA_SIZE, 8,
      EGL14.EGL_RENDERABLE_TYPE, EGL_OPENGL_ES3_BIT,
      EGL14.EGL_SURFACE_TYPE, EGL14.EGL_WINDOW_BIT,
      EGL14.EGL_NONE,
    )
    check(EGL14.eglChooseConfig(
      display,
      configAttributes,
      0,
      configs,
      0,
      configs.size,
      configCount,
      0,
    ) && configCount[0] > 0) { eglFailure("choose config") }
    val config = requireNotNull(configs[0])
    context = EGL14.eglCreateContext(
      display,
      config,
      EGL14.EGL_NO_CONTEXT,
      intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 3, EGL14.EGL_NONE),
      0,
    )
    check(context != EGL14.EGL_NO_CONTEXT) { eglFailure("create context") }
    windowSurface = EGL14.eglCreateWindowSurface(
      display,
      config,
      surface,
      intArrayOf(EGL14.EGL_NONE),
      0,
    )
    check(windowSurface != EGL14.EGL_NO_SURFACE) { eglFailure("create window surface") }
    check(EGL14.eglMakeCurrent(display, windowSurface, windowSurface, context)) {
      eglFailure("make current")
    }
    check(EGL14.eglSwapInterval(display, 1)) { eglFailure("set swap interval") }
  }

  fun swapBuffers() {
    check(EGL14.eglSwapBuffers(display, windowSurface)) { eglFailure("swap buffers") }
  }

  override fun close() {
    EGL14.eglMakeCurrent(
      display,
      EGL14.EGL_NO_SURFACE,
      EGL14.EGL_NO_SURFACE,
      EGL14.EGL_NO_CONTEXT,
    )
    EGL14.eglDestroySurface(display, windowSurface)
    EGL14.eglDestroyContext(display, context)
    EGL14.eglTerminate(display)
  }

  private fun querySurface(attribute: Int): Int {
    val value = IntArray(1)
    check(EGL14.eglQuerySurface(display, windowSurface, attribute, value, 0)) {
      eglFailure("query surface")
    }
    return value[0]
  }

  private fun eglFailure(operation: String): String =
    "EGL $operation failed with 0x${EGL14.eglGetError().toString(16)}"

  private companion object {
    const val EGL_OPENGL_ES3_BIT = 0x40
  }
}
