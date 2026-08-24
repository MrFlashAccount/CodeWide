package dev.codewide.app.remote

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

internal data class NativeCommand(
  val connectionId: String,
  val commandId: String,
  val method: String,
  val paramsJson: String,
  val state: String,
  val attempts: Int,
  val lastError: String?,
  val createdAt: Long,
  val updatedAt: Long,
  val nextAttemptAt: Long,
)

internal data class NativeCommandStorageStats(
  val rowCount: Long,
  val payloadBytes: Long,
  val pendingRows: Long,
  val pendingBytes: Long,
  val deliveredRows: Long,
  val failedRows: Long,
  val mainFileBytes: Long,
  val walFileBytes: Long,
  val shmFileBytes: Long,
)

/**
 * Native-owned durable command queue.
 *
 * This database is deliberately separate from the TanStack/OP-SQLite UI
 * cache. Kotlin owns delivery and may continue draining while Hermes is asleep;
 * JavaScript only receives projection events.
 */
internal class NativeCommandStore(context: Context) {
  private val database: SQLiteDatabase

  init {
    val directory = context.getDatabasePath("codex-remote-native-commands.db").parentFile
      ?: throw IllegalStateException("Android database directory is unavailable")
    directory.mkdirs()
    database = SQLiteDatabase.openOrCreateDatabase(
      context.getDatabasePath("codex-remote-native-commands.db"),
      null,
    )
    database.enableWriteAheadLogging()
    database.rawQuery("PRAGMA busy_timeout = 5000", null).use { it.moveToFirst() }
    database.execSQL(
      """
      CREATE TABLE IF NOT EXISTS native_commands (
        connection_id TEXT NOT NULL,
        command_id TEXT NOT NULL,
        method TEXT NOT NULL,
        params_json TEXT NOT NULL,
        payload_bytes INTEGER NOT NULL,
        state TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (connection_id, command_id)
      )
      """.trimIndent(),
    )
    ensureColumn("native_commands", "next_attempt_at", "INTEGER NOT NULL DEFAULT 0")
    database.execSQL(
      "CREATE INDEX IF NOT EXISTS native_commands_delivery ON native_commands(connection_id, state, created_at, command_id)",
    )
    // A process death can leave a command in the in-flight state. The RPC may
    // have reached the host, so retain it as uncertain and retry using the
    // command's stable client id instead of silently dropping it.
    database.execSQL(
      "UPDATE native_commands SET state = 'uncertain', next_attempt_at = 0, updated_at = ? WHERE state = 'sending'",
      arrayOf<Any?>(System.currentTimeMillis()),
    )
    // `accepted` was used by native-23 and older after an RPC response had
    // already confirmed turn/start or turn/steer. Keeping that acknowledged
    // command in the FIFO lane made a missing clientId projection block every
    // later follow-up forever. A positive RPC response is definitive delivery;
    // only an interrupted request belongs in `uncertain` reconciliation.
    database.delete("native_commands", "state = 'accepted'", null)
    pruneReceipts()
  }

  @Synchronized
  fun enqueue(connectionId: String, commandId: String, method: String, paramsJson: String): NativeCommand {
    val payloadBytes = paramsJson.toByteArray(Charsets.UTF_8).size
    require(payloadBytes <= MAX_COMMAND_BYTES) { "Native command payload is too large" }
    database.beginTransaction()
    try {
      read(connectionId, commandId)?.let {
        database.setTransactionSuccessful()
        return it
      }
      val usage = database.rawQuery(
        "SELECT COUNT(*), COALESCE(SUM(payload_bytes), 0) FROM native_commands WHERE connection_id = ? AND state NOT IN ('failed', 'delivered')",
        arrayOf(connectionId),
      ).use { rows ->
        rows.moveToFirst()
        rows.getLong(0) to rows.getLong(1)
      }
      require(usage.first < MAX_COMMANDS_PER_CONNECTION) { "Native command queue is full" }
      require(usage.second + payloadBytes <= MAX_BYTES_PER_CONNECTION) { "Native command queue byte limit exceeded" }
      val now = System.currentTimeMillis()
      database.insertOrThrow("native_commands", null, ContentValues().apply {
        put("connection_id", connectionId)
        put("command_id", commandId)
        put("method", method)
        put("params_json", paramsJson)
        put("payload_bytes", payloadBytes)
        put("state", "queued")
        put("attempts", 0)
        putNull("last_error")
        put("created_at", now)
        put("updated_at", now)
        put("next_attempt_at", 0)
      })
      database.setTransactionSuccessful()
      return NativeCommand(connectionId, commandId, method, paramsJson, "queued", 0, null, now, now, 0)
    } finally {
      database.endTransaction()
    }
  }

