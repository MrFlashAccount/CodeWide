import { INTERACTION_INVENTORY_STATE_NAMES } from "./interactionInventoryParity.ts";

export const REQUIRED_RELEASE_STEPS = [
  "01-pairing-and-chat-creation",
  "02-mobile-foreground",
  "03-mobile-send-while-backgrounded",
  "04-direct-app-server-while-backgrounded",
  "05-process-death-recovery",
  "06-v2-generation-and-saved-server",
  "07-v2-live-background-queue-and-recovery",
  "08-v2-attachments-and-changes",
  "09-v2-terminal-port-browser-and-system-ui",
] as const;

export const REQUIRED_RELEASE_OBSERVATIONS = [
  "clientDurableCreate",
  "finalCompanionAdmissionCount",
  "appServerOracleResult",
  "v2VoiceRoundTrip",
  "v2AppServerDeltaToPartialUi",
  "v2ForegroundStream",
  "v2KeyboardComposerGeometry",
  "v2LiveBackgroundNotification",
  "v2BackgroundDirectUpdate",
  "v2Queue",
  "v2ReconnectGap",
  "v2ForceStopFreshness",
  "v2AttachmentAuthoritativeInput",
  "v2AttachmentPreview",
  "v2Changes",
  "v2Terminal",
  "v2PortBrowser",
  "visualParityAtomicRows",
] as const;

const REQUIRED_VIDEO_NAMES = REQUIRED_RELEASE_STEPS.filter((name) => /^\d\d-/u.test(name)).map(
  (name) => `${name}.mp4`,
);

const MAX_EVIDENCE_AGE_MS = 6 * 60 * 60 * 1_000;
const MAX_CLOCK_SKEW_MS = 60_000;

export type AndroidE2eEvidence = {
  schemaVersion: 1;
  suite: "full" | "v2Only" | "visualParityOnly";
  backend: "managedAppServer";
  buildMode: "fresh" | "prebuilt";
  completedAt: string;
  runId: string;
  sourceFingerprint: string;
  passed: boolean;
  deviceKind: "emulator" | "physical" | null;
  deviceSerial: string | null;
  threadId: string | null;
  steps: Array<{ name: string; status: "passed" | "failed"; durationMs: number }>;
  observations: Array<{ stage: string; source: string; elapsedMs: number; outcome: string }>;
  videos: string[];
  failure: string | null;
};

export type EvidencePolicyContext = {
  allowPhysicalDevice: boolean;
  currentFingerprint: string;
  now: Date;
};

const REQUIRED_PARITY_ROWS = ["RESP-04", "RESP-05", "RESP-06", "RESP-07"] as const;
const VISUAL_PARITY_MATRIX_ROWS = 265;
const INTENTIONAL_DIFFERENCE_EVIDENCE =
  "Frozen V1 renders the empty context chip; the product rule requires V2 to omit it.";

type IntentionalDifferenceBasePolicy = {
  allowsStrictCaptures?: true;
  captureStates: readonly string[];
  code: VisualParityIntentionalDifference["code"];
  evidence: string;
  id:
    | "AGENT-05"
    | "ATT-02"
    | "ATT-07"
    | "CTX-04"
    | "CTX-06"
    | "DRAFT-01"
    | "LIST-21"
    | "INT-05"
    | "NEW-04"
    | "PAGE-03"
    | "PORT-04"
    | "PORT-05"
    | "PORT-06"
    | "PORT-07"
    | "QUEUE-08"
    | "ROW-04"
    | "TERM-07"
    | "TERM-08"
    | "VOICE-02"
    | "VOICE-04"
    | "VOICE-07";
  targets: "every async action" | "phone, wide";
  requiredStrictCaptureStates?: readonly [string, string];
  v1State: string;
  v2Scenario: string;
};

type IntentionalDifferencePolicy =
  | (IntentionalDifferenceBasePolicy & {
      emptyLabel: string;
      kind: "hidden-context-chip";
      loadingLabel: string;
      populatedLabel: string;
    })
  | (IntentionalDifferenceBasePolicy & { kind: "visible-agent-retry" })
  | (IntentionalDifferenceBasePolicy & { kind: "failed-queue-retry" })
  | (IntentionalDifferenceBasePolicy & { kind: "inline-video-player" })
  | (IntentionalDifferenceBasePolicy & { kind: "routable-empty-attachments" })
  | (IntentionalDifferenceBasePolicy & { kind: "attachment-upload-progress" })
  | (IntentionalDifferenceBasePolicy & { kind: "shimmer-catalog-pagination" })
  | (IntentionalDifferenceBasePolicy & { kind: "shimmer-history-pagination" })
  | (IntentionalDifferenceBasePolicy & {
      kind: "shimmer-voice-progress";
      progressText: "Connecting…" | "Transcribing…";
    })
  | (IntentionalDifferenceBasePolicy & { kind: "authoritative-waiting-input" })
  | (IntentionalDifferenceBasePolicy & { kind: "new-thread-create-progress" })
  | (IntentionalDifferenceBasePolicy & { kind: "terminal-exit-lifecycle" })
  | (IntentionalDifferenceBasePolicy & { kind: "terminal-replay-recovery" })
  | (IntentionalDifferenceBasePolicy & {
      kind: "bounded-tunnel";
      phase: "active" | "create-pending" | "expiry" | "revoke-pending";
    })
  | (IntentionalDifferenceBasePolicy & { kind: "visible-voice-cancellation" });

