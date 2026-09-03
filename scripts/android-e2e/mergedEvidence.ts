import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";

import {
  parseAndroidE2eEvidence,
  parseVisualParityEvidence,
  type AndroidE2eEvidence,
  type VisualParityCapture,
  type VisualParityEvidence,
  type VisualParityRow,
} from "./evidencePolicy.ts";
import { assertInteractionInventoryCoverage } from "./interactionInventoryParity.ts";

export const ANDROID_E2E_TARGETS = {
  fold: "codex_remote_fold_api35",
  phone: "codex_remote_phone_api35",
} as const;

export type AndroidE2eTargetFamily = keyof typeof ANDROID_E2E_TARGETS;
export type AndroidE2eCapturePosture =
  | "folded"
  | "foldedToUnfolded"
  | "phoneLandscape"
  | "phonePortrait"
  | "unfolded"
  | "unfoldedToFolded";

export type AndroidE2eCaptureProvenance = {
  captureId: string;
  capturedAt: string;
  generation: "v1" | "v2";
  origin: {
    kind: "appium";
    sessionId: string;
  };
  posture: AndroidE2eCapturePosture;
  rowId: string;
  screenshot: string;
  state: string;
  targetFamily: AndroidE2eTargetFamily;
  viewport: { height: number; width: number };
  xml: string;
};

export type AndroidE2eShardManifest = {
  schemaVersion: 1;
  actualAvd: string | null;
  apkSha256: string;
  captures: AndroidE2eCaptureProvenance[];
  companionSha256: string;
  deviceSerial: string | null;
  requestedAvd: string;
  sourceFingerprint: string;
  targetFamily: AndroidE2eTargetFamily;
};

type MergedArtifact = {
  contentSha256: string;
  path: string;
};

type MergedContentEquality = {
  contentSha256: string;
  paths: string[];
};

export type MergedAndroidE2eShard = {
  apkSha256: string;
  artifacts: {
    captureManifest: string;
    evidence: string;
    logcat: string;
    parityEvidence: string;
    report: string;
    videos: string[];
  };
  avd: string;
  companionSha256: string;
  deviceSerial: string;
  runId: string;
  sourceFingerprint: string;
  targetFamily: AndroidE2eTargetFamily;
};

type MergedAndroidE2eEvidenceBase = {
  schemaVersion: 2;
  apkSha256: string;
  artifacts: MergedArtifact[];
  backend: "managedAppServer";
  binaries: { apk: string; companion: string };
  buildMode: "fresh";
  completedAt: string;
  companionSha256: string;
  contentEquality: MergedContentEquality[];
  runId: string;
  shards: MergedAndroidE2eShard[];
  sourceFingerprint: string;
  targetFamilies: AndroidE2eTargetFamily[];
};

export type MergedAndroidE2eEvidence = MergedAndroidE2eEvidenceBase &
  (
    | { failure: null; parity: VisualParityEvidence; passed: true }
    | { failure: string; parity: null; passed: false }
  );

export type LoadedAndroidE2eShard = {
  artifactPrefix: string;
  evidence: AndroidE2eEvidence;
  manifest: AndroidE2eShardManifest;
  parity: VisualParityEvidence;
};

type MergeAndroidE2eEvidenceInput = {
  apkArtifact: string;
  artifactRoot: string;
  companionArtifact: string;
  completedAt: string;
  runId: string;
  shards: LoadedAndroidE2eShard[];
  sourceFingerprint: string;
};

export async function loadAndroidE2eShard(
  artifactRoot: string,
  artifactPrefix: string,
): Promise<LoadedAndroidE2eShard> {
  const root = resolveArtifactPath(artifactRoot, artifactPrefix);
  const [evidenceValue, manifestValue, parityValue] = await Promise.all([
    readJson(path.join(root, "evidence.json")),
    readJson(path.join(root, "capture-manifest.json")),
    readJson(path.join(root, "visual-parity", "evidence.json")),
  ]);
  return {
    artifactPrefix,
    evidence: parseAndroidE2eEvidence(evidenceValue),
    manifest: parseAndroidE2eShardManifest(manifestValue),
    parity: parseVisualParityEvidence(parityValue),
  };
}

