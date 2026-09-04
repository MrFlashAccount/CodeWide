package dev.codewide.app.remote

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaFormat
import android.os.SystemClock
import java.io.ByteArrayOutputStream
import java.nio.ByteOrder
import java.util.ArrayDeque

internal data class EncodedOpusPacket(
  val data: ByteArray,
  val samplesPerChannel: Int,
)

internal data class OpusTransportChunk(
  val data: ByteArray,
  val samplesPerChannel: Int,
  val level: Double,
)

/** Owns Android's streaming Opus encoder for one microphone capture. */
internal class OpusAudioEncoder(
  private val sampleRate: Int,
  private val numChannels: Int,
  bitrate: Int,
) : AutoCloseable {
  private val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_OPUS)
  private val frameSamplesPerChannel = sampleRate / OPUS_FRAMES_PER_SECOND
  private val frame = ShortArray(frameSamplesPerChannel * numChannels)
  private val queuedFrameSamples = ArrayDeque<Int>()
  private var frameSamples = 0
  private var submittedSamplesPerChannel = 0L
  private var closed = false

  init {
    require(sampleRate in OPUS_SAMPLE_RATES) { "Unsupported Opus sample rate" }
    require(numChannels == 1 || numChannels == 2) { "Unsupported Opus channel count" }
    require(bitrate in MIN_BITRATE..MAX_BITRATE) { "Unsupported Opus bitrate" }
    val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_OPUS, sampleRate, numChannels).apply {
      setInteger(MediaFormat.KEY_BIT_RATE, bitrate)
      setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, frame.size * Short.SIZE_BYTES)
      setInteger(MediaFormat.KEY_PCM_ENCODING, AudioFormat.ENCODING_PCM_16BIT)
    }
    codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    codec.start()
  }

  fun append(samples: ShortArray, count: Int): List<EncodedOpusPacket> {
    check(!closed) { "Opus encoder is closed" }
    require(count in 0..samples.size) { "PCM sample count is invalid" }
    val output = mutableListOf<EncodedOpusPacket>()
    var offset = 0
    while (offset < count) {
      val copied = minOf(count - offset, frame.size - frameSamples)
      samples.copyInto(frame, frameSamples, offset, offset + copied)
      frameSamples += copied
      offset += copied
      if (frameSamples == frame.size) {
        queueFrame(output)
        frameSamples = 0
      }
    }
    drainAvailable(output, 0L)
    return output
  }

  fun finish(): List<EncodedOpusPacket> {
    check(!closed) { "Opus encoder is closed" }
    val output = mutableListOf<EncodedOpusPacket>()
    if (frameSamples > 0) {
      frame.fill(0, frameSamples)
      queueFrame(output)
      frameSamples = 0
    }
    queueEndOfStream(output)
    val deadline = SystemClock.elapsedRealtime() + FINISH_TIMEOUT_MS
    var ended = false
    while (!ended && SystemClock.elapsedRealtime() < deadline) {
      ended = drainAvailable(output, CODEC_WAIT_US)
    }
    check(ended) { "Opus encoder did not finish" }
    check(queuedFrameSamples.isEmpty()) { "Opus encoder omitted audio frames" }
    close()
    return output
  }

  override fun close() {
    if (closed) return
    closed = true
    try {
      codec.stop()
    } finally {
      codec.release()
    }
  }

  private fun queueFrame(output: MutableList<EncodedOpusPacket>) {
    val inputIndex = awaitInputBuffer(output)
    val input = checkNotNull(codec.getInputBuffer(inputIndex)) { "Opus encoder input buffer is unavailable" }
    input.clear()
    input.order(ByteOrder.LITTLE_ENDIAN)
    for (sample in frame) input.putShort(sample)
    val presentationTimeUs = submittedSamplesPerChannel * MICROS_PER_SECOND / sampleRate
    codec.queueInputBuffer(inputIndex, 0, frame.size * Short.SIZE_BYTES, presentationTimeUs, 0)
    queuedFrameSamples.addLast(frameSamplesPerChannel)
    submittedSamplesPerChannel += frameSamplesPerChannel
  }

  private fun queueEndOfStream(output: MutableList<EncodedOpusPacket>) {
    val inputIndex = awaitInputBuffer(output)
    val presentationTimeUs = submittedSamplesPerChannel * MICROS_PER_SECOND / sampleRate
    codec.queueInputBuffer(inputIndex, 0, 0, presentationTimeUs, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
  }

  private fun awaitInputBuffer(output: MutableList<EncodedOpusPacket>): Int {
    while (true) {
      val index = codec.dequeueInputBuffer(CODEC_WAIT_US)
      if (index >= 0) return index
      drainAvailable(output, 0L)
    }
  }

  private fun drainAvailable(output: MutableList<EncodedOpusPacket>, timeoutUs: Long): Boolean {
    val info = MediaCodec.BufferInfo()
    var wait = timeoutUs
    while (true) {
      val index = codec.dequeueOutputBuffer(info, wait)
      wait = 0L
      when {
        index >= 0 -> {
          val codecConfig = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
          if (!codecConfig && info.size > 0) {
            val buffer = checkNotNull(codec.getOutputBuffer(index)) { "Opus encoder output buffer is unavailable" }
            buffer.position(info.offset)
            buffer.limit(info.offset + info.size)
            val packet = ByteArray(info.size)
            buffer.get(packet)
            val samples = queuedFrameSamples.pollFirst()
              ?: error("Opus encoder produced an unowned audio packet")
            output += EncodedOpusPacket(packet, samples)
          }
          val ended = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
          codec.releaseOutputBuffer(index, false)
          if (ended) return true
        }
        index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> Unit
        index == MediaCodec.INFO_TRY_AGAIN_LATER -> return false
        else -> Unit
      }
    }
  }

  private companion object {
    const val OPUS_FRAMES_PER_SECOND = 50
    const val MIN_BITRATE = 6_000
    const val MAX_BITRATE = 128_000
    const val MICROS_PER_SECOND = 1_000_000L
    const val CODEC_WAIT_US = 10_000L
    const val FINISH_TIMEOUT_MS = 5_000L
    val OPUS_SAMPLE_RATES = setOf(8_000, 12_000, 16_000, 24_000, 48_000)
  }
}