const INTENTIONAL_DIFFERENCE_POLICIES: readonly IntentionalDifferencePolicy[] = [
  {
    captureStates: ["phone-empty-attachments-policy", "wide-empty-attachments-policy"],
    code: "v2-empty-attachments-state",
    evidence:
      "Frozen V1 exposes only a disabled empty Attachments chip; the product rule requires V2 to expose a routable empty Attachments state.",
    id: "ATT-02",
    kind: "routable-empty-attachments",
    targets: "phone, wide",
    v1State: "Empty Attachments is an unreachable disabled chip",
    v2Scenario: "Routable empty Attachments state",
  },
  {
    captureStates: ["phone-inline-video-player-policy", "wide-inline-video-player-policy"],
    code: "v2-inline-video-player",
    evidence:
      "Frozen V1 downloads video attachments; the product rule requires V2 to open them in an inline player.",
    id: "ATT-07",
    kind: "inline-video-player",
    targets: "phone, wide",
    v1State: "Video attachment downloads without inline playback",
    v2Scenario: "Video attachment opens in inline player",
  },
  {
    captureStates: ["phone-empty-changes-chip-policy", "wide-empty-changes-chip-policy"],
    code: "v2-hide-empty-context-chip",
    emptyLabel: "No changes",
    evidence: INTENTIONAL_DIFFERENCE_EVIDENCE,
    id: "CTX-04",
    kind: "hidden-context-chip",
    loadingLabel: "Loading changes",
    populatedLabel: "Changes ·",
    targets: "phone, wide",
    v1State: "Empty Changes chip shown in frozen V1",
    v2Scenario: "Empty Changes chip intentionally absent",
  },
  {
    captureStates: ["phone-empty-attachments-chip-policy", "wide-empty-attachments-chip-policy"],
    code: "v2-hide-empty-context-chip",
    emptyLabel: "No attachments",
    evidence: INTENTIONAL_DIFFERENCE_EVIDENCE,
    id: "CTX-06",
    kind: "hidden-context-chip",
    loadingLabel: "Loading attachments",
    populatedLabel: "Attachments ·",
    targets: "phone, wide",
    v1State: "Empty Attachments chip shown in frozen V1",
    v2Scenario: "Empty Attachments chip intentionally absent",
  },
  {
    captureStates: ["phone-agent-refresh-error-policy", "wide-agent-refresh-error-policy"],
    code: "v2-visible-agent-retry",
    evidence:
      "Frozen V1 silently retains the cached agent list; the product rule requires V2 to expose a typed retryable error.",
    id: "AGENT-05",
    kind: "visible-agent-retry",
    targets: "phone, wide",
    v1State: "Agent refresh failure silently retains cached list",
    v2Scenario: "Agent refresh failure shows typed retryable error",
  },
  {
    allowsStrictCaptures: true,
    captureStates: ["phone-catalog-loading-more-policy", "wide-catalog-loading-more-policy"],
    code: "v2-shimmer-catalog-pagination",
    evidence:
      "Frozen V1 reveals the next catalog page from local SQLite without progress; V2 fetches bounded catalog.page and must use ShimmerText while both expose the same run-bound result.",
    id: "LIST-21",
    kind: "shimmer-catalog-pagination",
    requiredStrictCaptureStates: ["phone-catalog-page-result", "wide-catalog-page-result"],
    targets: "phone, wide",
    v1State: "Next local SQLite page appears without progress",
    v2Scenario: "Same next row arrives from bounded catalog.page with ShimmerText",
  },
  {
    allowsStrictCaptures: true,
    captureStates: ["phone-history-loading-newer-policy", "wide-history-loading-newer-policy"],
    code: "v2-shimmer-history-pagination",
    evidence:
      "Frozen V1 reveals the cached newer range from local SQLite without progress; V2 fetches bounded history.page and must use ShimmerText while both expose the same run-bound newer-turn result.",
    id: "PAGE-03",
    kind: "shimmer-history-pagination",
    requiredStrictCaptureStates: [
      "phone-history-newer-page-result",
      "wide-history-newer-page-result",
    ],
    targets: "phone, wide",
    v1State: "Cached newer range appears without progress",
    v2Scenario: "Same newer range arrives from bounded history.page with ShimmerText",
  },
  {
    allowsStrictCaptures: true,
    captureStates: [
      "phone-attachment-upload-pending-policy",
      "wide-attachment-upload-pending-policy",
    ],
    code: "v2-attachment-upload-progress",
    evidence:
      "Frozen V1 does not materialize a draft attachment until upload completes; V2 exposes the real pending attachment draft while both expose the same usable uploaded attachment after release.",
    id: "DRAFT-01",
    kind: "attachment-upload-progress",
    requiredStrictCaptureStates: [
      "phone-attachment-upload-result",
      "wide-attachment-upload-result",
    ],
    targets: "phone, wide",
    v1State: "No attachment card while upload is pending",
    v2Scenario: "Attachment upload pending card",
  },
  {
    captureStates: ["phone-failed-queue-retry-policy", "wide-failed-queue-retry-policy"],
    code: "v2-retry-failed-queue-item",
    evidence:
      "Frozen V1 leaves a failed queued item without retry; the product rule requires V2 to expose Retry queued prompt.",
    id: "QUEUE-08",
    kind: "failed-queue-retry",
    targets: "phone, wide",
    v1State: "Failed queued item without retry action",
    v2Scenario: "Failed queued item exposes retry action",
  },
  {
    captureStates: ["phone-waiting-input-row-policy", "wide-waiting-input-row-policy"],
    code: "v2-authoritative-waiting-input",
    evidence:
      "Frozen V1 exposes the generic Thread approval attention state; the product rule requires V2 to expose the authoritative Waiting for input state while preserving the same visual treatment.",
    id: "ROW-04",
    kind: "authoritative-waiting-input",
    targets: "phone, wide",
    v1State: "Generic Thread approval attention state",
    v2Scenario: "Authoritative Waiting for input state",
  },
  {
    captureStates: ["phone-bounded-tunnel-active-policy", "wide-bounded-tunnel-active-policy"],
    code: "v2-bounded-tunnel-active",
    evidence:
      "Frozen V1 exposes native port forwarding and has no reachable bounded LocalhostPreview path when native forwarding is available; the V2 security contract requires a bounded active tunnel.",
    id: "PORT-04",
    kind: "bounded-tunnel",
    phase: "active",
    targets: "phone, wide",
    v1State: "Native port forwarding active",
    v2Scenario: "Bounded tunnel active",
  },
  {
    captureStates: ["phone-new-thread-create-pending", "wide-new-thread-create-pending"],
    code: "v2-new-thread-create-progress",
    evidence:
      "Frozen V1 exposes no visible or accessibility pending state while new-thread submission is held; the product rule requires V2 ShimmerText and duplicate-submit suppression.",
    id: "NEW-04",
    kind: "new-thread-create-progress",
    targets: "phone, wide",
    v1State: "New-thread create has no pending presentation",
    v2Scenario: "New-thread create shows ShimmerText and disables duplicate submit",
  },
  {
    allowsStrictCaptures: true,
    captureStates: [
      "phone-new-thread-create-pending",
      "wide-new-thread-create-pending",
      "phone-action-attachment-upload-pending",
      "wide-action-attachment-upload-pending",
    ],
    code: "v2-new-thread-action-progress",
    evidence:
      "Frozen V1 exposes no pending presentation for held new-thread submission or attachment upload; V2 exposes their real pending states while all other async-action captures remain strict.",
    id: "INT-05",
    kind: "new-thread-create-progress",
    targets: "every async action",
    v1State:
      "New-thread submit and attachment upload have no pending presentation; other async actions retain their states",
    v2Scenario:
      "New-thread submit and attachment upload expose pending state; other async actions match",
  },
  {
    captureStates: [
      "phone-bounded-tunnel-create-pending-policy",
      "wide-bounded-tunnel-create-pending-policy",
    ],
    code: "v2-bounded-tunnel-create-pending",
    evidence:
      "Frozen V1 exposes an active native forward but no bounded creation state; the V2 security contract requires bounded tunnel creation and exposes its pending state.",
    id: "PORT-05",
    kind: "bounded-tunnel",
    phase: "create-pending",
    targets: "phone, wide",
    v1State: "Native forwarding active; bounded create state absent",
    v2Scenario: "Bounded tunnel create pending",
  },
  {
    captureStates: [
      "phone-bounded-tunnel-revoke-pending-policy",
      "wide-bounded-tunnel-revoke-pending-policy",
    ],
    code: "v2-bounded-tunnel-revoke-pending",
    evidence:
      "Frozen V1 exposes an active native forward but no bounded revocation state; the V2 security contract requires bounded tunnel revocation and exposes its pending state.",
    id: "PORT-06",
    kind: "bounded-tunnel",
    phase: "revoke-pending",
    targets: "phone, wide",
    v1State: "Native forwarding active; bounded revoke state absent",
    v2Scenario: "Bounded tunnel revoke pending",
  },
  {
    captureStates: ["phone-bounded-tunnel-expiry-policy", "wide-bounded-tunnel-expiry-policy"],
    code: "v2-bounded-tunnel-expiry",
    evidence:
      "Frozen V1 native forwarding stays active and has no bounded expiry lifecycle; the V2 security contract requires a visible bounded tunnel expiry.",
    id: "PORT-07",
    kind: "bounded-tunnel",
    phase: "expiry",
    targets: "phone, wide",
    v1State: "Native forwarding stays active; bounded expiry absent",
    v2Scenario: "Bounded tunnel expiry",
  },
  {
    captureStates: ["phone-voice-starting-policy", "wide-voice-starting-policy"],
    code: "v2-shimmer-voice-starting",
    evidence:
      "Frozen V1 uses an activity spinner while voice capture starts; the product rule requires V2 to use ShimmerText without a spinner.",
    id: "VOICE-02",
    kind: "shimmer-voice-progress",
    progressText: "Connecting…",
    targets: "phone, wide",
    v1State: "Voice starting uses activity spinner",
    v2Scenario: "Voice starting uses ShimmerText only",
  },
  {
    captureStates: ["phone-voice-finishing-policy", "wide-voice-finishing-policy"],
    code: "v2-shimmer-voice-finishing",
    evidence:
      "Frozen V1 uses an activity spinner while voice capture finishes; the product rule requires V2 to use ShimmerText without a spinner.",
    id: "VOICE-04",
    kind: "shimmer-voice-progress",
    progressText: "Transcribing…",
    targets: "phone, wide",
    v1State: "Voice finishing uses activity spinner",
    v2Scenario: "Voice finishing uses ShimmerText only",
  },
  {
    captureStates: ["phone-voice-cancellation-policy", "wide-voice-cancellation-policy"],
    code: "v2-visible-voice-cancellation",
    evidence:
      "Frozen V1 returns to idle before cancellation completes; the product rule requires V2 to expose the pending cancellation state.",
    id: "VOICE-07",
    kind: "visible-voice-cancellation",
    targets: "phone, wide",
    v1State: "Voice cancellation returns immediately to idle",
    v2Scenario: "Voice cancellation exposes pending state",
  },
  {
    allowsStrictCaptures: true,
    captureStates: ["phone-terminal-replay-unavailable", "wide-terminal-replay-unavailable"],
    code: "v2-terminal-replay-recovery",
    evidence:
      "Frozen V1 exposes the raw replay-unavailable error and requires closing the tab; V2 explains the replay loss and provides an explicit retry that starts a new shell.",
    id: "TERM-07",
    kind: "terminal-replay-recovery",
    requiredStrictCaptureStates: [
      "phone-terminal-replay-retry-success",
      "wide-terminal-replay-retry-success",
    ],
    targets: "phone, wide",
    v1State: "Raw replay-unavailable error requires Close/New tab",
    v2Scenario: "Human replay-loss error, Failed status, and explicit retry",
  },
  {
    captureStates: ["phone-terminal-exited", "wide-terminal-exited"],
    code: "v2-terminal-exit-lifecycle",
    evidence:
      "Frozen V1 preserves the selected terminal tab and output after exit without lifecycle metadata; V2 additionally exposes the exact terminal exit code.",
    id: "TERM-08",
    kind: "terminal-exit-lifecycle",
    targets: "phone, wide",
    v1State: "Exited shell retains tab/output without lifecycle metadata",
    v2Scenario: "Exited shell exposes exact `Exited · code 23` lifecycle metadata",
  },
];

