import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const roots = process.argv.slice(2);
const requestedRoots = roots.length === 0
  ? ["apps/android/dist", "target/release/codewide-companion"]
  : roots;

const forbidden = [
  { name: "OpenAI-style API key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { name: "bearer credential", pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{32,}\b/g },
  { name: "serialized pairing token", pattern: /["']pairingToken["']\s*:\s*["'][A-Za-z0-9_-]{32,}["']/g },
  { name: "serialized capability token", pattern: /["']capabilityToken["']\s*:\s*["'][A-Za-z0-9_-]{32,}["']/g },
  { name: "private home path", pattern: /\/(?:home|Users)\/[A-Za-z0-9._-]+\//g },
] as const;

const findings: Array<{ file: string; kind: string }> = [];
let scannedFiles = 0;
let scannedBytes = 0;

for (const root of requestedRoots) {
  for (const file of await filesUnder(root)) {
    const content = await readFile(file);
    scannedFiles += 1;
    scannedBytes += content.byteLength;
    const text = content.toString("latin1");
    for (const rule of forbidden) {
      rule.pattern.lastIndex = 0;
      if (rule.pattern.test(text)) findings.push({ file, kind: rule.name });
    }
  }
}

if (findings.length > 0) {
  process.stderr.write(`${JSON.stringify({ ok: false, findings }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({ ok: true, scannedFiles, scannedBytes })}\n`);
}

async function filesUnder(root: string): Promise<string[]> {
  const metadata = await stat(root).catch(() => null);
  if (metadata === null) return [];
  if (metadata.isFile()) return [root];
  const result: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await filesUnder(child));
    else if (entry.isFile()) result.push(child);
  }
  return result;
}