  @Synchronized
  fun nextReady(connectionId: String, now: Long = System.currentTimeMillis()): NativeCommand? =
    pendingLaneHeads(connectionId).firstOrNull { it.nextAttemptAt <= now }

  @Synchronized
  fun nextWakeAt(connectionId: String): Long? = pendingLaneHeads(connectionId)
    .minOfOrNull { it.nextAttemptAt }

  private fun pendingLaneHeads(connectionId: String): List<NativeCommand> = database.rawQuery(
    """
    SELECT connection_id, command_id, method, params_json, state, attempts, last_error, created_at, updated_at, next_attempt_at
    FROM native_commands
    WHERE connection_id = ? AND state IN ('queued', 'uncertain')
    ORDER BY created_at, command_id
    """.trimIndent(),
    arrayOf(connectionId),
  ).use { rows ->
    val lanes = mutableSetOf<String>()
    buildList {
      while (rows.moveToNext()) {
        val candidate = command(rows)
        if (lanes.add(laneKey(candidate))) add(candidate)
      }
    }
  }

  @Synchronized
  fun list(connectionId: String? = null): List<NativeCommand> {
    val where = if (connectionId == null) "" else " WHERE connection_id = ?"
    val args = if (connectionId == null) null else arrayOf(connectionId)
    return database.rawQuery(
      """
      SELECT connection_id, command_id, method, params_json, state, attempts, last_error, created_at, updated_at, next_attempt_at
      FROM native_commands$where
      ORDER BY created_at, command_id
      """.trimIndent(),
      args,
    ).use { rows ->
      buildList {
        while (rows.moveToNext()) add(command(rows))
      }
    }
  }

  @Synchronized
  fun markSending(command: NativeCommand): NativeCommand {
    val attempts = command.attempts + 1
    val now = System.currentTimeMillis()
    database.execSQL(
      "UPDATE native_commands SET state = 'sending', attempts = ?, last_error = NULL, next_attempt_at = 0, updated_at = ? WHERE connection_id = ? AND command_id = ?",
      arrayOf<Any?>(attempts, now, command.connectionId, command.commandId),
    )
    return command.copy(state = "sending", attempts = attempts, lastError = null, updatedAt = now, nextAttemptAt = 0)
  }

  @Synchronized
  fun markUncertain(command: NativeCommand, error: String, retryAt: Long = System.currentTimeMillis()): NativeCommand {
    val diagnostic = error.take(500)
    val now = System.currentTimeMillis()
    database.execSQL(
      "UPDATE native_commands SET state = 'uncertain', last_error = ?, next_attempt_at = ?, updated_at = ? WHERE connection_id = ? AND command_id = ?",
      arrayOf<Any?>(diagnostic, retryAt, now, command.connectionId, command.commandId),
    )
    return command.copy(state = "uncertain", lastError = diagnostic, updatedAt = now, nextAttemptAt = retryAt)
  }

