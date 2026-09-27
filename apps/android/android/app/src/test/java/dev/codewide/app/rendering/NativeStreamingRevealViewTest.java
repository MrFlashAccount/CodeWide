package dev.codewide.app.rendering;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import android.animation.ValueAnimator;
import android.app.Activity;
import android.content.Context;
import android.graphics.Color;
import android.os.Looper;
import android.text.Layout;
import android.text.Selection;
import android.text.Spannable;
import android.text.SpannableString;
import android.text.Spanned;
import android.text.style.CharacterStyle;
import android.text.style.ForegroundColorSpan;
import android.text.style.URLSpan;
import android.view.View;
import android.widget.FrameLayout;
import android.widget.TextView;
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlags;
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsLocalAccessor;
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android;
import com.facebook.react.views.text.ReactTextView;
import java.time.Duration;
import java.util.Set;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.annotation.Config;
import org.robolectric.util.ReflectionHelpers;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {35}, manifest = Config.NONE)
public class NativeStreamingRevealViewTest {
  private final ActivityController<Activity> controller =
      Robolectric.buildActivity(Activity.class).setup().visible();
  private final Activity activity = controller.get();
  private NativeStreamingRevealView surface;
  private CountingDocument document;
  private ReactTextView text;
  private Object previousFlags;

  @Before public void setUp() {
    // RN exposes this JVM test accessor to Java, not Kotlin callers. Use its shipped
    // flag values without loading the device JNI implementation, as in text layout tests.
    ReactNativeFeatureFlagsLocalAccessor flags = new ReactNativeFeatureFlagsLocalAccessor();
    flags.override(new ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android());
    previousFlags = ReflectionHelpers.getStaticField(ReactNativeFeatureFlags.class, "accessor");
    ReflectionHelpers.setStaticField(ReactNativeFeatureFlags.class, "accessor", flags);
    surface = new NativeStreamingRevealView(activity);
    surface.setStreamKey("answer");
    document = new CountingDocument(activity);
    text = new ReactTextView(activity);
    text.setTextIsSelectable(true);
    document.addView(text);
    surface.addView(document);
    activity.setContentView(surface);
    // The bare Activity fixture has no system app-visibility event. Deliver that input
    // to the real ViewRoot before sampling native paint; do not bypass the view's guard.
    ReflectionHelpers.callInstanceMethod(activity.getWindow().getDecorView().getParent(),
        "handleAppVisibility", ReflectionHelpers.ClassParameter.from(boolean.class, true));
    Shadows.shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(32));
  }

  @After public void tearDown() {
    controller.pause().stop().destroy();
    ReflectionHelpers.setStaticField(ReactNativeFeatureFlags.class, "accessor", previousFlags);
  }

  @Test public void completionRetainsTextLayoutSelectionAndLinksWithoutFurtherTraversal() {
    assertSettledContent(() -> surface.setAnimateNew(false));
  }

  @Test public void reducedMotionRetainsTextLayoutSelectionAndLinksWithoutFurtherTraversal() {
    assertSettledContent(() -> surface.setReduceMotion(true));
  }

  private void assertSettledContent(Runnable stopAnimation) {
    assertTrue("The native fixture must be visible", surface.isShown());
    assertTrue("The native fixture must be attached", surface.isAttachedToWindow());
    assertEquals(View.VISIBLE, surface.getWindowVisibility());
    assertTrue("The native fixture must allow animator paint", ValueAnimator.areAnimatorsEnabled());
    text.setText("Read more");
    layoutText();
    int readsBeforeLiveFrame = document.childReads;
    surface.onPreDraw();
    assertTrue("The live control must traverse the document", document.childReads > readsBeforeLiveFrame);

    URLSpan link = new URLSpan("https://example.test/docs");
    ForegroundColorSpan color = new ForegroundColorSpan(Color.GREEN);
    String source = "Read more about the final answer";
    SpannableString content = new SpannableString(source);
    content.setSpan(link, 0, 9, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
    content.setSpan(color, 10, source.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
    text.setText(content, TextView.BufferType.SPANNABLE);
    layoutText();
    surface.onPreDraw();
    layoutText();

    if (!(text.getText() instanceof Spannable displayed)) {
      throw new AssertionError("Selectable rendered text must remain Spannable");
    }
    assertTrue("The live suffix must have active reveal paint",
        displayed.getSpans(0, displayed.length(), CharacterStyle.class).length > 2);
    Selection.setSelection(displayed, 0, 9);
    Layout layout = text.getLayout();
    assertNotNull(layout);
    int readsBeforeCompletion = document.childReads;

    stopAnimation.run();
    for (int frame = 0; frame < 3; frame++) surface.onPreDraw();

    assertSame(displayed, text.getText());
    assertSame(layout, text.getLayout());
    assertEquals(source, text.getText().toString());
    assertEquals(0, Selection.getSelectionStart(displayed));
    assertEquals(9, Selection.getSelectionEnd(displayed));
    assertEquals(Set.of(link, color),
        Set.of(displayed.getSpans(0, displayed.length(), CharacterStyle.class)));
    assertEquals(0, displayed.getSpanStart(link));
    assertEquals(9, displayed.getSpanEnd(link));
    assertEquals(10, displayed.getSpanStart(color));
    assertEquals(source.length(), displayed.getSpanEnd(color));
    assertEquals(readsBeforeCompletion, document.childReads);
  }

  private void layoutText() {
    text.measure(View.MeasureSpec.makeMeasureSpec(400, View.MeasureSpec.EXACTLY),
        View.MeasureSpec.makeMeasureSpec(200, View.MeasureSpec.AT_MOST));
    text.layout(0, 0, text.getMeasuredWidth(), text.getMeasuredHeight());
  }

  private static class CountingDocument extends FrameLayout {
    private int childReads = 0;

    private CountingDocument(Context context) { super(context); }

    @Override public View getChildAt(int index) {
      childReads += 1;
      return super.getChildAt(index);
    }
  }
}
