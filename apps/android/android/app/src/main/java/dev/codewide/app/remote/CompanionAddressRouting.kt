package dev.codewide.app.remote

import android.content.Context
import com.facebook.react.modules.network.OkHttpClientProvider
import java.io.IOException
import okhttp3.HttpUrl
import okhttp3.Interceptor
import okhttp3.Response

/**
 * A Companion address issued to React Native views that load media by URL:
 * `https://companion.invalid/<connection id>/v1/...`. The reserved host never
 * resolves; [CompanionAddressInterceptor] sends it through the pinned tunnel.
 */
internal data class CompanionAddress(val connectionId: String, val pathAndQuery: String) {
  companion object {
    const val HOST = "companion.invalid"

    fun parse(url: HttpUrl): CompanionAddress? {
      if (url.host != HOST || url.scheme != "https") return null
      val connectionId = url.pathSegments.firstOrNull()?.takeIf { it.isNotBlank() } ?: return null
      val path = url.encodedPath.removePrefix("/${url.encodedPathSegments.first()}")
      val pathAndQuery = url.encodedQuery?.let { "$path?$it" } ?: path
      return CompanionAddress(connectionId, pathAndQuery)
    }
  }
}

/** Routes Companion addresses from React Native's shared HTTP clients through the service. */
internal object CompanionAddressInterceptor : Interceptor {
  override fun intercept(chain: Interceptor.Chain): Response {
    val request = chain.request()
    val address = CompanionAddress.parse(request.url) ?: return chain.proceed(request)
    // OkHttp reports only IOExceptions as call failures; anything else would crash the dispatcher.
    if (!isCompanionApiPath(address.pathAndQuery)) throw IOException("Companion address path is invalid")
    val service = CodexConnectionService.instance ?: throw IOException("Connection service is not running")
    return try {
      service.proceedCompanionAddress(address, request)
    } catch (error: IOException) {
      throw error
    } catch (error: RuntimeException) {
      throw IOException("Companion request failed: ${error.message}", error)
    }
  }
}

/**
 * Installs the interceptor into every client React Native creates: fetch, Fresco
 * images and expo-video's media source. Must run before React Native starts.
 */
internal fun installCompanionAddressRouting(context: Context) {
  val application = context.applicationContext
  OkHttpClientProvider.setOkHttpClientFactory {
    OkHttpClientProvider.createClientBuilder(application)
      .addInterceptor(CompanionAddressInterceptor)
      .build()
  }
}
