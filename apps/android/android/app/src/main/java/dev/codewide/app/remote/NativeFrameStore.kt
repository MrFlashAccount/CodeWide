package dev.codewide.app.remote

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

internal data class StoredFrame(val id: Long, val cursor: Long, val payload: String)
internal data class IncomingJournalFrame(
  val cursor: Long,
  val payload: String,
  val pendingRequestPayload: JSONObject?,
)
internal enum class JournalAppendStatus { COMMITTED, NON_CONTIGUOUS, OVERFLOW }
internal data class JournalAppendResult(
  val status: JournalAppendStatus,
  val frames: List<StoredFrame>,
  val acknowledgedCursor: Long?,
)
internal data class CommittedFramePage(
  val baseCursor: Long?,
  val headCursor: Long?,
  val frames: List<StoredFrame>,
)
private data class JournalState(val cursor: Long?, val frameCount: Long, val payloadBytes: Long)
private data class JournalTotals(val frameCount: Long, val payloadBytes: Long)
internal data class NativeFrameStorageStats(
  val frameCount: Long,
  val payloadBytes: Long,
  val mainFileBytes: Long,
  val walFileBytes: Long,
  val shmFileBytes: Long,
)
internal data class NativeProjectionCheckpoint(
  val snapshotCursor: Long?,
  val snapshotJson: String?,
  val pendingRequestsJson: String,
  val journalHeadCursor: Long?,
)

internal class NativeFrameStore(context: Context) {
  private val database: SQLiteDatabase

  init {
    DerivedStorageCleanup.purgeLegacyFrameStore(context)
    val databaseFile = File(context.cacheDir, "codex-remote/transport/codex-remote-frames.db")
    databaseFile.parentFile?.mkdirs()
    database = SQLiteDatabase.openOrCreateDatabase(databaseFile, null)
    database.enableWriteAheadLogging()
    database.rawQuery("PRAGMA busy_timeout = 5000", null).use { it.moveToFirst() }
    database.execSQL(
      """
      CREATE TABLE IF NOT EXISTS native_frames (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        connection_id TEXT NOT NULL,
        event_cursor INTEGER,
        payload TEXT NOT NULL,
        payload_bytes INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
      """.trimIndent(),
    )
    ensureColumn("native_frames", "event_cursor", "INTEGER")
    database.execSQL("CREATE INDEX IF NOT EXISTS native_frames_connection ON native_frames(connection_id, id)")
    database.execSQL("CREATE INDEX IF NOT EXISTS native_frames_cursor ON native_frames(connection_id, event_cursor)")
    database.execSQL(
      """
      CREATE TABLE IF NOT EXISTS native_sync_state (
        connection_id TEXT PRIMARY KEY NOT NULL,
        cursor INTEGER,
        snapshot_cursor INTEGER,
        snapshot_json TEXT,
        pending_requests_json TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL
      )
      """.trimIndent(),
    )
    ensureColumn("native_sync_state", "snapshot_cursor", "INTEGER")
    ensureColumn("native_sync_state", "projected_cursor", "INTEGER")
    ensureColumn("native_sync_state", "journal_frames", "INTEGER NOT NULL DEFAULT 0")
    ensureColumn("native_sync_state", "journal_bytes", "INTEGER NOT NULL DEFAULT 0")
    database.execSQL(
      "UPDATE native_sync_state SET snapshot_cursor = cursor WHERE snapshot_cursor IS NULL AND snapshot_json IS NOT NULL",
    )
    database.execSQL(
      "CREATE TABLE IF NOT EXISTS native_store_metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)",
    )
    database.execSQL(
      "CREATE TABLE IF NOT EXISTS native_journal_totals (singleton INTEGER PRIMARY KEY CHECK(singleton = 1), frame_count INTEGER NOT NULL, payload_bytes INTEGER NOT NULL)",
    )
    database.execSQL("INSERT OR IGNORE INTO native_journal_totals(singleton, frame_count, payload_bytes) VALUES (1, 0, 0)")
    val storedSchema = database.rawQuery(
      "SELECT value FROM native_store_metadata WHERE key = 'projection_schema'",
      null,
    ).use { row -> if (row.moveToFirst()) row.getString(0).toIntOrNull() else null }
    if (storedSchema != PROJECTION_SCHEMA_VERSION) {
      database.beginTransaction()
      try {
        // Disposable transport projections, not canonical user data. A v1
        // frame may contain megabytes and must never re-enter Hermes after an
        // upgrade merely because its cursor still matches.
        database.delete("native_frames", null, null)
        database.delete("native_sync_state", null, null)
        database.execSQL("UPDATE native_journal_totals SET frame_count = 0, payload_bytes = 0 WHERE singleton = 1")
        database.execSQL(
          "INSERT OR REPLACE INTO native_store_metadata(key, value) VALUES ('projection_schema', ?)",
          arrayOf(PROJECTION_SCHEMA_VERSION.toString()),
        )
        database.setTransactionSuccessful()
      } finally {
        database.endTransaction()
      }
    }
    rebuildJournalCounters()
  }

