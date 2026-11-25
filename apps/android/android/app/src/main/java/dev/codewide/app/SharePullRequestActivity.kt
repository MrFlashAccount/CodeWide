package dev.codewide.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle

/** Translates an explicit Sharesheet choice into normal cold/warm app navigation. */
class SharePullRequestActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null && intent.action == Intent.ACTION_SEND && intent.type == "text/plain") {
            val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString().orEmpty()
            val url = if (text.length <= MAX_SHARE_LENGTH) {
                WEB_URL.findAll(text).take(2).toList().singleOrNull()?.value
            } else null
            val destination = Uri.Builder().scheme("codewide").authority("openpr")
            if (url != null) {
                val uri = Uri.parse(url)
                if (!uri.host.isNullOrEmpty() && uri.userInfo == null) {
                    destination.appendQueryParameter("url", uri.buildUpon().clearQuery().fragment(null).build().toString())
                }
            }
            startActivity(Intent(this, MainActivity::class.java).setAction(Intent.ACTION_VIEW)
                .setData(destination.build()).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP))
        }
        finish()
    }

    private companion object {
        const val MAX_SHARE_LENGTH = 16384
        val WEB_URL = Regex("""https?://[^\s<>"']+""", RegexOption.IGNORE_CASE)
    }
}
