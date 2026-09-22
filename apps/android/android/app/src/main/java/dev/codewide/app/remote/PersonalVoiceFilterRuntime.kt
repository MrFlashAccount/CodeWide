package dev.codewide.app.remote

import android.content.Context
import android.media.AudioFormat
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors

internal data class PersonalVoiceFilterDecision(
  val open: Boolean,
  val similarity: Double,
)

/** Owns the local voiceprint, rolling microphone window and one active gate decision stream. */
internal class PersonalVoiceFilterRuntime private constructor(context: Context) {
  private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
  private val executor = Executors.newSingleThreadExecutor { task ->
    Thread(task, "CodeWidePersonalVoiceFilter").apply { isDaemon = true }
  }
  private val ring = ShortArray(WINDOW_SAMPLES)
  private var ringWrite = 0
  private var ringSize = 0
  private var samplesSinceEvaluation = 0
  private var evaluationPending = false
  private var generation = 0L
  private var segmentGeneration = 0L
  private var segmentVoicedSamples = 0
  private var silenceSamples = 0
  private var matchedSegment = false
  private var rejectedSegment = false
  private var open = false
  private var listener: ((PersonalVoiceFilterDecision) -> Unit)? = null
  private var profile: FloatArray? = readProfile()

  @Synchronized
  fun hasProfile(): Boolean = profile != null

  @Synchronized
  fun saveProfile(value: FloatArray) {
    require(value.size == EMBEDDING_SIZE && value.all(Float::isFinite)) {
      "Voice profile is invalid"
    }
    val envelope = JSONObject()
      .put("embedding", JSONArray().apply { value.forEach { put(it.toDouble()) } })
      .put("schemaVersion", PROFILE_SCHEMA_VERSION)
    check(preferences.edit().putString(PROFILE_KEY, envelope.toString()).commit()) {
      "Voice profile could not be persisted"
    }
    profile = value
  }

  @Synchronized
  fun start(listener: (PersonalVoiceFilterDecision) -> Unit): Boolean {
    if (profile == null) return false
    generation += 1
    this.listener = listener
    resetSegment()
    return true
  }

  @Synchronized
  fun stop() {
    generation += 1
    listener = null
    resetSegment()
  }

  fun acceptSamples(audioFormat: Int, channelCount: Int, sampleRate: Int, data: ByteArray) {
    synchronized(this) {
      if (listener == null) return
    }
    if (audioFormat != AudioFormat.ENCODING_PCM_16BIT) return
    val decoded = PersonalVoiceFeatures.decodePcm16(channelCount, sampleRate, data)
    if (decoded.isEmpty()) return
    var immediateDecision: PersonalVoiceFilterDecision? = null
    var activeGeneration = 0L
    val evaluation: PendingEvaluation? = synchronized(this) {
      if (listener == null) return
      for (sample in decoded) {
        ring[ringWrite] = sample
        ringWrite = (ringWrite + 1) % ring.size
        if (ringSize < ring.size) ringSize += 1
      }
      val voiceActive = currentVoiceActivity()
      if (voiceActive) {
        silenceSamples = 0
        segmentVoicedSamples += decoded.size
        if (!matchedSegment && !rejectedSegment && !open) {
          open = true
          immediateDecision = PersonalVoiceFilterDecision(open = true, similarity = -1.0)
        }
      } else {
        silenceSamples += decoded.size
        if (silenceSamples >= SEGMENT_RESET_SILENCE_SAMPLES) {
          val wasOpen = open
          resetSegment()
          if (wasOpen) {
            immediateDecision = PersonalVoiceFilterDecision(open = false, similarity = -1.0)
          }
        }
      }
      samplesSinceEvaluation += decoded.size
      activeGeneration = generation
      if (
        evaluationPending ||
        !voiceActive ||
        ringSize < MINIMUM_WINDOW_SAMPLES ||
        samplesSinceEvaluation < EVALUATION_STEP_SAMPLES
      ) {
        null
      } else {
        samplesSinceEvaluation = 0
        evaluationPending = true
        PendingEvaluation(generation, segmentGeneration, profile ?: return, recentSamples(ringSize))
      }
    }
    immediateDecision?.let { decision -> publish(activeGeneration, decision) }
    evaluation?.let { pending -> executor.execute { evaluate(pending) } }
  }

