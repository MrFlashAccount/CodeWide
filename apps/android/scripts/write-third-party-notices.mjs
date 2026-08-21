import { chmod, readFile, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

function packageRootFor(filePath) {
  const absolute = path.resolve(filePath);
  const marker = `${path.sep}node_modules${path.sep}`;
  const markerIndex = absolute.lastIndexOf(marker);
  if (markerIndex < 0) return null;
  const nodeModulesRoot = absolute.slice(0, markerIndex + marker.length);
  const segments = absolute.slice(markerIndex + marker.length).split(path.sep);
  const packageSegments = segments[0]?.startsWith("@") ? segments.slice(0, 2) : segments.slice(0, 1);
  if (packageSegments.length === 0 || packageSegments.some((segment) => segment.length === 0)) return null;
  return path.join(nodeModulesRoot, ...packageSegments);
}

async function readPackageNotice(packageRoot) {
  const packageJsonPath = path.join(packageRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const entries = await readdir(packageRoot);
  const licenseFile = entries
    .filter((entry) => /^(.*[-_.])?(licen[cs]e|copying|copyright)([-_.].*)?$/i.test(entry))
    .sort((left, right) => left.localeCompare(right))[0];
  const noticeFiles = entries
    .filter((entry) => /^notice([-_.].*)?$/i.test(entry))
    .sort((left, right) => left.localeCompare(right));
  return {
    name: String(packageJson.name ?? path.basename(packageRoot)),
    version: String(packageJson.version ?? "unknown"),
    declaredLicense: String(packageJson.license ?? "unspecified"),
    licenseText: licenseFile === undefined ? null : (await readFile(path.join(packageRoot, licenseFile), "utf8")).trim(),
    notices: await Promise.all(
      noticeFiles.map(async (fileName) => ({
        fileName,
        text: (await readFile(path.join(packageRoot, fileName), "utf8")).trim(),
      })),
    ),
  };
}

function packageTable(packages) {
  return [
    "| Package | Version | Declared license |",
    "| --- | --- | --- |",
    ...packages.map((entry) => `| \`${entry.name}\` | \`${entry.version}\` | ${entry.declaredLicense} |`),
  ].join("\n");
}

function groupedLicenseSections(packages) {
  const groups = new Map();
  for (const entry of packages) {
    const packageNames = groups.get(entry.licenseText) ?? [];
    packageNames.push(`${entry.name}@${entry.version}`);
    groups.set(entry.licenseText, packageNames);
  }
  return [...groups.entries()]
    .sort((left, right) => left[1][0].localeCompare(right[1][0]))
    .map(([licenseText, packageNames]) => [
      `### ${packageNames.map((name) => `\`${name}\``).join(", ")}`,
      "",
      licenseText,
    ].join("\n"))
    .join("\n\n");
}

function fillSharedLicenseTexts(packages) {
  const licenseTextBySpdx = new Map();
  for (const entry of packages) {
    if (entry.licenseText !== null) licenseTextBySpdx.set(entry.declaredLicense.toLowerCase(), entry.licenseText);
  }
  return packages.map((entry) => {
    if (entry.licenseText !== null) return entry;
    const sharedText = licenseTextBySpdx.get(entry.declaredLicense.toLowerCase());
    if (sharedText === undefined) {
      throw new Error(`Bundled package ${entry.name} has no readable license file or shared ${entry.declaredLicense} license text`);
    }
    return { ...entry, licenseText: sharedText };
  });
}

function requiredNoticeSections(packages) {
  return packages
    .flatMap((entry) => entry.notices.map((notice) => ({ ...notice, packageName: `${entry.name}@${entry.version}` })))
    .sort((left, right) => left.packageName.localeCompare(right.packageName) || left.fileName.localeCompare(right.fileName))
    .map((notice) => [
      `### \`${notice.packageName}\` — ${notice.fileName}`,
      "",
      notice.text,
    ].join("\n"))
    .join("\n\n");
}

export async function writeThirdPartyNotices({ androidRoot, destinationDirectory, bundledInputs }) {
  const inputPaths = bundledInputs.map((input) => path.resolve(process.cwd(), input));
  inputPaths.push(
    require.resolve("mermaid/dist/mermaid.min.js"),
    require.resolve("svgbob-wasm/svgbob_wasm_bg.js"),
    require.resolve("@panzoom/panzoom/dist/panzoom.min.js"),
    require.resolve("chii/package.json"),
  );
  const packageRoots = [...new Set(inputPaths.map(packageRootFor).filter((root) => root !== null))].sort();
  const packages = fillSharedLicenseTexts(await Promise.all(packageRoots.map(readPackageNotice)))
    .sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
  const manualNotices = (await readFile(path.join(androidRoot, "assets/THIRD_PARTY_NOTICES.manual.md"), "utf8")).trim();
  const requiredNotices = requiredNoticeSections(packages);
  const generated = [
    manualNotices,
    "",
    "## Bundled Android WebView dependencies",
    "",
    "This section is generated from the exact inputs used by the code-review, Mermaid, ASCII-diagram, browser DevTools, and pan/zoom WebView assets.",
    "",
    packageTable(packages),
    "",
    "## Bundled dependency license texts",
    "",
    groupedLicenseSections(packages),
    ...(requiredNotices.length > 0 ? ["", "## Required dependency notices", "", requiredNotices] : []),
    "",
  ].join("\n");
  const sourceDestination = path.join(androidRoot, "THIRD_PARTY_NOTICES.md");
  const assetDestination = path.join(destinationDirectory, "THIRD_PARTY_NOTICES.md");
  await Promise.all([
    writeFile(sourceDestination, generated, "utf8"),
    writeFile(assetDestination, generated, "utf8"),
  ]);
  await Promise.all([chmod(sourceDestination, 0o644), chmod(assetDestination, 0o644)]);
}
