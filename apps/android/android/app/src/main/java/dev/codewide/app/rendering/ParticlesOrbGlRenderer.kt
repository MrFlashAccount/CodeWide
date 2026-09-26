package dev.codewide.app.rendering

import android.opengl.GLES30
import android.os.SystemClock
import android.util.Log
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer

/** Builds the exact Canvas-era particle projection for one GL instanced draw. */
internal class ParticlesOrbGlFrameBuilder(
  private val density: Float,
) {
  private val points = ParticlesOrbModel.buildSphere()
  private val projected = List(points.size) { MutableParticlesOrbProjection() }
  val vertices: FloatBuffer = ByteBuffer
    .allocateDirect(ParticlesOrbModel.PARTICLE_COUNT * FLOATS_PER_PARTICLE * Float.SIZE_BYTES)
    .order(ByteOrder.nativeOrder())
    .asFloatBuffer()

  fun write(frame: ParticlesOrbFrame, size: Float): Float {
    val projectionContext = ParticlesOrbProjectionContext(frame, size, density)
    vertices.clear()
    var visualRadius = 0f
    for (index in points.indices) {
      val projection = projected[index]
      ParticlesOrbModel.projectInto(points[index], index, projectionContext, projection)
      visualRadius = maxOf(visualRadius, ParticlesOrbModel.visualExtent(projection, size))
      vertices.put(projection.x)
      vertices.put(projection.y)
      vertices.put(projection.dotRadius)
      vertices.put((projection.color shr 16 and 0xff) / 255f)
      vertices.put((projection.color shr 8 and 0xff) / 255f)
      vertices.put((projection.color and 0xff) / 255f)
      val alpha = (projection.alpha * 255f).toInt().coerceIn(0, 255)
      vertices.put(alpha / 255f)
    }
    vertices.flip()
    return visualRadius
  }

  companion object {
    const val FLOATS_PER_PARTICLE = 7
  }
}

