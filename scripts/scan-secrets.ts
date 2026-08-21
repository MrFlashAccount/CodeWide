import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, platform, arch, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GITLEAKS_VERSION = "8.30.1";
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function gitleaksTarget(): string {
  const hostPlatform = platform();
  const hostArchitecture = arch();
  if (hostPlatform === "linux" && hostArchitecture === "x64") return "linux_x64";
  if (hostPlatform === "linux" && hostArchitecture === "arm64") return "linux_arm64";
  if (hostPlatform === "darwin" && hostArchitecture === "x64") return "darwin_x64";
  if (hostPlatform === "darwin" && hostArchitecture === "arm64") return "darwin_arm64";
  throw new Error(`Unsupported Gitleaks host: ${hostPlatform}/${hostArchitecture}`);
}

function run(command: string, args: readonly string[], cwd = repositoryRoot, echoOutput = true): Buffer {
  const result = spawnSync(command, args, { cwd, encoding: null, stdio: ["ignore", "pipe", "pipe"] });
  if (echoOutput && result.stdout.length > 0) process.stdout.write(result.stdout);
  if (echoOutput && result.stderr.length > 0) process.stderr.write(result.stderr);
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} ${args[0] ?? ""} failed with exit code ${result.status ?? "unknown"}`);
  }
  return result.stdout;
}

async function download(url: string): Promise<Buffer> {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function installGitleaks(): Promise<string> {
  const override = process.env.CODEWIDE_GITLEAKS_BIN?.trim();
  if (override !== undefined && override.length > 0) return override;

  const target = gitleaksTarget();
  const cacheRoot = process.env.XDG_CACHE_HOME?.trim() || path.join(homedir(), ".cache");
  const installDirectory = path.join(cacheRoot, "codewide", "gitleaks", GITLEAKS_VERSION, target);
  const binary = path.join(installDirectory, "gitleaks");
  try {
    run(binary, ["version"]);
    return binary;
  } catch {
    // Install the pinned, checksum-verified release into the user cache below.
  }

  const archiveName = `gitleaks_${GITLEAKS_VERSION}_${target}.tar.gz`;
  const releaseRoot = `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}`;
  const [archive, checksums] = await Promise.all([
    download(`${releaseRoot}/${archiveName}`),
    download(`${releaseRoot}/gitleaks_${GITLEAKS_VERSION}_checksums.txt`),
  ]);
  const checksumLine = checksums.toString("utf8").split(/\r?\n/u)
    .find((line) => line.endsWith(`  ${archiveName}`) || line.endsWith(` ${archiveName}`));
  if (checksumLine === undefined) throw new Error(`Checksum for ${archiveName} was not published`);
  const expected = checksumLine.trim().split(/\s+/u)[0];
  const actual = createHash("sha256").update(archive).digest("hex");
  if (actual !== expected) throw new Error(`Checksum mismatch for ${archiveName}`);

  const extractionDirectory = await mkdtemp(path.join(tmpdir(), "codewide-gitleaks-"));
  try {
    const archivePath = path.join(extractionDirectory, archiveName);
    await writeFile(archivePath, archive);
    run("tar", ["-xzf", archivePath, "-C", extractionDirectory, "gitleaks"]);
    await mkdir(installDirectory, { recursive: true });
    await copyFile(path.join(extractionDirectory, "gitleaks"), binary);
    await chmod(binary, 0o755);
  } finally {
    await rm(extractionDirectory, { recursive: true, force: true });
  }
  run(binary, ["version"]);
  return binary;
}

async function createWorkingTreeSnapshot(): Promise<string> {
  const snapshot = await mkdtemp(path.join(tmpdir(), "codewide-secret-snapshot-"));
  const listedFiles = run("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], repositoryRoot, false);
  const files = listedFiles.toString("utf8").split("\0").filter((file) => file.length > 0);
  for (const relativePath of files) {
    const source = path.resolve(repositoryRoot, relativePath);
    if (source !== repositoryRoot && !source.startsWith(`${repositoryRoot}${path.sep}`)) {
      throw new Error(`Git returned a path outside the repository: ${relativePath}`);
    }
    const destination = path.join(snapshot, relativePath);
    let metadata;
    try {
      metadata = await lstat(source);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    await mkdir(path.dirname(destination), { recursive: true });
    if (metadata.isSymbolicLink()) {
      await writeFile(destination, `${await readlink(source)}\n`, "utf8");
    } else if (metadata.isFile()) {
      await copyFile(source, destination);
    }
  }
  return snapshot;
}

const gitleaks = await installGitleaks();
console.log("Scanning reachable Git history with Gitleaks...");
run(gitleaks, ["git", "--no-banner", "--redact", "--timeout", "300", "."]);

const snapshot = await createWorkingTreeSnapshot();
try {
  console.log("Scanning tracked and untracked, non-ignored working-tree files with Gitleaks...");
  run(gitleaks, ["dir", "--no-banner", "--redact", "--timeout", "300", "."], snapshot);
} finally {
  await rm(snapshot, { recursive: true, force: true });
}
console.log(`Gitleaks ${GITLEAKS_VERSION}: no secrets found.`);