  @Synchronized
  fun markFailed(command: NativeCommand, error: String): NativeCommand {
    val diagnostic = error.take(500)
    val now = System.currentTimeMillis()
    database.execSQL(
      "UPDATE native_commands SET state = 'failed', last_error = ?, next_attempt_at = 0, updated_at = ? WHERE connection_id = ? AND command_id = ?",
      arrayOf<Any?>(diagnostic, now, command.connectionId, command.commandId),
    )
    return command.copy(state = "failed", lastError = diagnostic, updatedAt = now, nextAttemptAt = 0)
  }

  /** Reconciles a failed message before reusing its stable delivery identity. */
  @Synchronized
  fun retryFailed(connectionId: String, commandId: String): NativeCommand {
    val command = read(connectionId, commandId)
      ?: throw IllegalArgumentException("Native command was not found")
    require(command.method == "turn/start" || command.method == "turn/steer") {
      "Only failed message commands can be retried"
    }
    if (command.state != "failed") return command
    val now = System.currentTimeMillis()
    database.execSQL(
      "UPDATE native_commands SET state = 'uncertain', last_error = NULL, next_attempt_at = 0, updated_at = ? WHERE connection_id = ? AND command_id = ? AND state = 'failed'",
      arrayOf<Any?>(now, connectionId, commandId),
    )
    return command.copy(state = "uncertain", lastError = null, updatedAt = now, nextAttemptAt = 0)
  }

  /**
   * Keeps a bounded delivery receipt after a positive RPC response.
   *
   * Delivered receipts are excluded from delivery lanes and queue limits, so
   * they cannot resend or block a follow-up. They only let the UI retain the
   * authored prompt while an incomplete live projection is being repaired.
   */
  @Synchronized
  fun markDelivered(command: NativeCommand): NativeCommand {
    if (!retainsDeliveryReceipt(command.method)) {
      delete(command.connectionId, command.commandId)
      return command.copy(state = "delivered", lastError = null, updatedAt = System.currentTimeMillis(), nextAttemptAt = 0)
    }
    val receiptParams = receiptParamsJson(command)
    val receiptBytes = receiptParams.toByteArray(Charsets.UTF_8).size
    val now = System.currentTimeMillis()
    database.execSQL(
      "UPDATE native_commands SET params_json = ?, payload_bytes = ?, state = 'delivered', last_error = NULL, next_attempt_at = 0, updated_at = ? WHERE connection_id = ? AND command_id = ?",
      arrayOf<Any?>(receiptParams, receiptBytes, now, command.connectionId, command.commandId),
    )
    pruneReceipts()
    return command.copy(paramsJson = receiptParams, state = "delivered", lastError = null, updatedAt = now, nextAttemptAt = 0)
  }

  @Synchronized
  fun delete(connectionId: String, commandId: String) {
    database.delete(
      "native_commands",
      "connection_id = ? AND command_id = ?",
      arrayOf(connectionId, commandId),
    )
  }

  /** Removes a retained receipt only after its authored message is authoritative. */
  @Synchronized
  fun acknowledgeDeliveryReceipt(connectionId: String, commandId: String) {
    database.delete(
      "native_commands",
      "connection_id = ? AND command_id = ? AND state = 'delivered'",
      arrayOf(connectionId, commandId),
    )
  }

  @Synchronized
  fun deleteConnection(connectionId: String) {
    database.delete("native_commands", "connection_id = ?", arrayOf(connectionId))
  }

  @Synchronized
  fun expediteTurnReconciliation(connectionId: String, threadId: String) {
    val now = System.currentTimeMillis()
    list(connectionId)
      .filter { command ->
        (command.method == "turn/start" || command.method == "turn/steer") &&
          command.state == "uncertain" &&
          commandThreadId(command) == threadId
      }
      .forEach { command ->
        database.execSQL(
          "UPDATE native_commands SET next_attempt_at = 0, updated_at = ? WHERE connection_id = ? AND command_id = ?",
          arrayOf<Any?>(now, command.connectionId, command.commandId),
        )
      }
  }