  @Synchronized
  fun appendEvents(connectionId: String, incoming: List<IncomingJournalFrame>): JournalAppendResult {
    if (incoming.isEmpty()) return JournalAppendResult(JournalAppendStatus.COMMITTED, emptyList(), null)
    database.beginTransaction()
    try {
      val state = journalState(connectionId)
      var cursor = state.cursor
      val fresh = mutableListOf<IncomingJournalFrame>()
      for (frame in incoming) {
        if (cursor != null && frame.cursor <= cursor) continue
        if (cursor != null && frame.cursor != cursor + 1L) {
          return JournalAppendResult(JournalAppendStatus.NON_CONTIGUOUS, emptyList(), null)
        }
        fresh += frame
        cursor = frame.cursor
      }
      if (fresh.isEmpty()) {
        database.setTransactionSuccessful()
        return JournalAppendResult(JournalAppendStatus.COMMITTED, emptyList(), incoming.maxOf { it.cursor })
      }

      val payloadBytes = fresh.sumOf { it.payload.toByteArray(Charsets.UTF_8).size.toLong() }
      val totals = journalTotals()
      if (
        state.frameCount + fresh.size > MAX_FRAMES
        || state.payloadBytes + payloadBytes > MAX_BYTES
        || totals.frameCount + fresh.size > MAX_TOTAL_FRAMES
        || totals.payloadBytes + payloadBytes > MAX_TOTAL_BYTES
      ) {
        resetJournal(connectionId, state.frameCount, state.payloadBytes)
        database.setTransactionSuccessful()
        return JournalAppendResult(JournalAppendStatus.OVERFLOW, emptyList(), null)
      }

      val now = System.currentTimeMillis()
      val stored = fresh.map { frame ->
        val values = ContentValues().apply {
          put("connection_id", connectionId)
          put("event_cursor", frame.cursor)
          put("payload", frame.payload)
          put("payload_bytes", frame.payload.toByteArray(Charsets.UTF_8).size)
          put("created_at", now)
        }
        StoredFrame(database.insertOrThrow("native_frames", null, values), frame.cursor, frame.payload)
      }
      database.execSQL(
        """
        INSERT INTO native_sync_state(connection_id, cursor, journal_frames, journal_bytes, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(connection_id) DO UPDATE SET
          cursor = excluded.cursor,
          journal_frames = native_sync_state.journal_frames + excluded.journal_frames,
          journal_bytes = native_sync_state.journal_bytes + excluded.journal_bytes,
          updated_at = excluded.updated_at
        """.trimIndent(),
        arrayOf<Any?>(connectionId, fresh.last().cursor, fresh.size, payloadBytes, now),
      )
      database.execSQL(
        "UPDATE native_journal_totals SET frame_count = frame_count + ?, payload_bytes = payload_bytes + ? WHERE singleton = 1",
        arrayOf<Any?>(fresh.size, payloadBytes),
      )
      applyPendingRequestEvents(connectionId, fresh.mapNotNull { it.pendingRequestPayload })
      database.setTransactionSuccessful()
      return JournalAppendResult(JournalAppendStatus.COMMITTED, stored, incoming.maxOf { it.cursor })
    } finally {
      database.endTransaction()
    }
  }

  @Synchronized
  fun syncCursor(connectionId: String): Long? = nativeCursor(connectionId)

  @Synchronized
  fun storageStats(): NativeFrameStorageStats {
    val totals = journalTotals()
    val main = File(database.path)
    return NativeFrameStorageStats(
      frameCount = totals.frameCount,
      payloadBytes = totals.payloadBytes,
      mainFileBytes = main.length(),
      walFileBytes = File(main.path + "-wal").length(),
      shmFileBytes = File(main.path + "-shm").length(),
    )
  }

