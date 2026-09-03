package dev.codewide.app.remote

import android.content.Context

internal enum class NativeSyncGeneration {
  LEGACY,
  V2,
}

/** Durable process-generation authority used before a React runtime exists. */
internal class NativeSyncGenerationStore(context: Context) {
  private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

  fun read(): NativeSyncGeneration = when (preferences.getString(KEY, null)) {
    V2_VALUE -> NativeSyncGeneration.V2
    else -> NativeSyncGeneration.LEGACY
  }

  fun write(generation: NativeSyncGeneration): Boolean =
    preferences.edit()
      .putString(KEY, if (generation == NativeSyncGeneration.V2) V2_VALUE else LEGACY_VALUE)
      .commit()

  private companion object {
    const val PREFERENCES = "codewide_native_runtime"
    const val KEY = "sync_generation"
    const val LEGACY_VALUE = "legacy"
    const val V2_VALUE = "v2"
  }
}