/** GL state and resources confined to one EGL render thread. */
internal class ParticlesOrbGlRenderer(
  private val density: Float,
  initialInput: ParticlesOrbRenderInput,
) : AutoCloseable {
  private val frameBuilder = ParticlesOrbGlFrameBuilder(density)
  private val backdropRadius = OrbBackdropRadius()
  private val particleProgram = GlProgram(PARTICLE_VERTEX_SHADER, PARTICLE_FRAGMENT_SHADER)
  private val backdropProgram = GlProgram(FULLSCREEN_VERTEX_SHADER, BACKDROP_FRAGMENT_SHADER)
  private val compositeProgram = GlProgram(FULLSCREEN_TEXTURE_VERTEX_SHADER, COMPOSITE_FRAGMENT_SHADER)
  private val additiveLayer = GlAdditiveLayer()
  private val particleVao = IntArray(1)
  private val particleBuffer = IntArray(1)
  private var simulation = ParticlesOrbSimulation(initialInput.orbState)
  private var simulationInitialState = initialInput.orbState
  private var hasAdvanced = false
  private var lastFrameNanos = 0L
  private var lastRenderedGeneration = Long.MIN_VALUE
  private var lastWidth = 0
  private var lastHeight = 0
  private var previousReducedMotion = initialInput.reducedMotion
  private var renderedFrames = 0L
  private var lastDiagnosticMs = Long.MIN_VALUE

  init {
    GLES30.glDisable(GLES30.GL_DEPTH_TEST)
    GLES30.glDisable(GLES30.GL_CULL_FACE)
    GLES30.glEnable(GLES30.GL_BLEND)
    GLES30.glGenVertexArrays(1, particleVao, 0)
    GLES30.glGenBuffers(1, particleBuffer, 0)
    GLES30.glBindVertexArray(particleVao[0])
    GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, particleBuffer[0])
    GLES30.glBufferData(
      GLES30.GL_ARRAY_BUFFER,
      ParticlesOrbModel.PARTICLE_COUNT * ParticlesOrbGlFrameBuilder.FLOATS_PER_PARTICLE * Float.SIZE_BYTES,
      null,
      GLES30.GL_DYNAMIC_DRAW,
    )
    val stride = ParticlesOrbGlFrameBuilder.FLOATS_PER_PARTICLE * Float.SIZE_BYTES
    GLES30.glEnableVertexAttribArray(0)
    GLES30.glVertexAttribPointer(0, 2, GLES30.GL_FLOAT, false, stride, 0)
    GLES30.glVertexAttribDivisor(0, 1)
    GLES30.glEnableVertexAttribArray(1)
    GLES30.glVertexAttribPointer(1, 1, GLES30.GL_FLOAT, false, stride, 2 * Float.SIZE_BYTES)
    GLES30.glVertexAttribDivisor(1, 1)
    GLES30.glEnableVertexAttribArray(2)
    GLES30.glVertexAttribPointer(2, 4, GLES30.GL_FLOAT, false, stride, 3 * Float.SIZE_BYTES)
    GLES30.glVertexAttribDivisor(2, 1)
    GLES30.glBindVertexArray(0)
    checkGl("create particle buffers")
  }

  fun draw(
    input: ParticlesOrbRenderInput,
    frameTimeNanos: Long,
    width: Int,
    height: Int,
  ): Boolean {
    if (input.reducedMotion && input.generation == lastRenderedGeneration &&
      width == lastWidth && height == lastHeight) {
      return false
    }
    if (input.reducedMotion != previousReducedMotion) {
      lastFrameNanos = 0L
      previousReducedMotion = input.reducedMotion
    }
    if (!hasAdvanced && input.orbState != simulationInitialState) {
      simulation = ParticlesOrbSimulation(input.orbState)
      simulationInitialState = input.orbState
    }
    val deltaSeconds = if (lastFrameNanos == 0L) {
      0f
    } else {
      ((frameTimeNanos - lastFrameNanos).coerceAtMost(MAX_FRAME_DELTA_NANOS) / 1_000_000_000.0).toFloat()
    }
    lastFrameNanos = frameTimeNanos
    val frame = simulation.advance(
      state = input.orbState,
      inputLevel = if (input.reducedMotion) null else input.inputLevel,
      playbackLevel = if (input.reducedMotion) null else input.playbackLevel,
      deltaSeconds = deltaSeconds,
      isStatic = input.reducedMotion,
    )
    hasAdvanced = true

    val size = minOf(width, height).toFloat()
    val visualRadius = frameBuilder.write(frame, size)
    val backdropSize = backdropRadius.update(
      visualRadius = visualRadius,
      padding = 3f * density,
      deltaSeconds = deltaSeconds,
      snap = input.reducedMotion,
    )
    if (frame.additiveGlow) {
      additiveLayer.bind(width, height)
      clearSurface(width, height)
      drawParticles(width, height, additive = true)
      GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0)
      clearSurface(width, height)
      drawBackdrop(input.backdropEnabled, size / 2f, backdropSize, height)
      additiveLayer.composite(compositeProgram)
    } else {
      GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, 0)
      clearSurface(width, height)
      drawBackdrop(input.backdropEnabled, size / 2f, backdropSize, height)
      drawParticles(width, height, additive = false)
    }
    renderedFrames += 1L
    lastRenderedGeneration = input.generation
    lastWidth = width
    lastHeight = height
    logDiagnostics(input, frame)
    return true
  }

  override fun close() {
    additiveLayer.close()
    GLES30.glDeleteBuffers(1, particleBuffer, 0)
    GLES30.glDeleteVertexArrays(1, particleVao, 0)
    particleProgram.close()
    backdropProgram.close()
    compositeProgram.close()
  }

  private fun clearSurface(width: Int, height: Int) {
    GLES30.glViewport(0, 0, width, height)
    GLES30.glClearColor(0f, 0f, 0f, 0f)
    GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT)
  }

  private fun drawBackdrop(enabled: Boolean, center: Float, radius: Float, height: Int) {
    if (!enabled || radius <= 0f) return
    GLES30.glBlendFuncSeparate(
      GLES30.GL_SRC_ALPHA,
      GLES30.GL_ONE_MINUS_SRC_ALPHA,
      GLES30.GL_ONE,
      GLES30.GL_ONE_MINUS_SRC_ALPHA,
    )
    backdropProgram.use()
    backdropProgram.set2f("uCenter", center, height - center)
    backdropProgram.set1f("uRadius", radius)
    backdropProgram.set3f("uColor", 18f / 255f, 20f / 255f, 32f / 255f)
    backdropProgram.set1f("uCoreAlpha", (VoiceOverlayContrast.CORE_COLOR ushr 24) / 255f)
    GLES30.glDrawArrays(GLES30.GL_TRIANGLE_STRIP, 0, 4)
  }

  private fun drawParticles(width: Int, height: Int, additive: Boolean) {
    if (additive) {
      GLES30.glBlendFuncSeparate(GLES30.GL_SRC_ALPHA, GLES30.GL_ONE, GLES30.GL_ONE, GLES30.GL_ONE)
    } else {
      GLES30.glBlendFuncSeparate(
        GLES30.GL_SRC_ALPHA,
        GLES30.GL_ONE_MINUS_SRC_ALPHA,
        GLES30.GL_ONE,
        GLES30.GL_ONE_MINUS_SRC_ALPHA,
      )
    }
    particleProgram.use()
    particleProgram.set2f("uViewport", width.toFloat(), height.toFloat())
    GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, particleBuffer[0])
    GLES30.glBufferSubData(
      GLES30.GL_ARRAY_BUFFER,
      0,
      frameBuilder.vertices.remaining() * Float.SIZE_BYTES,
      frameBuilder.vertices,
    )
    GLES30.glBindVertexArray(particleVao[0])
    GLES30.glDrawArraysInstanced(
      GLES30.GL_TRIANGLE_STRIP,
      0,
      4,
      ParticlesOrbModel.PARTICLE_COUNT,
    )
    GLES30.glBindVertexArray(0)
  }

  private fun logDiagnostics(input: ParticlesOrbRenderInput, frame: ParticlesOrbFrame) {
    if (!input.backdropEnabled) return
    val now = SystemClock.elapsedRealtime()
    if (lastDiagnosticMs != Long.MIN_VALUE && now - lastDiagnosticMs < 1_000L) return
    lastDiagnosticMs = now
    Log.i(
      LOG_TAG,
      "state=${input.orbState.wireValue} reducedMotion=${input.reducedMotion} frames=$renderedFrames " +
        "input=${input.inputLevel} playback=${input.playbackLevel} level=${frame.level} " +
        "listeningWeight=${frame.weights.listening} ripple=${frame.ripple} " +
        "radiusScale=${frame.radiusScale} angleY=${frame.angleY} static=${frame.isStatic}",
    )
  }

  private companion object {
    const val LOG_TAG = "CodeWideParticlesGL"
    const val MAX_FRAME_DELTA_NANOS = 66_666_667L

    const val PARTICLE_VERTEX_SHADER = """#version 300 es
      layout(location = 0) in vec2 aCenterPx;
      layout(location = 1) in float aRadiusPx;
      layout(location = 2) in vec4 aColor;
      uniform vec2 uViewport;
      out vec2 vLocal;
      out vec4 vColor;

      void main() {
        const vec2 corners[4] = vec2[4](
          vec2(-1.0, -1.0),
          vec2( 1.0, -1.0),
          vec2(-1.0,  1.0),
          vec2( 1.0,  1.0)
        );
        vec2 local = corners[gl_VertexID];
        vec2 pixel = aCenterPx + local * aRadiusPx;
        gl_Position = vec4(
          pixel.x / uViewport.x * 2.0 - 1.0,
          1.0 - pixel.y / uViewport.y * 2.0,
          0.0,
          1.0
        );
        vLocal = local;
        vColor = aColor;
      }
    """

    const val PARTICLE_FRAGMENT_SHADER = """#version 300 es
      precision highp float;
      in vec2 vLocal;
      in vec4 vColor;
      out vec4 outColor;

      void main() {
        float distanceFromCenter = length(vLocal);
        float coverage = 1.0 - smoothstep(1.0 - fwidth(distanceFromCenter), 1.0, distanceFromCenter);
        outColor = vec4(vColor.rgb, vColor.a * coverage);
      }
    """

    const val FULLSCREEN_VERTEX_SHADER = """#version 300 es
      void main() {
        const vec2 positions[4] = vec2[4](
          vec2(-1.0, -1.0),
          vec2( 1.0, -1.0),
          vec2(-1.0,  1.0),
          vec2( 1.0,  1.0)
        );
        gl_Position = vec4(positions[gl_VertexID], 0.0, 1.0);
      }
    """

    const val BACKDROP_FRAGMENT_SHADER = """#version 300 es
      precision highp float;
      uniform vec2 uCenter;
      uniform float uRadius;
      uniform vec3 uColor;
      uniform float uCoreAlpha;
      out vec4 outColor;

      void main() {
        float radiusFraction = distance(gl_FragCoord.xy, uCenter) / uRadius;
        float feather = clamp((1.0 - radiusFraction) / (1.0 - 0.78), 0.0, 1.0);
        outColor = vec4(uColor, uCoreAlpha * feather);
      }
    """

    const val FULLSCREEN_TEXTURE_VERTEX_SHADER = """#version 300 es
      out vec2 vUv;

      void main() {
        const vec2 positions[4] = vec2[4](
          vec2(-1.0, -1.0),
          vec2( 1.0, -1.0),
          vec2(-1.0,  1.0),
          vec2( 1.0,  1.0)
        );
        const vec2 coordinates[4] = vec2[4](
          vec2(0.0, 0.0),
          vec2(1.0, 0.0),
          vec2(0.0, 1.0),
          vec2(1.0, 1.0)
        );
        gl_Position = vec4(positions[gl_VertexID], 0.0, 1.0);
        vUv = coordinates[gl_VertexID];
      }
    """

    const val COMPOSITE_FRAGMENT_SHADER = """#version 300 es
      precision highp float;
      uniform sampler2D uTexture;
      in vec2 vUv;
      out vec4 outColor;

      void main() {
        outColor = texture(uTexture, vUv);
      }
    """
  }
}