  @Synchronized
  fun storeSnapshot(connectionId: String, cursor: Long, snapshotJson: String) {
    database.beginTransaction()
    try {
      val journal = journalState(connectionId)
      database.delete("native_frames", "connection_id = ?", arrayOf(connectionId))
      decrementTotals(journal.frameCount, journal.payloadBytes)
      database.execSQL(
        """
        INSERT INTO native_sync_state(connection_id, cursor, snapshot_cursor, snapshot_json, journal_frames, journal_bytes, updated_at)
        VALUES (?, ?, ?, ?, 0, 0, ?)
        ON CONFLICT(connection_id) DO UPDATE SET
          cursor = excluded.cursor,
          snapshot_cursor = excluded.snapshot_cursor,
          projected_cursor = NULL,
          snapshot_json = excluded.snapshot_json,
          journal_frames = 0,
          journal_bytes = 0,
          updated_at = excluded.updated_at
        """.trimIndent(),
        arrayOf<Any?>(connectionId, cursor, cursor, snapshotJson, System.currentTimeMillis()),
      )
      database.setTransactionSuccessful()
    } finally {
      database.endTransaction()
    }
  }

  @Synchronized
  fun storePendingRequests(connectionId: String, pendingRequestsJson: String) {
    database.execSQL(
      """
      INSERT INTO native_sync_state(connection_id, pending_requests_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(connection_id) DO UPDATE SET
        pending_requests_json = excluded.pending_requests_json,
        updated_at = excluded.updated_at
      """.trimIndent(),
      arrayOf<Any?>(connectionId, pendingRequestsJson, System.currentTimeMillis()),
    )
  }

  @Synchronized
  fun pendingRequestsJson(connectionId: String): String = database.rawQuery(
    "SELECT pending_requests_json FROM native_sync_state WHERE connection_id = ?",
    arrayOf(connectionId),
  ).use { row ->
    if (!row.moveToFirst() || row.isNull(0)) "[]" else row.getString(0)
  }

  @Synchronized
  fun checkpoint(connectionId: String): NativeProjectionCheckpoint {
    var currentCursor: Long? = null
    var snapshotCursor: Long? = null
    var projectedCursor: Long? = null
    var snapshotJson: String? = null
    var pendingRequestsJson = "[]"
    database.rawQuery(
      "SELECT cursor, snapshot_cursor, projected_cursor, snapshot_json, pending_requests_json FROM native_sync_state WHERE connection_id = ?",
      arrayOf(connectionId),
    ).use { row ->
      if (row.moveToFirst()) {
        currentCursor = if (row.isNull(0)) null else row.getLong(0)
        snapshotCursor = if (row.isNull(1)) null else row.getLong(1)
        projectedCursor = if (row.isNull(2)) null else row.getLong(2)
        snapshotJson = if (row.isNull(3)) null else row.getString(3)
        pendingRequestsJson = row.getString(4)
      }
    }
    if (projectedCursor == null && snapshotCursor == null) {
      return NativeProjectionCheckpoint(null, null, pendingRequestsJson, null)
    }
    if (projectedCursor != null && currentCursor != null && projectedCursor >= currentCursor!!) {
      return NativeProjectionCheckpoint(null, null, pendingRequestsJson, null)
    }
    if (projectedCursor != null && snapshotCursor != null && projectedCursor >= snapshotCursor!!) {
      return NativeProjectionCheckpoint(null, null, pendingRequestsJson, currentCursor)
    }
    return NativeProjectionCheckpoint(snapshotCursor, snapshotJson, pendingRequestsJson, currentCursor?.takeIf { snapshotCursor == null || it > snapshotCursor!! })
  }

  @Synchronized
  fun acknowledgeThrough(connectionId: String, projectionCursor: Long) {
    database.beginTransaction()
    try {
      val state = database.rawQuery(
        "SELECT cursor, projected_cursor FROM native_sync_state WHERE connection_id = ?",
        arrayOf(connectionId),
      ).use { row ->
        if (!row.moveToFirst() || row.isNull(0)) null
        else row.getLong(0) to if (row.isNull(1)) null else row.getLong(1)
      } ?: return
      val (nativeCursor, previousProjection) = state
      if (!ProjectionCursorPolicy.accepts(nativeCursor, previousProjection, projectionCursor)) return
      database.execSQL(
        "UPDATE native_sync_state SET projected_cursor = ?, updated_at = ? WHERE connection_id = ?",
        arrayOf<Any?>(projectionCursor, System.currentTimeMillis(), connectionId),
      )
      val removed = database.rawQuery(
        "SELECT COUNT(*), COALESCE(SUM(payload_bytes), 0) FROM native_frames WHERE connection_id = ? AND event_cursor <= ?",
        arrayOf(connectionId, projectionCursor.toString()),
      ).use { row ->
        row.moveToFirst()
        JournalTotals(row.getLong(0), row.getLong(1))
      }
      database.delete(
        "native_frames",
        "connection_id = ? AND event_cursor <= ?",
        arrayOf(connectionId, projectionCursor.toString()),
      )
      database.execSQL(
        "UPDATE native_sync_state SET journal_frames = MAX(0, journal_frames - ?), journal_bytes = MAX(0, journal_bytes - ?) WHERE connection_id = ?",
        arrayOf<Any?>(removed.frameCount, removed.payloadBytes, connectionId),
      )
      decrementTotals(removed.frameCount, removed.payloadBytes)
      database.setTransactionSuccessful()
    } finally {
      database.endTransaction()
    }
  }