/** Coalesces native Opus packets without changing their codec order. */
internal class OpusTransportBatcher(private val targetSamplesPerChannel: Int) {
  private val packets = mutableListOf<ByteArray>()
  private var samplesPerChannel = 0
  private var latestLevel = 0.0

  init {
    require(targetSamplesPerChannel > 0) { "Opus transport batch size must be positive" }
  }

  fun append(packet: EncodedOpusPacket, level: Double): OpusTransportChunk? {
    packets += packet.data
    samplesPerChannel += packet.samplesPerChannel
    latestLevel = level
    return if (samplesPerChannel >= targetSamplesPerChannel) flush() else null
  }

  fun flush(): OpusTransportChunk? {
    if (packets.isEmpty()) return null
    val chunk = OpusTransportChunk(packOpusPackets(packets), samplesPerChannel, latestLevel)
    packets.clear()
    samplesPerChannel = 0
    latestLevel = 0.0
    return chunk
  }
}

internal fun packOpusPackets(packets: List<ByteArray>): ByteArray {
  require(packets.isNotEmpty()) { "Opus transport chunk must contain a packet" }
  val output = ByteArrayOutputStream()
  for (packet in packets) {
    require(packet.isNotEmpty() && packet.size <= MAX_OPUS_PACKET_BYTES) { "Opus packet size is invalid" }
    output.write(packet.size ushr 8)
    output.write(packet.size and 0xff)
    output.write(packet)
  }
  return output.toByteArray()
}

private const val MAX_OPUS_PACKET_BYTES = 1_275
