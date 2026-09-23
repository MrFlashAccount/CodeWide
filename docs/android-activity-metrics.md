# Companion-owned activity figures

The numbers beside `ran commands` are Companion projections. Android formats the
count, approximate command-output tokens and approximate API-equivalent input cost;
it does not sum item footprints, scan stdout, infer prices or substitute a local
estimate when metadata is missing. Markdown parsing is outside this change.

`codewide.activityMetrics` version 1 contains a turn total, exact item-ID ranges,
and separately attributed command footprints on item/delta payloads. Closed history
carries only the total; live chunks do not retransmit all older command footprints. Each summary declares `count`, distinct `kinds` and an
`outputFootprint`. The footprint retains the explicit `approxBytesPerToken` basis:
UTF-8 bytes rounded up per command at four bytes/token, summed by Companion. Cost
uses the server's recorded turn input price; `estimatedInputCostUsd: null` means
unknown. These are estimates, not measured per-command model usage or billing.

The backend owns the 16-card live activity window's range summaries. Agent updates
separate groups; completed final answers, hidden reasoning, questions and pre-turn
activity do not inflate the completed history total. Full item hydration carries
ready range metadata on the first item of each group. Selection uses both endpoints,
so a partial or unrelated range cannot inherit a whole-turn total.

Live ingestion observes raw command output before private-content externalization.
The durable activity state stores IDs, kinds, byte counts and presentation flags,
never command output or conversation text. Sparse turn completion preserves earlier
observations; canonical item completion replaces a streamed byte count rather than
adding it again. The published projection travels through the normal durable replay
journal and validated sync-client adapter. Canonical rollout summary caches use a
new projection version so older sealed summaries refresh.

Compatibility: an old Companion or absent/invalid attribution produces no numeric
estimate in the UI. A live observer joining an already running turn without a
checkpoint explicitly marks totals unknown until authoritative history is available;
it never presents a partially observed count as a whole-turn total. Explicit full-turn reads receive recorded usage from canonical
history before output is externalized. Individual item-page hydration carries the
corresponding server range/command metadata as well. Android storage compaction
preserves server metadata without manufacturing another summary.

Validation covers UTF-8 attribution, price unknown/known, live range boundaries,
command completion replacement, sparse terminal events, durable-state reopening,
canonical summary replay, wire validation, storage preservation and native rendering
of server-provided figures. Run `pnpm test:companion`, Cargo Clippy/format checks,
focused sync-client/Android Vitest tests and `pnpm validate:android:v1`.

Delivery requires both Companion and client updates (OTA suffices for the Android
code in this change). No release or physical-device measurement is implied by source
validation.

Validated on 2026-09-22: `pnpm test` (1,877 tests), `pnpm test:companion`,
`cargo clippy --workspace --all-targets -- -D warnings`, `cargo fmt --all -- --check`,
`pnpm validate:android:v1` and the Android application bundle check passed.
Physical-device behavior and performance have not been measured for this change.
Nothing was committed, pushed or published.
