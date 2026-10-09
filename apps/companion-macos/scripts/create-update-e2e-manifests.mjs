#!/usr/bin/env node

import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const [
  hostRoot,
  serverOrigin,
  baselineDmg,
  targetDmg,
  baselineVersion,
  baselineBuild,
  baselineRevision,
  targetVersion,
  targetBuild,
  targetRevision,
] = process.argv.slice(2);

if ([hostRoot, serverOrigin, baselineDmg, targetDmg, baselineVersion, baselineBuild,
  baselineRevision, targetVersion, targetBuild, targetRevision].some((value) => !value)) {
  throw new Error("Expected host root, origin, two artifacts, and baseline/target metadata");
}
const fixtureOrigin = new URL(serverOrigin);
if (fixtureOrigin.protocol !== "http:" || fixtureOrigin.hostname !== "127.0.0.1"
    || !fixtureOrigin.port || fixtureOrigin.pathname !== "/") {
  throw new Error("E2E fixture origin must be an explicit 127.0.0.1 HTTP origin");
}

const privateKeyPem = process.env.CODEWIDE_HOST_UPDATE_SIGNING_PRIVATE_KEY;
const publicKeySpki = process.env.CODEWIDE_HOST_UPDATE_SIGNING_PUBLIC_KEY_SPKI;
const keyId = process.env.CODEWIDE_HOST_UPDATE_SIGNING_KEY_ID;
if (!privateKeyPem || !publicKeySpki || !/^[A-Za-z0-9_-]{1,64}$/u.test(keyId ?? "")) {
  throw new Error("Host-update private key, public SPKI, and key id are required");
}
const privateKey = createPrivateKey(privateKeyPem);
if (privateKey.asymmetricKeyType !== "ec"
    || privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
  throw new Error("Host-update E2E key must be P-256");
}
const derivedSpki = createPublicKey(privateKey)
  .export({ format: "der", type: "spki" }).toString("base64");
if (derivedSpki !== publicKeySpki) throw new Error("Host-update E2E key pair does not match");

const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const baselineDigest = sha256(baselineDmg);
const targetDigest = sha256(targetDmg);
const issuedAt = Math.floor(Date.now() / 1000) - 60;
const expiresAt = issuedAt + 60 * 60;
const baselineName = "CodeWide-baseline.dmg";
const targetName = basename(targetDmg);
const releasePrefix = "https://github.com/MrFlashAccount/CodeWide/releases/download";
const baselineArtifactDirectory = join(hostRoot, "releases", "download", `v${baselineVersion}`);
const targetArtifactDirectory = join(hostRoot, "releases", "download", `v${targetVersion}`);
mkdirSync(baselineArtifactDirectory, { recursive: true });
mkdirSync(targetArtifactDirectory, { recursive: true });
copyFileSync(baselineDmg, join(baselineArtifactDirectory, baselineName));
copyFileSync(targetDmg, join(targetArtifactDirectory, targetName));

function target(version, build, sourceRevision, artifactUrl, digest, rollbackCompatibleFrom) {
  return {
    platform: "macos-universal",
    version,
    build,
    sourceRevision,
    artifactUrl,
    sha256: digest,
    bootstrapVersion: 1,
    journalVersion: 1,
    stateEpoch: 1,
    rollbackCompatibleFrom,
  };
}

function envelope(sequence, releaseTarget) {
  const payload = Buffer.from(JSON.stringify({
    schemaVersion: 1,
    channel: "stable",
    sequence,
    issuedAt,
    expiresAt,
    targets: [releaseTarget],
  }), "utf8");
  return {
    schemaVersion: 1,
    keyId,
    algorithm: "ES256",
    payload: payload.toString("base64url"),
    signature: sign("sha256", payload, privateKey).toString("base64"),
  };
}

const baselineEnvelope = envelope(1, target(
  baselineVersion,
  baselineBuild,
  baselineRevision,
  `${releasePrefix}/v${baselineVersion}/${baselineName}`,
  baselineDigest,
  [],
));
const targetEnvelope = envelope(2, target(
  targetVersion,
  targetBuild,
  targetRevision,
  `${releasePrefix}/v${targetVersion}/${encodeURIComponent(targetName)}`,
  targetDigest,
  [baselineDigest],
));

const baselineManifestDirectory = join(hostRoot, "releases", "download", `v${baselineVersion}`);
const latestManifestDirectory = join(hostRoot, "latest");
mkdirSync(baselineManifestDirectory, { recursive: true });
mkdirSync(latestManifestDirectory, { recursive: true });
writeFileSync(
  join(baselineManifestDirectory, "release-manifest.json"),
  `${JSON.stringify(baselineEnvelope, null, 2)}\n`,
);
writeFileSync(
  join(latestManifestDirectory, "release-manifest.json"),
  `${JSON.stringify(targetEnvelope, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify({ baselineDigest, targetDigest })}\n`);
