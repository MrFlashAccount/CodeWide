#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { readReleaseDelivery, releaseRecord } from "./release-product-contract.ts";

/** Fetches only unchanged published products and proves their original bytes before assembly. */
export function reuseReleaseProducts(planPath: string, destination: string): void {
  const plan = releaseRecord(JSON.parse(readFileSync(planPath, "utf8")), "release plan");
  if (!Array.isArray(plan.targets)) throw new Error("Release targets are required");
  mkdirSync(destination, { recursive: true });
  for (const value of plan.targets) {
    const target = readReleaseDelivery(value);
    if (target.delivery !== "reuse") continue;
    for (const asset of target.assets) {
      const download = spawnSync(
        "gh",
        ["release", "download", target.sourceTag, "--pattern", asset.name, "--dir", destination],
        { encoding: "utf8" },
      );
      if (download.error !== undefined) throw download.error;
      if (download.status !== 0)
        throw new Error(`Could not reuse ${target.id}: ${download.stderr.trim()}`);
      const bytes = readFileSync(join(destination, asset.name));
      if (
        bytes.length !== asset.size ||
        createHash("sha256").update(bytes).digest("hex") !== asset.sha256
      ) {
        throw new Error(`Reused asset checksum mismatch: ${asset.name}`);
      }
    }
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) {
  const [planPath, destination] = process.argv.slice(2);
  if (planPath === undefined || destination === undefined)
    throw new Error("Usage: reuse-release-products <plan.json> <destination>");
  reuseReleaseProducts(planPath, destination);
}
