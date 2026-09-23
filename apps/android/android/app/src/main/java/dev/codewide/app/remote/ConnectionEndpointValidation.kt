package dev.codewide.app.remote

import java.net.URI

/** Admits only the versioned Companion endpoint or a route-qualified blind Relay carrier. */
internal fun validateConnectionEndpoint(endpoint: String) {
  val uri = URI(endpoint)
  require(uri.scheme == "wss" || uri.scheme == "ws") { "Endpoint must use ws or wss" }
  require(uri.host != null) { "Endpoint must contain a host" }
  val relayRoute = Regex("^/c/[a-f0-9]{64}/v1/sync$").matches(uri.path)
  require(uri.path == "/v1/sync" || relayRoute) {
    "Endpoint path must be /v1/sync or an explicit relay route"
  }
  require(uri.userInfo == null && uri.query == null && uri.fragment == null) {
    "Endpoint must not contain credentials, query parameters, or fragments"
  }
  if (uri.scheme == "ws") {
    require(uri.host == "127.0.0.1" || uri.host == "localhost" || uri.host == "::1" || uri.host == "10.0.2.2" || relayRoute) {
      "Cleartext WebSocket is only allowed for local development or an explicit inner-TLS relay route"
    }
  }
}