  private fun evaluate(pending: PendingEvaluation) {
    val embedding = PersonalVoiceFeatures.embedding(pending.samples)
    val similarity = if (embedding === null) -1.0 else {
      PersonalVoiceFeatures.similarity(pending.profile, embedding)
    }
    var decision: PersonalVoiceFilterDecision? = null
    synchronized(this) {
      if (
        pending.generation != generation ||
        pending.segmentGeneration != segmentGeneration ||
        listener == null
      ) {
        return
      }
      evaluationPending = false
      val matches = similarity >= MATCH_THRESHOLD
      if (matches) {
        matchedSegment = true
        rejectedSegment = false
        if (!open) {
          open = true
          decision = PersonalVoiceFilterDecision(open = true, similarity = similarity)
        }
      } else if (!matchedSegment && segmentVoicedSamples >= REJECTION_WINDOW_SAMPLES) {
        rejectedSegment = true
        if (open) {
          open = false
          decision = PersonalVoiceFilterDecision(open = false, similarity = similarity)
        }
      }
    }
    decision?.let { current -> publish(pending.generation, current) }
  }

  private fun currentVoiceActivity(): Boolean {
    if (ringSize < PersonalVoiceFeatures.ACTIVITY_WINDOW_SAMPLES) return false
    return PersonalVoiceFeatures.voiceActive(
      recentSamples(PersonalVoiceFeatures.ACTIVITY_WINDOW_SAMPLES),
    )
  }

  private fun publish(expectedGeneration: Long, decision: PersonalVoiceFilterDecision) {
    val current = synchronized(this) {
      if (expectedGeneration == generation) listener else null
    }
    current?.invoke(decision)
  }

  private fun recentSamples(count: Int): ShortArray {
    val samples = ShortArray(count)
    val start = (ringWrite - count + ring.size) % ring.size
    for (index in samples.indices) samples[index] = ring[(start + index) % ring.size]
    return samples
  }

  private fun resetSegment() {
    segmentGeneration += 1
    ringWrite = 0
    ringSize = 0
    samplesSinceEvaluation = 0
    evaluationPending = false
    segmentVoicedSamples = 0
    silenceSamples = 0
    matchedSegment = false
    rejectedSegment = false
    open = false
  }

  private fun readProfile(): FloatArray? {
    val stored = preferences.getString(PROFILE_KEY, null) ?: return null
    return try {
      val envelope = JSONObject(stored)
      if (envelope.optInt("schemaVersion") != PROFILE_SCHEMA_VERSION) return null
      val values = envelope.getJSONArray("embedding")
      if (values.length() != EMBEDDING_SIZE) return null
      FloatArray(values.length()) { index -> values.getDouble(index).toFloat() }
        .takeIf { embedding -> embedding.all(Float::isFinite) }
    } catch (_: Exception) {
      null
    }
  }

  private data class PendingEvaluation(
    val generation: Long,
    val segmentGeneration: Long,
    val profile: FloatArray,
    val samples: ShortArray,
  )

  companion object {
    private const val EMBEDDING_SIZE = 26
    private const val EVALUATION_STEP_SAMPLES = PersonalVoiceFeatures.SAMPLE_RATE / 25
    private const val MATCH_THRESHOLD = 0.75
    private const val MINIMUM_WINDOW_SAMPLES = PersonalVoiceFeatures.SAMPLE_RATE * 3 / 25
    private const val PREFERENCES = "codewide_personal_voice_filter"
    private const val PROFILE_KEY = "profile"
    private const val PROFILE_SCHEMA_VERSION = 1
    private const val REJECTION_WINDOW_SAMPLES = PersonalVoiceFeatures.SAMPLE_RATE * 8 / 25
    private const val SEGMENT_RESET_SILENCE_SAMPLES = PersonalVoiceFeatures.SAMPLE_RATE * 6 / 25
    private const val WINDOW_SAMPLES = PersonalVoiceFeatures.SAMPLE_RATE * 4 / 25
    @Volatile private var instance: PersonalVoiceFilterRuntime? = null

    fun install(context: Context): PersonalVoiceFilterRuntime = synchronized(this) {
      instance ?: PersonalVoiceFilterRuntime(context.applicationContext).also { instance = it }
    }

    fun requireInstalled(): PersonalVoiceFilterRuntime =
      instance ?: error("Personal voice filter runtime is unavailable")
  }
}