private class GlProgram(vertexSource: String, fragmentSource: String) : AutoCloseable {
  private val program: Int

  init {
    val vertexShader = compileShader(GLES30.GL_VERTEX_SHADER, vertexSource)
    val fragmentShader = compileShader(GLES30.GL_FRAGMENT_SHADER, fragmentSource)
    program = GLES30.glCreateProgram()
    check(program != 0) { "Could not create GL program" }
    GLES30.glAttachShader(program, vertexShader)
    GLES30.glAttachShader(program, fragmentShader)
    GLES30.glLinkProgram(program)
    val linked = IntArray(1)
    GLES30.glGetProgramiv(program, GLES30.GL_LINK_STATUS, linked, 0)
    val linkLog = GLES30.glGetProgramInfoLog(program)
    GLES30.glDeleteShader(vertexShader)
    GLES30.glDeleteShader(fragmentShader)
    check(linked[0] == GLES30.GL_TRUE) { "Could not link GL program: $linkLog" }
  }

  fun use() {
    GLES30.glUseProgram(program)
  }

  fun set1f(name: String, value: Float) {
    GLES30.glUniform1f(uniform(name), value)
  }

  fun set2f(name: String, first: Float, second: Float) {
    GLES30.glUniform2f(uniform(name), first, second)
  }

