import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";

type ReportStep = {
  name: string;
  status: "passed" | "failed";
  durationMs: number;
  error?: string;
};

export type E2eReportEvidence = {
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
  steps: readonly ReportStep[];
  observations: readonly {
    stage: string;
    source: string;
    elapsedMs: number;
    outcome: string;
    operationId?: string;
  }[];
  videos: readonly string[];
  failure: string | null;
};

export async function writeE2eReport(
  artifactDir: string,
  evidence: E2eReportEvidence,
): Promise<string> {
  const reportPath = path.join(artifactDir, "report.html");
  const artifacts = await collectArtifacts(artifactDir);
  await writeFile(reportPath, renderReport(evidence, artifacts), { mode: 0o600 });
  return reportPath;
}

function renderReport(evidence: E2eReportEvidence, artifacts: readonly string[]): string {
  const status = evidence.passed ? "PASS" : "FAIL";
  const existingVideos = artifacts.filter(isVideoArtifact);
  const orderedVideos = [
    ...evidence.videos.filter((video) => existingVideos.includes(video)),
    ...existingVideos.filter((video) => !evidence.videos.includes(video)),
  ];
  const videos = orderedVideos
    .map(
      (video, index) => `
    <article>
      <div class="artifact-title"><span>${index + 1}</span>${escapeHtml(labelFromFile(video))}<a href="${artifactUrl(video)}" download>download</a></div>
      <video controls preload="metadata" src="${artifactUrl(video)}"></video>
    </article>`,
    )
    .join("");
  const images = artifacts
    .filter(isImageArtifact)
    .map(
      (image) => `
    <article>
      <div class="artifact-title">${escapeHtml(labelFromFile(image))}<a href="${artifactUrl(image)}">open</a></div>
      <a class="image-link" href="${artifactUrl(image)}"><img loading="lazy" src="${artifactUrl(image)}" alt="${escapeHtml(labelFromFile(image))}"></a>
    </article>`,
    )
    .join("");
  const files = artifacts
    .filter((artifact) => !isVideoArtifact(artifact) && !isImageArtifact(artifact))
    .map(
      (artifact) => `
      <li><a href="${artifactUrl(artifact)}">${escapeHtml(artifact)}</a></li>`,
    )
    .join("");
  const steps = evidence.steps
    .map(
      (step) => `
      <tr>
        <td class="step-status ${step.status}">${step.status === "passed" ? "PASS" : "FAIL"}</td>
        <td>${escapeHtml(step.name)}</td>
        <td>${formatDuration(step.durationMs)}</td>
      </tr>`,
    )
    .join("");
  const failure = evidence.failure === null ? "" : `<pre>${escapeHtml(evidence.failure)}</pre>`;
  const observations = evidence.observations
    .map(
      (observation) => `
      <tr>
        <td>${escapeHtml(observation.stage)}</td>
        <td>${escapeHtml(observation.source)}</td>
        <td>${escapeHtml(observation.outcome)}</td>
        <td>${escapeHtml(observation.operationId ?? "-")}</td>
        <td>${formatDuration(observation.elapsedMs)}</td>
      </tr>`,
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CodeWide Android E2E · ${escapeHtml(evidence.runId)}</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #09090b; color: #f4f4f5; }
    * { box-sizing: border-box; }
    body { margin: 0; }
    main { width: min(1180px, calc(100% - 32px)); margin: 32px auto 64px; }
    header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 28px; }
    h1 { margin: 0 0 8px; font-size: clamp(24px, 4vw, 38px); letter-spacing: -.04em; }
    .meta { color: #a1a1aa; font: 13px ui-monospace, SFMono-Regular, monospace; overflow-wrap: anywhere; }
    .badge { border: 1px solid ${evidence.passed ? "#166534" : "#991b1b"}; border-radius: 999px; padding: 7px 12px; color: ${evidence.passed ? "#86efac" : "#fca5a5"}; background: ${evidence.passed ? "#052e16" : "#450a0a"}; font-weight: 800; }
    .artifacts { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 460px), 1fr)); gap: 20px; }
    article, .steps { border: 1px solid #27272a; border-radius: 16px; background: #111113; overflow: hidden; }
    .artifact-title { display: flex; align-items: center; gap: 10px; padding: 14px 16px; font-weight: 700; overflow-wrap: anywhere; }
    .artifact-title span { display: grid; place-items: center; flex: 0 0 24px; width: 24px; height: 24px; border-radius: 50%; background: #27272a; color: #d4d4d8; font-size: 12px; }
    .artifact-title a { margin-left: auto; color: #a5b4fc; font-size: 12px; }
    video { display: block; width: 100%; max-height: 72vh; background: #000; }
    .image-link { display: block; background: #09090b; }
    img { display: block; width: 100%; max-height: 72vh; object-fit: contain; }
    h2 { margin: 36px 0 14px; font-size: 20px; }
    table { width: 100%; border-collapse: collapse; }
    td { padding: 11px 14px; border-bottom: 1px solid #27272a; }
    tr:last-child td { border-bottom: 0; }
    td:last-child { text-align: right; color: #a1a1aa; font-variant-numeric: tabular-nums; }
    .step-status { width: 70px; font: 700 11px ui-monospace, SFMono-Regular, monospace; }
    .step-status.passed { color: #86efac; }
    .step-status.failed { color: #fca5a5; }
    .files { margin: 0; padding: 8px 16px 8px 36px; }
    .files li { padding: 7px 0; overflow-wrap: anywhere; }
    .files a { color: #a5b4fc; }
    pre { white-space: pre-wrap; padding: 16px; border: 1px solid #7f1d1d; border-radius: 12px; background: #450a0a; color: #fecaca; }
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <h1>Android → real Observer E2E</h1>
        <div class="meta">schema ${evidence.schemaVersion} · ${escapeHtml(evidence.suite)} · ${escapeHtml(evidence.backend)} · ${escapeHtml(evidence.buildMode)} build<br>${escapeHtml(evidence.runId)} · completed ${escapeHtml(evidence.completedAt)} · ${escapeHtml(evidence.deviceKind ?? "no device")} ${escapeHtml(evidence.deviceSerial ?? "")} · ${escapeHtml(evidence.threadId ?? "no thread")}<br>source ${escapeHtml(evidence.sourceFingerprint)}</div>
      </div>
      <div class="badge">${status}</div>
    </header>
    ${failure}
    ${videos === "" ? "" : `<h2>Videos</h2><section class="artifacts">${videos}</section>`}
    ${images === "" ? "" : `<h2>Screenshots and visual diffs</h2><section class="artifacts">${images}</section>`}
    ${files === "" ? "" : `<h2>Logs, page sources, and evidence</h2><div class="steps"><ul class="files">${files}</ul></div>`}
    <h2>Execution</h2>
    <div class="steps"><table><tbody>${steps}</tbody></table></div>
    <h2>Authoritative observations</h2>
    <div class="steps"><table><tbody>${observations}</tbody></table></div>
  </main>
</body>
</html>
`;
}

function labelFromFile(fileName: string): string {
  return fileName
    .replace(/^[0-9]+-/u, "")
    .replace(/\.(?:jpe?g|json|log|mov|mp4|png|txt|webm|webp|xml)$/iu, "")
    .replaceAll("-", " ");
}

function formatDuration(durationMs: number): string {
  return durationMs < 1_000 ? `${durationMs} ms` : `${(durationMs / 1_000).toFixed(1)} s`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function collectArtifacts(root: string, directory = ""): Promise<string[]> {
  const artifacts: string[] = [];
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = directory === "" ? entry.name : path.posix.join(directory, entry.name);
    if (entry.isDirectory()) {
      artifacts.push(...(await collectArtifacts(root, relativePath)));
    } else if (entry.isFile() && entry.name !== "report.html") {
      artifacts.push(relativePath);
    }
  }
  artifacts.sort((left, right) => left.localeCompare(right));
  return artifacts;
}

function isVideoArtifact(fileName: string): boolean {
  return /\.(?:mov|mp4|webm)$/iu.test(fileName);
}

function isImageArtifact(fileName: string): boolean {
  return /\.(?:jpe?g|png|webp)$/iu.test(fileName);
}

function artifactUrl(relativePath: string): string {
  return escapeHtml(relativePath.split("/").map(encodeURIComponent).join("/"));
}
