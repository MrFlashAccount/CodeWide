package dev.codewide.app.remote

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import dev.codewide.app.rendering.NativeCodeBlockManager
import dev.codewide.app.rendering.AnimatedNumberManager
import dev.codewide.app.rendering.ContentReviewSelectionModule
import dev.codewide.app.rendering.DiagramPreviewModule
import dev.codewide.app.rendering.NativeShimmerTextManager
import dev.codewide.app.rendering.NebulaOrbManager
import dev.codewide.app.rendering.VoiceAssistantOrbManager
import dev.codewide.app.rendering.NativeRevealManager
import dev.codewide.app.rendering.NativeStreamingRevealManager
import dev.codewide.app.rendering.NativeFluidLayoutManager
import dev.codewide.app.rendering.SliderTouchCaptureManager
import dev.codewide.app.performance.CodexPerformanceModule
import dev.codewide.app.diagnostics.WindowDiagnosticsModule

class CodeWidePackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(
      CodeWideModule(reactContext),
      AppNoticeWindowModule(reactContext),
      CodexPerformanceModule(reactContext),
      WindowDiagnosticsModule(reactContext),
      ContentReviewSelectionModule(reactContext),
      DiagramPreviewModule(reactContext),
      GlobalVoiceForegroundModule(reactContext),
      GlobalVoiceAudioRouteModule(reactContext),
      LargePasteModule(reactContext),
      PersonalVoiceFilterModule(reactContext),
    )

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> =
    listOf(
      NativeCodeBlockManager(),
      AnimatedNumberManager(),
      NativeShimmerTextManager(),
      NativeRevealManager(),
      NativeStreamingRevealManager(),
      NativeFluidLayoutManager(),
      SliderTouchCaptureManager(),
      NebulaOrbManager(),
      VoiceAssistantOrbManager(),
    )
}