  @Synchronized
  fun deleteConnection(connectionId: String) {
    database.beginTransaction()
    try {
      val journal = journalState(connectionId)
      database.delete("native_frames", "connection_id = ?", arrayOf(connectionId))
      database.delete("native_sync_state", "connection_id = ?", arrayOf(connectionId))
      decrementTotals(journal.frameCount, journal.payloadBytes)
      database.setTransactionSuccessful()
    } finally {
      database.endTransaction()
    }
  }

  @Synchronized
  fun committedFrames(
    connectionId: String,
    afterCursor: Long?,
    maxFrames: Int,
    maxBytes: Int,
  ): CommittedFramePage {
    val checkpointCursor = database.rawQuery(
      "SELECT cursor, snapshot_cursor, projected_cursor FROM native_sync_state WHERE connection_id = ?",
      arrayOf(connectionId),
    ).use { row ->
      if (!row.moveToFirst()) Triple<Long?, Long?, Long?>(null, null, null)
      else Triple(
        if (row.isNull(0)) null else row.getLong(0),
        if (row.isNull(1)) null else row.getLong(1),
        if (row.isNull(2)) null else row.getLong(2),
      )
    }
    val (headCursor, snapshotCursor, projectedCursor) = checkpointCursor
    val baseCursor = afterCursor ?: projectedCursor ?: snapshotCursor
    val frames = mutableListOf<StoredFrame>()
    var bytes = 0L
    val selection = if (baseCursor == null) "connection_id = ?" else "connection_id = ? AND event_cursor > ?"
    val args = if (baseCursor == null) arrayOf(connectionId, maxFrames.toString())
    else arrayOf(connectionId, baseCursor.toString(), maxFrames.toString())
    database.rawQuery(
      "SELECT id, event_cursor, payload, payload_bytes FROM native_frames WHERE $selection ORDER BY event_cursor LIMIT ?",
      args,
    ).use { row ->
      while (row.moveToNext()) {
        val frameBytes = row.getLong(3)
        if (frames.isNotEmpty() && bytes + frameBytes > maxBytes) break
        frames += StoredFrame(row.getLong(0), row.getLong(1), row.getString(2))
        bytes += frameBytes
      }
    }
    return CommittedFramePage(baseCursor, headCursor, frames)
  }

  private fun nativeCursor(connectionId: String): Long? = database.rawQuery(
    "SELECT cursor FROM native_sync_state WHERE connection_id = ?",
    arrayOf(connectionId),
  ).use { row ->
    if (!row.moveToFirst() || row.isNull(0)) null else row.getLong(0)
  }

  private fun journalState(connectionId: String): JournalState = database.rawQuery(
    "SELECT cursor, journal_frames, journal_bytes FROM native_sync_state WHERE connection_id = ?",
    arrayOf(connectionId),
  ).use { row ->
    if (!row.moveToFirst()) JournalState(null, 0, 0)
    else JournalState(if (row.isNull(0)) null else row.getLong(0), row.getLong(1), row.getLong(2))
  }

  private fun journalTotals(): JournalTotals = database.rawQuery(
    "SELECT frame_count, payload_bytes FROM native_journal_totals WHERE singleton = 1",
    null,
  ).use { row ->
    if (!row.moveToFirst()) JournalTotals(0, 0) else JournalTotals(row.getLong(0), row.getLong(1))
  }

  private fun decrementTotals(frameCount: Long, payloadBytes: Long) {
    if (frameCount == 0L && payloadBytes == 0L) return
    database.execSQL(
      "UPDATE native_journal_totals SET frame_count = MAX(0, frame_count - ?), payload_bytes = MAX(0, payload_bytes - ?) WHERE singleton = 1",
      arrayOf<Any?>(frameCount, payloadBytes),
    )
  }

