package dev.codewide.app.remote

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProjectionCursorPolicyTest {
  @Test
  fun acceptsOnlyForwardCursorsAlreadyOwnedByTheNativeJournal() {
    assertTrue(ProjectionCursorPolicy.accepts(nativeCursor = 12, previousProjection = null, candidate = 10))
    assertTrue(ProjectionCursorPolicy.accepts(nativeCursor = 12, previousProjection = 10, candidate = 12))
    assertFalse(ProjectionCursorPolicy.accepts(nativeCursor = 12, previousProjection = 10, candidate = 10))
    assertFalse(ProjectionCursorPolicy.accepts(nativeCursor = 12, previousProjection = 10, candidate = 9))
    assertFalse(ProjectionCursorPolicy.accepts(nativeCursor = 12, previousProjection = 10, candidate = 13))
  }
}