  @Synchronized
  fun close() {
    database.close()
  }

  @Synchronized
  fun stateJson(command: NativeCommand, state: String = command.state): String {
    val storage = storageStats()
    return JSONObject(projectionJson(command, state))
      .put("storage", JSONObject()
        .put("rowCount", storage.rowCount)
        .put("payloadBytes", storage.payloadBytes)
        .put("pendingRows", storage.pendingRows)
        .put("pendingBytes", storage.pendingBytes)
        .put("deliveredRows", storage.deliveredRows)
        .put("failedRows", storage.failedRows)
        .put("mainFileBytes", storage.mainFileBytes)
        .put("walFileBytes", storage.walFileBytes)
        .put("shmFileBytes", storage.shmFileBytes))
      .toString()
  }

  @Synchronized
  fun storageStats(): NativeCommandStorageStats {
    val logical = database.rawQuery(
      """
      SELECT
        COUNT(*),
        COALESCE(SUM(payload_bytes), 0),
        COALESCE(SUM(CASE WHEN state IN ('queued', 'sending', 'uncertain') THEN 1 ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN state IN ('queued', 'sending', 'uncertain') THEN payload_bytes ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN state = 'delivered' THEN 1 ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END), 0)
      FROM native_commands
      """.trimIndent(),
      null,
    ).use { rows ->
      rows.moveToFirst()
      LongArray(6) { index -> rows.getLong(index) }
    }
    val main = File(database.path)
    return NativeCommandStorageStats(
      rowCount = logical[0],
      payloadBytes = logical[1],
      pendingRows = logical[2],
      pendingBytes = logical[3],
      deliveredRows = logical[4],
      failedRows = logical[5],
      mainFileBytes = main.length(),
      walFileBytes = File(main.path + "-wal").length(),
      shmFileBytes = File(main.path + "-shm").length(),
    )
  }

  private fun read(connectionId: String, commandId: String): NativeCommand? = database.rawQuery(
    """
    SELECT connection_id, command_id, method, params_json, state, attempts, last_error, created_at, updated_at, next_attempt_at
    FROM native_commands WHERE connection_id = ? AND command_id = ?
    """.trimIndent(),
    arrayOf(connectionId, commandId),
  ).use { rows -> if (!rows.moveToFirst()) null else command(rows) }

  private fun command(rows: android.database.Cursor): NativeCommand = NativeCommand(
    connectionId = rows.getString(0),
    commandId = rows.getString(1),
    method = rows.getString(2),
    paramsJson = rows.getString(3),
    state = rows.getString(4),
    attempts = rows.getInt(5),
    lastError = if (rows.isNull(6)) null else rows.getString(6),
    createdAt = rows.getLong(7),
    updatedAt = rows.getLong(8),
    nextAttemptAt = rows.getLong(9),
  )

  private fun laneKey(command: NativeCommand): String =
    NativeCommandPolicy.deliveryLane(command.method, commandThreadId(command))

  private fun commandThreadId(command: NativeCommand): String? = runCatching {
    val params = JSONObject(command.paramsJson)
    params.optJSONObject("command")?.optString("remoteThreadId")?.takeIf { it.isNotBlank() }
      ?: params.optString("threadId").takeIf { it.isNotBlank() }
  }.getOrNull()

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

  private fun pruneReceipts() {
    val now = System.currentTimeMillis()
    database.execSQL(
      "DELETE FROM native_commands WHERE state IN ('failed', 'delivered') AND updated_at < ?",
      arrayOf<Any?>(now - RECEIPT_RETENTION_MS),
    )
    database.execSQL(
      """
      DELETE FROM native_commands
      WHERE state = 'delivered' AND rowid NOT IN (
        SELECT rowid FROM native_commands
        WHERE state = 'delivered'
        ORDER BY updated_at DESC, rowid DESC
        LIMIT $MAX_DELIVERED_RECEIPTS
      )
      """.trimIndent(),
    )
  }

