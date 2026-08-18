package dev.codewide.app.rendering

import org.junit.Assert.assertEquals
import org.junit.Test

class NativeDiffProjectionTest {
  @Test
  fun projectsOldAndNewLineNumbersAcrossAUnifiedHunk() {
    val projection = NativeDiffProjector.project(
      "@@ -10,3 +20,4 @@\n context\n-removed\n+added\n+another\n tail",
    )

    assertEquals(
      listOf(
        Triple(10, 20, NativeDiffLineKind.CONTEXT),
        Triple(11, null, NativeDiffLineKind.DELETION),
        Triple(null, 21, NativeDiffLineKind.ADDITION),
        Triple(null, 22, NativeDiffLineKind.ADDITION),
        Triple(12, 23, NativeDiffLineKind.CONTEXT),
      ),
      projection.lines.map { Triple(it.oldLine, it.newLine, it.kind) },
    )
    assertEquals("context\nremoved\nadded\nanother\ntail", projection.code)
    assertEquals("10 20  \n11    −\n   21 +\n   22 +\n12 23  ", projection.gutter)
  }

  @Test
  fun keepsFileHeadersOutOfTheLineNumberSequence() {
    val projection = NativeDiffProjector.project(
      "diff --git a/a.ts b/a.ts\nindex 123..456 100644\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new",
    )

    assertEquals(
      listOf(NativeDiffLineKind.DELETION, NativeDiffLineKind.ADDITION),
      projection.lines.map { it.kind },
    )
    assertEquals("old\nnew", projection.code)
    assertEquals(1, projection.lines[0].oldLine)
    assertEquals(1, projection.lines[1].newLine)
  }

  @Test
  fun keepsCodeThatLooksLikeAFileHeaderInsideAHunk() {
    val projection = NativeDiffProjector.project(
      "@@ -1 +1 @@\n--- actual deleted code\n+++ actual added code",
    )

    assertEquals("-- actual deleted code\n++ actual added code", projection.code)
    assertEquals(
      listOf(NativeDiffLineKind.DELETION, NativeDiffLineKind.ADDITION),
      projection.lines.map { it.kind },
    )
  }

  @Test
  fun synthesizesAHunkAfterExistingFileHeaders() {
    val projection = NativeDiffProjector.project(
      "--- a/component.tsx\n+++ b/component.tsx\n-old\n+new",
    )

    assertEquals("old\nnew", projection.code)
    assertEquals(
      listOf(NativeDiffLineKind.DELETION, NativeDiffLineKind.ADDITION),
      projection.lines.map { it.kind },
    )
  }

  @Test
  fun preservesCodeCharactersInsteadOfHtmlEscapingThem() {
    val projection = NativeDiffProjector.project(
      "@@ -1 +1 @@\n-const oldView = <Old />;\n+const newView = <New />;",
    )

    assertEquals("const oldView = <Old />;\nconst newView = <New />;", projection.code)
  }
}
