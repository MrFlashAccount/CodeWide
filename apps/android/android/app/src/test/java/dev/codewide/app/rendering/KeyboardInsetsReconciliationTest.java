package dev.codewide.app.rendering;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.os.Looper;
import android.view.View;
import android.view.WindowInsets;
import androidx.core.graphics.Insets;
import androidx.core.view.WindowInsetsAnimationCompat;
import androidx.core.view.WindowInsetsCompat;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.JavaOnlyArray;
import com.facebook.react.bridge.JavaOnlyMap;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlags;
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsLocalAccessor;
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android;
import com.facebook.react.uimanager.ThemedReactContext;
import com.facebook.react.uimanager.events.Event;
import com.facebook.react.views.view.ReactViewGroup;
import com.reactnativekeyboardcontroller.listeners.KeyboardAnimationCallback;
import com.reactnativekeyboardcontroller.listeners.KeyboardAnimationCallbackConfig;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.Implementation;
import org.robolectric.annotation.Implements;
import org.robolectric.util.ReflectionHelpers;

/** Real library callbacks must publish window overlap even without IME animation callbacks. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 35,
    instrumentedPackages = {"com.reactnativekeyboardcontroller", "com.facebook.react.bridge"},
    shadows = {KeyboardInsetsReconciliationTest.EventSink.class, KeyboardInsetsReconciliationTest.Maps.class})
public class KeyboardInsetsReconciliationTest {
  private InsetsView view;
  private KeyboardAnimationCallback callback;

  @Before public void setUp() {
    ReactNativeFeatureFlagsLocalAccessor flags = new ReactNativeFeatureFlagsLocalAccessor();
    flags.override(new ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android());
    ReflectionHelpers.setStaticField(ReactNativeFeatureFlags.class, "accessor", flags);
    EventSink.events.clear();
    EventSink.notifications.clear();
    view = new InsetsView();
    Robolectric.buildActivity(android.app.Activity.class).setup().get().setContentView(view);
    callback = new KeyboardAnimationCallback(new ReactViewGroup(view.getContext()), view, null,
        new KeyboardAnimationCallbackConfig(WindowInsetsCompat.Type.navigationBars(),
            WindowInsetsCompat.Type.ime(), WindowInsetsAnimationCompat.Callback.DISPATCH_MODE_STOP, false));
  }

  @Test public void noAnimationShowResizeHidePublishesOverlapExactlyOnce() {
    apply(300, true);
    drain();
    assertTransition(300, 1);
    assertEquals(List.of("KeyboardController::keyboardWillShow", "KeyboardController::keyboardDidShow"), EventSink.notifications);
    clearEvents();
    apply(300, true);
    drain();
    assertTrue(EventSink.events.isEmpty());
    apply(180, true);
    drain();
    assertTransition(180, 1);
    clearEvents();
    apply(0, false);
    drain();
    assertTransition(0, 0);
    assertEquals(List.of("KeyboardController::keyboardWillHide", "KeyboardController::keyboardDidHide"), EventSink.notifications);
  }

  @Test public void latestInsetsWinAndDestroyedOrSuspendedCallbacksDoNotPublish() {
    apply(300, true);
    apply(0, false);
    drain();
    assertTrue(EventSink.events.isEmpty());
    callback.suspend(true);
    apply(300, true);
    drain();
    assertTrue(EventSink.events.isEmpty());
    callback.suspend(false);
    apply(300, true);
    callback.destroy();
    drain();
    assertTrue(EventSink.events.isEmpty());
  }

  @Test public void realAnimationOwnsEventsInsteadOfInsetsFallback() {
    WindowInsetsAnimationCompat animation = new WindowInsetsAnimationCompat(WindowInsetsCompat.Type.ime(), null, 200);
    callback.onPrepare(animation);
    apply(300, true);
    drain();
    assertTrue(EventSink.events.isEmpty());
    callback.onStart(animation, new WindowInsetsAnimationCompat.BoundsCompat(Insets.NONE, Insets.of(0, 0, 0, 324)));
    // Start is intentionally deferred until progress, avoiding synchronous Fabric mutation in onStart.
    assertTrue(EventSink.events.isEmpty());
    callback.onProgress(current(), List.of(animation));
    callback.onEnd(animation);
    assertTransition(300, 1);
    clearEvents();
    apply(300, true);
    drain();
    assertTrue(EventSink.events.isEmpty());
  }

  private void apply(int overlap, boolean visible) {
    view.insets = new WindowInsets.Builder()
        .setInsets(WindowInsets.Type.navigationBars(), android.graphics.Insets.of(0, 0, 0, 24))
        .setInsets(WindowInsets.Type.ime(), android.graphics.Insets.of(0, 0, 0, visible ? overlap + 24 : 0))
        .setVisible(WindowInsets.Type.ime(), visible).build();
    callback.onApplyWindowInsets(view, current());
  }

  private WindowInsetsCompat current() { return WindowInsetsCompat.toWindowInsetsCompat(view.insets); }
  private static void drain() { Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(32)); }
  private static void clearEvents() { EventSink.events.clear(); EventSink.notifications.clear(); }

  private static void assertTransition(int pixels, int progress) {
    assertEquals(List.of("topKeyboardMoveStart", "topKeyboardMove", "topKeyboardMoveEnd"),
        EventSink.events.stream().map(Event::getEventName).toList());
    double height = pixels / (double) android.content.res.Resources.getSystem().getDisplayMetrics().density;
    for (Event<?> event : EventSink.events) {
      WritableMap data = ReflectionHelpers.callInstanceMethod(event, "getEventData");
      assertEquals(height, data.getDouble("height"), 0.001);
      assertEquals(progress, data.getDouble("progress"), 0.001);
    }
  }

  private static final class InsetsView extends View {
    WindowInsets insets = new WindowInsets.Builder().build();
    InsetsView() { super(RuntimeEnvironment.getApplication()); }
    @Override public WindowInsets getRootWindowInsets() { return insets; }
  }

  // Substitute only the JNI/JS delivery boundary; callbacks and their event payloads are real.
  @Implements(className = "com.reactnativekeyboardcontroller.extensions.ThemedReactContextKt", isInAndroidSdk = false)
  public static class EventSink {
    static final List<Event<?>> events = new ArrayList<>();
    static final List<String> notifications = new ArrayList<>();
    @Implementation protected static void dispatchEvent(ThemedReactContext context, int id, Event<?> event) {
      if (event.getEventName().startsWith("topKeyboardMove")) events.add(event);
    }
    @Implementation protected static void emitEvent(ThemedReactContext context, String name, WritableMap data) { notifications.add(name); }
    @Implementation protected static void keepShadowNodesInSync(ThemedReactContext context, int id) {}
    @Implementation protected static String getAppearance(ThemedReactContext context) { return "light"; }
  }

  @Implements(Arguments.class)
  public static class Maps {
    @Implementation protected static WritableMap createMap() { return new JavaOnlyMap(); }
    @Implementation protected static WritableArray createArray() { return new JavaOnlyArray(); }
  }
}
