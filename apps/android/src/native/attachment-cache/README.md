# Attachment disk cache

The Android private-transfer adapter, image materializer and video preview use one app-private disk cache. Markdown, plain text, HTML, images and arbitrary download ranges have the same retention policy.

- `disk-cache.ts` owns the 1 GiB payload budget, admission reservations, last-access eviction and reader leases. Payload bytes never enter this owner's JavaScript state. Small metadata sidecars are additional to the payload budget.
- `storage.native.ts` owns atomic metadata persistence, completed-file discovery and removal of abandoned partial files. It retires the previous unmanaged image cache on first use.
- `cached-transfer.native.ts` owns HTTP cache integration. Files are streamed to a partial destination by Expo, checked against the response revision, range and byte count, then renamed into place. The cache is keyed by a digest of the saved server scope, source identity, content revision and requested byte range. Credentials and transport URLs are not persisted in metadata.
- `http-metadata.ts` validates server freshness and range evidence. Mutable files require a successful HEAD with SHA-256 or a strong ETag before reuse. This is a bandwidth cache, not an offline-access grant. Authorization errors are never replaced with cached content.
- `attachment-response.ts` preserves UTF-8 text decoding when file bytes cross React Native's fetch polyfill. Binary consumers still receive the original bytes.

A range cache entry is never treated as a complete file. Completed entries survive application restarts. Concurrent readers share one pending write, and active native readers hold leases so cleanup cannot remove their files. If a request cannot fit while readers are active, or the server cannot prove its content revision, the caller uses the ordinary transfer/streaming path. Cache admission does not reject large attachments.

Cancellation uses the shared `native/check-aborted.ts` adapter and the `signal.aborted` property. React Native ships an AbortSignal without `throwIfAborted`; Node-only tests cannot establish that runtime contract. The native cache tests therefore exercise the AbortController resolved from React Native itself, including successful first reads, cache hits and cancellation.

The cache does not own files explicitly saved into a user-selected folder, SQLite history, decoded image memory or WebView resources. It applies no age-based expiry; last access determines eviction when the payload budget is reached. Video files that fit are materialized before local playback; oversized files keep streaming.

Validation: `pnpm test`, `pnpm --filter @codewide/android typecheck`, `pnpm validate:android:v2`. Native adapter tests use real temporary files behind Expo-only substitutes. The native Android smoke check additionally covers UTF-8, byte ranges, inline bytes and cache reuse across a process restart.