type VisualParityStatus = "blocked" | "pass" | "diff" | "fail" | "intentional-difference";

type VisualParityBlocker = {
  code: string;
  evidence: string;
};

export type VisualParityIntentionalDifference = {
  code:
    | "v2-authoritative-waiting-input"
    | "v2-attachment-upload-progress"
    | "v2-bounded-tunnel-active"
    | "v2-bounded-tunnel-create-pending"
    | "v2-bounded-tunnel-expiry"
    | "v2-bounded-tunnel-revoke-pending"
    | "v2-empty-attachments-state"
    | "v2-hide-empty-context-chip"
    | "v2-inline-video-player"
    | "v2-new-thread-action-progress"
    | "v2-new-thread-create-progress"
    | "v2-retry-failed-queue-item"
    | "v2-shimmer-catalog-pagination"
    | "v2-shimmer-history-pagination"
    | "v2-shimmer-voice-finishing"
    | "v2-shimmer-voice-starting"
    | "v2-terminal-exit-lifecycle"
    | "v2-terminal-replay-recovery"
    | "v2-visible-agent-retry"
    | "v2-visible-voice-cancellation";
  evidence: string;
};

export type VisualParityCapture = {
  state: string;
  status: VisualParityStatus;
  v1Screenshot?: string;
  v1Xml?: string;
  v2Screenshot?: string;
  v2Xml?: string;
  diffImage?: string;
  diffData?: string;
  ratio?: number;
  threshold?: number;
};

export type VisualParityRow = {
  id: string;
  status: VisualParityStatus;
  captures: VisualParityCapture[];
  blocker?: VisualParityBlocker;
  intentionalDifference?: VisualParityIntentionalDifference;
  targets: string;
  v1State: string;
  v2Scenario: string;
};

export type VisualParityEvidence = {
  schemaVersion: 1;
  matrixRows: number;
  coveredRows: number;
  blockedRows: number;
  rows: VisualParityRow[];
};

export type VisualParityMatrixRow = {
  id: string;
  releaseStatus: "intentional-difference" | "pass";
  targets: string;
  v1State: string;
  v2Scenario: string;
};

export function parseAndroidE2eEvidence(value: unknown): AndroidE2eEvidence {
  if (!isRecord(value)) throw new Error("Android E2E evidence must be a JSON object");
  const steps = value.steps;
  const observations = value.observations;
  const videos = value.videos;
  if (!Array.isArray(steps) || !steps.every(isStep)) {
    throw new Error("Android E2E evidence contains invalid steps");
  }
  if (!Array.isArray(observations) || !observations.every(isObservation)) {
    throw new Error("Android E2E evidence contains invalid observations");
  }
  if (!Array.isArray(videos) || !videos.every((video) => typeof video === "string")) {
    throw new Error("Android E2E evidence contains invalid video paths");
  }
  if (
    value.schemaVersion !== 1 ||
    (value.suite !== "full" && value.suite !== "v2Only" && value.suite !== "visualParityOnly") ||
    value.backend !== "managedAppServer" ||
    (value.buildMode !== "fresh" && value.buildMode !== "prebuilt") ||
    typeof value.completedAt !== "string" ||
    typeof value.runId !== "string" ||
    typeof value.sourceFingerprint !== "string" ||
    typeof value.passed !== "boolean" ||
    (value.deviceKind !== "emulator" &&
      value.deviceKind !== "physical" &&
      value.deviceKind !== null) ||
    (typeof value.deviceSerial !== "string" && value.deviceSerial !== null) ||
    (typeof value.threadId !== "string" && value.threadId !== null) ||
    (typeof value.failure !== "string" && value.failure !== null)
  ) {
    throw new Error("Android E2E evidence has an invalid release schema");
  }
  return {
    schemaVersion: value.schemaVersion,
    suite: value.suite,
    backend: value.backend,
    buildMode: value.buildMode,
    completedAt: value.completedAt,
    runId: value.runId,
    sourceFingerprint: value.sourceFingerprint,
    passed: value.passed,
    deviceKind: value.deviceKind,
    deviceSerial: value.deviceSerial,
    threadId: value.threadId,
    steps,
    observations,
    videos,
    failure: value.failure,
  };
}

export function validateAndroidE2eEvidence(
  evidence: AndroidE2eEvidence,
  context: EvidencePolicyContext,
): void {
  if (!evidence.passed || evidence.failure !== null) {
    throw new Error(
      `Android E2E evidence is not passing: ${evidence.failure ?? "unknown failure"}`,
    );
  }
  if (
    evidence.suite !== "full" ||
    evidence.backend !== "managedAppServer" ||
    evidence.buildMode !== "fresh"
  ) {
    throw new Error(
      "Android release requires a fresh build and the full managed-App-Server E2E suite",
    );
  }
  if (evidence.runId === "" || !/^sha256:[0-9a-f]{64}$/u.test(evidence.sourceFingerprint)) {
    throw new Error("Android E2E evidence has invalid run or source identity");
  }
  const completedAt = Date.parse(evidence.completedAt);
  if (!Number.isFinite(completedAt)) throw new Error("Android E2E completedAt is invalid");
  const age = context.now.getTime() - completedAt;
  if (age < -MAX_CLOCK_SKEW_MS || age > MAX_EVIDENCE_AGE_MS) {
    throw new Error("Android E2E evidence is not current (maximum age is 6 hours)");
  }
  if (evidence.sourceFingerprint !== context.currentFingerprint) {
    throw new Error("Android E2E evidence was produced from a different source state");
  }
  if (
    evidence.deviceSerial === null ||
    evidence.deviceSerial === "" ||
    evidence.deviceKind === null
  ) {
    throw new Error("Android E2E evidence has no device");
  }
  if (evidence.threadId === null || evidence.threadId === "") {
    throw new Error("Android E2E evidence has no exercised thread");
  }
  const serialIsEmulator = evidence.deviceSerial.startsWith("emulator-");
  if (
    (evidence.deviceKind === "emulator") !== serialIsEmulator ||
    (evidence.deviceKind === "physical") === serialIsEmulator
  ) {
    throw new Error("Android E2E evidence has inconsistent device identity");
  }
  if (evidence.deviceKind === "physical" && !context.allowPhysicalDevice) {
    throw new Error("Physical-device evidence requires CODEWIDE_ALLOW_PHYSICAL_E2E_EVIDENCE=1");
  }
  const passedSteps = new Set(
    evidence.steps.filter((step) => step.status === "passed").map((step) => step.name),
  );
  const failedSteps = evidence.steps.filter((step) => step.status !== "passed");
  if (failedSteps.length > 0) throw new Error("Android E2E evidence contains failed steps");
  requireMarkers("step", REQUIRED_RELEASE_STEPS, passedSteps);
  const observedStages = new Set(evidence.observations.map((observation) => observation.stage));
  requireMarkers("observation", REQUIRED_RELEASE_OBSERVATIONS, observedStages);
  requireMarkers("video", REQUIRED_VIDEO_NAMES, new Set(evidence.videos));
}

export function parseVisualParityEvidence(value: unknown): VisualParityEvidence {
  if (!isRecord(value)) throw new Error("Visual parity evidence must be a JSON object");
  if (
    value.schemaVersion !== 1 ||
    typeof value.matrixRows !== "number" ||
    !Number.isInteger(value.matrixRows) ||
    typeof value.coveredRows !== "number" ||
    !Number.isInteger(value.coveredRows) ||
    typeof value.blockedRows !== "number" ||
    !Number.isInteger(value.blockedRows) ||
    !Array.isArray(value.rows) ||
    !value.rows.every(isVisualParityRow)
  ) {
    throw new Error("Visual parity evidence has an invalid schema");
  }
  return {
    schemaVersion: value.schemaVersion,
    matrixRows: value.matrixRows,
    coveredRows: value.coveredRows,
    blockedRows: value.blockedRows,
    rows: value.rows,
  };
}