  fun set3f(name: String, first: Float, second: Float, third: Float) {
    GLES30.glUniform3f(uniform(name), first, second, third)
  }

  fun set1i(name: String, value: Int) {
    GLES30.glUniform1i(uniform(name), value)
  }

  override fun close() {
    GLES30.glDeleteProgram(program)
  }

  private fun uniform(name: String): Int {
    val location = GLES30.glGetUniformLocation(program, name)
    check(location >= 0) { "GL uniform is unavailable: $name" }
    return location
  }

  private fun compileShader(type: Int, source: String): Int {
    val shader = GLES30.glCreateShader(type)
    check(shader != 0) { "Could not create GL shader" }
    GLES30.glShaderSource(shader, source)
    GLES30.glCompileShader(shader)
    val compiled = IntArray(1)
    GLES30.glGetShaderiv(shader, GLES30.GL_COMPILE_STATUS, compiled, 0)
    val compileLog = GLES30.glGetShaderInfoLog(shader)
    if (compiled[0] != GLES30.GL_TRUE) GLES30.glDeleteShader(shader)
    check(compiled[0] == GLES30.GL_TRUE) { "Could not compile GL shader: $compileLog" }
    return shader
  }
}

private class GlAdditiveLayer : AutoCloseable {
  private val framebuffer = IntArray(1)
  private val texture = IntArray(1)
  private var width = 0
  private var height = 0

