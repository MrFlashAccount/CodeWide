import type {
  ConfigReadResponse,
  ModelListResponse,
  PermissionProfileListResponse,
} from "@codewide/codex-protocol/v0.147.0/v2";
import type { RpcClient } from "@codewide/sync-client";
import { loadSkillCatalog } from "./load-skill-catalog";
import type { TurnControlsRow, TurnControlsValue } from "./turn-controls-types";
import type { WorkspaceResourceDatabase } from "./workspace-resource-database";
import { turnControlsResourceKey } from "./workspace-resource-keys";
import type { createWorkspaceSession } from "./workspace-session";

export type TurnControlsSection = keyof TurnControlsValue;
export type TurnControlsLoaders = {
  [Section in TurnControlsSection]: () => Promise<TurnControlsValue[Section]>;
};

export type TurnControlsLoadResult = {
  value: TurnControlsValue;
  errors: Error[];
  loadedSections: number;
};

export function isTurnControlsCacheFresh(
  cached: Pick<TurnControlsRow, "status" | "value" | "error" | "updatedAt"> | undefined,
  now: number,
  maxAgeMs: number,
): boolean {
  return (
    cached?.status === "ready" &&
    cached.error === null &&
    cached.value !== null &&
    cached.value.defaults !== undefined &&
    cached.value.models.every((model) => typeof model.isDefault === "boolean") &&
    cached.value.skills.every((skill) => skill.catalog !== undefined) &&
    now - cached.updatedAt < maxAgeMs
  );
}

/**
 * Fetches independent catalogs concurrently and publishes every successful
 * section immediately. A slow skill scan can never hold model/permission UI.
 */
export async function loadTurnControlsIncrementally(
  initial: TurnControlsValue,
  loaders: TurnControlsLoaders,
  onPartial: (value: TurnControlsValue, section: TurnControlsSection) => void,
  timeoutMs = 12_000,
): Promise<TurnControlsLoadResult> {
  const current = cloneTurnControls(initial);
  const loadSection = async <Section extends TurnControlsSection>(
    section: Section,
  ): Promise<Error | null> => {
    try {
      const value = await withTimeout(loaders[section](), timeoutMs, section);
      assignSection(current, section, value);
      onPartial(cloneTurnControls(current), section);
      return null;
    } catch (cause) {
      return cause instanceof Error ? cause : new Error(`Could not load ${section}`);
    }
  };
  const results = await Promise.all([
    loadSection("models"),
    loadSection("skills"),
    loadSection("permissions"),
    loadSection("defaults"),
  ]);
  const errors = results.filter((error): error is Error => error !== null);
  return { value: current, errors, loadedSections: 4 - errors.length };
}

export function cloneTurnControls(value: TurnControlsValue): TurnControlsValue {
  return {
    models: value.models.map((model) => ({
      ...model,
      isDefault: model.isDefault === true,
      efforts: [...model.efforts],
    })),
    skills: value.skills.map((skill) => ({ ...skill })),
    permissions: value.permissions.map((permission) => ({ ...permission })),
    defaults:
      value.defaults === undefined
        ? { model: null, effort: null, permissions: null }
        : { ...value.defaults },
  };
}