export function parseVisualParityMatrix(markdown: string): VisualParityMatrixRow[] {
  const rows = markdown
    .split("\n")
    .filter((line) => /^\| [A-Z]+-\d+\s+\|/u.test(line))
    .map(parseVisualParityMatrixLine);
  if (
    rows.length !== VISUAL_PARITY_MATRIX_ROWS ||
    new Set(rows.map((row) => row.id)).size !== VISUAL_PARITY_MATRIX_ROWS
  ) {
    throw new Error(
      `Visual parity matrix must contain ${VISUAL_PARITY_MATRIX_ROWS} unique atomic rows`,
    );
  }
  return rows;
}

export function validateVisualParityMatrix(
  evidence: VisualParityEvidence,
  matrix: readonly VisualParityMatrixRow[],
): void {
  if (
    matrix.length !== VISUAL_PARITY_MATRIX_ROWS ||
    new Set(matrix.map((row) => row.id)).size !== VISUAL_PARITY_MATRIX_ROWS
  ) {
    throw new Error("Canonical visual parity matrix is incomplete");
  }
  const evidenceById = new Map(evidence.rows.map((row) => [row.id, row]));
  for (const expected of matrix) {
    const actual = evidenceById.get(expected.id);
    if (
      actual === undefined ||
      actual.status !== expected.releaseStatus ||
      actual.targets !== expected.targets ||
      actual.v1State !== expected.v1State ||
      actual.v2Scenario !== expected.v2Scenario
    ) {
      throw new Error(`Visual parity evidence does not match canonical row ${expected.id}`);
    }
  }
}

export function validateVisualParityEvidence(evidence: VisualParityEvidence): string[] {
  if (
    evidence.matrixRows !== VISUAL_PARITY_MATRIX_ROWS ||
    evidence.rows.length !== VISUAL_PARITY_MATRIX_ROWS
  ) {
    throw new Error(`Visual parity evidence must contain ${VISUAL_PARITY_MATRIX_ROWS} rows`);
  }
  const rowIds = new Set(evidence.rows.map((row) => row.id));
  if (rowIds.size !== evidence.rows.length) {
    throw new Error("Visual parity evidence contains duplicate row ids");
  }
  const passedRows = evidence.rows.filter((row) => row.status === "pass");
  const intentionalDifferenceRows = evidence.rows.filter(
    (row) => row.status === "intentional-difference",
  );
  const blockedRows = evidence.rows.filter((row) => row.status === "blocked");
  if (
    evidence.coveredRows !== VISUAL_PARITY_MATRIX_ROWS ||
    evidence.coveredRows !== passedRows.length + intentionalDifferenceRows.length
  ) {
    throw new Error("Visual parity coveredRows does not match the passing rows");
  }
  if (
    evidence.blockedRows !== blockedRows.length ||
    evidence.coveredRows + evidence.blockedRows !== evidence.matrixRows
  ) {
    throw new Error("Visual parity blockedRows does not account for the full matrix");
  }
  const artifacts: string[] = [];
  const uniqueArtifacts = new Set<string>();
  for (const row of evidence.rows) {
    if (row.status === "diff" || row.status === "fail") {
      throw new Error(`Visual parity row ${row.id} is ${row.status}`);
    }
    if (row.status === "blocked") {
      const reason = row.blocker?.code ?? "missing blocker evidence";
      throw new Error(`Visual parity row ${row.id} is blocked: ${reason}`);
    }
    if (row.blocker !== undefined) {
      throw new Error(`Passing visual parity row ${row.id} still carries a blocker`);
    }
    const intentionalPolicy = intentionalDifferencePolicy(row.id);
    if (row.status === "intentional-difference") {
      validateIntentionalDifferenceRow(row, intentionalPolicy);
    } else if (intentionalPolicy !== undefined || row.intentionalDifference !== undefined) {
      throw new Error(`Visual parity row ${row.id} has an invalid intentional-difference policy`);
    }
    if (row.captures.length === 0) {
      throw new Error(`Passing visual parity row ${row.id} has no paired capture`);
    }
    if (new Set(row.captures.map((capture) => capture.state)).size !== row.captures.length) {
      throw new Error(`Visual parity row ${row.id} contains duplicate capture states`);
    }
    validateTargetLayoutCoverage(row);
    for (const capture of row.captures) {
      const expectedCaptureStatus =
        intentionalPolicy?.captureStates.includes(capture.state) === true
          ? "intentional-difference"
          : "pass";
      if (capture.status !== expectedCaptureStatus) {
        throw new Error(`Visual parity capture ${row.id}/${capture.state} is ${capture.status}`);
      }
      if (
        capture.ratio === undefined ||
        capture.threshold === undefined ||
        (expectedCaptureStatus === "pass" && capture.ratio > capture.threshold)
      ) {
        throw new Error(`Visual parity capture ${row.id}/${capture.state} exceeds its threshold`);
      }
      for (const key of [
        "v1Screenshot",
        "v1Xml",
        "v2Screenshot",
        "v2Xml",
        "diffImage",
        "diffData",
      ] as const) {
        const artifact = capture[key];
        if (artifact === undefined || artifact === "" || pathBasename(artifact) !== artifact) {
          throw new Error(`Visual parity capture ${row.id}/${capture.state} has invalid ${key}`);
        }
        if (uniqueArtifacts.has(artifact)) {
          throw new Error(`Visual parity artifact is aliased across captures: ${artifact}`);
        }
        uniqueArtifacts.add(artifact);
        artifacts.push(artifact);
      }
    }
  }
  for (const policy of INTENTIONAL_DIFFERENCE_POLICIES) {
    if (!intentionalDifferenceRows.some((row) => row.id === policy.id)) {
      throw new Error(`Visual parity evidence is missing intentional difference ${policy.id}`);
    }
  }
  const passedCaptures = passedRows.flatMap((row) => row.captures);
  if (!passedCaptures.some((capture) => capture.state.startsWith("phone-"))) {
    throw new Error("Visual parity evidence has no exact phone-layout pair");
  }
  if (!passedCaptures.some((capture) => capture.state.startsWith("wide-"))) {
    throw new Error("Visual parity evidence has no exact wide-layout pair");
  }
  for (const requiredRow of REQUIRED_PARITY_ROWS) {
    if (!passedRows.some((row) => row.id === requiredRow)) {
      throw new Error(`Visual parity evidence is missing exact pair ${requiredRow}`);
    }
  }
  const capturedInteractionStates = new Set(
    evidence.rows.flatMap((row) => row.captures.map((capture) => `${row.id}:${capture.state}`)),
  );
  const missingInteractionStates = INTERACTION_INVENTORY_STATE_NAMES.filter(
    (state) => !capturedInteractionStates.has(state),
  );
  if (missingInteractionStates.length > 0) {
    throw new Error(
      `Visual parity evidence lacks exact interaction inventory: ${missingInteractionStates.join(", ")}`,
    );
  }
  return artifacts;
}

function validateTargetLayoutCoverage(row: VisualParityRow): void {
  const requiredPrefixes = targetLayoutPrefixes(row.targets);
  for (const prefix of requiredPrefixes) {
    if (!row.captures.some((capture) => capture.state.startsWith(prefix))) {
      throw new Error(`Visual parity row ${row.id} has no exact ${prefix.slice(0, -1)} capture`);
    }
  }
}

function targetLayoutPrefixes(targets: string): readonly string[] {
  if (targets === "phone landscape") return ["phone-landscape-"];
  if (targets === "folded → unfolded") return ["folded-to-unfolded-"];
  if (targets === "unfolded → folded") return ["unfolded-to-folded-"];
  if (targets.startsWith("every ")) return [];
  const layouts = targets.split(", ");
  const allowed = new Set(["folded", "phone", "unfolded", "wide"]);
  if (!layouts.every((layout) => allowed.has(layout))) {
    throw new Error(`Visual parity targets are not covered by the release policy: ${targets}`);
  }
  return layouts.map((layout) => `${layout}-`);
}