export async function mergeAndroidE2eEvidence(
  input: MergeAndroidE2eEvidenceInput,
): Promise<MergedAndroidE2eEvidence> {
  validateDigest(input.sourceFingerprint, "source fingerprint");
  const apkArtifact = normalizeRelativeArtifactPath(input.apkArtifact);
  const companionArtifact = normalizeRelativeArtifactPath(input.companionArtifact);
  const [apkSha256, companionSha256] = await Promise.all([
    sha256File(resolveArtifactPath(input.artifactRoot, apkArtifact)),
    sha256File(resolveArtifactPath(input.artifactRoot, companionArtifact)),
  ]);
  const shards = validateAndDescribeShards(input, apkSha256, companionSha256);
  const parity = mergeParity(shards, input.shards);
  const artifactPaths = collectArtifactPaths(shards, input.shards, [
    apkArtifact,
    companionArtifact,
  ]);
  const allArtifactPaths = await listArtifactFiles(input.artifactRoot);
  const available = new Set(allArtifactPaths);
  for (const required of artifactPaths) {
    if (!available.has(required)) throw new Error(`Merged artifact is missing: ${required}`);
  }
  const artifacts = await inspectArtifacts(input.artifactRoot, allArtifactPaths);
  const contentEquality = equalityGroups(artifacts);
  return {
    schemaVersion: 2,
    apkSha256,
    artifacts,
    backend: "managedAppServer",
    binaries: { apk: apkArtifact, companion: companionArtifact },
    buildMode: "fresh",
    completedAt: input.completedAt,
    companionSha256,
    contentEquality,
    failure: null,
    parity,
    passed: true,
    runId: input.runId,
    shards,
    sourceFingerprint: input.sourceFingerprint,
    targetFamilies: ["phone", "fold"],
  };
}

export function parseAndroidE2eShardManifest(value: unknown): AndroidE2eShardManifest {
  if (!isRecord(value) || !Array.isArray(value.captures)) {
    throw new Error("Android E2E shard manifest must be an object with captures");
  }
  const targetFamily = parseTargetFamily(value.targetFamily);
  const captures = value.captures.map((capture) => parseCapture(capture, targetFamily));
  if (
    value.schemaVersion !== 1 ||
    typeof value.actualAvd !== "string" && value.actualAvd !== null ||
    typeof value.apkSha256 !== "string" ||
    typeof value.companionSha256 !== "string" ||
    typeof value.deviceSerial !== "string" && value.deviceSerial !== null ||
    typeof value.requestedAvd !== "string" ||
    typeof value.sourceFingerprint !== "string"
  ) {
    throw new Error("Android E2E shard manifest has an invalid schema");
  }
  return {
    schemaVersion: 1,
    actualAvd: value.actualAvd,
    apkSha256: value.apkSha256,
    captures,
    companionSha256: value.companionSha256,
    deviceSerial: value.deviceSerial,
    requestedAvd: value.requestedAvd,
    sourceFingerprint: value.sourceFingerprint,
    targetFamily,
  };
}

