/**
 * Catalog-row provider annotations added by a multi-provider Companion.
 *
 * `model/list` rows carry `codewideAgentProvider` and `permissionProfile/list`
 * rows carry `codewideAgentProviders`. Both are extension fields outside the
 * generated App Server types, so they are validated here at the RPC boundary.
 * A legacy Companion omits them; the client then treats the catalog as one
 * provider and applies no provider scoping.
 */
import type { PermissionProfileSummary } from "@codewide/codex-protocol/v0.155.1/v2";
import { parseAgentProviderId, type AgentProviderId } from "./threadAgent";
import type { TurnControlsValue } from "./turn-controls-types";
import { unknownRecord } from "./unknownRecord";

type CatalogModel = TurnControlsValue["models"][number];
type CatalogPermission = TurnControlsValue["permissions"][number];

/** Reads the provider of one `model/list` row; `null` when the Companion did not annotate it. */
export function modelRowAgentProvider(row: unknown): AgentProviderId | null {
  return parseAgentProviderId(unknownRecord(row)?.codewideAgentProvider);
}

/** Converts one `permissionProfile/list` row into the catalog row with its provider annotation. */
export function permissionRowWithProviders(row: PermissionProfileSummary): CatalogPermission {
  const annotated: unknown = unknownRecord(row)?.codewideAgentProviders;
  const providers = Array.isArray(annotated)
    ? annotated.flatMap((value: unknown) => {
        const provider = parseAgentProviderId(value);
        return provider === null ? [] : [provider];
      })
    : null;
  return { allowed: row.allowed, description: row.description, id: row.id, providers };
}

/** Persisted catalogs written before provider annotations existed must be refreshed once. */
export function catalogHasProviderFields(value: TurnControlsValue): boolean {
  return (
    value.models.every((model) => "provider" in model) &&
    value.permissions.every((permission) => "providers" in permission)
  );
}

/**
 * Rows of the host's primary provider. The merged `model/list` marks exactly one
 * row `isDefault`, and it belongs to the primary provider. A legacy or
 * unannotated catalog is returned unchanged.
 */
export function primaryProviderModels<Model extends Pick<CatalogModel, "isDefault" | "provider">>(
  models: readonly Model[],
): readonly Model[] {
  const primary = models.find((model) => model.isDefault)?.provider ?? null;
  return primary === null
    ? models
    : models.filter((model) => model.provider === null || model.provider === primary);
}