export function validateIntentionalDifferenceXml(
  rowId: string,
  v1Xml: string,
  v2Xml: string,
  state?: string,
): void {
  const policy = intentionalDifferencePolicy(rowId);
  if (policy === undefined) {
    throw new Error(`Visual parity row ${rowId} is not an approved intentional difference`);
  }
  const v1Descriptions = contentDescriptions(v1Xml);
  const v2Descriptions = contentDescriptions(v2Xml);
  if (policy.kind === "visible-agent-retry") {
    validateAgentRetryXml(rowId, v1Xml, v2Xml, v1Descriptions, v2Descriptions);
    return;
  }
  if (policy.kind === "failed-queue-retry") {
    validateFailedQueueRetryXml(rowId, v1Xml, v2Xml, v1Descriptions);
    return;
  }
  if (policy.kind === "routable-empty-attachments") {
    validateEmptyAttachmentsXml(rowId, v1Xml, v2Xml, v1Descriptions, v2Descriptions);
    return;
  }
  if (policy.kind === "shimmer-catalog-pagination") {
    validateCatalogPaginationXml(rowId, v1Xml, v2Xml);
    return;
  }
  if (policy.kind === "shimmer-history-pagination") {
    validateHistoryPaginationXml(rowId, v1Xml, v2Xml);
    return;
  }
  if (policy.kind === "attachment-upload-progress") {
    validateAttachmentUploadProgressXml(rowId, v1Xml, v2Xml, v1Descriptions, v2Descriptions);
    return;
  }
  if (policy.kind === "inline-video-player") {
    validateInlineVideoXml(rowId, v1Xml, v2Xml, v1Descriptions, v2Descriptions);
    return;
  }
  if (policy.kind === "authoritative-waiting-input") {
    validateAuthoritativeWaitingInputXml(rowId, v1Xml, v2Xml);
    return;
  }
  if (policy.kind === "new-thread-create-progress") {
    if (rowId === "INT-05" && state?.endsWith("-action-attachment-upload-pending") === true) {
      validateAttachmentUploadProgressXml(rowId, v1Xml, v2Xml, v1Descriptions, v2Descriptions);
      return;
    }
    validateNewThreadCreateProgressXml(rowId, v1Xml, v2Xml);
    return;
  }
  if (policy.kind === "bounded-tunnel") {
    validateBoundedTunnelXml({
      phase: policy.phase,
      rowId,
      v1Descriptions,
      v1Xml,
      v2Descriptions,
      v2Xml,
    });
    return;
  }
  if (policy.kind === "visible-voice-cancellation") {
    validateVoiceCancellationXml(rowId, v1Xml, v2Xml, v1Descriptions, v2Descriptions);
    return;
  }
  if (policy.kind === "shimmer-voice-progress") {
    validateVoiceProgressXml(rowId, policy.progressText, v1Xml, v2Xml);
    return;
  }
  if (policy.kind === "terminal-replay-recovery") {
    validateTerminalReplayUnavailableXml(rowId, state, v1Xml, v2Xml);
    return;
  }
  if (policy.kind === "terminal-exit-lifecycle") {
    validateTerminalExitLifecycleXml(rowId, state, v1Xml, v2Xml);
    return;
  }
  if (!v1Descriptions.some((description) => description.startsWith(policy.emptyLabel))) {
    throw new Error(`Frozen V1 evidence for ${rowId} does not show ${policy.emptyLabel}`);
  }
  const v1Forbidden = [policy.loadingLabel, policy.populatedLabel];
  if (v1Descriptions.some((description) => startsWithAny(description, v1Forbidden))) {
    throw new Error(`Frozen V1 evidence for ${rowId} does not show the required empty state`);
  }
  const v2Forbidden = [policy.emptyLabel, policy.loadingLabel, policy.populatedLabel];
  if (v2Descriptions.some((description) => startsWithAny(description, v2Forbidden))) {
    throw new Error(`V2 evidence for ${rowId} still shows the forbidden context chip`);
  }
}

export function validateRequiredStrictCaptureXml(
  rowId: string,
  state: string,
  v1Xml: string,
  v2Xml: string,
): void {
  const policy = intentionalDifferencePolicy(rowId);
  if (policy?.requiredStrictCaptureStates?.includes(state) !== true) return;
  if (policy.kind === "shimmer-catalog-pagination") {
    const resultPattern = /^Row parity [A-Z0-9]{8} catalog anchor$/u;
    const v1Results = new Set(textValues(v1Xml).filter((value) => resultPattern.test(value)));
    const sharedResult = textValues(v2Xml).find((value) => v1Results.has(value));
    if (
      sharedResult === undefined ||
      textValues(v1Xml).includes("Loading threads…") ||
      textValues(v2Xml).includes("Loading threads…")
    ) {
      throw new Error(
        `Visual parity evidence for ${rowId}/${state} lacks the same settled page result`,
      );
    }
    return;
  }
  if (policy.kind === "shimmer-history-pagination") {
    validateSettledHistoryPaginationXml(rowId, state, v1Xml, v2Xml);
    return;
  }
  if (policy.kind === "attachment-upload-progress") {
    validateSettledAttachmentUploadXml(rowId, state, v1Xml, v2Xml);
    return;
  }
  if (policy.kind === "terminal-replay-recovery") {
    validateTerminalReplayRecoveryXml(rowId, state, v1Xml, v2Xml);
    return;
  }
  throw new Error(`Visual parity row ${rowId}/${state} has no strict XML policy`);
}

function validateIntentionalDifferenceRow(
  row: VisualParityRow,
  policy: IntentionalDifferencePolicy | undefined,
): void {
  if (
    policy === undefined ||
    row.intentionalDifference?.code !== policy.code ||
    row.intentionalDifference.evidence !== policy.evidence ||
    row.targets !== policy.targets ||
    row.v1State !== policy.v1State ||
    row.v2Scenario !== policy.v2Scenario
  ) {
    throw new Error(`Visual parity row ${row.id} has an invalid intentional difference`);
  }
  const intentionalCaptures = row.captures.filter(
    (capture) => capture.status === "intentional-difference",
  );
  const intentionalCaptureStates = new Set(intentionalCaptures.map((capture) => capture.state));
  if (
    intentionalCaptures.length !== policy.captureStates.length ||
    policy.captureStates.some((state) => !intentionalCaptureStates.has(state))
  ) {
    throw new Error(`Visual parity row ${row.id} lacks exact phone and wide policy captures`);
  }
  if (!policy.allowsStrictCaptures && row.captures.length !== policy.captureStates.length) {
    throw new Error(`Visual parity row ${row.id} carries unexpected extra captures`);
  }
  if (
    policy.requiredStrictCaptureStates?.some(
      (state) =>
        !row.captures.some((capture) => capture.state === state && capture.status === "pass"),
    ) === true
  ) {
    throw new Error(`Visual parity row ${row.id} lacks exact strict policy captures`);
  }
}

function validateAgentRetryXml(
  rowId: string,
  v1Xml: string,
  v2Xml: string,
  v1Descriptions: readonly string[],
  v2Descriptions: readonly string[],
): void {
  if (!hasEnabledDescription(v1Xml, "Open subagent ")) {
    throw new Error(`Frozen V1 evidence for ${rowId} does not retain an enabled agent row`);
  }
  if (v1Descriptions.includes("Try again") || v1Xml.includes('text="Loading agents…"')) {
    throw new Error(`Frozen V1 evidence for ${rowId} does not show the required silent failure`);
  }
  if (!v2Descriptions.includes("Try again") || v2Xml.includes('text="Loading agents…"')) {
    throw new Error(`V2 evidence for ${rowId} does not show a stable retry action`);
  }
  const errorTextPattern = /\b(?:connection|could not|error|failed|offline|unavailable)\b/iu;
  if (!textValues(v2Xml).some((value) => errorTextPattern.test(value))) {
    throw new Error(`V2 evidence for ${rowId} does not expose a visible query error`);
  }
}

function validateFailedQueueRetryXml(
  rowId: string,
  v1Xml: string,
  v2Xml: string,
  v1Descriptions: readonly string[],
): void {
  if (v1Descriptions.includes("Retry queued prompt")) {
    throw new Error(`Frozen V1 evidence for ${rowId} unexpectedly exposes queue retry`);
  }
  if (!hasEnabledDescription(v2Xml, "Retry queued prompt")) {
    throw new Error(`V2 evidence for ${rowId} does not expose enabled queue retry`);
  }
  const v1Identity = queueFailureIdentity(v1Xml);
  const v2Identity = queueFailureIdentity(v2Xml);
  if (
    v1Identity === undefined ||
    v2Identity === undefined ||
    v1Identity.promptNonce !== v1Identity.errorNonce ||
    v2Identity.promptNonce !== v2Identity.errorNonce ||
    v1Identity.promptNonce !== v2Identity.promptNonce
  ) {
    throw new Error(`Visual parity evidence for ${rowId} does not show the same failed queue item`);
  }
}