  private fun receiptParamsJson(command: NativeCommand): String {
    val source = runCatching { JSONObject(command.paramsJson) }.getOrNull()
    val threadId = source?.optString("threadId")?.takeIf { it.isNotBlank() }.orEmpty()
    val text = source?.let(::commandText).orEmpty().take(MAX_RECEIPT_TEXT_CHARS)
    return JSONObject()
      .put("threadId", threadId)
      .put("input", JSONArray().put(JSONObject().put("type", "text").put("text", text)))
      .toString()
  }

  companion object {
    fun projectionJson(command: NativeCommand, state: String = command.state): String = JSONObject()
      .put("connectionId", command.connectionId)
      .put("commandId", command.commandId)
      .put("method", command.method)
      .put("state", state)
      .put("attempts", command.attempts)
      .put("createdAt", command.createdAt)
      .put("updatedAt", command.updatedAt)
      .apply {
        val params = runCatching { JSONObject(command.paramsJson) }.getOrNull()
        val queued = params?.optJSONObject("command")
        val threadId = queued?.optString("remoteThreadId")?.takeIf { it.isNotBlank() }
          ?: params?.optString("threadId")?.takeIf { it.isNotBlank() }
        val targetCommandId = if (command.method == "companion/queue/put") {
          queued?.optString("commandId")?.takeIf { it.isNotBlank() }
        } else {
          params?.optString("commandId")?.takeIf { it.isNotBlank() }
        }
        val textParams = queued?.optJSONObject("params") ?: params
        put("threadId", threadId ?: JSONObject.NULL)
        put("targetCommandId", targetCommandId ?: JSONObject.NULL)
        put("text", if (command.method == "companion/queue/edit") params?.optString("text").orEmpty() else textParams?.let(::commandText).orEmpty())
        put("attachments", textParams?.let(::commandAttachments) ?: JSONArray())
        put("lastError", command.lastError ?: JSONObject.NULL)
      }
      .toString()

    private fun commandText(params: JSONObject): String {
      val input = params.optJSONArray("input") ?: return ""
      return buildString {
        for (index in 0 until input.length()) {
          val item = input.optJSONObject(index) ?: continue
          val text = when (item.optString("type")) {
            "text" -> item.optString("text")
            else -> ""
          }
          if (text.isBlank()) continue
          if (isNotEmpty()) append('\n')
          append(text)
        }
      }
    }

    private fun commandAttachments(params: JSONObject): JSONArray {
      val result = JSONArray()
      val input = params.optJSONArray("input") ?: return result
      for (index in 0 until input.length()) {
        val item = input.optJSONObject(index) ?: continue
        if (item.optString("type") != "remoteFile") continue
        val rootId = item.optString("rootId")
        val path = item.optString("path")
        val name = item.optString("name")
        val kind = item.optString("kind")
        if (
          rootId.isBlank() || path.isBlank() || name.isBlank()
          || (kind != "image" && kind != "audio" && kind != "file")
        ) continue
        result.put(JSONObject()
          // Match queued-input.ts so recovery never changes attachment identity.
          .put("id", "$rootId\u0000$path")
          .put("rootId", rootId)
          .put("path", path)
          .put("name", name)
          .put("kind", kind))
      }
      return result
    }

    private const val MAX_COMMANDS_PER_CONNECTION = 1_000L
    private const val MAX_COMMAND_BYTES = 4 * 1024 * 1024
    private const val MAX_BYTES_PER_CONNECTION = 16L * 1024L * 1024L
    private const val RECEIPT_RETENTION_MS = 7L * 24L * 60L * 60L * 1_000L
    private fun retainsDeliveryReceipt(method: String): Boolean = method == "turn/start" || method == "turn/steer"

    private const val MAX_DELIVERED_RECEIPTS = 250
    private const val MAX_RECEIPT_TEXT_CHARS = 256 * 1024
  }
}
