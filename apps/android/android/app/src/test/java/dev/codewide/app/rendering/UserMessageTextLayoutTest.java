package dev.codewide.app.rendering;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.graphics.Typeface;
import android.text.Layout;
import android.text.Spannable;
import android.util.DisplayMetrics;
import android.view.ContextThemeWrapper;
import android.view.Gravity;
import android.view.View;
import com.facebook.react.common.assets.ReactFontManager;
import com.facebook.react.common.mapbuffer.WritableMapBuffer;
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlags;
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsLocalAccessor;
import com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android;
import com.facebook.react.uimanager.DisplayMetricsHolder;
import com.facebook.react.views.text.ReactTextUpdate;
import com.facebook.react.views.text.ReactTextView;
import com.facebook.react.views.text.TextAttributeProps;
import com.facebook.react.views.text.TextLayoutManager;
import com.facebook.yoga.YogaMeasureMode;
import com.facebook.yoga.YogaMeasureOutput;
import dev.codewide.app.R;
import java.io.File;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;
import org.robolectric.annotation.GraphicsMode;
import org.robolectric.annotation.Implementation;
import org.robolectric.annotation.Implements;
import org.robolectric.util.ReflectionHelpers;

/** Fabric's measured height must contain the text Android actually lays out. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = {34, 35}, shadows = UserMessageTextLayoutTest.Android15TextFlags.class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
public class UserMessageTextLayoutTest {
  // Robolectric's framework flag defaults differ from the shipping Android 15 image.
  // Enable its documented glyph-bound default; the real TextView still reads AppTheme
  // and chooses the actual measurement policy. Removing the theme fix must fail below.
  @Implements(className = "android.text.ClientFlags", isInAndroidSdk = false, minSdk = 35)
  public static class Android15TextFlags {
    @Implementation protected static boolean useBoundsForWidth() { return true; }
  }

  @Test public void shippedThemeKeepsEveryWordInsideMeasuredBubble() {
    // RN's stable flag values, without loading Android JNI into the desktop JVM.
    ReactNativeFeatureFlagsLocalAccessor flags = new ReactNativeFeatureFlagsLocalAccessor();
    flags.override(new ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android());
    ReflectionHelpers.setStaticField(ReactNativeFeatureFlags.class, "accessor", flags);
    Context context = new ContextThemeWrapper(RuntimeEnvironment.getApplication(), R.style.AppTheme);
    File fontFile = new File("../../assets/fonts/RobotoFlex-Regular.ttf");
    assertTrue(fontFile.getAbsolutePath(), fontFile.exists());
    // Expo Font registers this family in the asset cache, not addCustomFont's resource cache.
    ReactFontManager.getInstance().setTypeface(
        "RobotoFlex-Regular", Typeface.NORMAL, Typeface.createFromFile(fontFile));

    for (float density : new float[] {1f, 1.5f, 2f, 2.625f, 3f, 3.5f}) {
      for (float fontScale : new float[] {1f, 1.3f}) {
        DisplayMetrics metrics = new DisplayMetrics();
        metrics.setToDefaults();
        metrics.density = density;
        metrics.scaledDensity = density * fontScale;
        metrics.densityDpi = Math.round(160 * density);
        DisplayMetricsHolder.setWindowDisplayMetrics(metrics);
        DisplayMetricsHolder.setScreenDisplayMetrics(metrics);
        for (String source : new String[] {
            "Давай выкатим апк", "Давай выкатим", "Ship the APK", "Первая строка\nПоследнее слово"}) {
          assertTextFits(context, source, density, fontScale);
        }
      }
    }
  }

  private static void assertTextFits(Context context, String source, float density, float fontScale) {
    WritableMapBuffer attributes = new WritableMapBuffer()
        .put(TextAttributeProps.TA_KEY_FONT_FAMILY, "RobotoFlex-Regular")
        .put(TextAttributeProps.TA_KEY_FONT_SIZE, 14d)
        .put(TextAttributeProps.TA_KEY_FONT_WEIGHT, "400")
        .put(TextAttributeProps.TA_KEY_LINE_HEIGHT, 20d);
    WritableMapBuffer fragment = new WritableMapBuffer()
        .put(TextLayoutManager.FR_KEY_STRING, source)
        .put(TextLayoutManager.FR_KEY_REACT_TAG, 1)
        .put(TextLayoutManager.FR_KEY_TEXT_ATTRIBUTES, attributes);
    WritableMapBuffer attributed = new WritableMapBuffer()
        .put(TextLayoutManager.AS_KEY_STRING, source)
        .put(TextLayoutManager.AS_KEY_FRAGMENTS, new WritableMapBuffer().put(0, fragment))
        .put(TextLayoutManager.AS_KEY_BASE_ATTRIBUTES, attributes);
    WritableMapBuffer paragraph = new WritableMapBuffer()
        .put(TextLayoutManager.PA_KEY_TEXT_BREAK_STRATEGY, "highQuality")
        .put(TextLayoutManager.PA_KEY_INCLUDE_FONT_PADDING, true)
        .put(TextLayoutManager.PA_KEY_HYPHENATION_FREQUENCY, "none");
    Spannable text = TextLayoutManager.INSTANCE.getOrCreateSpannableForText(
        context.getAssets(), attributed, null);
    // Include tight widths around the reported phrase as well as multi-line and wide bubbles.
    for (int available = 90; available <= 210; available++) {
      long measured = TextLayoutManager.measureText(context.getAssets(), attributed, paragraph,
          available * density, YogaMeasureMode.AT_MOST, 1000 * density,
          YogaMeasureMode.AT_MOST, null, null);
      int width = Math.round(YogaMeasureOutput.getWidth(measured) * density);
      int height = Math.round(YogaMeasureOutput.getHeight(measured) * density);
      ReactTextView view = new ReactTextView(context);
      view.setPadding(0, 0, 0, 0);
      view.setFontSize(14f);
      view.setTextIsSelectable(true);
      view.setText(new ReactTextUpdate(text, -1, Gravity.START,
          Layout.BREAK_STRATEGY_HIGH_QUALITY, Layout.JUSTIFICATION_MODE_NONE));
      view.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
          View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.EXACTLY));
      view.layout(0, 0, width, height);
      Layout layout = view.getLayout();
      assertNotNull(layout);
      assertEquals(source, view.getText().toString());
      assertEquals(source.length(), layout.getLineEnd(layout.getLineCount() - 1));
      assertTrue("density=" + density + " scale=" + fontScale + " available=" + available
          + " measuredHeight=" + height + " drawnHeight=" + layout.getHeight(),
          layout.getLineBottom(layout.getLineCount() - 1) <= height);
    }
  }
}