function assignSection<Section extends TurnControlsSection>(
  target: TurnControlsValue,
  section: Section,
  value: TurnControlsValue[Section],
): void {
  // Indexed assignment cannot retain the key/value correlation from the
  // mapped loader type. Keep that TypeScript limitation inside this module.
  Object.assign(target, { [section]: value });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} catalog timed out after ${timeoutMs} ms`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

const TURN_CONTROLS_FRESH_MS = 6 * 60 * 60 * 1_000;
const EMPTY_TURN_CONTROLS: TurnControlsValue = {
  models: [],
  skills: [],
  permissions: [],
  defaults: { model: null, effort: null, permissions: null },
};

/** Existing resource projection and qualified session access for catalog loading. */
export type TurnControlsAuthority = {
  getResources(): Pick<WorkspaceResourceDatabase, "turnControls" | "putTurnControls"> | null;
  getSession(connectionId: string): RpcClient | undefined;
  rpcAfterAttach: ReturnType<typeof createWorkspaceSession>["rpcAfterAttach"];
};

/** Keeps one pending catalog operation per connection and working directory. */
export function createTurnControlsLoader({
  getResources,
  getSession,
  rpcAfterAttach,
}: TurnControlsAuthority) {
  const turnControlsInFlight = new Map<string, Promise<TurnControlsValue>>();
  const loadTurnControls = async (
    connectionId: string,
    cwd: string,
  ): Promise<TurnControlsValue> => {
    const cacheKey = turnControlsResourceKey(connectionId, cwd);
    const resources = getResources();
    const cached = resources?.turnControls.get(cacheKey);
    const pending = turnControlsInFlight.get(cacheKey);
    if (pending !== undefined) return await pending;
    const session = getSession(connectionId);
    const cachedValue =
      cached?.value === null || cached?.value === undefined
        ? null
        : cloneTurnControls(cached.value);
    const cacheFresh = isTurnControlsCacheFresh(cached, Date.now(), TURN_CONTROLS_FRESH_MS);
    if (cacheFresh && cachedValue !== null) return cachedValue;
    if (session === undefined) {
      if (cachedValue !== null) return cachedValue;
      throw new Error("Connection is not enabled");
    }
    const operation = (async (): Promise<TurnControlsValue> => {
      try {
        resources?.putTurnControls({
          id: cacheKey,
          connectionId,
          cwd,
          status: cachedValue === null ? "loading" : "refreshing",
          value: cachedValue,
          error: null,
        });
        const result = await loadTurnControlsIncrementally(
          cachedValue ?? EMPTY_TURN_CONTROLS,
          {
            models: async () => {
              const response = await rpcAfterAttach<ModelListResponse>(session, "model/list", {
                cursor: null,
                limit: 100,
                includeHidden: false,
              });
              return response.data.map((model) => ({
                id: model.model,
                label: model.displayName,
                defaultEffort: model.defaultReasoningEffort,
                efforts: model.supportedReasoningEfforts.map((option) => option.reasoningEffort),
                supportsPersonality: model.supportsPersonality,
                isDefault: model.isDefault,
              }));
            },
            skills: () =>
              loadSkillCatalog({
                skills: () =>
                  rpcAfterAttach<unknown>(session, "skills/list", {
                    cwds: [cwd],
                    forceReload: false,
                  }),
                installedPlugins: () =>
                  rpcAfterAttach<unknown>(session, "plugin/installed", { cwds: [cwd] }),
                plugin: ({ pluginName, marketplacePath, remoteMarketplaceName }) =>
                  rpcAfterAttach<unknown>(session, "plugin/read", {
                    pluginName,
                    marketplacePath,
                    remoteMarketplaceName,
                  }),
              }),
            permissions: async () => {
              const response = await rpcAfterAttach<PermissionProfileListResponse>(
                session,
                "permissionProfile/list",
                { cursor: null, limit: 100, cwd },
              );
              return response.data;
            },
            defaults: async () => {
              const response = await rpcAfterAttach<ConfigReadResponse>(session, "config/read", {
                cwd,
                includeLayers: false,
              });
              const configuredPermissions =
                typeof response.config.permissions === "string"
                  ? response.config.permissions
                  : response.config.sandbox_mode === "danger-full-access"
                    ? ":danger-full-access"
                    : response.config.sandbox_mode === "workspace-write"
                      ? ":workspace"
                      : response.config.sandbox_mode === "read-only"
                        ? ":read-only"
                        : null;
              return {
                model: response.config.model,
                effort: response.config.model_reasoning_effort,
                permissions: configuredPermissions,
              };
            },
          },
          (value) =>
            resources?.putTurnControls({
              id: cacheKey,
              connectionId,
              cwd,
              status: "refreshing",
              value,
              error: null,
            }),
        );
        if (result.loadedSections === 0 && cachedValue === null) {
          throw (
            result.errors[0] ??
            new Error("Could not load model, skill, permission, or default controls")
          );
        }
        const partialError =
          result.errors.length === 0
            ? null
            : `Some controls are unavailable: ${result.errors.map((cause) => cause.message).join(" · ")}`;
        resources?.putTurnControls({
          id: cacheKey,
          connectionId,
          cwd,
          status: "ready",
          value: result.value,
          error: partialError,
        });
        return result.value;
      } catch (cause) {
        resources?.putTurnControls({
          id: cacheKey,
          connectionId,
          cwd,
          status: "error",
          value: cachedValue,
          error: cause instanceof Error ? cause.message : "Could not load turn controls",
        });
        throw cause;
      }
    })();
    turnControlsInFlight.set(cacheKey, operation);
    const release = () => {
      if (turnControlsInFlight.get(cacheKey) === operation) {
        turnControlsInFlight.delete(cacheKey);
      }
    };
    void operation.then(release, release);
    // A durable value is usable immediately. Refresh it in the background;
    // callers should never block an already-open thread on catalog RPCs.
    if (cachedValue !== null) {
      void operation.catch(() => undefined);
      return cachedValue;
    }
    return await operation;
  };

  return loadTurnControls;
}
