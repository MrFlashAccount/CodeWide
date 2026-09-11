package dev.codewide.app.rendering

import android.text.style.UpdateLayout
import com.swmansion.enriched.markdown.input.spans.InputCodeBlockSpan
import org.junit.Assert.assertTrue
import org.junit.Test

class ComposerCodeBlockSpanTest {
  @Test fun codeBlockMetricsNotifyAnExistingEditableLayoutWithoutAnotherKeystroke() {
    // Android DynamicLayout only reflows added/removed/changed spans that implement
    // UpdateLayout. This framework contract must hold before the next text edit;
    // otherwise a newly inserted block retains its old one-line height until Enter.
    assertTrue(
      "Code block spacing must invalidate the existing Android text layout",
      UpdateLayout::class.java.isAssignableFrom(InputCodeBlockSpan::class.java),
    )
  }
}