  private fun rebuildJournalCounters() {
    database.beginTransaction()
    try {
      database.execSQL("UPDATE native_sync_state SET journal_frames = 0, journal_bytes = 0")
      database.rawQuery(
        "SELECT connection_id, COUNT(*), COALESCE(SUM(payload_bytes), 0) FROM native_frames GROUP BY connection_id",
        null,
      ).use { rows ->
        while (rows.moveToNext()) {
          database.execSQL(
            "UPDATE native_sync_state SET journal_frames = ?, journal_bytes = ? WHERE connection_id = ?",
            arrayOf<Any?>(rows.getLong(1), rows.getLong(2), rows.getString(0)),
          )
        }
      }
      val totals = database.rawQuery(
        "SELECT COUNT(*), COALESCE(SUM(payload_bytes), 0) FROM native_frames",
        null,
      ).use { rows ->
        rows.moveToFirst()
        JournalTotals(rows.getLong(0), rows.getLong(1))
      }
      database.execSQL(
        "UPDATE native_journal_totals SET frame_count = ?, payload_bytes = ? WHERE singleton = 1",
        arrayOf<Any?>(totals.frameCount, totals.payloadBytes),
      )
      database.setTransactionSuccessful()
    } finally {
      database.endTransaction()
    }
  }

  private fun resetJournal(connectionId: String, frameCount: Long, payloadBytes: Long) {
    database.delete("native_frames", "connection_id = ?", arrayOf(connectionId))
    database.execSQL(
      "UPDATE native_sync_state SET cursor = NULL, snapshot_cursor = NULL, projected_cursor = NULL, snapshot_json = NULL, journal_frames = 0, journal_bytes = 0, updated_at = ? WHERE connection_id = ?",
      arrayOf<Any?>(System.currentTimeMillis(), connectionId),
    )
    decrementTotals(frameCount, payloadBytes)
  }

  private fun ensureColumn(table: String, column: String, sqlType: String) {
    val exists = database.rawQuery("PRAGMA table_info($table)", null).use { rows ->
      var found = false
      while (rows.moveToNext()) {
        if (rows.getString(rows.getColumnIndexOrThrow("name")) == column) {
          found = true
          break
        }
      }
      found
    }
    if (!exists) database.execSQL("ALTER TABLE $table ADD COLUMN $column $sqlType")
  }

  private fun applyPendingRequestEvents(connectionId: String, payloads: List<JSONObject>) {
    if (payloads.isEmpty()) return
    val pending = runCatching { JSONArray(pendingRequestsJson(connectionId)) }.getOrElse { JSONArray() }
    payloads.forEach { payload ->
      val method = payload.optString("method")
      if (method == "serverRequest/resolved") {
        val requestId = payload.optJSONObject("params")?.opt("requestId") ?: return@forEach
        val key = requestKey(requestId)
        for (index in pending.length() - 1 downTo 0) {
          val request = pending.optJSONObject(index) ?: continue
          if (requestKey(request.opt("id")) == key) pending.remove(index)
        }
      } else {
        val requestId = payload.opt("id")
        val params = payload.optJSONObject("params")
        if (requestId == null || requestId === JSONObject.NULL || params == null) return@forEach
        val key = requestKey(requestId)
        var present = false
        for (index in 0 until pending.length()) {
          val request = pending.optJSONObject(index) ?: continue
          if (requestKey(request.opt("id")) == key) {
            present = true
            break
          }
        }
        if (!present) pending.put(JSONObject().put("id", requestId).put("method", method).put("params", params))
      }
    }
    database.execSQL(
      "UPDATE native_sync_state SET pending_requests_json = ?, updated_at = ? WHERE connection_id = ?",
      arrayOf<Any?>(pending.toString(), System.currentTimeMillis(), connectionId),
    )
  }

  private fun requestKey(value: Any?): String = when (value) {
    is Number -> "number:$value"
    else -> "string:${value.toString()}"
  }

  companion object {
    // Snapshot scope now includes every model provider. Invalidate the derived
    // cursor once so upgraded clients cannot keep a previously filtered catalog.
    // Keep the current schema generation. Catalog source selection does not
    // change the persisted row shape and must not force another cache reset.
    private const val PROJECTION_SCHEMA_VERSION = 5
    private const val MAX_FRAMES = 10_000L
    private const val MAX_BYTES = 64L * 1024L * 1024L
    private const val MAX_TOTAL_FRAMES = 50_000L
    private const val MAX_TOTAL_BYTES = 256L * 1024L * 1024L
    private val USER_SERVER_REQUESTS = setOf(
      "item/commandExecution/requestApproval",
      "item/fileChange/requestApproval",
      "item/tool/requestUserInput",
      "mcpServer/elicitation/request",
      "item/permissions/requestApproval",
    )

    fun changesPendingRequests(payload: JSONObject): Boolean {
      val method = payload.optString("method")
      return method == "serverRequest/resolved" || USER_SERVER_REQUESTS.contains(method)
    }
  }
}
