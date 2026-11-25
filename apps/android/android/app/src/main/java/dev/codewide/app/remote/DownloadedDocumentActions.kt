package dev.codewide.app.remote

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.DocumentsContract.Document
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.WritableMap
import java.io.IOException

internal object DownloadedDocumentActions {
  fun share(context: Context, values: ReadableArray, mimeType: String?) {
    val uris = ArrayList<Uri>(values.size())
    for (index in 0 until values.size()) {
      val uri = Uri.parse(requireNotNull(values.getString(index)))
      require(uri.scheme == "content") { "Only saved documents can be shared" }
      uris.add(uri)
    }
    require(uris.isNotEmpty()) { "Select a file to share" }
    val multiple = uris.size > 1
    val send = Intent(if (multiple) Intent.ACTION_SEND_MULTIPLE else Intent.ACTION_SEND).apply {
      type = mimeType ?: if (multiple) "*/*" else context.contentResolver.getType(uris.first()) ?: "*/*"
      if (multiple) putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
      else putExtra(Intent.EXTRA_STREAM, uris.first())
      clipData = ClipData.newRawUri("Downloads", uris.first()).apply {
        for (index in 1 until uris.size) addItem(ClipData.Item(uris[index]))
      }
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    context.startActivity(Intent.createChooser(send, null).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }

  fun rename(context: Context, value: String, name: String): WritableMap {
    require(name.isNotBlank() && name != "." && name != ".." && name.none { it == '/' || it == '\\' || it.isISOControl() }) { "Invalid file name" }
    val uri = Uri.parse(value)
    require(uri.scheme == "content" && DocumentsContract.isTreeUri(uri)) { "A saved document in the download folder is required" }
    val resolver = context.contentResolver
    // Downloads are direct children of the selected SAF tree. Document IDs are opaque.
    val children = DocumentsContract.buildChildDocumentsUriUsingTree(uri, DocumentsContract.getTreeDocumentId(uri))
    val id = DocumentsContract.getDocumentId(uri)
    resolver.query(children, arrayOf(Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME), null, null, null)?.use {
      while (it.moveToNext()) {
        require(it.getString(0) == id || it.getString(1) != name) { "A file with this name already exists" }
      }
    } ?: throw IOException("Could not check the download folder")
    val renamed = DocumentsContract.renameDocument(resolver, uri, name) ?: throw IOException("The provider could not rename this file")
    // The move has committed. Keep its new URI even if the provider cannot return metadata.
    val actualName = runCatching {
      resolver.query(renamed, arrayOf(Document.COLUMN_DISPLAY_NAME), null, null, null)?.use {
        if (it.moveToFirst()) it.getString(0) else null
      }
    }.getOrNull() ?: name
    return Arguments.createMap().apply {
      putString("name", actualName)
      putString("uri", renamed.toString())
    }
  }
}
