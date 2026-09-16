import type {
  ConfigReadResponse,
  ModelListResponse,
  PermissionProfileListResponse,
} from "@codewide/codex-protocol/v0.147.0/v2";
import type { RpcClient } from "@codewide/sync-client";
import { loadSkillCatalog } from "./load-skill-catalog";
import type { TurnControlsRow, TurnControlsValue } from "./turn-controls-types";
import { unknownRecord } from "./unknownRecord";
import type { WorkspaceResourceDatabase } from "./workspace-resource-database";
import { turnControlsResourceKey } from "./workspace-resource-keys";
import type { createWorkspaceSession } from "./workspace-session";

export type TurnControlsSection = keyof TurnControlsValue;
export type TurnControlsLoaders = {
  [Section in TurnControlsSection]: () => Promise<TurnControlsValue[Section]>;
};

export type TurnControlsLoadResult = {
  errors: Error[];
  loadedSections: number;
  value: TurnControlsValue;
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
    persistedDefaultsPresent(cached.value) &&
    cached.value.models.every((model) => typeof model.isDefault === "boolean") &&
    cached.value.skills.every((skill) => skill.catalog !== undefined) &&
    now - cached.updatedAt < maxAgeMs
  );
}

function persistedDefaultsPresent(value: TurnControlsValue): boolean {
  return unknownRecord(value)?.defaults !== undefined;
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
    } catch (error) {
      return error instanceof Error ? error : new Error(`Could not load ${section}`);
    }
  };
  const results = await Promise.all([
    loadSection("models"),
    loadSection("skills"),
    loadSection("permissions"),
    loadSection("defaults"),
  ]);
  const errors = results.filter((error): error is Error => error !== null);
  return { errors, loadedSections: 4 - errors.length, value: current };
}

export function cloneTurnControls(value: TurnControlsValue): TurnControlsValue {
  return {
    defaults:
      // WHY: Persisted rows from an older schema may omit defaults even though current writes always include it.
      // oxlint-disable-next-line typescript/no-unnecessary-condition
      value.defaults === undefined
        ? { effort: null, model: null, permissions: null }
        : { ...value.defaults },
    models: value.models.map((model) => ({
      ...model,
      efforts: [...model.efforts],
      isDefault: model.isDefault,
    })),
    permissions: value.permissions.map((permission) => ({ ...permission })),
    skills: value.skills.map((skill) => ({ ...skill })),
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

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} catalog timed out after ${String(timeoutMs)} ms`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== null) {
      clearTimeout(timer);
    }
  });
}

const TURN_CONTROLS_FRESH_MS = 6 * 60 * 60 * 1000;
const EMPTY_TURN_CONTROLS: TurnControlsValue = {
  defaults: { effort: null, model: null, permissions: null },
  models: [],
  permissions: [],
  skills: [],
};

/** Existing resource projection and qualified session access for catalog loading. */
export type TurnControlsAuthority = {
  getResources: () => Pick<WorkspaceResourceDatabase, "turnControls" | "putTurnControls"> | null;
  getSession: (connectionId: string) => RpcClient | undefined;
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
    if (pending !== undefined) {
      return pending;
    }
    const session = getSession(connectionId);
    const cachedValue =
      cached?.value === null || cached?.value === undefined
        ? null
        : cloneTurnControls(cached.value);
    const cacheFresh = isTurnControlsCacheFresh(cached, Date.now(), TURN_CONTROLS_FRESH_MS);
    if (cacheFresh && cachedValue !== null) {
      return cachedValue;
    }
    if (session === undefined) {
      if (cachedValue !== null) {
        return cachedValue;
      }
      throw new Error("Connection is not enabled");
    }
    const operation = (async (): Promise<TurnControlsValue> => {
      try {
        resources?.putTurnControls({
          connectionId,
          cwd,
          error: null,
          id: cacheKey,
          status: cachedValue === null ? "loading" : "refreshing",
          value: cachedValue,
        });
        const result = await loadTurnControlsIncrementally(
          cachedValue ?? EMPTY_TURN_CONTROLS,
          {
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
                effort: response.config.model_reasoning_effort,
                model: response.config.model,
                permissions: configuredPermissions,
              };
            },
            models: async () => {
              const response = await rpcAfterAttach<ModelListResponse>(session, "model/list", {
                cursor: null,
                includeHidden: false,
                limit: 100,
              });
              return response.data.map((model) => ({
                defaultEffort: model.defaultReasoningEffort,
                efforts: model.supportedReasoningEfforts.map((option) => option.reasoningEffort),
                id: model.model,
                isDefault: model.isDefault,
                label: model.displayName,
                supportsPersonality: model.supportsPersonality,
              }));
            },
            permissions: async () => {
              const response = await rpcAfterAttach<PermissionProfileListResponse>(
                session,
                "permissionProfile/list",
                { cursor: null, cwd, limit: 100 },
              );
              return response.data;
            },
            skills: async () =>
              loadSkillCatalog({
                installedPlugins: async () =>
                  rpcAfterAttach<unknown>(session, "plugin/installed", { cwds: [cwd] }),
                plugin: async ({ marketplacePath, pluginName, remoteMarketplaceName }) =>
                  rpcAfterAttach<unknown>(session, "plugin/read", {
                    marketplacePath,
                    pluginName,
                    remoteMarketplaceName,
                  }),
                skills: async () =>
                  rpcAfterAttach<unknown>(session, "skills/list", {
                    cwds: [cwd],
                    forceReload: false,
                  }),
              }),
          },
          (value) =>
            resources?.putTurnControls({
              connectionId,
              cwd,
              error: null,
              id: cacheKey,
              status: "refreshing",
              value,
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
          connectionId,
          cwd,
          error: partialError,
          id: cacheKey,
          status: "ready",
          value: result.value,
        });
        return result.value;
      } catch (error) {
        resources?.putTurnControls({
          connectionId,
          cwd,
          error: error instanceof Error ? error.message : "Could not load turn controls",
          id: cacheKey,
          status: "error",
          value: cachedValue,
        });
        throw error;
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
    return operation;
  };

  return loadTurnControls;
}