function validateVoiceCancellationXml(
  rowId: string,
  v1Xml: string,
  v2Xml: string,
  v1Descriptions: readonly string[],
  v2Descriptions: readonly string[],
): void {
  const finishingControls = [
    "Cancel voice input",
    "Finish voice input and send transcript",
    "Stop voice input and insert transcript",
  ];
  if (
    !v1Descriptions.includes("Voice input") ||
    v1Xml.includes('text="Cancelling voice…"') ||
    v1Descriptions.some((description) => finishingControls.includes(description))
  ) {
    throw new Error(`Frozen V1 evidence for ${rowId} does not show immediate voice idle`);
  }
  if (
    !v2Xml.includes('text="Cancelling voice…"') ||
    !v2Descriptions.includes("Cancel voice input") ||
    !hasDisabledDescription(v2Xml, "Cancel voice input")
  ) {
    throw new Error(`V2 evidence for ${rowId} does not expose pending voice cancellation`);
  }
}

function validateCatalogPaginationXml(rowId: string, v1Xml: string, v2Xml: string): void {
  const loadingText = "Loading threads…";
  if (textValues(v1Xml).includes(loadingText) || !textValues(v2Xml).includes(loadingText)) {
    throw new Error(`Visual parity evidence for ${rowId} does not prove the ShimmerText policy`);
  }
  const runBoundRowPattern = /^Row parity [A-Z0-9]{8} catalog 01$/u;
  const v1Rows = new Set(textValues(v1Xml).filter((value) => runBoundRowPattern.test(value)));
  const matchingRow = textValues(v2Xml).find((value) => v1Rows.has(value));
  if (matchingRow === undefined) {
    throw new Error(`Visual parity evidence for ${rowId} does not retain the same catalog row`);
  }
}

function validateHistoryPaginationXml(rowId: string, v1Xml: string, v2Xml: string): void {
  const markerPattern = /^PAGE((?:PHONE|WIDE)?[A-Za-z0-9]{8})(36|38)$/u;
  const v1Latest = textValues(v1Xml).find((value) => markerPattern.exec(value)?.[2] === "38");
  const v1Match = v1Latest === undefined ? null : markerPattern.exec(v1Latest);
  const expectedV2Anchor = v1Match === null ? undefined : `PAGE${v1Match[1]}36`;
  if (
    v1Latest === undefined ||
    expectedV2Anchor === undefined ||
    !textValues(v2Xml).includes(expectedV2Anchor) ||
    textValues(v1Xml).includes("Loading messages…") ||
    /resource-id="[^"]*history-loading-indicator"/u.test(v1Xml) ||
    !textValues(v2Xml).includes("Loading messages…")
  ) {
    throw new Error(
      `Visual parity evidence for ${rowId} does not prove the exact local-V1/remote-V2 history progress policy`,
    );
  }
}

function validateSettledHistoryPaginationXml(
  rowId: string,
  state: string,
  v1Xml: string,
  v2Xml: string,
): void {
  const resultPattern = /^PAGE(?:PHONE|WIDE)?[A-Za-z0-9]{8}38$/u;
  const v1Results = new Set(textValues(v1Xml).filter((value) => resultPattern.test(value)));
  const sharedResult = textValues(v2Xml).find((value) => v1Results.has(value));
  if (
    sharedResult === undefined ||
    textValues(v1Xml).includes("Loading messages…") ||
    textValues(v2Xml).includes("Loading messages…") ||
    /resource-id="[^"]*history-loading-indicator"/u.test(v1Xml) ||
    /resource-id="[^"]*history-loading-indicator"/u.test(v2Xml)
  ) {
    throw new Error(
      `Visual parity evidence for ${rowId}/${state} lacks the same settled newer-turn result`,
    );
  }
}

function validateAttachmentUploadProgressXml(
  rowId: string,
  v1Xml: string,
  v2Xml: string,
  v1Descriptions: readonly string[],
  v2Descriptions: readonly string[],
): void {
  const namePattern = /^draft-pending-(?:phone|wide)[a-z0-9]{8}\.txt$/u;
  const v2Name = textValues(v2Xml).find((value) => namePattern.test(value));
  if (
    v2Name === undefined ||
    textValues(v1Xml).includes(v2Name) ||
    v1Descriptions.includes("Draft attachments") ||
    !v2Descriptions.includes("Draft attachments") ||
    !textValues(v2Xml).some((value) => value.startsWith("Uploading "))
  ) {
    throw new Error(
      `Visual parity evidence for ${rowId} does not prove the exact V2-only pending attachment card`,
    );
  }
}

function validateSettledAttachmentUploadXml(
  rowId: string,
  state: string,
  v1Xml: string,
  v2Xml: string,
): void {
  const namePattern = /^draft-pending-(?:phone|wide)[a-z0-9]{8}\.txt$/u;
  const v1Names = new Set(textValues(v1Xml).filter((value) => namePattern.test(value)));
  const sharedName = textValues(v2Xml).find((value) => v1Names.has(value));
  if (
    sharedName === undefined ||
    !hasEnabledDescription(v1Xml, `Remove ${sharedName}`) ||
    !hasEnabledDescription(v2Xml, "Remove attachment") ||
    textValues(v1Xml).some((value) => value.startsWith("Uploading ")) ||
    textValues(v2Xml).some((value) => value.startsWith("Uploading "))
  ) {
    throw new Error(
      `Visual parity evidence for ${rowId}/${state} lacks the same settled usable attachment`,
    );
  }
}

function validateNewThreadCreateProgressXml(rowId: string, v1Xml: string, v2Xml: string): void {
  if (
    !hasEnabledDescription(v1Xml, "Send message") ||
    textValues(v1Xml).includes("Send") ||
    v1Xml.includes('busy="true"')
  ) {
    throw new Error(`Frozen V1 evidence for ${rowId} unexpectedly exposes create progress`);
  }
  if (!hasDisabledDescription(v2Xml, "Send message") || !textValues(v2Xml).includes("Send")) {
    throw new Error(`V2 evidence for ${rowId} does not expose ShimmerText create progress`);
  }
}

interface BoundedTunnelXmlInput {
  phase: "active" | "create-pending" | "expiry" | "revoke-pending";
  rowId: string;
  v1Descriptions: readonly string[];
  v1Xml: string;
  v2Descriptions: readonly string[];
  v2Xml: string;
}

function validateBoundedTunnelXml(input: BoundedTunnelXmlInput): void {
  const { phase, rowId, v1Descriptions, v1Xml, v2Descriptions, v2Xml } = input;
  const v1Texts = textValues(v1Xml);
  const v2Texts = textValues(v2Xml);
  const liveLabel = v1Descriptions
    .filter((description) => description.endsWith(", Live"))
    .map((description) => description.slice(0, -", Live".length))
    .find((label) => v1Descriptions.includes(`Forwarding actions ${label}`));
  const nativePortText = v1Texts.find((value) => /^:\d+ → phone :\d+$/u.test(value));
  const fixturePort = nativePortText?.match(/^:(\d+) → phone :\d+$/u)?.[1];
  const forbiddenV1Descriptions = [
    "Open bounded localhost preview",
    "Open localhost tunnel",
    "Close browser",
    "Retry revoke",
    "Reconnect",
  ];
  const forbiddenV1Texts = [
    "Bounded",
    "Opening",
    "Revoking bounded tunnel…",
    "This bounded tunnel expired.",
  ];
  if (
    liveLabel === undefined ||
    fixturePort === undefined ||
    v1Descriptions.some((description) => forbiddenV1Descriptions.includes(description)) ||
    v1Texts.some((value) => forbiddenV1Texts.includes(value))
  ) {
    throw new Error(`Frozen V1 evidence for ${rowId} is not the run-bound native forwarding state`);
  }
  if (phase === "active") {
    if (
      !hasEnabledDescription(v2Xml, "Close browser") ||
      !v2Texts.includes(`localhost:${fixturePort}`) ||
      !v2Texts.includes("Bounded") ||
      !v2Texts.some((value) => /^WEBOK[A-Z0-9]+$/u.test(value))
    ) {
      throw new Error(`V2 evidence for ${rowId} is not the run-bound bounded tunnel`);
    }
    return;
  }
  if (phase === "create-pending") {
    if (
      !v2Texts.includes("Opening") ||
      !v2Texts.includes(`localhost:${fixturePort}`) ||
      !hasDisabledDescription(v2Xml, "Open localhost tunnel") ||
      !v2Descriptions.includes("Close localhost preview")
    ) {
      throw new Error(`V2 evidence for ${rowId} is not bounded tunnel creation pending`);
    }
    return;
  }
  if (phase === "revoke-pending") {
    if (
      !v2Texts.includes("Revoking bounded tunnel…") ||
      !hasDisabledDescription(v2Xml, "Close browser") ||
      !hasDisabledDescription(v2Xml, "Retry revoke")
    ) {
      throw new Error(`V2 evidence for ${rowId} is not bounded tunnel revocation pending`);
    }
    return;
  }
  if (
    !v2Texts.includes("This bounded tunnel expired.") ||
    !hasEnabledDescription(v2Xml, "Close browser") ||
    !hasEnabledDescription(v2Xml, "Reconnect") ||
    v2Descriptions.includes("Open localhost tunnel")
  ) {
    throw new Error(`V2 evidence for ${rowId} is not bounded tunnel expiry`);
  }
}