export async function sha256File(filePath: string): Promise<string> {
  const bytes = await readFile(filePath);
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function validateAndDescribeShards(
  input: MergeAndroidE2eEvidenceInput,
  apkSha256: string,
  companionSha256: string,
): MergedAndroidE2eShard[] {
  if (input.shards.length !== 2) throw new Error("Merged Android E2E requires exactly two shards");
  const byFamily = new Map(input.shards.map((shard) => [shard.manifest.targetFamily, shard]));
  if (byFamily.size !== 2 || !byFamily.has("phone") || !byFamily.has("fold")) {
    throw new Error("Merged Android E2E requires one phone shard and one fold shard");
  }
  return (["phone", "fold"] as const).map((family) => {
    const shard = requireValue(byFamily.get(family), `${family} shard`);
    const expectedAvd = ANDROID_E2E_TARGETS[family];
    const manifest = shard.manifest;
    const evidence = shard.evidence;
    if (!evidence.passed || evidence.failure !== null) {
      throw new Error(`${family} shard failed: ${evidence.failure ?? "unknown failure"}`);
    }
    if (evidence.suite !== "full" || evidence.backend !== "managedAppServer") {
      throw new Error(`${family} shard is not a full managed-App-Server run`);
    }
    if (evidence.buildMode !== "prebuilt") {
      throw new Error(`${family} shard must consume the orchestrator's locked prebuilt artifacts`);
    }
    if (evidence.deviceKind !== "emulator" || evidence.deviceSerial === null) {
      throw new Error(`${family} shard did not use an Android emulator`);
    }
    if (manifest.requestedAvd !== expectedAvd || manifest.actualAvd !== expectedAvd) {
      throw new Error(`${family} shard did not run on ${expectedAvd}`);
    }
    if (manifest.deviceSerial !== evidence.deviceSerial) {
      throw new Error(`${family} shard device identity disagrees with its run evidence`);
    }
    if (
      manifest.sourceFingerprint !== input.sourceFingerprint ||
      evidence.sourceFingerprint !== input.sourceFingerprint ||
      manifest.apkSha256 !== apkSha256 ||
      manifest.companionSha256 !== companionSha256
    ) {
      throw new Error(`${family} shard fingerprint differs from the orchestrator lock`);
    }
    validateCaptureManifest(manifest);
    const prefix = normalizeRelativeArtifactPath(shard.artifactPrefix);
    return {
      apkSha256: manifest.apkSha256,
      artifacts: {
        captureManifest: `${prefix}/capture-manifest.json`,
        evidence: `${prefix}/evidence.json`,
        logcat: `${prefix}/logcat.txt`,
        parityEvidence: `${prefix}/visual-parity/evidence.json`,
        report: `${prefix}/report.html`,
        videos: evidence.videos.map((video) => `${prefix}/${normalizeArtifactName(video)}`),
      },
      avd: expectedAvd,
      companionSha256: manifest.companionSha256,
      deviceSerial: evidence.deviceSerial,
      runId: evidence.runId,
      sourceFingerprint: manifest.sourceFingerprint,
      targetFamily: family,
    };
  });
}

function mergeParity(
  shardDescriptions: MergedAndroidE2eShard[],
  loadedShards: LoadedAndroidE2eShard[],
): VisualParityEvidence {
  const manifests = new Map(
    loadedShards.map((shard) => [shard.manifest.targetFamily, shard.manifest]),
  );
  const first = loadedShards[0]?.parity;
  if (first === undefined) throw new Error("Merged Android E2E has no parity evidence");
  const rows = new Map<string, VisualParityRow>();
  for (const shard of loadedShards) {
    if (shard.parity.matrixRows !== first.matrixRows || shard.parity.rows.length !== first.rows.length) {
      throw new Error("Android E2E shard parity matrices differ in size");
    }
    for (const row of shard.parity.rows) {
      const existing = rows.get(row.id);
      if (existing === undefined) {
        rows.set(row.id, { ...row, captures: [], status: "blocked" });
      } else if (
        existing.targets !== row.targets ||
        existing.v1State !== row.v1State ||
        existing.v2Scenario !== row.v2Scenario
      ) {
        throw new Error(`Android E2E shard parity definition differs for ${row.id}`);
      }
      const merged = requireValue(rows.get(row.id), `parity row ${row.id}`);
      for (const capture of row.captures) {
        assertCaptureHasDirectProvenance(
          capture,
          row.id,
          shard.manifest,
        );
        merged.captures.push(prefixCaptureArtifacts(capture, shard.artifactPrefix));
      }
      if (row.intentionalDifference !== undefined) {
        if (
          merged.intentionalDifference !== undefined &&
          JSON.stringify(merged.intentionalDifference) !== JSON.stringify(row.intentionalDifference)
        ) {
          throw new Error(`Intentional-difference policy differs for ${row.id}`);
        }
        merged.intentionalDifference = row.intentionalDifference;
      }
    }
  }
  if (rows.size !== first.matrixRows) {
    throw new Error(`Merged parity has ${rows.size}/${first.matrixRows} rows`);
  }
  assertInteractionInventoryCoverage(
    [...rows.values()].flatMap((row) =>
      row.captures.map((capture) => ({ rowId: row.id, state: capture.state })),
    ),
  );
  const shardFamilies = new Set(shardDescriptions.map((shard) => shard.targetFamily));
  for (const row of rows.values()) {
    if (row.captures.length === 0) throw new Error(`${row.id} has no captured parity state`);
    const disallowed = row.captures.find(
      (capture) => capture.status === "blocked" || capture.status === "diff" || capture.status === "fail",
    );
    if (disallowed !== undefined) {
      throw new Error(`${row.id}/${disallowed.state} is ${disallowed.status}`);
    }
    assertTargetCoverage(row, loadedShards, manifests, shardFamilies);
    const intentional = row.captures.some((capture) => capture.status === "intentional-difference");
    row.status = intentional ? "intentional-difference" : "pass";
    delete row.blocker;
  }
  return {
    schemaVersion: 1,
    blockedRows: 0,
    coveredRows: rows.size,
    matrixRows: first.matrixRows,
    rows: [...rows.values()].toSorted((left, right) => left.id.localeCompare(right.id)),
  };
}

function assertTargetCoverage(
  row: VisualParityRow,
  shards: LoadedAndroidE2eShard[],
  manifests: Map<AndroidE2eTargetFamily, AndroidE2eShardManifest>,
  shardFamilies: Set<AndroidE2eTargetFamily>,
): void {
  const required = requiredPostures(row.targets);
  for (const requirement of required) {
    const family = requirement.family;
    if (!shardFamilies.has(family)) throw new Error(`${row.id} lacks its ${family} shard`);
    const shard = requireValue(
      shards.find((candidate) => candidate.manifest.targetFamily === family),
      `${family} shard`,
    );
    const manifest = requireValue(manifests.get(family), `${family} capture manifest`);
    const states = new Set(row.captures.map((capture) => capture.state));
    const hasOwnedCapture = manifest.captures.some(
      (capture) =>
        capture.rowId === row.id &&
        capture.posture === requirement.posture &&
        states.has(capture.state),
    );
    if (!hasOwnedCapture || shard.parity.rows.every((candidate) => candidate.id !== row.id)) {
      throw new Error(
        `${row.id} lacks direct ${family}/${requirement.posture} Appium evidence`,
      );
    }
  }
}

type RequiredCapturePosture = {
  family: AndroidE2eTargetFamily;
  posture: AndroidE2eCapturePosture;
};

function requiredPostures(targets: string): RequiredCapturePosture[] {
  const normalized = targets.toLowerCase();
  if (normalized.startsWith("every ")) {
    return [
      { family: "phone", posture: "phonePortrait" },
      { family: "fold", posture: "unfolded" },
    ];
  }
  if (normalized.includes("folded → unfolded")) {
    return [{ family: "fold", posture: "foldedToUnfolded" }];
  }
  if (normalized.includes("unfolded → folded")) {
    return [{ family: "fold", posture: "unfoldedToFolded" }];
  }
  const required: RequiredCapturePosture[] = [];
  if (normalized.includes("phone landscape")) {
    required.push({ family: "phone", posture: "phoneLandscape" });
  } else if (normalized.includes("phone")) {
    required.push({ family: "phone", posture: "phonePortrait" });
  }
  if (normalized.includes("wide") || normalized.includes("unfolded")) {
    required.push({ family: "fold", posture: "unfolded" });
  }
  if (normalized.includes("folded")) required.push({ family: "fold", posture: "folded" });
  if (required.length === 0) throw new Error(`Unknown visual parity target posture: ${targets}`);
  return required;
}

function assertCaptureHasDirectProvenance(
  capture: VisualParityCapture,
  rowId: string,
  manifest: AndroidE2eShardManifest,
): void {
  if (
    capture.v1Screenshot === undefined ||
    capture.v1Xml === undefined ||
    capture.v2Screenshot === undefined ||
    capture.v2Xml === undefined
  ) {
    throw new Error(`${rowId}/${capture.state} does not have a complete V1/V2 artifact pair`);
  }
  for (const [generation, screenshot, xml] of [
    ["v1", capture.v1Screenshot, capture.v1Xml],
    ["v2", capture.v2Screenshot, capture.v2Xml],
  ] as const) {
    const matches = manifest.captures.filter(
      (candidate) =>
        candidate.rowId === rowId &&
        candidate.state === capture.state &&
        candidate.generation === generation &&
        candidate.screenshot === screenshot &&
        candidate.xml === xml &&
        candidate.origin.kind === "appium",
    );
    if (matches.length !== 1) {
      throw new Error(`${rowId}/${capture.state}/${generation} lacks unique direct Appium provenance`);
    }
  }
}

function prefixCaptureArtifacts(
  capture: VisualParityCapture,
  artifactPrefix: string,
): VisualParityCapture {
  const prefix = `${normalizeRelativeArtifactPath(artifactPrefix)}/visual-parity`;
  return {
    state: capture.state,
    status: capture.status,
    ...(capture.diffData === undefined
      ? {}
      : { diffData: `${prefix}/${normalizeArtifactName(capture.diffData)}` }),
    ...(capture.diffImage === undefined
      ? {}
      : { diffImage: `${prefix}/${normalizeArtifactName(capture.diffImage)}` }),
    ...(capture.ratio === undefined ? {} : { ratio: capture.ratio }),
    ...(capture.threshold === undefined ? {} : { threshold: capture.threshold }),
    ...(capture.v1Screenshot === undefined
      ? {}
      : { v1Screenshot: `${prefix}/${normalizeArtifactName(capture.v1Screenshot)}` }),
    ...(capture.v1Xml === undefined
      ? {}
      : { v1Xml: `${prefix}/${normalizeArtifactName(capture.v1Xml)}` }),
    ...(capture.v2Screenshot === undefined
      ? {}
      : { v2Screenshot: `${prefix}/${normalizeArtifactName(capture.v2Screenshot)}` }),
    ...(capture.v2Xml === undefined
      ? {}
      : { v2Xml: `${prefix}/${normalizeArtifactName(capture.v2Xml)}` }),
  };
}

function collectArtifactPaths(
  shards: MergedAndroidE2eShard[],
  loadedShards: LoadedAndroidE2eShard[],
  binaryArtifacts: string[],
): string[] {
  const paths: string[] = [...binaryArtifacts];
  for (const shard of shards) {
    paths.push(
      shard.artifacts.captureManifest,
      shard.artifacts.evidence,
      shard.artifacts.logcat,
      shard.artifacts.parityEvidence,
      shard.artifacts.report,
      ...shard.artifacts.videos,
    );
  }
  for (const shard of loadedShards) {
    const prefix = `${normalizeRelativeArtifactPath(shard.artifactPrefix)}/visual-parity`;
    for (const capture of shard.manifest.captures) {
      paths.push(
        `${prefix}/${normalizeArtifactName(capture.screenshot)}`,
        `${prefix}/${normalizeArtifactName(capture.xml)}`,
      );
    }
    for (const row of shard.parity.rows) {
      for (const capture of row.captures) {
        for (const artifact of [capture.diffData, capture.diffImage]) {
          if (artifact !== undefined) paths.push(`${prefix}/${normalizeArtifactName(artifact)}`);
        }
      }
    }
  }
  const unique = new Set<string>();
  for (const artifact of paths) {
    if (unique.has(artifact)) {
      const metadataArtifact = /(?:capture-manifest|evidence)\.json$/u.test(artifact);
      if (!metadataArtifact) throw new Error(`Merged evidence aliases artifact path ${artifact}`);
    }
    unique.add(artifact);
  }
  return [...unique].toSorted();
}

async function inspectArtifacts(root: string, artifactPaths: string[]): Promise<MergedArtifact[]> {
  const rootReal = await realpath(root);
  const identities = new Set<string>();
  const artifacts: MergedArtifact[] = [];
  for (const artifactPath of artifactPaths) {
    const absolute = resolveArtifactPath(root, artifactPath);
    const metadata = await lstat(absolute);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size === 0) {
      throw new Error(`Merged artifact is not a non-empty regular file: ${artifactPath}`);
    }
    const actual = await realpath(absolute);
    if (actual !== rootReal && !actual.startsWith(`${rootReal}${path.sep}`)) {
      throw new Error(`Merged artifact escapes its root: ${artifactPath}`);
    }
    const identity = `${metadata.dev}:${metadata.ino}`;
    if (identities.has(identity)) throw new Error(`Merged artifacts reuse inode ${identity}`);
    identities.add(identity);
    artifacts.push({ contentSha256: await sha256File(absolute), path: artifactPath });
  }
  return artifacts;
}

