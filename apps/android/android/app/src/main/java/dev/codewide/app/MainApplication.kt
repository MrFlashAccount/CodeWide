package dev.codewide.app

import android.app.Application
import android.content.ComponentCallbacks2
import android.content.res.Configuration
import android.media.AudioAttributes
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor

import com.facebook.drawee.backends.pipeline.Fresco
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint
import com.facebook.react.modules.fresco.FrescoModule
import com.oney.WebRTCModule.WebRTCModuleOptions

import dev.codewide.app.remote.CodeWidePackage
import dev.codewide.app.remote.GlobalVoiceAudioRouteRuntime
import dev.codewide.app.remote.GlobalVoiceAudioRecordFailureKind
import dev.codewide.app.remote.NativeStartupTrace
import dev.codewide.app.remote.PersonalVoiceFilterRuntime
import dev.codewide.app.remote.VoiceCaptureForegroundService
import dev.codewide.app.rendering.NativeCodeHighlighter
import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ExpoReactHostFactory
import org.webrtc.audio.JavaAudioDeviceModule

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost by lazy {
    ExpoReactHostFactory.getDefaultReactHost(
      context = applicationContext,
      packageList =
        PackageList(this).packages.apply {
          // Packages that cannot be autolinked yet can be added manually here, for example:
          add(CodeWidePackage())
        }
    )
  }

  override fun onCreate() {
    NativeStartupTrace.markApplicationStarted()
    super.onCreate()
    PersonalVoiceFilterRuntime.install(this)
    configureWebRtcAudioDeviceModule()
    DefaultNewArchitectureEntryPoint.releaseLevel = try {
      ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
    } catch (e: IllegalArgumentException) {
      ReleaseLevel.STABLE
    }
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
    NativeStartupTrace.markApplicationReady()
  }

  private fun configureWebRtcAudioDeviceModule() {
    val audioAttributes = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_MEDIA)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
      .build()
    val audioDeviceModule = JavaAudioDeviceModule.builder(this)
      .setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
      .setUseHardwareAcousticEchoCanceler(AcousticEchoCanceler.isAvailable())
      .setUseHardwareNoiseSuppressor(NoiseSuppressor.isAvailable())
      .setAudioAttributes(audioAttributes)
      .setEnableVolumeLogger(false)
      .setAudioRecordErrorCallback(object : JavaAudioDeviceModule.AudioRecordErrorCallback {
        override fun onWebRtcAudioRecordInitError(errorMessage: String) {
          VoiceCaptureForegroundService.reportWebRtcAudioRecordFailure(
            GlobalVoiceAudioRecordFailureKind.INIT,
          )
        }

        override fun onWebRtcAudioRecordStartError(
          errorCode: JavaAudioDeviceModule.AudioRecordStartErrorCode,
          errorMessage: String,
        ) {
          VoiceCaptureForegroundService.reportWebRtcAudioRecordFailure(
            GlobalVoiceAudioRecordFailureKind.START,
          )
        }

        override fun onWebRtcAudioRecordError(errorMessage: String) {
          VoiceCaptureForegroundService.reportWebRtcAudioRecordFailure(
            GlobalVoiceAudioRecordFailureKind.RUNTIME,
          )
        }
      })
      .setAudioRecordStateCallback(object : JavaAudioDeviceModule.AudioRecordStateCallback {
        override fun onWebRtcAudioRecordStart() {
          GlobalVoiceAudioRouteRuntime.recordingChanged(true)
          VoiceCaptureForegroundService.updateWebRtcAudioRecordRunning(true)
        }

        override fun onWebRtcAudioRecordStop() {
          GlobalVoiceAudioRouteRuntime.recordingChanged(false)
          VoiceCaptureForegroundService.updateWebRtcAudioRecordRunning(false)
        }
      })
      .setSamplesReadyCallback { samples ->
        VoiceCaptureForegroundService.acceptWebRtcInputSamples(
          samples.audioFormat,
          samples.channelCount,
          samples.sampleRate,
          samples.data,
        )
        PersonalVoiceFilterRuntime.requireInstalled().acceptSamples(
          samples.audioFormat,
          samples.channelCount,
          samples.sampleRate,
          samples.data,
        )
      }
      .createAudioDeviceModule()
    WebRTCModuleOptions.getInstance().audioDeviceModule = audioDeviceModule
    GlobalVoiceAudioRouteRuntime.install(this, audioDeviceModule)
  }

  override fun onConfigurationChanged(newConfig: Configuration) {
    super.onConfigurationChanged(newConfig)
    ApplicationLifecycleDispatcher.onConfigurationChanged(this, newConfig)
  }

  override fun onTrimMemory(level: Int) {
    super.onTrimMemory(level)
    if (level < ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN) return
    NativeCodeHighlighter.trimMemory()
    if (FrescoModule.hasBeenInitialized()) Fresco.getImagePipeline().clearMemoryCaches()
  }
}
