package dev.codewide.app.rendering;

import androidx.annotation.Nullable;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.modules.deviceinfo.DeviceInfoModule;

/** Requests the same change-only Dimensions publication that ReactRootView runs after layout. */
final class ReactWindowDimensions {
  private ReactWindowDimensions() {}

  static void publishChanges(@Nullable ReactContext context) {
    if (context == null || !context.hasActiveReactInstance()) return;
    DeviceInfoModule deviceInfo = context.getNativeModule(DeviceInfoModule.class);
    if (deviceInfo != null) deviceInfo.emitUpdateDimensionsEvent();
  }
}
