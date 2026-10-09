# companion-core

`companion-core` is the shared Rust implementation of the CodeWide Companion.
Platform hosts import it in-process; it is not a daemon protocol and does not
require IPC between a host and the core.

## Owns

- Companion domain services and durable state;
- device identity, pairing, authorization, and secure storage;
- session indexing, history, content, files, terminal, VCS, media, and sync;
- V1 and V2 device protocol implementations and their machine-readable
  contracts under `contract/`;
- runtime state locking, migration, health, and update checkpoints used by
  platform hosts;
- host-update HTTP/release/journal contracts and fenced phase validation;
- the existing device-facing server implementation used by the Linux host.

The crate was extracted from the original Linux Companion without changing its
observable behavior. Because of that history it still contains device
transport/server modules and dependencies such as Axum. "Core" means shared
runtime ownership here; it does not yet mean a transport-free domain library.

## Does not own

- Linux CLI parsing, systemd units, or package installation;
- macOS menu UI, LaunchAgent registration, XPC, Sparkle, or code signing;
- UniFFI-compatible DTOs and generated Swift bindings;
- relay deployment or public routing policy;
- Android client projection and persistence.

Remote host replacement is deliberately split at `host_update::HostUpdateGuardian`.
The core is a stateless authenticated facade; the out-of-process platform
guardian exclusively owns the fsynced journal, activation, health proof,
rollback, and terminal result. Absence of a compatible guardian keeps remote
apply disabled and requires a manual update.

Host-specific lifecycle belongs in the platform host. In particular, the
macOS app must not embed the Linux CLI or expose a local HTTP management
endpoint.

## Consumers

- `apps/companion-linux`: Linux host and CLI;
- `crates/companion-swift-ffi`: narrow adapter for the Swift LaunchAgent;
- contract generators and compatibility tests for Android and sync clients.

## Contracts

- `contract/v1.json` owns the V1 machine-readable limits and compatibility
  surface.
- `contract/host-update-v1.json` owns the additive host-update API, guardian,
  journal, phase, release-target, and error contracts.
- `contract/v2.json` owns the V2 device wire contract.
- `runtime_host` owns the platform-host state lock, update checkpoint, and
  transport-neutral runtime health proof. These lifecycle values live here
  because no independent consumer justifies a separate control-contract crate.

These contracts are not the macOS XPC contract and are not a generic plugin
API. The existing VCS provider protocol under `vcs/` remains distinct from any
future arbitrary Companion plugin system.

## Validation

```sh
cargo test -p companion-core --lib
cargo clippy -p companion-core --all-targets -- -D warnings
```
