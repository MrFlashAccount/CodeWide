# companion-swift-ffi

`companion-swift-ffi` is the narrow UniFFI/static-library adapter used by the
native macOS Companion host.

The Swift LaunchAgent links this crate and calls `companion-core` in-process.
The menu app communicates with the LaunchAgent through authenticated XPC;
neither XPC nor a local server is implemented in this crate.

## Owns

- the UniFFI-exported `CoreHost` object;
- conversion from Rust runtime values into FFI-safe records and errors;
- the static library and binding-generator entrypoint consumed by the macOS
  build.

The current vertical slice exposes only runtime creation, health, and the
durable pre-update checkpoint. Device-management APIs should be added only as
thin conversions over `companion-core`; domain behavior does not belong here.

## Does not own

- Companion domain logic or durable state;
- Swift XPC protocols and peer validation;
- LaunchAgent installation or restart policy;
- Sparkle feed generation, update installation, or rollback;
- Linux hosting or CLI behavior.

## Dependency direction

```text
Swift LaunchAgent -> UniFFI bindings -> companion-swift-ffi -> companion-core
```

Generated Swift and C surfaces live under `apps/macos/Sources/`. Regenerate
them after changing an exported UniFFI type or method:

```sh
apps/macos/scripts/generate-swift-bindings.sh
```

## Validation

```sh
cargo test -p companion-swift-ffi
cargo clippy -p companion-swift-ffi --all-targets -- -D warnings
apps/macos/scripts/validate-boundaries.sh
```