function validateVoiceProgressXml(
  rowId: string,
  progressText: string,
  v1Xml: string,
  v2Xml: string,
): void {
  for (const [version, xml] of [
    ["Frozen V1", v1Xml],
    ["V2", v2Xml],
  ] as const) {
    if (
      !contentDescriptions(xml).includes("Voice recording") ||
      !textValues(xml).includes(progressText)
    ) {
      throw new Error(`${version} evidence for ${rowId} does not preserve voice progress content`);
    }
  }
  if (!hasProgressBar(v1Xml) || hasProgressBar(v2Xml)) {
    throw new Error(`Visual parity evidence for ${rowId} does not prove spinner-to-shimmer policy`);
  }
}

function validateTerminalReplayUnavailableXml(
  rowId: string,
  state: string | undefined,
  v1Xml: string,
  v2Xml: string,
): void {
  const title = sharedTerminalTitle(v1Xml, v2Xml);
  const layout = stateLayout(state);
  const v1Descriptions = contentDescriptions(v1Xml);
  if (
    title === undefined ||
    layout === undefined ||
    !hasSelectedDescription(v1Xml, title) ||
    !hasSelectedDescription(v2Xml, title) ||
    !textValues(v1Xml).includes("terminal_replay_unavailable") ||
    !hasEnabledDescription(v1Xml, `Close ${title}`) ||
    !hasEnabledDescription(v1Xml, "New terminal tab") ||
    textValues(v1Xml).includes("Terminal history is unavailable") ||
    v1Descriptions.includes("Retry terminal after replay loss")
  ) {
    throw new Error(`Frozen V1 evidence for ${rowId} is not the run-bound replay-loss state`);
  }
  if (
    textValues(v2Xml).includes("terminal_replay_unavailable") ||
    !textValues(v2Xml).includes("Terminal history is unavailable") ||
    !textValues(v2Xml).includes(
      "The previous output could not be replayed. Retry starts a new shell.",
    ) ||
    !textValues(v2Xml).includes("Failed") ||
    !hasEnabledDescription(v2Xml, "Retry terminal after replay loss")
  ) {
    throw new Error(`V2 evidence for ${rowId} does not expose replay-loss recovery`);
  }
}

function validateTerminalReplayRecoveryXml(
  rowId: string,
  state: string,
  v1Xml: string,
  v2Xml: string,
): void {
  const layout = stateLayout(state);
  const v1Marker = terminalMarker(v1Xml, "RETRY");
  const v2Marker = terminalMarker(v2Xml, "RETRY");
  const forbiddenTexts = [
    "terminal_replay_unavailable",
    "Terminal history is unavailable",
    "Failed",
  ];
  if (
    layout === undefined ||
    v1Marker?.layout !== layout ||
    v1Marker.generation !== "V1" ||
    v2Marker?.layout !== layout ||
    v2Marker.generation !== "V2" ||
    sharedTerminalTitle(v1Xml, v2Xml) === undefined ||
    !hasSelectedTerminalTitle(v1Xml, v2Xml) ||
    !textValues(v2Xml).includes("Live") ||
    forbiddenTexts.some((value) => textValues(v1Xml).includes(value)) ||
    forbiddenTexts.some((value) => textValues(v2Xml).includes(value)) ||
    contentDescriptions(v1Xml).includes("Retry terminal after replay loss") ||
    contentDescriptions(v2Xml).includes("Retry terminal after replay loss")
  ) {
    throw new Error(`Visual parity evidence for ${rowId}/${state} lacks the recovered terminal`);
  }
}

function validateTerminalExitLifecycleXml(
  rowId: string,
  state: string | undefined,
  v1Xml: string,
  v2Xml: string,
): void {
  const title = sharedTerminalTitle(v1Xml, v2Xml);
  const layout = stateLayout(state);
  const v1Marker = terminalMarker(v1Xml, "EXIT");
  const v2Marker = terminalMarker(v2Xml, "EXIT");
  if (
    title === undefined ||
    layout === undefined ||
    v1Marker?.layout !== layout ||
    v1Marker.generation !== "V1" ||
    v2Marker?.layout !== layout ||
    v2Marker.generation !== "V2" ||
    !hasSelectedDescription(v1Xml, title) ||
    !hasSelectedDescription(v2Xml, title) ||
    !hasEnabledDescription(v1Xml, `Close ${title}`) ||
    !hasEnabledDescription(v2Xml, `Close ${title}`) ||
    textValues(v1Xml).includes("Exited · code 23") ||
    contentDescriptions(v1Xml).includes("Exited · code 23") ||
    (!textValues(v2Xml).includes("Exited · code 23") &&
      !contentDescriptions(v2Xml).includes("Exited · code 23"))
  ) {
    throw new Error(`Visual parity evidence for ${rowId} does not prove exit lifecycle metadata`);
  }
}

function validateEmptyAttachmentsXml(
  rowId: string,
  v1Xml: string,
  v2Xml: string,
  v1Descriptions: readonly string[],
  v2Descriptions: readonly string[],
): void {
  if (
    !hasDisabledDescription(v1Xml, "No attachments") ||
    v1Descriptions.includes("Close attachments") ||
    textValues(v1Xml).includes("No attachments in this thread.")
  ) {
    throw new Error(`Frozen V1 evidence for ${rowId} is not the unreachable empty chip`);
  }
  if (
    !hasEnabledDescription(v2Xml, "Close attachments") ||
    !v2Descriptions.includes("No attachments") ||
    !textValues(v2Xml).includes("No attachments in this thread.")
  ) {
    throw new Error(`V2 evidence for ${rowId} is not the routable empty Attachments state`);
  }
}

function validateInlineVideoXml(
  rowId: string,
  v1Xml: string,
  v2Xml: string,
  v1Descriptions: readonly string[],
  v2Descriptions: readonly string[],
): void {
  const v1Basenames = videoBasenames(v1Xml);
  const v2Basenames = videoBasenames(v2Xml);
  const [basename] = v1Basenames;
  if (
    v1Basenames.length !== 1 ||
    v2Basenames.length !== 1 ||
    basename !== v2Basenames[0] ||
    basename === undefined ||
    !hasEnabledDescription(v1Xml, `Open attachment ${basename}`) ||
    v1Descriptions.some((description) => description.startsWith("Video player ·"))
  ) {
    throw new Error(`Frozen V1 evidence for ${rowId} is not the matching download-only video`);
  }
  if (
    !v2Descriptions.includes("Video player · ready") ||
    !hasEnabledDescription(v2Xml, "Close attachment")
  ) {
    throw new Error(`V2 evidence for ${rowId} is not the ready inline video player`);
  }
}

function validateAuthoritativeWaitingInputXml(rowId: string, v1Xml: string, v2Xml: string): void {
  const v1Text = textValues(v1Xml);
  const v2Text = textValues(v2Xml);
  if (!v1Text.includes("Thread approval") || v1Text.includes("Waiting for input")) {
    throw new Error(`Frozen V1 evidence for ${rowId} is not generic approval attention`);
  }
  if (!v2Text.includes("Waiting for input") || v2Text.includes("Thread approval")) {
    throw new Error(`V2 evidence for ${rowId} is not authoritative waiting-for-input`);
  }
}

function parseVisualParityMatrixLine(line: string): VisualParityMatrixRow {
  const [id, v1State, v2Scenario, targets, _evidence, auditStatus] = line
    .split("|")
    .slice(1, 7)
    .map((cell) => cell.trim());
  if (
    id === undefined ||
    id === "" ||
    v1State === undefined ||
    v1State === "" ||
    v2Scenario === undefined ||
    v2Scenario === "" ||
    targets === undefined ||
    targets === "" ||
    auditStatus === undefined ||
    !["diff", "intentional-difference", "open", "pass"].includes(auditStatus)
  ) {
    throw new Error(`Malformed visual parity matrix row: ${line}`);
  }
  return {
    id,
    releaseStatus: auditStatus === "intentional-difference" ? "intentional-difference" : "pass",
    targets,
    v1State,
    v2Scenario,
  };
}

