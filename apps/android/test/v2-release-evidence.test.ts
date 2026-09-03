import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  parseAndroidE2eEvidence,
  parseVisualParityEvidence,
  parseVisualParityMatrix,
  REQUIRED_RELEASE_OBSERVATIONS,
  REQUIRED_RELEASE_STEPS,
  validateAndroidE2eEvidence,
  validateIntentionalDifferenceXml,
  validateRequiredStrictCaptureXml,
  validateVisualParityEvidence,
  validateVisualParityMatrix,
  type AndroidE2eEvidence,
  type VisualParityCapture,
  type VisualParityEvidence,
} from "../../../scripts/android-e2e/evidencePolicy";
import { INTERACTION_INVENTORY_STATE_NAMES } from "../../../scripts/android-e2e/interactionInventoryParity";

const NOW = new Date("2026-09-03T10:00:00.000Z");
const CURRENT_FINGERPRINT = `sha256:${"a".repeat(64)}`;
const e2eHarness = readFileSync(
  new URL("../../../scripts/android-e2e.ts", import.meta.url),
  "utf8",
);
const visualParityMatrix = parseVisualParityMatrix(
  readFileSync(new URL("../../../docs/android-v2-visual-parity.md", import.meta.url), "utf8"),
);
const VISUAL_PARITY_ARTIFACT_FIELDS = [
  "v1Screenshot",
  "v1Xml",
  "v2Screenshot",
  "v2Xml",
  "diffImage",
  "diffData",
] as const;

function passingEvidence(): AndroidE2eEvidence {
  return {
    schemaVersion: 1,
    suite: "full",
    backend: "managedAppServer",
    buildMode: "fresh",
    completedAt: "2026-09-03T09:59:00.000Z",
    runId: "release-evidence",
    sourceFingerprint: CURRENT_FINGERPRINT,
    passed: true,
    deviceKind: "emulator",
    deviceSerial: "emulator-5554",
    threadId: "thread-release",
    steps: REQUIRED_RELEASE_STEPS.map((name) => ({ name, status: "passed", durationMs: 1 })),
    observations: REQUIRED_RELEASE_OBSERVATIONS.map((stage) => ({
      stage,
      source: "test",
      elapsedMs: 1,
      outcome: "passed",
    })),
    videos: REQUIRED_RELEASE_STEPS.filter((name) => /^\d\d-/u.test(name)).map(
      (name) => `${name}.mp4`,
    ),
    failure: null,
  };
}

function parityCapture(
  state: string,
  status: VisualParityCapture["status"] = "pass",
  artifactNamespace = "",
): VisualParityCapture {
  const artifactStem = artifactNamespace === "" ? state : `${artifactNamespace}-${state}`;
  return {
    state,
    status,
    v1Screenshot: `${artifactStem}-v1.png`,
    v1Xml: `${artifactStem}-v1.xml`,
    v2Screenshot: `${artifactStem}-v2.png`,
    v2Xml: `${artifactStem}-v2.xml`,
    diffImage: `${artifactStem}-diff.png`,
    diffData: `${artifactStem}-diff.json`,
    ratio: 0.001,
    threshold: 0.01,
  };
}

function passingParityEvidence(): VisualParityEvidence {
  return {
    schemaVersion: 1,
    matrixRows: 265,
    coveredRows: 265,
    blockedRows: 0,
    rows: visualParityMatrix.map((row, index) => parityRow(row, index)),
  };
}

