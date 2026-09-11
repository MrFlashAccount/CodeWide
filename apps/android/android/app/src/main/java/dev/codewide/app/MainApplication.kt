package dev.codewide.app

import android.app.Application
import android.content.ComponentCallbacks2
import android.content.res.Configuration

import com.facebook.drawee.backends.pipeline.Fresco
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactNativeApplicationEntryPoint.loadReactNative
import com.facebook.react.ReactPackage
import com.facebook.react.ReactHost
import com.facebook.react.common.ReleaseLevel
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint
import com.facebook.react.modules.fresco.FrescoModule

import expo.modules.ApplicationLifecycleDispatcher
import expo.modules.ExpoReactHostFactory
import dev.codewide.app.remote.CodeWidePackage
import dev.codewide.app.remote.NativeStartupTrace
import dev.codewide.app.rendering.NativeCodeHighlighter

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
    DefaultNewArchitectureEntryPoint.releaseLevel = try {
      ReleaseLevel.valueOf(BuildConfig.REACT_NATIVE_RELEASE_LEVEL.uppercase())
    } catch (e: IllegalArgumentException) {
      ReleaseLevel.STABLE
    }
    loadReactNative(this)
    ApplicationLifecycleDispatcher.onApplicationCreate(this)
    NativeStartupTrace.markApplicationReady()
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
