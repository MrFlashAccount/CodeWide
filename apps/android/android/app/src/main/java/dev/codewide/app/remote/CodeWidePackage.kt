package dev.codewide.app.remote

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import dev.codewide.app.rendering.NativeCodeBlockManager
import dev.codewide.app.rendering.AnimatedNumberManager
import dev.codewide.app.performance.CodexPerformanceModule

class CodeWidePackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(CodeWideModule(reactContext), CodexPerformanceModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    listOf(NativeCodeBlockManager(), AnimatedNumberManager())
}