function parityRow(
  row: (typeof visualParityMatrix)[number],
  index: number,
): VisualParityEvidence["rows"][number] {
  if (row.id === "ATT-02") {
    return {
      ...row,
      status: "intentional-difference",
      captures: [
        parityCapture("phone-empty-attachments-policy", "intentional-difference"),
        parityCapture("wide-empty-attachments-policy", "intentional-difference"),
      ],
      intentionalDifference: {
        code: "v2-empty-attachments-state",
        evidence:
          "Frozen V1 exposes only a disabled empty Attachments chip; the product rule requires V2 to expose a routable empty Attachments state.",
      },
    };
  }
  if (row.id === "ATT-07") {
    return {
      ...row,
      status: "intentional-difference",
      captures: [
        parityCapture("phone-inline-video-player-policy", "intentional-difference"),
        parityCapture("wide-inline-video-player-policy", "intentional-difference"),
      ],
      intentionalDifference: {
        code: "v2-inline-video-player",
        evidence:
          "Frozen V1 downloads video attachments; the product rule requires V2 to open them in an inline player.",
      },
    };
  }
  if (row.id === "ROW-04") {
    return {
      ...row,
      status: "intentional-difference",
      captures: [
        parityCapture("phone-waiting-input-row-policy", "intentional-difference"),
        parityCapture("wide-waiting-input-row-policy", "intentional-difference"),
      ],
      intentionalDifference: {
        code: "v2-authoritative-waiting-input",
        evidence:
          "Frozen V1 exposes the generic Thread approval attention state; the product rule requires V2 to expose the authoritative Waiting for input state while preserving the same visual treatment.",
      },
    };
  }
  if (row.id === "NEW-04" || row.id === "INT-05") {
    const actionMatrix = row.id === "INT-05";
    const inventoryStates = actionMatrix ? interactionStates(row.id) : [];
    const intentionalStates = new Set([
      "phone-new-thread-create-pending",
      "wide-new-thread-create-pending",
      "phone-action-attachment-upload-pending",
      "wide-action-attachment-upload-pending",
    ]);
    const policyStates = actionMatrix
      ? [...intentionalStates]
      : ["phone-new-thread-create-pending", "wide-new-thread-create-pending"];
    return {
      ...row,
      status: "intentional-difference",
      captures: [
        ...policyStates.map((state) =>
          parityCapture(state, "intentional-difference", row.id.toLowerCase()),
        ),
        ...inventoryStates
          .filter((state) => !intentionalStates.has(state))
          .map((state) => parityCapture(state, "pass", row.id.toLowerCase())),
      ],
      intentionalDifference: {
        code: actionMatrix ? "v2-new-thread-action-progress" : "v2-new-thread-create-progress",
        evidence: actionMatrix
          ? "Frozen V1 exposes no pending presentation for held new-thread submission or attachment upload; V2 exposes their real pending states while all other async-action captures remain strict."
          : "Frozen V1 exposes no visible or accessibility pending state while new-thread submission is held; the product rule requires V2 ShimmerText and duplicate-submit suppression.",
      },
    };
  }
  if (
    row.id === "PORT-04" ||
    row.id === "PORT-05" ||
    row.id === "PORT-06" ||
    row.id === "PORT-07"
  ) {
    const policies = {
      "PORT-04": {
        code: "v2-bounded-tunnel-active" as const,
        evidence:
          "Frozen V1 exposes native port forwarding and has no reachable bounded LocalhostPreview path when native forwarding is available; the V2 security contract requires a bounded active tunnel.",
        phase: "active",
      },
      "PORT-05": {
        code: "v2-bounded-tunnel-create-pending" as const,
        evidence:
          "Frozen V1 exposes an active native forward but no bounded creation state; the V2 security contract requires bounded tunnel creation and exposes its pending state.",
        phase: "create-pending",
      },
      "PORT-06": {
        code: "v2-bounded-tunnel-revoke-pending" as const,
        evidence:
          "Frozen V1 exposes an active native forward but no bounded revocation state; the V2 security contract requires bounded tunnel revocation and exposes its pending state.",
        phase: "revoke-pending",
      },
      "PORT-07": {
        code: "v2-bounded-tunnel-expiry" as const,
        evidence:
          "Frozen V1 native forwarding stays active and has no bounded expiry lifecycle; the V2 security contract requires a visible bounded tunnel expiry.",
        phase: "expiry",
      },
    } as const;
    const policy = policies[row.id];
    return {
      ...row,
      status: "intentional-difference",
      captures: [
        parityCapture(`phone-bounded-tunnel-${policy.phase}-policy`, "intentional-difference"),
        parityCapture(`wide-bounded-tunnel-${policy.phase}-policy`, "intentional-difference"),
      ],
      intentionalDifference: { code: policy.code, evidence: policy.evidence },
    };
  }
  if (row.id === "VOICE-02" || row.id === "VOICE-04") {
    const starting = row.id === "VOICE-02";
    return {
      ...row,
      status: "intentional-difference",
      captures: [
        parityCapture(
          `phone-voice-${starting ? "starting" : "finishing"}-policy`,
          "intentional-difference",
        ),
        parityCapture(
          `wide-voice-${starting ? "starting" : "finishing"}-policy`,
          "intentional-difference",
        ),
      ],
      intentionalDifference: {
        code: starting ? "v2-shimmer-voice-starting" : "v2-shimmer-voice-finishing",
        evidence: starting
          ? "Frozen V1 uses an activity spinner while voice capture starts; the product rule requires V2 to use ShimmerText without a spinner."
          : "Frozen V1 uses an activity spinner while voice capture finishes; the product rule requires V2 to use ShimmerText without a spinner.",
      },
    };
  }
  if (row.id === "TERM-07") {
    return {
      ...row,
      status: "intentional-difference",
      captures: [
        parityCapture("phone-terminal-replay-unavailable", "intentional-difference"),
        parityCapture("wide-terminal-replay-unavailable", "intentional-difference"),
        parityCapture("phone-terminal-replay-retry-success"),
        parityCapture("wide-terminal-replay-retry-success"),
      ],
      intentionalDifference: {
        code: "v2-terminal-replay-recovery",
        evidence:
          "Frozen V1 exposes the raw replay-unavailable error and requires closing the tab; V2 explains the replay loss and provides an explicit retry that starts a new shell.",
      },
    };
  }
  if (row.id === "TERM-08") {
    return {
      ...row,
      status: "intentional-difference",
      captures: [
        parityCapture("phone-terminal-exited", "intentional-difference"),
        parityCapture("wide-terminal-exited", "intentional-difference"),
      ],
      intentionalDifference: {
        code: "v2-terminal-exit-lifecycle",
        evidence:
          "Frozen V1 preserves the selected terminal tab and output after exit without lifecycle metadata; V2 additionally exposes the exact terminal exit code.",
      },
    };
  }
  if (row.id === "QUEUE-08") {
    return {
      ...row,
      status: "intentional-difference",
      captures: [
        parityCapture("phone-failed-queue-retry-policy", "intentional-difference"),
        parityCapture("wide-failed-queue-retry-policy", "intentional-difference"),
      ],
      intentionalDifference: {
        code: "v2-retry-failed-queue-item",
        evidence:
          "Frozen V1 leaves a failed queued item without retry; the product rule requires V2 to expose Retry queued prompt.",
      },
    };
  }
  if (row.id === "LIST-21") {
    return {
      ...row,
      status: "intentional-difference",
      captures: [
        parityCapture("phone-catalog-loading-more-policy", "intentional-difference"),
        parityCapture("wide-catalog-loading-more-policy", "intentional-difference"),
        parityCapture("phone-catalog-page-result"),
        parityCapture("wide-catalog-page-result"),
      ],
      intentionalDifference: {
        code: "v2-shimmer-catalog-pagination",
        evidence:
          "Frozen V1 reveals the next catalog page from local SQLite without progress; V2 fetches bounded catalog.page and must use ShimmerText while both expose the same run-bound result.",
      },
    };
  }
  if (row.id === "PAGE-03") {
    return {
      ...row,
      status: "intentional-difference",
      captures: [
        parityCapture("phone-history-loading-newer-policy", "intentional-difference"),
        parityCapture("wide-history-loading-newer-policy", "intentional-difference"),
        parityCapture("phone-history-newer-page-result"),
        parityCapture("wide-history-newer-page-result"),
      ],
      intentionalDifference: {
        code: "v2-shimmer-history-pagination",
        evidence:
          "Frozen V1 reveals the cached newer range from local SQLite without progress; V2 fetches bounded history.page and must use ShimmerText while both expose the same run-bound newer-turn result.",
      },
    };
  }
  if (row.id === "DRAFT-01") {
    return {
      ...row,
      status: "intentional-difference",
      captures: [
        parityCapture("phone-attachment-upload-pending-policy", "intentional-difference"),
        parityCapture("wide-attachment-upload-pending-policy", "intentional-difference"),
        parityCapture("phone-attachment-upload-result"),
        parityCapture("wide-attachment-upload-result"),
      ],
      intentionalDifference: {
        code: "v2-attachment-upload-progress",
        evidence:
          "Frozen V1 does not materialize a draft attachment until upload completes; V2 exposes the real pending attachment draft while both expose the same usable uploaded attachment after release.",
      },
    };
  }
  if (row.id === "VOICE-07") {
    return {
      ...row,
      status: "intentional-difference",
      captures: [
        parityCapture("phone-voice-cancellation-policy", "intentional-difference"),
        parityCapture("wide-voice-cancellation-policy", "intentional-difference"),
      ],
      intentionalDifference: {
        code: "v2-visible-voice-cancellation",
        evidence:
          "Frozen V1 returns to idle before cancellation completes; the product rule requires V2 to expose the pending cancellation state.",
      },
    };
  }
  if (row.id === "AGENT-05") {
    return {
      ...row,
      status: "intentional-difference",
      captures: [
        parityCapture("phone-agent-refresh-error-policy", "intentional-difference"),
        parityCapture("wide-agent-refresh-error-policy", "intentional-difference"),
      ],
      intentionalDifference: {
        code: "v2-visible-agent-retry",
        evidence:
          "Frozen V1 silently retains the cached agent list; the product rule requires V2 to expose a typed retryable error.",
      },
    };
  }
  if (row.id === "CTX-04" || row.id === "CTX-06") {
    const subject = row.id === "CTX-04" ? "changes" : "attachments";
    return {
      ...row,
      status: "intentional-difference",
      captures: [
        parityCapture(`phone-empty-${subject}-chip-policy`, "intentional-difference"),
        parityCapture(`wide-empty-${subject}-chip-policy`, "intentional-difference"),
      ],
      intentionalDifference: {
        code: "v2-hide-empty-context-chip",
        evidence:
          "Frozen V1 renders the empty context chip; the product rule requires V2 to omit it.",
      },
    };
  }
  const requiredInteractionStates = interactionStates(row.id);
  if (requiredInteractionStates.length > 0) {
    return {
      ...row,
      status: "pass",
      captures: requiredInteractionStates.map((state) =>
        parityCapture(state, "pass", row.id.toLowerCase()),
      ),
    };
  }
  const exactFoldState = new Map([
    ["RESP-04", "folded-conversation"],
    ["RESP-05", "unfolded-conversation"],
    ["RESP-06", "folded-to-unfolded-conversation"],
    ["RESP-07", "unfolded-to-folded-conversation"],
  ]).get(row.id);
  const states = exactFoldState === undefined ? targetStates(row.targets, index) : [exactFoldState];
  return { ...row, status: "pass", captures: states.map((state) => parityCapture(state)) };
}

