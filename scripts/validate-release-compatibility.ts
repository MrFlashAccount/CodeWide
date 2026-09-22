#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

type InterfaceContract = {
  readonly versions: ReadonlySet<number>;
  readonly contract: string | undefined;
};

type ProductContract = {
  readonly provides: ReadonlyMap<string, ReadonlySet<number>>;
  readonly requires: ReadonlyMap<string, ReadonlySet<number>>;
};

type CompatibilityContract = {
  readonly interfaces: ReadonlyMap<string, InterfaceContract>;
  readonly products: ReadonlyMap<string, ProductContract>;
  readonly links: readonly {
    readonly provider: string;
    readonly consumer: string;
    readonly interfaceName: string;
  }[];
};

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const compatibilityPath = resolve(repoRoot, "release/compatibility.json");

export function validateCompatibility(value: unknown, readContractVersion: (path: string) => number): void {
  const contract = parseCompatibility(value);
  for (const [interfaceName, declaration] of contract.interfaces) {
    if (declaration.contract === undefined) continue;
    const actual = readContractVersion(declaration.contract);
    if (!declaration.versions.has(actual)) {
      throw new Error(`${interfaceName} contract declares protocol ${actual}, outside compatibility versions`);
    }
  }
  for (const link of contract.links) {
    const declaration = contract.interfaces.get(link.interfaceName);
    if (declaration === undefined) throw new Error(`Unknown interface ${link.interfaceName}`);
    const provider = contract.products.get(link.provider);
    if (provider === undefined) throw new Error(`Unknown provider ${link.provider}`);
    const consumer = contract.products.get(link.consumer);
    if (consumer === undefined) throw new Error(`Unknown consumer ${link.consumer}`);
    const provided = provider.provides.get(link.interfaceName);
    if (provided === undefined) throw new Error(`${link.provider} does not provide ${link.interfaceName}`);
    const required = consumer.requires.get(link.interfaceName);
    if (required === undefined) throw new Error(`${link.consumer} does not require ${link.interfaceName}`);
    ensureDeclaredVersions(link.provider, link.interfaceName, provided, declaration.versions);
    ensureDeclaredVersions(link.consumer, link.interfaceName, required, declaration.versions);
    if (![...provided].some((version) => required.has(version))) {
      throw new Error(`${link.provider} and ${link.consumer} have no compatible ${link.interfaceName} version`);
    }
  }
}

function parseCompatibility(value: unknown): CompatibilityContract {
  if (!isRecord(value) || value.schemaVersion !== 1) throw new Error("Compatibility schemaVersion must be 1");
  if (!isRecord(value.interfaces) || !isRecord(value.products) || !Array.isArray(value.links)) {
    throw new Error("Compatibility contract must define interfaces, products, and links");
  }
  const interfaces = new Map<string, InterfaceContract>();
  for (const [name, raw] of Object.entries(value.interfaces)) {
    if (!isRecord(raw)) throw new Error(`Interface ${name} must be an object`);
    interfaces.set(name, {
      versions: versions(raw.versions, `interfaces.${name}.versions`),
      contract: raw.contract === undefined ? undefined : nonEmptyString(raw.contract, `interfaces.${name}.contract`),
    });
  }
  const products = new Map<string, ProductContract>();
  for (const [name, raw] of Object.entries(value.products)) {
    if (!isRecord(raw)) throw new Error(`Product ${name} must be an object`);
    products.set(name, {
      provides: interfaceVersions(raw.provides, `products.${name}.provides`),
      requires: interfaceVersions(raw.requires, `products.${name}.requires`),
    });
  }
  const links = value.links.map((raw, index) => {
    if (!isRecord(raw)) throw new Error(`links.${index} must be an object`);
    return {
      provider: nonEmptyString(raw.provider, `links.${index}.provider`),
      consumer: nonEmptyString(raw.consumer, `links.${index}.consumer`),
      interfaceName: nonEmptyString(raw.interface, `links.${index}.interface`),
    };
  });
  return { interfaces, products, links };
}

function interfaceVersions(value: unknown, field: string): ReadonlyMap<string, ReadonlySet<number>> {
  if (!isRecord(value)) throw new Error(`${field} must be an object`);
  const parsed = new Map<string, ReadonlySet<number>>();
  for (const [name, raw] of Object.entries(value)) parsed.set(name, versions(raw, `${field}.${name}`));
  return parsed;
}

function versions(value: unknown, field: string): ReadonlySet<number> {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${field} must be a non-empty array`);
  const parsed = new Set<number>();
  for (const candidate of value) {
    if (typeof candidate !== "number" || !Number.isSafeInteger(candidate) || candidate < 1) {
      throw new Error(`${field} must contain positive integers`);
    }
    if (parsed.has(candidate)) throw new Error(`${field} contains duplicate version ${candidate}`);
    parsed.add(candidate);
  }
  return parsed;
}

function ensureDeclaredVersions(
  product: string,
  interfaceName: string,
  productVersions: ReadonlySet<number>,
  declared: ReadonlySet<number>,
): void {
  for (const version of productVersions) {
    if (!declared.has(version)) throw new Error(`${product} uses undeclared ${interfaceName} version ${version}`);
  }
}

function nonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${field} must be a non-empty string`);
  return value;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readProtocolVersion(relativePath: string): number {
  const path = resolve(repoRoot, relativePath);
  if (!path.startsWith(`${repoRoot}/`)) throw new Error(`Contract path escapes repository: ${relativePath}`);
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(value) || typeof value.protocolVersion !== "number" || !Number.isSafeInteger(value.protocolVersion)) {
    throw new Error(`${relativePath} has no integer protocolVersion`);
  }
  return value.protocolVersion;
}

function main(): void {
  const value: unknown = JSON.parse(readFileSync(compatibilityPath, "utf8"));
  validateCompatibility(value, readProtocolVersion);
  process.stdout.write("release compatibility: valid\n");
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`release compatibility: ${message}\n`);
    process.exitCode = 1;
  }
}
