package dev.codewide.app.remote

import android.content.Context
import java.io.File

/** Deletes only obsolete, server-reconstructable databases from app data. */
internal object DerivedStorageCleanup {
  fun purgeAfterProfileRecovery(context: Context): Long {
    val databasesDirectory = context.getDatabasePath("placeholder.db").parentFile
      ?: return 0L
    val oldUiCache = File(File(databasesDirectory, "default"), "codex-remote-ui-cache.db")
    return deleteSqliteFiles(context.getDatabasePath("codex-remote.db")) +
      deleteSqliteFiles(oldUiCache) +
      deleteSqliteFiles(context.getDatabasePath("codex-remote-frames.db"))
  }

  fun purgeLegacyFrameStore(context: Context): Long =
    deleteSqliteFiles(context.getDatabasePath("codex-remote-frames.db"))

  private fun deleteSqliteFiles(database: File): Long {
    var reclaimed = 0L
    for (file in listOf(
      database,
      File(database.path + "-wal"),
      File(database.path + "-shm"),
      File(database.path + "-journal"),
    )) {
      if (!file.exists()) continue
      val bytes = file.length()
      if (file.delete()) reclaimed += bytes
    }
    database.parentFile?.takeIf { it.name == "default" && it.list()?.isEmpty() == true }?.delete()
    return reclaimed
  }
}
