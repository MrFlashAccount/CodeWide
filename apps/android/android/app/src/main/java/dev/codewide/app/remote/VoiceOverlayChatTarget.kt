package dev.codewide.app.remote

import android.content.Context
import android.content.Intent
import android.net.Uri

/** Exact current supervisor identity; catalog membership is deliberately unchanged. */
internal data class VoiceOverlayChatTarget(val connectionId: String, val threadId: String) {
  fun intent(context: Context): Intent = Intent(Intent.ACTION_VIEW, Uri.Builder()
    .scheme("codewide").authority("")
    .appendPath("threads").appendPath(connectionId).appendPath(threadId).build())
    .setPackage(context.packageName)
    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
}