function interactionStates(rowId: string): string[] {
  const prefix = `${rowId}:`;
  return INTERACTION_INVENTORY_STATE_NAMES.filter((entry) => entry.startsWith(prefix)).map(
    (entry) => entry.slice(prefix.length),
  );
}

function targetStates(targets: string, index: number): string[] {
  if (targets === "phone landscape") return [`phone-landscape-row-${index}`];
  if (targets === "folded → unfolded") return [`folded-to-unfolded-row-${index}`];
  if (targets === "unfolded → folded") return [`unfolded-to-folded-row-${index}`];
  if (targets.startsWith("every ")) return [`phone-row-${index}`];
  return targets.split(", ").map((layout) => `${layout}-row-${index}`);
}

describe("Android V2 release evidence", () => {
  it("keeps the release policy aligned with every required harness marker", () => {
    for (const marker of [...REQUIRED_RELEASE_STEPS, ...REQUIRED_RELEASE_OBSERVATIONS]) {
      expect(e2eHarness).toContain(`"${marker}"`);
    }
  });

  it("accepts only complete current emulator evidence for the same source", () => {
    expect(() =>
      validateAndroidE2eEvidence(passingEvidence(), {
        allowPhysicalDevice: false,
        currentFingerprint: CURRENT_FINGERPRINT,
        now: NOW,
      }),
    ).not.toThrow();
  });

  it.each([
    ["failed run", (evidence: AndroidE2eEvidence) => (evidence.passed = false)],
    ["visual-only suite", (evidence: AndroidE2eEvidence) => (evidence.suite = "visualParityOnly")],
    ["V2-only suite", (evidence: AndroidE2eEvidence) => (evidence.suite = "v2Only")],
    ["prebuilt APK", (evidence: AndroidE2eEvidence) => (evidence.buildMode = "prebuilt")],
    [
      "stale run",
      (evidence: AndroidE2eEvidence) => (evidence.completedAt = "2026-09-03T00:00:00.000Z"),
    ],
    [
      "different source",
      (evidence: AndroidE2eEvidence) => (evidence.sourceFingerprint = `sha256:${"b".repeat(64)}`),
    ],
    ["missing scenario", (evidence: AndroidE2eEvidence) => evidence.steps.pop()],
    ["missing observation", (evidence: AndroidE2eEvidence) => evidence.observations.pop()],
    ["missing videos", (evidence: AndroidE2eEvidence) => evidence.videos.pop()],
    ["empty thread", (evidence: AndroidE2eEvidence) => (evidence.threadId = "")],
    [
      "implicit physical device",
      (evidence: AndroidE2eEvidence) => {
        evidence.deviceKind = "physical";
        evidence.deviceSerial = "R5CT123";
      },
    ],
    [
      "inconsistent device identity",
      (evidence: AndroidE2eEvidence) => (evidence.deviceSerial = "R5CT123"),
    ],
  ])("rejects %s", (_label, mutate) => {
    const evidence = passingEvidence();
    mutate(evidence);
    expect(() =>
      validateAndroidE2eEvidence(evidence, {
        allowPhysicalDevice: false,
        currentFingerprint: CURRENT_FINGERPRINT,
        now: NOW,
      }),
    ).toThrow();
  });

  it("rejects structurally incomplete JSON", () => {
    expect(() => parseAndroidE2eEvidence({ passed: true })).toThrow(/steps/u);
  });

  it("accepts explicit physical-device evidence only with release opt-in", () => {
    const evidence = passingEvidence();
    evidence.deviceKind = "physical";
    evidence.deviceSerial = "R5CT123";
    expect(() =>
      validateAndroidE2eEvidence(evidence, {
        allowPhysicalDevice: true,
        currentFingerprint: CURRENT_FINGERPRINT,
        now: NOW,
      }),
    ).not.toThrow();
  });

  it("accepts honest atomic parity evidence and returns every required artifact", () => {
    const evidence = passingParityEvidence();
    expect(() => validateVisualParityMatrix(evidence, visualParityMatrix)).not.toThrow();
    const captureCount = evidence.rows.reduce((count, row) => count + row.captures.length, 0);
    const artifacts = validateVisualParityEvidence(evidence);
    expect(artifacts).toHaveLength(captureCount * VISUAL_PARITY_ARTIFACT_FIELDS.length);
    expect(artifacts).toStrictEqual(
      evidence.rows.flatMap((row) =>
        row.captures.flatMap((capture) =>
          VISUAL_PARITY_ARTIFACT_FIELDS.map((field) => capture[field]),
        ),
      ),
    );
  });

  it("loads the canonical 265-row matrix instead of accepting substituted row ids", () => {
    expect(visualParityMatrix).toHaveLength(265);
    const evidence = passingParityEvidence();
    evidence.rows.find((row) => row.id === "BOOT-01")!.id = "SUBSTITUTE-01";
    expect(() => validateVisualParityMatrix(evidence, visualParityMatrix)).toThrow(/BOOT-01/u);
  });

  it("rejects changed canonical row semantics", () => {
    const evidence = passingParityEvidence();
    evidence.rows.find((row) => row.id === "CTX-04")!.v2Scenario = "Hidden by waiver";
    expect(() => validateVisualParityMatrix(evidence, visualParityMatrix)).toThrow(/CTX-04/u);
  });

  it("proves both approved empty-chip differences from the paired accessibility XML", () => {
    expect(() =>
      validateIntentionalDifferenceXml(
        "CTX-04",
        '<hierarchy><node content-desc="No changes" /></hierarchy>',
        '<hierarchy><node content-desc="Message Codex" /></hierarchy>',
      ),
    ).not.toThrow();
    expect(() =>
      validateIntentionalDifferenceXml(
        "CTX-06",
        '<hierarchy><node content-desc="No attachments · 0" /></hierarchy>',
        '<hierarchy><node content-desc="Message Codex" /></hierarchy>',
      ),
    ).not.toThrow();
  });

  it("proves the approved V2 agent retry difference from the paired accessibility XML", () => {
    expect(() =>
      validateIntentionalDifferenceXml(
        "AGENT-05",
        '<hierarchy><node content-desc="Open subagent worker" enabled="true" text="Worker" /></hierarchy>',
        '<hierarchy><node content-desc="Try again" enabled="true" text="Try again" /><node content-desc="" text="Connection unavailable" /></hierarchy>',
      ),
    ).not.toThrow();
  });

  it("proves the approved V2 queue retry difference from the paired accessibility XML", () => {
    expect(() =>
      validateIntentionalDifferenceXml(
        "QUEUE-08",
        '<hierarchy><node text="E2EFAILEDQUEUE42" /><node text="E2E_QUEUE_RETRY_REQUIRED_42" /></hierarchy>',
        '<hierarchy><node text="E2EFAILEDQUEUE42" /><node text="E2E_QUEUE_RETRY_REQUIRED_42" /><node content-desc="Retry queued prompt" enabled="true" /></hierarchy>',
      ),
    ).not.toThrow();
  });

  it("proves terminal replay recovery and its strict successful retry", () => {
    const v1Unavailable =
      '<hierarchy><node content-desc="Terminal 1" selected="true" /><node content-desc="Close Terminal 1" enabled="true" /><node content-desc="New terminal tab" enabled="true" /><node text="terminal_replay_unavailable" /></hierarchy>';
    const v2Unavailable =
      '<hierarchy><node content-desc="Terminal 1" selected="true" /><node content-desc="Retry terminal after replay loss" enabled="true" /><node text="Terminal history is unavailable" /><node text="The previous output could not be replayed. Retry starts a new shell." /><node text="Failed" /></hierarchy>';
    expect(() =>
      validateIntentionalDifferenceXml(
        "TERM-07",
        v1Unavailable,
        v2Unavailable,
        "phone-terminal-replay-unavailable",
      ),
    ).not.toThrow();
    expect(() =>
      validateRequiredStrictCaptureXml(
        "TERM-07",
        "phone-terminal-replay-retry-success",
        '<hierarchy><node content-desc="Terminal 1" selected="true" /><node text="RETRY_PHONE_V1_abc123" /></hierarchy>',
        '<hierarchy><node content-desc="Terminal 1" selected="true" /><node text="Live" /><node text="RETRY_PHONE_V2_def456" /></hierarchy>',
      ),
    ).not.toThrow();
    expect(() =>
      validateRequiredStrictCaptureXml(
        "TERM-07",
        "phone-terminal-replay-retry-success",
        '<hierarchy><node content-desc="Terminal 1" selected="true" /><node text="RETRY_PHONE_V1_abc123" /></hierarchy>',
        '<hierarchy><node content-desc="Terminal 1" selected="true" /><node text="Live" /><node text="RETRY_WIDE_V2_def456" /></hierarchy>',
      ),
    ).toThrow(/recovered terminal/u);
  });

  it("proves exact terminal exit lifecycle metadata", () => {
    expect(() =>
      validateIntentionalDifferenceXml(
        "TERM-08",
        '<hierarchy><node content-desc="Terminal 1" selected="true" /><node content-desc="Close Terminal 1" enabled="true" /><node text="EXIT_WIDE_V1_abc123" /></hierarchy>',
        '<hierarchy><node content-desc="Terminal 1" selected="true" /><node content-desc="Close Terminal 1" enabled="true" /><node content-desc="Exited · code 23" /><node text="EXIT_WIDE_V2_def456" /></hierarchy>',
        "wide-terminal-exited",
      ),
    ).not.toThrow();
  });

  it("proves the approved catalog pagination progress difference", () => {
    expect(() =>
      validateIntentionalDifferenceXml(
        "LIST-21",
        '<hierarchy><node text="Row parity DEADBEEF catalog 01" /></hierarchy>',
        '<hierarchy><node text="Row parity DEADBEEF catalog 01" /><node text="Loading threads…" /></hierarchy>',
      ),
    ).not.toThrow();
  });

  it("proves the strict settled catalog result paired with LIST-21", () => {
    expect(() =>
      validateRequiredStrictCaptureXml(
        "LIST-21",
        "phone-catalog-page-result",
        '<hierarchy><node text="Row parity DEADBEEF catalog anchor" /></hierarchy>',
        '<hierarchy><node text="Row parity DEADBEEF catalog anchor" /></hierarchy>',
      ),
    ).not.toThrow();
    expect(() =>
      validateRequiredStrictCaptureXml(
        "LIST-21",
        "wide-catalog-page-result",
        '<hierarchy><node text="Row parity DEADBEEF catalog anchor" /></hierarchy>',
        '<hierarchy><node text="Row parity CAFEBABE catalog anchor" /></hierarchy>',
      ),
    ).toThrow(/settled page result/u);
  });

  it("proves PAGE-03 progress and the same settled newer history result", () => {
    expect(() =>
      validateIntentionalDifferenceXml(
        "PAGE-03",
        '<hierarchy><node text="PAGEPHONEDEADBEEF38" /></hierarchy>',
        '<hierarchy><node text="PAGEPHONEDEADBEEF36" /><node text="Loading messages…" /></hierarchy>',
      ),
    ).not.toThrow();
    expect(() =>
      validateRequiredStrictCaptureXml(
        "PAGE-03",
        "phone-history-newer-page-result",
        '<hierarchy><node text="PAGEPHONEDEADBEEF38" /></hierarchy>',
        '<hierarchy><node text="PAGEPHONEDEADBEEF38" /></hierarchy>',
      ),
    ).not.toThrow();
  });

  it("proves DRAFT-01 pending state and the same settled usable attachment", () => {
    const name = "draft-pending-phoneabcdefgh.txt";
    expect(() =>
      validateIntentionalDifferenceXml(
        "DRAFT-01",
        "<hierarchy />",
        `<hierarchy><node content-desc="Draft attachments" /><node text="${name}" /><node text="Uploading ${name}" /></hierarchy>`,
      ),
    ).not.toThrow();
    expect(() =>
      validateRequiredStrictCaptureXml(
        "DRAFT-01",
        "phone-attachment-upload-result",
        `<hierarchy><node text="${name}" /><node content-desc="Remove ${name}" enabled="true" /></hierarchy>`,
        `<hierarchy><node text="${name}" /><node content-desc="Remove attachment" enabled="true" /></hierarchy>`,
      ),
    ).not.toThrow();
    expect(() =>
      validateIntentionalDifferenceXml(
        "INT-05",
        "<hierarchy />",
        `<hierarchy><node content-desc="Draft attachments" /><node text="${name}" /><node text="Uploading ${name}" /></hierarchy>`,
        "phone-action-attachment-upload-pending",
      ),
    ).not.toThrow();
  });

  it.each([
    ["VOICE-02", "Connecting…"],
    ["VOICE-04", "Transcribing…"],
  ])("proves the approved %s spinner-to-shimmer difference", (rowId, progressText) => {
    expect(() =>
      validateIntentionalDifferenceXml(
        rowId,
        `<hierarchy><node content-desc="Voice recording" text="${progressText}" /><node class="android.widget.ProgressBar" /></hierarchy>`,
        `<hierarchy><node content-desc="Voice recording" text="${progressText}" /></hierarchy>`,
      ),
    ).not.toThrow();
  });

  it("proves the approved V2 voice cancellation difference from the paired accessibility XML", () => {
    expect(() =>
      validateIntentionalDifferenceXml(
        "VOICE-07",
        '<hierarchy><node content-desc="Voice input" enabled="true" /></hierarchy>',
        '<hierarchy><node text="Cancelling voice…" /><node content-desc="Cancel voice input" enabled="false" /></hierarchy>',
      ),
    ).not.toThrow();
  });

  it("proves the approved routable empty Attachments difference", () => {
    expect(() =>
      validateIntentionalDifferenceXml(
        "ATT-02",
        '<hierarchy><node content-desc="No attachments" enabled="false" /></hierarchy>',
        '<hierarchy><node content-desc="Close attachments" enabled="true" /><node content-desc="No attachments" enabled="true" text="No attachments in this thread." /></hierarchy>',
      ),
    ).not.toThrow();
  });

  it("proves the approved inline video-player difference", () => {
    expect(() =>
      validateIntentionalDifferenceXml(
        "ATT-07",
        '<hierarchy><node content-desc="Open attachment visual-parity-video-a42.mp4" enabled="true" /></hierarchy>',
        '<hierarchy><node content-desc="Close attachment" enabled="true" /><node content-desc="Video player · ready" text="visual-parity-video-a42.mp4" /></hierarchy>',
      ),
    ).not.toThrow();
  });

  it("proves the approved authoritative waiting-input difference", () => {
    expect(() =>
      validateIntentionalDifferenceXml(
        "ROW-04",
        '<hierarchy><node text="Thread approval" /></hierarchy>',
        '<hierarchy><node text="Waiting for input" /></hierarchy>',
      ),
    ).not.toThrow();
  });

  it.each(["NEW-04", "INT-05"])("proves the approved %s new-thread pending difference", (rowId) => {
    expect(() =>
      validateIntentionalDifferenceXml(
        rowId,
        '<hierarchy><node content-desc="Send message" enabled="true" /></hierarchy>',
        '<hierarchy><node content-desc="Send message" enabled="false" /><node text="Send" /></hierarchy>',
      ),
    ).not.toThrow();
  });

  it.each([
    [
      "PORT-04",
      '<node content-desc="Close browser" enabled="true" /><node text="localhost:4321" /><node text="Bounded" /><node text="WEBOKRUN42" />',
    ],
    [
      "PORT-05",
      '<node text="localhost:4321" /><node text="Opening" /><node content-desc="Open localhost tunnel" enabled="false" /><node content-desc="Close localhost preview" />',
    ],
    [
      "PORT-06",
      '<node text="Revoking bounded tunnel…" /><node content-desc="Close browser" enabled="false" /><node content-desc="Retry revoke" enabled="false" />',
    ],
    [
      "PORT-07",
      '<node text="This bounded tunnel expired." /><node content-desc="Close browser" enabled="true" /><node content-desc="Reconnect" enabled="true" />',
    ],
  ])("proves the approved %s bounded-tunnel difference", (rowId, v2Xml) => {
    const v1Xml =
      '<node content-desc="E2E forward, Live" /><node content-desc="Forwarding actions E2E forward" /><node text=":4321 → phone :5678" />';
    expect(() => validateIntentionalDifferenceXml(rowId, v1Xml, v2Xml)).not.toThrow();
    expect(() => validateIntentionalDifferenceXml(rowId, "<hierarchy />", v2Xml)).toThrow(
      /native forwarding state/u,
    );
  });

  it.each([
    [
      "an unapproved row",
      () => validateIntentionalDifferenceXml("CTX-99", "<hierarchy />", "<hierarchy />"),
    ],
    [
      "missing frozen-V1 empty chip",
      () => validateIntentionalDifferenceXml("CTX-04", "<hierarchy />", "<hierarchy />"),
    ],
    [
      "a populated frozen-V1 chip",
      () =>
        validateIntentionalDifferenceXml(
          "CTX-04",
          '<node content-desc="No changes" /><node content-desc="Changes · 1" />',
          "<hierarchy />",
        ),
    ],
    [
      "an empty V2 chip",
      () =>
        validateIntentionalDifferenceXml(
          "CTX-06",
          '<node content-desc="No attachments" />',
          '<node content-desc="No attachments" />',
        ),
    ],
    [
      "a loading V2 chip",
      () =>
        validateIntentionalDifferenceXml(
          "CTX-06",
          '<node content-desc="No attachments" />',
          '<node content-desc="Loading attachments" />',
        ),
    ],
    [
      "a disabled frozen-V1 agent row",
      () =>
        validateIntentionalDifferenceXml(
          "AGENT-05",
          '<node content-desc="Open subagent worker" enabled="false" text="Worker" />',
          '<node content-desc="Try again" text="Connection unavailable" />',
        ),
    ],
    [
      "a frozen-V1 agent retry",
      () =>
        validateIntentionalDifferenceXml(
          "AGENT-05",
          '<node content-desc="Open subagent worker" enabled="true" /><node content-desc="Try again" />',
          '<node content-desc="Try again" text="Connection unavailable" />',
        ),
    ],
    [
      "a missing V2 agent retry",
      () =>
        validateIntentionalDifferenceXml(
          "AGENT-05",
          '<node content-desc="Open subagent worker" enabled="true" />',
          '<node text="Connection unavailable" />',
        ),
    ],
    [
      "a hidden V2 agent error",
      () =>
        validateIntentionalDifferenceXml(
          "AGENT-05",
          '<node content-desc="Open subagent worker" enabled="true" />',
          '<node content-desc="Try again" text="Try again" />',
        ),
    ],
    [
      "a missing V2 queue retry",
      () =>
        validateIntentionalDifferenceXml(
          "QUEUE-08",
          '<node text="E2EFAILEDQUEUE42" /><node text="E2E_QUEUE_RETRY_REQUIRED_42" />',
          '<node text="E2EFAILEDQUEUE42" /><node text="E2E_QUEUE_RETRY_REQUIRED_42" />',
        ),
    ],
    [
      "a frozen-V1 queue retry",
      () =>
        validateIntentionalDifferenceXml(
          "QUEUE-08",
          '<node text="E2EFAILEDQUEUE42" /><node text="E2E_QUEUE_RETRY_REQUIRED_42" /><node content-desc="Retry queued prompt" />',
          '<node text="E2EFAILEDQUEUE42" /><node text="E2E_QUEUE_RETRY_REQUIRED_42" /><node content-desc="Retry queued prompt" enabled="true" />',
        ),
    ],
    [
      "different V1/V2 failed queue fixtures",
      () =>
        validateIntentionalDifferenceXml(
          "QUEUE-08",
          '<node text="E2EFAILEDQUEUE42" /><node text="E2E_QUEUE_RETRY_REQUIRED_42" />',
          '<node text="E2EFAILEDQUEUE43" /><node text="E2E_QUEUE_RETRY_REQUIRED_43" /><node content-desc="Retry queued prompt" enabled="true" />',
        ),
    ],
    [
      "a frozen-V1 catalog loading indicator",
      () =>
        validateIntentionalDifferenceXml(
          "LIST-21",
          '<node text="Row parity DEADBEEF catalog 01" /><node text="Loading threads…" />',
          '<node text="Row parity DEADBEEF catalog 01" /><node text="Loading threads…" />',
        ),
    ],
    [
      "different V1/V2 catalog fixtures",
      () =>
        validateIntentionalDifferenceXml(
          "LIST-21",
          '<node text="Row parity DEADBEEF catalog 01" />',
          '<node text="Row parity CAFEBABE catalog 01" /><node text="Loading threads…" />',
        ),
    ],
    [
      "a missing frozen-V1 voice spinner",
      () =>
        validateIntentionalDifferenceXml(
          "VOICE-02",
          '<node content-desc="Voice recording" text="Connecting…" />',
          '<node content-desc="Voice recording" text="Connecting…" />',
        ),
    ],
    [
      "a V2 voice spinner",
      () =>
        validateIntentionalDifferenceXml(
          "VOICE-04",
          '<node content-desc="Voice recording" text="Transcribing…" /><node class="android.widget.ProgressBar" />',
          '<node content-desc="Voice recording" text="Transcribing…" /><node class="android.widget.ProgressBar" />',
        ),
    ],
    [
      "changed V2 voice progress content",
      () =>
        validateIntentionalDifferenceXml(
          "VOICE-04",
          '<node content-desc="Voice recording" text="Transcribing…" /><node class="android.widget.ProgressBar" />',
          '<node content-desc="Voice recording" text="Finishing voice…" />',
        ),
    ],
    [
      "a routable frozen-V1 empty Attachments screen",
      () =>
        validateIntentionalDifferenceXml(
          "ATT-02",
          '<node content-desc="No attachments" enabled="false" /><node content-desc="Close attachments" />',
          '<node content-desc="Close attachments" enabled="true" /><node content-desc="No attachments" text="No attachments in this thread." />',
        ),
    ],
    [
      "a missing V2 empty Attachments body",
      () =>
        validateIntentionalDifferenceXml(
          "ATT-02",
          '<node content-desc="No attachments" enabled="false" />',
          '<node content-desc="Close attachments" enabled="true" /><node content-desc="No attachments" />',
        ),
    ],
    [
      "different V1/V2 video fixtures",
      () =>
        validateIntentionalDifferenceXml(
          "ATT-07",
          '<node content-desc="Open attachment visual-parity-video-a42.mp4" enabled="true" />',
          '<node content-desc="Close attachment" enabled="true" /><node content-desc="Video player · ready" text="visual-parity-video-b43.mp4" />',
        ),
    ],
    [
      "a V2 video player that is not ready",
      () =>
        validateIntentionalDifferenceXml(
          "ATT-07",
          '<node content-desc="Open attachment visual-parity-video-a42.mp4" enabled="true" />',
          '<node content-desc="Close attachment" enabled="true" /><node content-desc="Video player · loading" text="visual-parity-video-a42.mp4" />',
        ),
    ],
    [
      "a frozen-V1 authoritative waiting-input state",
      () =>
        validateIntentionalDifferenceXml(
          "ROW-04",
          '<node text="Waiting for input" />',
          '<node text="Waiting for input" />',
        ),
    ],
    [
      "a generic V2 approval state",
      () =>
        validateIntentionalDifferenceXml(
          "ROW-04",
          '<node text="Thread approval" />',
          '<node text="Thread approval" />',
        ),
    ],
    [
      "a disabled frozen-V1 new-thread send action",
      () =>
        validateIntentionalDifferenceXml(
          "NEW-04",
          '<node content-desc="Send message" enabled="false" />',
          '<node content-desc="Send message" enabled="false" text="Send" />',
        ),
    ],
    [
      "a V2 new-thread send action without ShimmerText",
      () =>
        validateIntentionalDifferenceXml(
          "INT-05",
          '<node content-desc="Send message" enabled="true" />',
          '<node content-desc="Send message" enabled="false" />',
        ),
    ],
    [
      "a V2 voice cancellation that already returned idle",
      () =>
        validateIntentionalDifferenceXml(
          "VOICE-07",
          '<node content-desc="Voice input" />',
          '<node content-desc="Voice input" />',
        ),
    ],
    [
      "a terminal replay error without the explicit recovery explanation",
      () =>
        validateIntentionalDifferenceXml(
          "TERM-07",
          '<node content-desc="Terminal 1" selected="true" /><node content-desc="Close Terminal 1" enabled="true" /><node content-desc="New terminal tab" enabled="true" /><node text="terminal_replay_unavailable" />',
          '<node content-desc="Terminal 1" selected="true" /><node content-desc="Retry terminal after replay loss" enabled="true" /><node text="Terminal history is unavailable" /><node text="Failed" />',
          "phone-terminal-replay-unavailable",
        ),
    ],
    [
      "a terminal replay error without the selected tab identity",
      () =>
        validateIntentionalDifferenceXml(
          "TERM-07",
          '<node content-desc="Terminal 1" /><node content-desc="Close Terminal 1" enabled="true" /><node content-desc="New terminal tab" enabled="true" /><node text="terminal_replay_unavailable" />',
          '<node content-desc="Terminal 1" /><node content-desc="Retry terminal after replay loss" enabled="true" /><node text="Terminal history is unavailable" /><node text="The previous output could not be replayed. Retry starts a new shell." /><node text="Failed" />',
          "phone-terminal-replay-unavailable",
        ),
    ],
    [
      "a terminal exit capture without the exact exit lifecycle",
      () =>
        validateIntentionalDifferenceXml(
          "TERM-08",
          '<node content-desc="Terminal 1" selected="true" /><node content-desc="Close Terminal 1" enabled="true" /><node text="EXIT_PHONE_V1_abc123" />',
          '<node content-desc="Terminal 1" selected="true" /><node content-desc="Close Terminal 1" enabled="true" /><node content-desc="Exited · code 0" /><node text="EXIT_PHONE_V2_def456" />',
          "phone-terminal-exited",
        ),
    ],
    [
      "a frozen-V1 pending voice cancellation",
      () =>
        validateIntentionalDifferenceXml(
          "VOICE-07",
          '<node content-desc="Voice input" /><node text="Cancelling voice…" />',
          '<node text="Cancelling voice…" /><node content-desc="Cancel voice input" enabled="false" />',
        ),
    ],
  ])("rejects intentional-difference XML with %s", (_label, validate) => {
    expect(validate).toThrow();
  });

  it.each([
    [
      "wrong matrix size",
      (evidence: VisualParityEvidence) => {
        evidence.matrixRows = 264;
      },
    ],
    [
      "duplicate row ids",
      (evidence: VisualParityEvidence) => {
        evidence.rows[1]!.id = evidence.rows[0]!.id;
      },
    ],
    [
      "dishonest coveredRows",
      (evidence: VisualParityEvidence) => {
        evidence.coveredRows += 1;
      },
    ],
    [
      "dishonest blockedRows",
      (evidence: VisualParityEvidence) => {
        evidence.blockedRows -= 1;
      },
    ],
    [
      "blocked row",
      (evidence: VisualParityEvidence) => {
        const row = evidence.rows[10]!;
        row.status = "blocked";
        row.captures = [];
        row.blocker = {
          code: "non-rewindable-live-state",
          evidence: "The live state cannot be rewound for a deterministic exact pair.",
        };
        evidence.coveredRows -= 1;
        evidence.blockedRows += 1;
      },
    ],
    [
      "generic intentional difference",
      (evidence: VisualParityEvidence) => {
        const row = evidence.rows.find(
          (candidate) => candidate.id !== "CTX-04" && candidate.id !== "CTX-06",
        )!;
        row.status = "intentional-difference";
        row.captures[0]!.status = "intentional-difference";
        row.intentionalDifference = {
          code: "v2-hide-empty-context-chip",
          evidence:
            "Frozen V1 renders the empty context chip; the product rule requires V2 to omit it.",
        };
      },
    ],
    [
      "changed intentional-difference evidence",
      (evidence: VisualParityEvidence) => {
        evidence.rows.find((row) => row.id === "CTX-04")!.intentionalDifference!.evidence =
          "Waived";
      },
    ],
    [
      "intentional difference marked as a normal pass",
      (evidence: VisualParityEvidence) => {
        evidence.rows.find((row) => row.id === "CTX-04")!.status = "pass";
      },
    ],
    [
      "intentional-difference capture marked as a normal pass",
      (evidence: VisualParityEvidence) => {
        evidence.rows.find((row) => row.id === "CTX-04")!.captures[0]!.status = "pass";
      },
    ],
    [
      "missing exact intentional-difference layout",
      (evidence: VisualParityEvidence) => {
        evidence.rows.find((row) => row.id === "CTX-06")!.captures.pop();
      },
    ],
    [
      "changed intentional-difference scenario",
      (evidence: VisualParityEvidence) => {
        evidence.rows.find((row) => row.id === "CTX-06")!.v2Scenario = "Hidden by waiver";
      },
    ],
    [
      "a waived strict INT-05 action capture",
      (evidence: VisualParityEvidence) => {
        const capture = evidence.rows
          .find((row) => row.id === "INT-05")!
          .captures.find((candidate) => candidate.state === "phone-existing-thread-send-pending")!;
        capture.status = "intentional-difference";
      },
    ],
    [
      "an over-threshold strict INT-05 action capture",
      (evidence: VisualParityEvidence) => {
        const capture = evidence.rows
          .find((row) => row.id === "INT-05")!
          .captures.find((candidate) => candidate.state === "phone-existing-thread-send-pending")!;
        capture.ratio = 0.02;
      },
    ],
    [
      "failed row",
      (evidence: VisualParityEvidence) => {
        evidence.rows[0]!.status = "fail";
      },
    ],
    [
      "failed capture",
      (evidence: VisualParityEvidence) => {
        evidence.rows[0]!.captures[0]!.status = "diff";
      },
    ],
    [
      "missing capture artifact",
      (evidence: VisualParityEvidence) => {
        delete evidence.rows[0]!.captures[0]!.v1Xml;
      },
    ],
    [
      "artifact path traversal",
      (evidence: VisualParityEvidence) => {
        evidence.rows[0]!.captures[0]!.diffData = "../diff.json";
      },
    ],
    [
      "aliased capture artifact",
      (evidence: VisualParityEvidence) => {
        evidence.rows[1]!.captures[0]!.v1Screenshot = evidence.rows[0]!.captures[0]!.v1Screenshot;
      },
    ],
    [
      "missing phone layout",
      (evidence: VisualParityEvidence) => {
        for (const row of evidence.rows) {
          for (const capture of row.captures) {
            capture.state = capture.state.replace(/^phone-/u, "compact-");
          }
        }
      },
    ],
    [
      "missing wide layout",
      (evidence: VisualParityEvidence) => {
        for (const row of evidence.rows) {
          for (const capture of row.captures) {
            capture.state = capture.state.replace(/^wide-/u, "expanded-");
          }
        }
      },
    ],
    [
      "missing required foldable row",
      (evidence: VisualParityEvidence) => {
        evidence.rows.find((row) => row.id === "RESP-04")!.id = "RESP-03";
      },
    ],
  ])("rejects visual parity evidence with %s", (_label, mutate) => {
    const evidence = passingParityEvidence();
    mutate(evidence);
    expect(() => {
      validateVisualParityMatrix(evidence, visualParityMatrix);
      validateVisualParityEvidence(evidence);
    }).toThrow();
  });

  it("rejects structurally invalid visual parity JSON", () => {
    expect(() => parseVisualParityEvidence({ schemaVersion: 1, rows: [] })).toThrow(/schema/u);
  });

  it("rejects an incomplete visual parity matrix", () => {
    expect(() => parseVisualParityMatrix("| BOOT-01 | A | B | phone | — | open |\n")).toThrow(
      /265/u,
    );
  });
});
