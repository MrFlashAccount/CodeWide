package dev.codewide.app.remote

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

internal data class StoredFrame(val id: Long, val cursor: Long, val payload: String)
internal data class NativeProjectionCheckpoint(
  val snapshotCursor: Long?,
  val snapshotJson: String?,
  val pendingRequestsJson: String,
  val frames: List<StoredFrame>,
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
    database.execSQL(
      "UPDATE native_sync_state SET snapshot_cursor = cursor WHERE snapshot_cursor IS NULL AND snapshot_json IS NOT NULL",
    )
    database.execSQL(
      "CREATE TABLE IF NOT EXISTS native_store_metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)",
    )
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
        database.execSQL(
          "INSERT OR REPLACE INTO native_store_metadata(key, value) VALUES ('projection_schema', ?)",
          arrayOf(PROJECTION_SCHEMA_VERSION.toString()),
        )
        database.setTransactionSuccessful()
      } finally {
        database.endTransaction()
      }
    }
  }

  @Synchronized
  fun appendEvent(connectionId: String, cursor: Long, payload: String): Long {
    database.beginTransaction()
    try {
      val current = nativeCursor(connectionId)
      if (current != null && cursor <= current) {
        database.setTransactionSuccessful()
        return DUPLICATE
      }
      if (current != null && cursor != current + 1L) {
        database.setTransactionSuccessful()
        return NON_CONTIGUOUS
      }
      val values = ContentValues().apply {
        put("connection_id", connectionId)
        put("event_cursor", cursor)
        put("payload", payload)
        put("payload_bytes", payload.toByteArray(Charsets.UTF_8).size)
        put("created_at", System.currentTimeMillis())
      }
      val id = database.insertOrThrow("native_frames", null, values)
      database.execSQL(
        """
        INSERT INTO native_sync_state(connection_id, cursor, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(connection_id) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at
        """.trimIndent(),
        arrayOf<Any?>(connectionId, cursor, System.currentTimeMillis()),
      )
      applyPendingRequestEvent(connectionId, payload)
      if (journalLimitExceeded(connectionId) || totalJournalLimitExceeded()) {
        resetJournal(connectionId)
        database.setTransactionSuccessful()
        return OVERFLOW
      }
      database.setTransactionSuccessful()
      return id
    } finally {
      database.endTransaction()
    }
  }

  @Synchronized
  fun syncCursor(connectionId: String): Long? = nativeCursor(connectionId)

  @Synchronized
  fun storeSnapshot(connectionId: String, cursor: Long, snapshotJson: String) {
    database.beginTransaction()
    try {
      database.delete("native_frames", "connection_id = ?", arrayOf(connectionId))
      database.execSQL(
        """
        INSERT INTO native_sync_state(connection_id, cursor, snapshot_cursor, snapshot_json, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(connection_id) DO UPDATE SET
          cursor = excluded.cursor,
          snapshot_cursor = excluded.snapshot_cursor,
          projected_cursor = NULL,
          snapshot_json = excluded.snapshot_json,
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
      return NativeProjectionCheckpoint(null, null, pendingRequestsJson, emptyList())
    }
    if (projectedCursor != null && currentCursor != null && projectedCursor >= currentCursor!!) {
      return NativeProjectionCheckpoint(null, null, pendingRequestsJson, emptyList())
    }
    if (projectedCursor != null && snapshotCursor != null && projectedCursor >= snapshotCursor!!) {
      return NativeProjectionCheckpoint(null, null, pendingRequestsJson, pending(connectionId, projectedCursor))
    }
    return NativeProjectionCheckpoint(snapshotCursor, snapshotJson, pendingRequestsJson, pending(connectionId, snapshotCursor))
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
      database.delete(
        "native_frames",
        "connection_id = ? AND event_cursor <= ?",
        arrayOf(connectionId, projectionCursor.toString()),
      )
      database.setTransactionSuccessful()
    } finally {
      database.endTransaction()
    }
  }

  @Synchronized
  fun deleteConnection(connectionId: String) {
    database.delete("native_frames", "connection_id = ?", arrayOf(connectionId))
    database.delete("native_sync_state", "connection_id = ?", arrayOf(connectionId))
  }

  private fun pending(connectionId: String, afterCursor: Long? = null): List<StoredFrame> {
    val result = mutableListOf<StoredFrame>()
    database.rawQuery(
      "SELECT id, event_cursor, payload FROM native_frames WHERE connection_id = ? ORDER BY id LIMIT ?",
      arrayOf(connectionId, MAX_REPLAY_BATCH.toString()),
    ).use { row ->
      while (row.moveToNext()) {
        val payload = row.getString(2)
        val cursor = if (row.isNull(1)) extractEventCursor(payload) else row.getLong(1)
        if (cursor != null && (afterCursor == null || cursor > afterCursor)) {
          result += StoredFrame(row.getLong(0), cursor, payload)
        }
      }
    }
    return result
  }

  private fun nativeCursor(connectionId: String): Long? = database.rawQuery(
    "SELECT cursor FROM native_sync_state WHERE connection_id = ?",
    arrayOf(connectionId),
  ).use { row ->
    if (!row.moveToFirst() || row.isNull(0)) null else row.getLong(0)
  }

  private fun nativeSnapshotCursor(connectionId: String): Long? = database.rawQuery(
    "SELECT snapshot_cursor FROM native_sync_state WHERE connection_id = ?",
    arrayOf(connectionId),
  ).use { row ->
    if (!row.moveToFirst() || row.isNull(0)) null else row.getLong(0)
  }

  private fun journalLimitExceeded(connectionId: String): Boolean = database.rawQuery(
    "SELECT COUNT(*), COALESCE(SUM(payload_bytes), 0) FROM native_frames WHERE connection_id = ?",
    arrayOf(connectionId),
  ).use { row -> row.moveToFirst() && (row.getLong(0) > MAX_FRAMES || row.getLong(1) > MAX_BYTES) }

  private fun totalJournalLimitExceeded(): Boolean = database.rawQuery(
    "SELECT COUNT(*), COALESCE(SUM(payload_bytes), 0) FROM native_frames",
    null,
  ).use { row -> row.moveToFirst() && (row.getLong(0) > MAX_TOTAL_FRAMES || row.getLong(1) > MAX_TOTAL_BYTES) }

  private fun resetJournal(connectionId: String) {
    database.delete("native_frames", "connection_id = ?", arrayOf(connectionId))
    database.execSQL(
      "UPDATE native_sync_state SET cursor = NULL, snapshot_cursor = NULL, projected_cursor = NULL, snapshot_json = NULL, updated_at = ? WHERE connection_id = ?",
      arrayOf<Any?>(System.currentTimeMillis(), connectionId),
    )
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

  private fun extractEventCursor(payload: String): Long? = try {
    JSONObject(payload).optLong("cursor", -1L).takeIf { it >= 0L }
  } catch (_: Throwable) {
    null
  }

  private fun applyPendingRequestEvent(connectionId: String, rawEnvelope: String) {
    val payload = runCatching { JSONObject(rawEnvelope).optJSONObject("payload") }.getOrNull() ?: return
    if (!changesPendingRequests(payload)) return
    val method = payload.optString("method")
    val pending = runCatching { JSONArray(pendingRequestsJson(connectionId)) }.getOrElse { JSONArray() }
    if (method == "serverRequest/resolved") {
      val requestId = payload.optJSONObject("params")?.opt("requestId") ?: return
      val key = requestKey(requestId)
      for (index in pending.length() - 1 downTo 0) {
        val request = pending.optJSONObject(index) ?: continue
        if (requestKey(request.opt("id")) == key) pending.remove(index)
      }
    } else {
      val requestId = payload.opt("id")
      val params = payload.optJSONObject("params")
      if (requestId == null || requestId === JSONObject.NULL || params == null) return
      val key = requestKey(requestId)
      for (index in 0 until pending.length()) {
        val request = pending.optJSONObject(index) ?: continue
        if (requestKey(request.opt("id")) == key) return
      }
      pending.put(JSONObject().put("id", requestId).put("method", method).put("params", params))
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
    private const val PROJECTION_SCHEMA_VERSION = 2
    const val OVERFLOW = -1L
    const val DUPLICATE = -2L
    const val NON_CONTIGUOUS = -3L
    private const val MAX_FRAMES = 10_000L
    private const val MAX_BYTES = 64L * 1024L * 1024L
    private const val MAX_TOTAL_FRAMES = 50_000L
    private const val MAX_TOTAL_BYTES = 256L * 1024L * 1024L
    private const val MAX_REPLAY_BATCH = 10_000
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