  fun bind(nextWidth: Int, nextHeight: Int) {
    ensureSize(nextWidth, nextHeight)
    GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, framebuffer[0])
  }

  fun composite(program: GlProgram) {
    GLES30.glBlendFuncSeparate(
      GLES30.GL_ONE,
      GLES30.GL_ONE_MINUS_SRC_ALPHA,
      GLES30.GL_ONE,
      GLES30.GL_ONE_MINUS_SRC_ALPHA,
    )
    program.use()
    GLES30.glActiveTexture(GLES30.GL_TEXTURE0)
    GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, texture[0])
    program.set1i("uTexture", 0)
    GLES30.glDrawArrays(GLES30.GL_TRIANGLE_STRIP, 0, 4)
  }

  override fun close() {
    if (texture[0] != 0) {
      GLES30.glDeleteTextures(1, texture, 0)
      texture[0] = 0
    }
    if (framebuffer[0] != 0) {
      GLES30.glDeleteFramebuffers(1, framebuffer, 0)
      framebuffer[0] = 0
    }
  }

  private fun ensureSize(nextWidth: Int, nextHeight: Int) {
    if (framebuffer[0] != 0 && width == nextWidth && height == nextHeight) return
    close()
    width = nextWidth
    height = nextHeight
    GLES30.glGenTextures(1, texture, 0)
    GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, texture[0])
    GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MIN_FILTER, GLES30.GL_NEAREST)
    GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_MAG_FILTER, GLES30.GL_NEAREST)
    GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_S, GLES30.GL_CLAMP_TO_EDGE)
    GLES30.glTexParameteri(GLES30.GL_TEXTURE_2D, GLES30.GL_TEXTURE_WRAP_T, GLES30.GL_CLAMP_TO_EDGE)
    GLES30.glTexImage2D(
      GLES30.GL_TEXTURE_2D,
      0,
      GLES30.GL_RGBA8,
      width,
      height,
      0,
      GLES30.GL_RGBA,
      GLES30.GL_UNSIGNED_BYTE,
      null,
    )
    GLES30.glGenFramebuffers(1, framebuffer, 0)
    GLES30.glBindFramebuffer(GLES30.GL_FRAMEBUFFER, framebuffer[0])
    GLES30.glFramebufferTexture2D(
      GLES30.GL_FRAMEBUFFER,
      GLES30.GL_COLOR_ATTACHMENT0,
      GLES30.GL_TEXTURE_2D,
      texture[0],
      0,
    )
    check(GLES30.glCheckFramebufferStatus(GLES30.GL_FRAMEBUFFER) == GLES30.GL_FRAMEBUFFER_COMPLETE) {
      "Particles additive framebuffer is incomplete"
    }
    checkGl("create additive framebuffer")
  }
}

private fun checkGl(operation: String) {
  val error = GLES30.glGetError()
  check(error == GLES30.GL_NO_ERROR) { "GL $operation failed with 0x${error.toString(16)}" }
}
