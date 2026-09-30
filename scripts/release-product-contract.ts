/** Public release inventory: a product keeps the version and origin of its last build. */
export type ReleaseProduct = {
  readonly id: ReleaseProductId;
  readonly version: string;
  readonly sourceRevision: string;
  readonly sourceTag: string;
  readonly assets: readonly ReleaseProductAsset[];
};

export type ReleaseProductAsset = {
  readonly name: string;
  readonly sha256: string;
  readonly size: number;
};

export const releaseProductIds = ["relay", "companion-linux", "macos", "android-apk"] as const;
export type ReleaseProductId = (typeof releaseProductIds)[number];

export type ReleaseDelivery =
  | {
      readonly delivery: "build";
      readonly id: ReleaseProductId;
      readonly version: string;
      readonly sourceRevision: string;
      readonly sourceTag: string;
    }
  | ({ readonly delivery: "reuse" } & ReleaseProduct);

export function releaseRecord(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (!isReleaseRecord(value)) throw new Error(`${field} must be an object`);
  return value;
}

function isReleaseRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function releaseString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${field} must be a non-empty string`);
  return value;
}

export function releaseVersion(value: unknown): string {
  const parsed = releaseString(value, "version");
  if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u.test(parsed))
    throw new Error("Invalid release version");
  return parsed;
}

export function releaseRevision(value: unknown): string {
  const parsed = releaseString(value, "sourceRevision");
  if (!/^[0-9a-f]{40}$/u.test(parsed)) throw new Error("sourceRevision must be a full Git SHA");
  return parsed;
}

export function releaseTag(value: unknown): string {
  const parsed = releaseString(value, "sourceTag");
  if (isDatedReleaseTag(parsed)) return parsed;
  if (!parsed.startsWith("v")) throw new Error("Invalid release source tag");
  releaseVersion(parsed.slice(1));
  return parsed;
}

export function releaseProductId(value: unknown): ReleaseProductId {
  for (const id of releaseProductIds) if (value === id) return id;
  throw new Error("Unknown release product");
}

function readAsset(value: unknown): ReleaseProductAsset {
  const asset = releaseRecord(value, "asset");
  const name = releaseString(asset.name, "asset.name");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(name)) throw new Error("Unsafe release asset name");
  const sha256 = releaseString(asset.sha256, "asset.sha256");
  if (!/^[0-9a-f]{64}$/u.test(sha256)) throw new Error("Invalid release asset digest");
  if (typeof asset.size !== "number" || !Number.isSafeInteger(asset.size) || asset.size <= 0)
    throw new Error("Invalid release asset size");
  return { name, sha256, size: asset.size };
}

export function readReleaseProduct(value: unknown): ReleaseProduct {
  const product = releaseRecord(value, "product");
  if (!Array.isArray(product.assets) || product.assets.length === 0)
    throw new Error("Product assets are required");
  const assets = product.assets.map(readAsset);
  if (new Set(assets.map(({ name }) => name)).size !== assets.length)
    throw new Error("Duplicate product asset");
  return {
    id: releaseProductId(product.id),
    version: releaseVersion(product.version),
    sourceRevision: releaseRevision(product.sourceRevision),
    sourceTag: releaseTag(product.sourceTag),
    assets,
  };
}

export function readReleaseProducts(value: unknown): readonly ReleaseProduct[] {
  const manifest = releaseRecord(value, "release manifest");
  if (!Array.isArray(manifest.products)) throw new Error("Release manifest products are required");
  const products = manifest.products.map(readReleaseProduct);
  if (
    products.length !== releaseProductIds.length ||
    new Set(products.map(({ id }) => id)).size !== releaseProductIds.length
  ) {
    throw new Error("Release inventory must contain all four products exactly once");
  }
  return products;
}

export function readReleaseDelivery(value: unknown): ReleaseDelivery {
  const target = releaseRecord(value, "release target");
  if (target.delivery === "reuse") return { delivery: "reuse", ...readReleaseProduct(target) };
  if (target.delivery !== "build") throw new Error("Invalid release delivery");
  return readBuildDelivery(target);
}

function readBuildDelivery(
  target: Readonly<Record<string, unknown>>,
): Extract<ReleaseDelivery, { readonly delivery: "build" }> {
  return {
    delivery: "build",
    id: releaseProductId(target.id),
    version: releaseVersion(target.version),
    sourceRevision: releaseRevision(target.sourceRevision),
    sourceTag: releaseTag(target.sourceTag),
  };
}
import { isDatedReleaseTag } from "./release-set-identity.ts";
