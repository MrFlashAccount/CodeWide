package dev.codewide.app.remote

import com.facebook.react.module.annotations.ReactModule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
class GlobalVoiceForegroundModuleTest {
  @Test fun overlayActionsCanResolveTheirForegroundOwnerByClass() {
    // ReactInstance.getNativeModule(Class) returns null without this runtime annotation,
    // even when JS can acquire the module by name. Both Mic and Stop use that lookup.
    // This is the RN registration contract, not the implementation of either action.
    val registration = GlobalVoiceForegroundModule::class.java.getAnnotation(ReactModule::class.java)
    assertNotNull("Mic/Stop require class-based React Native module lookup", registration)
    // The wire name is consumed by NativeModules.CodeWideGlobalVoiceForeground in JS.
    assertEquals("CodeWideGlobalVoiceForeground", requireNotNull(registration).name)
  }
}
