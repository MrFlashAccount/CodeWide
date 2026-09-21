# Release process

CodeWide has one explicit release-impact graph in `release/graph.json`. It is a
delivery-policy graph, not a replacement for Cargo, SwiftPM, or pnpm build
graphs. This distinction is intentional: a build dependency does not always
mean that every consuming artifact must be published.

## Plan affected deliveries

Compare a branch with `origin/main`:

```sh
pnpm release:plan -- --base origin/main --head HEAD
```

Include local tracked and untracked changes:

```sh
pnpm release:plan -- --base origin/main --head HEAD --include-working-tree
```

The planner reports changed files, affected components, release targets, and
unmatched non-documentation files. Unmatched files are deliberately visible:
they require a graph review instead of silently producing a false "no release"
answer.

Current target policy:

- shared `companion-core` or `companion-control` changes affect both the Linux
  Companion and the native macOS app;
- Swift/XPC/menu-app-only changes affect macOS only;
- Android TypeScript and shared package changes select OTA;
- Android native/configuration/lockfile changes select APK, which supersedes
  OTA for the same change set;
- documentation and release-planner-only changes do not publish a product.

Pull requests run `.github/workflows/release-plan.yml` and attach the JSON plan.
The planner never publishes by itself.

## macOS

Run a validation-only release from a clean, pushed branch:

```sh
./scripts/release-macos 0.1.0 --dry-run
```

Publish after the validation succeeds:

```sh
./scripts/release-macos 0.1.0
```

The command dispatches the macOS 26 GitHub runner and waits for the complete
workflow. The workflow refuses to release when the graph does not select macOS;
`--force` is an explicit operator override. It builds the ad-hoc signed app and
DMG, proves a signed Sparkle update from the baseline app, verifies state
migration and LaunchAgent recovery, then publishes the DMG and signed appcast.

Required GitHub `release` environment secrets:

- `SPARKLE_ED25519_PUBLIC_KEY`
- `SPARKLE_ED25519_PRIVATE_KEY`

There is no Developer ID or notarization step. Sparkle authenticates update
artifacts, while macOS may still warn on the first launch of an ad-hoc-signed
application.

## Other targets

The planner keeps the existing one-shot delivery owners:

- `./scripts/release-companion`
- `./scripts/release-ota`
- `./scripts/release-apk`

It does not automatically execute local/systemd or Android publication. That is
a separate operator action after reviewing the plan; avoiding accidental
cross-platform publication is part of the contract.
