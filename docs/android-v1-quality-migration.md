# Android V1 quality checks

`pnpm validate:android:v1` checks the complete native and web TypeScript graphs,
platform adapter compatibility, React rules, and V1 dependency boundaries. The
existing Android release command already runs these type and lint checks.

## Enforced checks

- V1 and V2 extend the same pinned `@sergeigarin/hygene/tsconfig.base.json` preset.
  Native and browser standard libraries remain separate. V1 now checks unused
  locals/parameters, implicit returns and overrides, switch fallthrough,
  unreachable code, side-effect imports, and erasable TypeScript syntax.
- Dependency Cruiser checks every V1 source module, including imports used only
  for types. It rejects cycles, unresolved imports, and dependencies on V2 source
  or the `/v2` sync-client entrypoint. Generation-neutral boot and presentation
  remain owned by their existing V2 gate.
- The existing React hook/compiler and presentation-token lint checks remain
  mandatory. `lint:v1:dependencies` is part of the normal lint command, so release
  validation cannot omit the dependency check.

Three type dependency cycles were removed by assigning SQL capabilities, thread
resource contracts, and summary-view contracts to independent contract modules.
Existing public type exports remain compatible; persistence formats and runtime
state machines are unchanged.

## Remaining V2 tools

This is not full parity with `validate:android:v2`. The initial audit against
revision `b998497` covered 442 V1/shared source modules:

| Tool | Initial finding | Remaining work |
| --- | --- | --- |
| Oxlint | About 3,800 diagnostics with V2's effective common rules | Fix Promise handling and callback/effect ownership first; review each rule against V1's actual boundaries. |
| Oxfmt | 348 V1 files differ | Apply formatting in a separate change to keep behavioral review readable. |
| Knip | 87 exports, 44 types, 3 files, and 59 unresolved references reported | Model platform entrypoints and test consumers before treating these as dead code. These counts are preliminary, not confirmed defects. |

The Oxlint estimate excludes V2's raw-style rule because V1 already has a
separate presentation-token checker. Neither audit-only configs nor suppressions
were added to the required gate. A green V1 gate does not imply the remaining
Oxlint, Oxfmt, or Knip migration is complete.

## Migration choices

- **Incremental — PASS:** enable the shared TypeScript preset and dependency
  checks now. Both produce actionable failures and can be made green without
  changing product behavior.
- **Structural — CONDITIONAL:** transfer the rest of Oxlint after separating
  V1's callback, subscription, and asynchronous-work owners. Start with unhandled
  Promises and direct effects; renaming modules and changing syntax alone would
  leave the important defects unresolved.
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