function intentionalDifferencePolicy(rowId: string): IntentionalDifferencePolicy | undefined {
  return INTENTIONAL_DIFFERENCE_POLICIES.find((policy) => policy.id === rowId);
}

function contentDescriptions(xml: string): string[] {
  return [...xml.matchAll(/\bcontent-desc="([^"]*)"/gu)].map((match) => match[1] ?? "");
}

function textValues(xml: string): string[] {
  return [...xml.matchAll(/\btext="([^"]+)"/gu)].map((match) => match[1] ?? "");
}

function hasEnabledDescription(xml: string, prefix: string): boolean {
  return [...xml.matchAll(/<node\b([^>]*)>/gu)].some((match) => {
    const attributes = match[1] ?? "";
    const description = /\bcontent-desc="([^"]*)"/u.exec(attributes)?.[1];
    return description?.startsWith(prefix) === true && /\benabled="true"/u.test(attributes);
  });
}

function hasDisabledDescription(xml: string, description: string): boolean {
  return [...xml.matchAll(/<node\b([^>]*)>/gu)].some((match) => {
    const attributes = match[1] ?? "";
    const actualDescription = /\bcontent-desc="([^"]*)"/u.exec(attributes)?.[1];
    return actualDescription === description && /\benabled="false"/u.test(attributes);
  });
}

function hasSelectedDescription(xml: string, description: string): boolean {
  return [...xml.matchAll(/<node\b([^>]*)>/gu)].some((match) => {
    const attributes = match[1] ?? "";
    const actualDescription = /\bcontent-desc="([^"]*)"/u.exec(attributes)?.[1];
    return actualDescription === description && /\bselected="true"/u.test(attributes);
  });
}

function queueFailureIdentity(
  xml: string,
): { promptNonce: string; errorNonce: string } | undefined {
  const values = [...contentDescriptions(xml), ...textValues(xml)];
  const promptNonce = prefixedValue(values, "E2EFAILEDQUEUE");
  const errorNonce = prefixedValue(values, "E2E_QUEUE_RETRY_REQUIRED_");
  return promptNonce === undefined || errorNonce === undefined
    ? undefined
    : { promptNonce, errorNonce };
}

function videoBasenames(xml: string): string[] {
  const pattern = /visual-parity-video-[a-z0-9]+\.mp4/gu;
  return [
    ...new Set(
      [...contentDescriptions(xml), ...textValues(xml)].flatMap(
        (value) => value.match(pattern) ?? [],
      ),
    ),
  ];
}

function sharedTerminalTitle(v1Xml: string, v2Xml: string): string | undefined {
  const titlePattern = /^Terminal \d+$/u;
  const v1Titles = new Set(contentDescriptions(v1Xml).filter((value) => titlePattern.test(value)));
  return contentDescriptions(v2Xml).find((value) => v1Titles.has(value));
}

function hasSelectedTerminalTitle(v1Xml: string, v2Xml: string): boolean {
  const title = sharedTerminalTitle(v1Xml, v2Xml);
  return (
    title !== undefined &&
    hasSelectedDescription(v1Xml, title) &&
    hasSelectedDescription(v2Xml, title)
  );
}

function stateLayout(state: string | undefined): "PHONE" | "WIDE" | undefined {
  if (state?.startsWith("phone-") === true) return "PHONE";
  if (state?.startsWith("wide-") === true) return "WIDE";
  return undefined;
}

function terminalMarker(
  xml: string,
  prefix: "EXIT" | "RETRY",
): { generation: "V1" | "V2"; layout: "PHONE" | "WIDE" } | undefined {
  const pattern = new RegExp(`^${prefix}_(PHONE|WIDE)_(V1|V2)_[A-Za-z0-9]+$`, "u");
  const match = textValues(xml)
    .map((value) => pattern.exec(value))
    .find((candidate) => candidate !== null);
  const layout = match?.[1];
  const generation = match?.[2];
  return (layout === "PHONE" || layout === "WIDE") && (generation === "V1" || generation === "V2")
    ? { generation, layout }
    : undefined;
}

function prefixedValue(values: readonly string[], prefix: string): string | undefined {
  const matches = values
    .filter((value) => value.startsWith(prefix))
    .map((value) => value.slice(prefix.length))
    .filter((value) => value !== "");
  return matches.length === 1 ? matches[0] : undefined;
}

function hasProgressBar(xml: string): boolean {
  return /\bclass="android\.widget\.ProgressBar"/u.test(xml);
}

function startsWithAny(value: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => value.startsWith(prefix));
}

function requireMarkers(
  kind: string,
  required: readonly string[],
  actual: ReadonlySet<string>,
): void {
  const missing = required.filter((marker) => !actual.has(marker));
  if (missing.length > 0)
    throw new Error(`Android E2E evidence is missing ${kind}: ${missing.join(", ")}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStep(value: unknown): value is AndroidE2eEvidence["steps"][number] {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    (value.status === "passed" || value.status === "failed") &&
    typeof value.durationMs === "number" &&
    Number.isFinite(value.durationMs) &&
    value.durationMs >= 0
  );
}

function isObservation(value: unknown): value is AndroidE2eEvidence["observations"][number] {
  return (
    isRecord(value) &&
    typeof value.stage === "string" &&
    typeof value.source === "string" &&
    typeof value.elapsedMs === "number" &&
    Number.isFinite(value.elapsedMs) &&
    value.elapsedMs >= 0 &&
    typeof value.outcome === "string"
  );
}

function isVisualParityRow(value: unknown): value is VisualParityRow {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isVisualParityStatus(value.status) &&
    typeof value.targets === "string" &&
    typeof value.v1State === "string" &&
    typeof value.v2Scenario === "string" &&
    (value.blocker === undefined || isVisualParityBlocker(value.blocker)) &&
    (value.intentionalDifference === undefined ||
      isVisualParityIntentionalDifference(value.intentionalDifference)) &&
    Array.isArray(value.captures) &&
    value.captures.every(isVisualParityCapture)
  );
}

function isVisualParityCapture(value: unknown): value is VisualParityCapture {
  if (
    !isRecord(value) ||
    typeof value.state !== "string" ||
    value.state === "" ||
    !isVisualParityStatus(value.status)
  ) {
    return false;
  }
  for (const key of [
    "v1Screenshot",
    "v1Xml",
    "v2Screenshot",
    "v2Xml",
    "diffImage",
    "diffData",
  ] as const) {
    if (value[key] !== undefined && typeof value[key] !== "string") return false;
  }
  for (const key of ["ratio", "threshold"] as const) {
    if (
      value[key] !== undefined &&
      (typeof value[key] !== "number" || !Number.isFinite(value[key]) || value[key] < 0)
    ) {
      return false;
    }
  }
  return true;
}

function isVisualParityStatus(value: unknown): value is VisualParityStatus {
  return (
    value === "blocked" ||
    value === "pass" ||
    value === "diff" ||
    value === "fail" ||
    value === "intentional-difference"
  );
}

function isVisualParityBlocker(value: unknown): value is VisualParityBlocker {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    value.code !== "" &&
    typeof value.evidence === "string" &&
    value.evidence !== ""
  );
}

function isVisualParityIntentionalDifference(
  value: unknown,
): value is VisualParityIntentionalDifference {
  return (
    isRecord(value) &&
    (value.code === "v2-authoritative-waiting-input" ||
      value.code === "v2-attachment-upload-progress" ||
      value.code === "v2-bounded-tunnel-active" ||
      value.code === "v2-bounded-tunnel-create-pending" ||
      value.code === "v2-bounded-tunnel-expiry" ||
      value.code === "v2-bounded-tunnel-revoke-pending" ||
      value.code === "v2-empty-attachments-state" ||
      value.code === "v2-hide-empty-context-chip" ||
      value.code === "v2-inline-video-player" ||
      value.code === "v2-new-thread-action-progress" ||
      value.code === "v2-new-thread-create-progress" ||
      value.code === "v2-retry-failed-queue-item" ||
      value.code === "v2-shimmer-catalog-pagination" ||
      value.code === "v2-shimmer-history-pagination" ||
      value.code === "v2-shimmer-voice-finishing" ||
      value.code === "v2-shimmer-voice-starting" ||
      value.code === "v2-terminal-exit-lifecycle" ||
      value.code === "v2-terminal-replay-recovery" ||
      value.code === "v2-visible-agent-retry" ||
      value.code === "v2-visible-voice-cancellation") &&
    typeof value.evidence === "string" &&
    value.evidence !== ""
  );
}

function pathBasename(value: string): string {
  return value.replace(/^.*[\\/]/u, "");
}
