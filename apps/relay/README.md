# codewide-relay

`codewide-relay` is the separately deployed blind reverse transport used to
connect a Companion and its remote clients when direct reachability is not
available.

## Owns

- short-lived invitations and route registration;
- bounded opaque forwarding between authenticated route peers;
- relay TLS identity and pinning material;
- relay-local route persistence, revocation, and status commands;
- listener lifecycle for the standalone `codewide-relay` process.

The relay transports encrypted application bytes. Companion authentication and
the inner application TLS session remain end-to-end boundaries; the relay must
not gain message, device, or command semantics.

## Does not own

- Companion domain APIs or device authorization;
- plaintext inspection or termination of the inner Companion session;
- Linux Companion process management;
- macOS XPC, LaunchAgent, or application updates;
- client projection state.

`companion-core` may use the relay client-side adapter, but the relay remains a
separate deployable service with independent state and failure handling.

## Running locally

```sh
cargo run -p codewide-relay -- --help
```

The default command starts the listener. `invite`, `revoke`, and `status`
manage relay routes in the selected state directory.

## Validation

```sh
cargo test -p codewide-relay
cargo clippy -p codewide-relay --all-targets -- -D warnings
```
