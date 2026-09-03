import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import {
  parseAndroidE2eEvidence,
  parseVisualParityEvidence,
  parseVisualParityMatrix,
  validateAndroidE2eEvidence,
  validateIntentionalDifferenceXml,
  validateRequiredStrictCaptureXml,
  validateVisualParityEvidence,
  validateVisualParityMatrix,
} from "./android-e2e/evidencePolicy.ts";
import { computeSourceFingerprint } from "./android-e2e/sourceFingerprint.ts";

const repoRoot = path.resolve(import.meta.dirname, "..");
const evidenceInput = process.env.CODEWIDE_ANDROID_E2E_EVIDENCE?.trim();
if (evidenceInput === undefined || evidenceInput === "") {
  throw new Error(
    "CODEWIDE_ANDROID_E2E_EVIDENCE must point to a fresh passing evidence.json from pnpm test:android:e2e",
  );
}
const evidencePath = path.resolve(repoRoot, evidenceInput);
const evidenceRoot = `${path.join(repoRoot, "test-results", "android-e2e")}${path.sep}`;
if (!evidencePath.startsWith(evidenceRoot) || path.basename(evidencePath) !== "evidence.json") {
  throw new Error("Android E2E evidence must be an explicit test-results/android-e2e run artifact");
}
const evidenceStat = await lstat(evidencePath);
if (!evidenceStat.isFile()) throw new Error("Android E2E evidence must be a regular file");
const evidence = parseAndroidE2eEvidence(JSON.parse(await readFile(evidencePath, "utf8")));
validateAndroidE2eEvidence(evidence, {
  allowPhysicalDevice: process.env.CODEWIDE_ALLOW_PHYSICAL_E2E_EVIDENCE === "1",
  currentFingerprint: await computeSourceFingerprint(repoRoot),
  now: new Date(),
});
const artifactRoot = path.dirname(evidencePath);
const parityRoot = path.join(artifactRoot, "visual-parity");
const parityEvidencePath = path.join(parityRoot, "evidence.json");
const parityEvidenceStat = await lstat(parityEvidencePath);
if (!parityEvidenceStat.isFile()) {
  throw new Error("Visual parity evidence must be a regular file");
}
const parityEvidence = parseVisualParityEvidence(
  JSON.parse(await readFile(parityEvidencePath, "utf8")),
);
const parityMatrix = parseVisualParityMatrix(
  await readFile(path.join(repoRoot, "docs", "android-v2-visual-parity.md"), "utf8"),
);
validateVisualParityMatrix(parityEvidence, parityMatrix);
const parityArtifacts = validateVisualParityEvidence(parityEvidence);
for (const artifact of parityArtifacts) {
  const artifactStat = await lstat(path.join(parityRoot, artifact));
  if (!artifactStat.isFile() || artifactStat.size === 0) {
    throw new Error(`Visual parity artifact is missing or invalid: ${artifact}`);
  }
}
for (const row of parityEvidence.rows) {
  if (row.status !== "intentional-difference") continue;
  for (const capture of row.captures) {
    if (capture.v1Xml === undefined || capture.v2Xml === undefined) {
      throw new Error(`Intentional visual difference ${row.id}/${capture.state} has no XML pair`);
    }
    const v1Xml = await readFile(path.join(parityRoot, capture.v1Xml), "utf8");
    const v2Xml = await readFile(path.join(parityRoot, capture.v2Xml), "utf8");
    if (capture.status === "intentional-difference") {
      validateIntentionalDifferenceXml(row.id, v1Xml, v2Xml, capture.state);
    } else {
      validateRequiredStrictCaptureXml(row.id, capture.state, v1Xml, v2Xml);
    }
  }
}
for (const video of evidence.videos) {
  if (path.basename(video) !== video) throw new Error(`Invalid Android E2E video path: ${video}`);
  const videoStat = await lstat(path.join(artifactRoot, video));
  if (!videoStat.isFile() || videoStat.size < 4_096) {
    throw new Error(`Android E2E video is missing or invalid: ${video}`);
  }
}
const report = await lstat(path.join(artifactRoot, "report.html"));
if (!report.isFile() || report.size === 0) throw new Error("Android E2E report.html is missing");
process.stdout.write(
  `${JSON.stringify({ ok: true, runId: evidence.runId, evidence: path.relative(repoRoot, evidencePath) })}\n`,
);