async function listArtifactFiles(root: string, directory = ""): Promise<string[]> {
  const absolute = directory === "" ? root : resolveArtifactPath(root, directory);
  const entries = await readdir(absolute, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = directory === "" ? entry.name : path.posix.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Merged artifact tree contains symlink ${relative}`);
    if (entry.isDirectory()) {
      files.push(...(await listArtifactFiles(root, relative)));
    } else if (entry.isFile()) {
      files.push(relative);
    } else {
      throw new Error(`Merged artifact tree contains a non-regular entry ${relative}`);
    }
  }
  return files.toSorted();
}

function equalityGroups(artifacts: MergedArtifact[]): MergedContentEquality[] {
  const groups = new Map<string, string[]>();
  for (const artifact of artifacts) {
    const current = groups.get(artifact.contentSha256) ?? [];
    current.push(artifact.path);
    groups.set(artifact.contentSha256, current);
  }
  return [...groups.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([contentSha256, paths]) => ({ contentSha256, paths: paths.toSorted() }))
    .toSorted((left, right) => left.contentSha256.localeCompare(right.contentSha256));
}

function validateCaptureManifest(manifest: AndroidE2eShardManifest): void {
  const captureIds = new Set<string>();
  const artifactPaths = new Set<string>();
  for (const capture of manifest.captures) {
    if (capture.targetFamily !== manifest.targetFamily) {
      throw new Error(`Capture ${capture.captureId} has the wrong target family`);
    }
    if (captureIds.has(capture.captureId)) throw new Error(`Duplicate capture id ${capture.captureId}`);
    captureIds.add(capture.captureId);
    for (const artifact of [capture.screenshot, capture.xml]) {
      if (artifactPaths.has(artifact)) throw new Error(`Capture artifact is aliased: ${artifact}`);
      artifactPaths.add(artifact);
    }
  }
}

function parseCapture(
  value: unknown,
  manifestFamily: AndroidE2eTargetFamily,
): AndroidE2eCaptureProvenance {
  if (
    !isRecord(value) ||
    typeof value.captureId !== "string" ||
    typeof value.capturedAt !== "string" ||
    (value.generation !== "v1" && value.generation !== "v2") ||
    !isRecord(value.origin) ||
    value.origin.kind !== "appium" ||
    typeof value.origin.sessionId !== "string" ||
    !isPosture(value.posture) ||
    typeof value.rowId !== "string" ||
    typeof value.screenshot !== "string" ||
    typeof value.state !== "string" ||
    parseTargetFamily(value.targetFamily) !== manifestFamily ||
    !isRecord(value.viewport) ||
    typeof value.viewport.height !== "number" ||
    typeof value.viewport.width !== "number" ||
    typeof value.xml !== "string"
  ) {
    throw new Error("Android E2E capture provenance has an invalid schema");
  }
  if (
    value.captureId === "" ||
    value.origin.sessionId === "" ||
    value.viewport.height <= 0 ||
    value.viewport.width <= 0 ||
    !Number.isFinite(Date.parse(value.capturedAt))
  ) {
    throw new Error("Android E2E capture provenance has invalid identity or geometry");
  }
  return value as AndroidE2eCaptureProvenance;
}

function parseTargetFamily(value: unknown): AndroidE2eTargetFamily {
  if (value !== "phone" && value !== "fold") {
    throw new Error("Android E2E target family must be phone or fold");
  }
  return value;
}

function isPosture(value: unknown): value is AndroidE2eCapturePosture {
  return (
    value === "folded" ||
    value === "foldedToUnfolded" ||
    value === "phoneLandscape" ||
    value === "phonePortrait" ||
    value === "unfolded" ||
    value === "unfoldedToFolded"
  );
}

function normalizeArtifactName(value: string): string {
  if (value === "" || path.basename(value) !== value) {
    throw new Error(`Artifact must be a basename: ${value}`);
  }
  return value;
}

function normalizeRelativeArtifactPath(value: string): string {
  if (value === "" || path.isAbsolute(value)) throw new Error(`Invalid artifact path: ${value}`);
  const normalized = path.posix.normalize(value.replaceAll(path.sep, "/"));
  if (normalized === ".." || normalized.startsWith("../") || normalized.includes("/../")) {
    throw new Error(`Artifact path escapes its root: ${value}`);
  }
  return normalized;
}

function resolveArtifactPath(root: string, relativePath: string): string {
  const normalized = normalizeRelativeArtifactPath(relativePath);
  const absolute = path.resolve(root, normalized);
  const rootAbsolute = path.resolve(root);
  if (absolute !== rootAbsolute && !absolute.startsWith(`${rootAbsolute}${path.sep}`)) {
    throw new Error(`Artifact path escapes its root: ${relativePath}`);
  }
  return absolute;
}

function validateDigest(value: string, label: string): void {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) throw new Error(`Invalid ${label}`);
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function requireValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing ${label}`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
