# Android V1 quality checks

`pnpm validate:android:v1` checks the complete native and web TypeScript graphs,
platform adapter compatibility, formatting, shared hygiene rules, V1 layout and
public API documentation, dead code, and dependency boundaries. The existing
Android release command already runs this gate.

## Enforced checks

- V1 and V2 use the same pinned `@sergeigarin/hygene` TypeScript and Oxlint
  presets. The full type-aware V1 audit currently contains 23,604 historical
  diagnostics. `oxlint.v1.baseline.json` records that debt by exact file and rule;
  the required gate rejects every increase while allowing the count to decrease.
  `pnpm --filter @codewide/android lint:v1:hygiene:all` prints the complete report.
- Oxfmt owns the complete V1 source layout. ESLint additionally requires a blank
  line after imports, one property per line in multi-property `StyleSheet` objects,
  and adjacent JSDoc on exported domain contracts, capabilities, and primary
  application APIs. Leaf UI exports remain exempt from ceremonial documentation.
- Knip starts from the legacy route, V1 test consumers, and every Metro platform
  entrypoint. Exact platform-selected module names are documented in its resolver
  exception. The initial clean-up removed 68 unused export modifiers and four
  declarations with no runtime or test consumer.
- Dependency Cruiser checks `app/legacy.tsx` and every V1 source module, including
  imports used only for types. It rejects cycles, unresolved imports, and
  dependencies on V2 source or the `/v2` sync-client entrypoint. Generation-neutral
  boot and presentation remain owned by their existing V2 gate.
- React hook/compiler and presentation-token checks remain mandatory. The normal
  `lint` command delegates to the complete V1 lint aggregate, so the hygiene,
  Knip, and dependency checks cannot be omitted accidentally.

Three type dependency cycles were removed by assigning SQL capabilities, thread
resource contracts, and summary-view contracts to independent contract modules.
Existing public type exports remain compatible; persistence formats and runtime
state machines are unchanged.

## Hygiene debt

A green V1 gate means no new shared-hygiene violation was introduced; it does not
mean the historical Oxlint baseline is empty. The baseline groups diagnostics by
file and rule so formatting and line movement do not create churn. It is a
ratchet, not an exemption source: a change that needs a new exception must use the
narrow rule documented in `AGENTS.md`, while ordinary touched code should reduce
the baseline count.

## Migration choices

- **Incremental — PASS:** the baseline ratchet lets existing files become compliant
  one rule at a time without admitting new debt.
- **Structural — PASS:** the required V1 gate now composes separate owners for
  hygiene, formatting, React/layout rules, Knip, and Dependency Cruiser. Each tool
  sees the full V1 scope through an explicit configuration.
- **Radical — CONDITIONAL:** retire V1 and use V2 exclusively. This could remove
  the cost of maintaining two policy surfaces, but completeness and production
  compatibility are not established by static checks. The cheapest experiment
  is a V1/V2 scenario comparison for navigation, documents, voice, and reconnect.
  Reversibility requires retaining the existing generation switch and V1 until
  that comparison passes. This migration does not switch generations.

## V1 feature ownership migration

The approved [feature architecture](android-v1-feature-architecture.md) and
[migration ledger](android-v1-feature-migration.md) define source ownership;
[local source context](../apps/android/src/CONTEXT.md) routes the implementation.
D0 created documentation only. The later authorized M0–M8 migration implements feature-path gate coverage, all feature owners, lower runtime closure and facade deletion. The migration ledger records final verification and explicit device-only limits.

M0 extends presentation-token coverage to `src/features/**`; existing React
coverage already includes these paths. `v1-feature-boundaries.test.ts` exercises
the production configurations against temporary sources and verifies lower
data/native-to-feature, root-composition back-edges, V1-to-V2 and type-cycle
rejections. Fixtures are removed after verification. The V1 gate and all 16
focused boundary/presentation tests pass. No feature exemption or suppression
was introduced.

Every M1–M8 application unit runs `pnpm validate:android:v1` and its mapped semantic
regressions. Move native/web/type siblings and source-test consumers atomically.
Keep main-chat immediate/progressive behavior distinct from subagent Transition;
verify separate JS module startup and boot-native resource handles. The ledger
records stale-activation, draft/queue, upload/voice, history/scroll and tool-lifetime
acceptance plus rollback. Existing history, rendering and platform docs remain
the detailed mechanism owners.

D0 checks document links, complete source/field/style inventory, approved-file
scope and `git diff --check`, and runs the documented V1 gate before handoff. This
documentation update does not claim feature-boundary enforcement, a completed
application refactor, device parity, full V2-tool parity or release completion.
