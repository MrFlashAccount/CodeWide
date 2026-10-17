package dev.codewide.app.remote

import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode

/**
 * Device acceptance of interest-filtered delivery (docs/companion-sync-interest.md):
 * every delivery continues the stored cursor through `afterCursor`, an
 * `advance` closes a filtered run without a journal row, and the interest set
 * is persisted before it reaches the wire.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], manifest = Config.NONE)
@LooperMode(LooperMode.Mode.PAUSED)
class NativeInterestAcceptanceTest {
  private class Fixture(val connectionId: String) {
    val frames = mutableListOf<JSONObject>()
    val resets = mutableListOf<String>()
    val handler = Handler(Looper.getMainLooper())
    val store = NativeFrameStore(RuntimeEnvironment.getApplication())
    val engine = NativeProtocolEngine(connectionId, store, handler, handler,
      sendFrame = { payload -> frames.add(JSONObject(payload)); true },
      resetTransport = resets::add, onLive = {}, onPortInventory = {}, telemetry = NativeTelemetryRecorder {})

    fun open(head: Long) {
      engine.onSocketOpen()
      engine.onFrame("""{"type":"hello","headCursor":$head,"snapshotRequired":false}""")
      engine.onFrame("""{"type":"status","status":"live"}""")
    }

    fun snapshotAt(cursor: Long) {
      store.storeSnapshot(connectionId, cursor, "[]")
    }

    fun event(cursor: Long, afterCursor: Long?) {
      val frame = JSONObject().put("type", "event").put("cursor", cursor)
        .put("payload", JSONObject().put("method", "turn/started")
          .put("params", JSONObject().put("threadId", "thread")))
      afterCursor?.let { frame.put("afterCursor", it) }
      engine.onFrame(frame.toString())
    }

    fun advance(cursor: Long, afterCursor: Long?) {
      val frame = JSONObject().put("type", "advance").put("cursor", cursor)
      afterCursor?.let { frame.put("afterCursor", it) }
      engine.onFrame(frame.toString())
    }

    fun caughtUp(cursor: Long) {
      engine.onFrame("""{"type":"caughtUp","cursor":$cursor}""")
    }

    fun journalCursors(): List<Long> = store.committedFrames(connectionId, null, 100, 1_000_000).frames.map { it.cursor }

    fun sent(type: String): List<JSONObject> = frames.filter { it.optString("type") == type }
  }

  @Test fun eventsWithGapsChainedByAfterCursorAndATrailingAdvanceAreAccepted() {
    val test = Fixture("interest-chain")
    try {
      test.snapshotAt(10)
      test.open(head = 20)
      test.event(12, afterCursor = 10)
      test.event(15, afterCursor = 12)
      test.advance(20, afterCursor = 15)
      test.caughtUp(20)

      assertTrue(test.resets.isEmpty())
      assertEquals(listOf(12L, 15L), test.journalCursors())
      assertEquals(20L, test.store.syncCursor(test.connectionId))
      assertEquals(20L, test.sent("ack").last().getLong("cursor"))
      val page = test.store.committedFrames(test.connectionId, 15, 100, 1_000_000)
      assertTrue("an advance owns no journal row", page.frames.isEmpty())
      assertEquals("the head moved past the skipped range", 20L, page.headCursor)
    } finally {
      test.engine.close()
    }
  }

  @Test fun duplicatesAreSkippedWithoutBreakingTheChain() {
    val test = Fixture("interest-duplicates")
    try {
      test.snapshotAt(10)
      test.open(head = 14)
      test.event(12, afterCursor = 10)
      test.event(12, afterCursor = 10)
      test.event(14, afterCursor = 12)
      test.engine.onSocketClosed()

      assertTrue(test.resets.isEmpty())
      assertEquals(listOf(12L, 14L), test.journalCursors())
    } finally {
      test.engine.close()
    }
  }

  @Test fun aRealChainBreakResetsTheTransport() {
    val test = Fixture("interest-break")
    try {
      test.snapshotAt(10)
      test.open(head = 15)
      test.event(12, afterCursor = 10)
      test.event(15, afterCursor = 13)
      test.engine.onSocketClosed()

      assertEquals(listOf("non_contiguous_sync_cursor"), test.resets)
      // The breaking frame is never committed. Whether event 12, which
      // continued the chain from 10, was committed first depends on batching.
      val cursor = test.store.syncCursor(test.connectionId)
      assertTrue("cursor $cursor is not chain-valid", cursor == 10L || cursor == 12L)
    } finally {
      test.engine.close()
    }
  }

  @Test fun anAdvanceThatDoesNotContinueTheStoredCursorResetsTheTransport() {
    val test = Fixture("interest-advance-break")
    try {
      test.snapshotAt(10)
      test.open(head = 20)
      test.advance(20, afterCursor = 11)
      test.engine.onSocketClosed()

      assertEquals(listOf("non_contiguous_sync_cursor"), test.resets)
      assertEquals(10L, test.store.syncCursor(test.connectionId))
    } finally {
      test.engine.close()
    }
  }

  @Test fun deliveriesWithoutAfterCursorAreInvalid() {
    val test = Fixture("interest-missing")
    try {
      test.snapshotAt(10)
      test.open(head = 12)
      test.event(11, afterCursor = null)
      test.advance(12, afterCursor = null)
      test.event(11, afterCursor = 11)

      assertEquals(listOf("invalid_event", "invalid_advance", "invalid_event"), test.resets)
      test.engine.onSocketClosed()
      assertTrue(test.journalCursors().isEmpty())
    } finally {
      test.engine.close()
    }
  }

  @Test fun helloDeclaresThePersistedInterestAndChangesSendOnlyTheDifference() {
    val test = Fixture("interest-wire")
    try {
      test.engine.replaceInterest(listOf("a", "b"))
      assertTrue("a closed socket only persists", test.sent("interest").isEmpty())

      test.open(head = 0)
      assertEquals(listOf("a", "b"), test.sent("hello").single().getJSONArray("interest").strings())

      test.engine.replaceInterest(listOf("b", "c"))
      val change = test.sent("interest").single()
      assertEquals(listOf("c"), change.getJSONArray("add").strings())
      assertEquals(listOf("a"), change.getJSONArray("remove").strings())
      assertEquals(listOf("b", "c"), test.store.interest(test.connectionId))

      test.engine.replaceInterest(listOf("c", "b"))
      assertEquals("an unchanged set sends nothing", 1, test.sent("interest").size)

      test.engine.onSocketClosed()
      test.open(head = 0)
      assertEquals(listOf("b", "c"), test.sent("hello").last().getJSONArray("interest").strings())
    } finally {
      test.engine.close()
    }
  }

  @Test fun anEmptyStoreDeclaresAnEmptyInterestAndOversizedSetsAreRejectedLocally() {
    val test = Fixture("interest-limits")
    try {
      test.open(head = 0)
      assertEquals(0, test.sent("hello").single().getJSONArray("interest").length())

      assertThrows(IllegalArgumentException::class.java) {
        test.engine.replaceInterest((0..64).map { "thread-$it" })
      }
      assertThrows(IllegalArgumentException::class.java) {
        test.engine.replaceInterest(listOf("x".repeat(257)))
      }
      assertTrue(test.sent("interest").isEmpty())
      assertTrue(test.store.interest(test.connectionId).isEmpty())
    } finally {
      test.engine.close()
    }
  }

  @Test fun aSessionlessDeclarationIsValidatedByTheSameOwnerAndKeepsThePersistedSet() {
    val test = Fixture("interest-sessionless")
    try {
      NativeSyncInterest.storeWithoutSession(test.store, test.connectionId, listOf("a", "a", "b"))
      assertEquals(listOf("a", "b"), test.store.interest(test.connectionId))

      val overLimit = List(NativeSyncInterest.MAX_INTEREST_THREADS + 1) { "a" }
      val tooLong = listOf("x".repeat(NativeSyncInterest.MAX_INTEREST_THREAD_ID_CHARS + 1))
      for (invalid in listOf(overLimit, tooLong, listOf(""))) {
        assertThrows(IllegalArgumentException::class.java) {
          NativeSyncInterest.storeWithoutSession(test.store, test.connectionId, invalid)
        }
      }
      assertEquals("a rejected set leaves the persisted one", listOf("a", "b"), test.store.interest(test.connectionId))

      test.open(head = 0)
      assertEquals(listOf("a", "b"), test.sent("hello").single().getJSONArray("interest").strings())
    } finally {
      test.engine.close()
    }
  }

  private fun JSONArray.strings(): List<String> = (0 until length()).map(::getString)
}
