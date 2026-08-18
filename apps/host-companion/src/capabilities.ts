export const DEVICE_SCOPES = [
  "threads.read",
  "threads.write",
  "turns.start",
  "turns.steer",
  "approvals.respond",
  "files.download.workspace",
  "files.upload.workspace",
  "localhost.forward",
  "processes.manage",
  "tools.call",
  "shell.explicit",
] as const;

export type DeviceScope = typeof DEVICE_SCOPES[number];

export type AuthorizationContext =
  | { kind: "admin"; deviceId: null; scopes: readonly DeviceScope[] }
  | { kind: "device"; deviceId: string; scopes: readonly DeviceScope[] }
  | { kind: "session"; deviceId: string; scopes: readonly DeviceScope[]; expiresAt: number };

// A newly paired phone can use every V1 product surface, but it cannot open a
// raw App Server bridge, execute an arbitrary shell command, or invoke an MCP
// tool directly. Those privileged surfaces require an explicit admin grant.
export const DEFAULT_DEVICE_SCOPES: readonly DeviceScope[] = [
  "threads.read",
  "threads.write",
  "turns.start",
  "turns.steer",
  "approvals.respond",
  "files.download.workspace",
  "files.upload.workspace",
  "localhost.forward",
  "processes.manage",
];

const VALID_SCOPES = new Set<string>(DEVICE_SCOPES);

export function parseDeviceScopes(value: unknown): DeviceScope[] | null {
  if (!Array.isArray(value)) return null;
  const scopes: DeviceScope[] = [];
  for (const candidate of value) {
    if (typeof candidate !== "string" || !VALID_SCOPES.has(candidate)) return null;
    if (!scopes.includes(candidate as DeviceScope)) scopes.push(candidate as DeviceScope);
  }
  return scopes;
}

export function hasScope(context: AuthorizationContext, scope: DeviceScope): boolean {
  return context.kind === "admin" || context.scopes.includes(scope);
}

const READ_METHODS = new Set([
  "account/rateLimits/read",
  "thread/list",
  "thread/search",
  "thread/searchOccurrences",
  "thread/loaded/list",
  "thread/read",
  "thread/turns/list",
  "thread/items/list",
  "companion/threadResources/read",
  "companion/threadChange/read",
  "thread/goal/get",
  "threadSection/list",
  "skills/list",
  "hooks/list",
  "plugin/list",
  "plugin/search",
  "plugin/installed",
  "plugin/read",
  "plugin/skill/read",
  "app/read",
  "app/list",
  "app/installed",
  "model/list",
  "modelProvider/capabilities/read",
  "permissionProfile/list",
  "collaborationMode/list",
  "mcpServerStatus/list",
  "mcpServer/resource/read",
  "thread/backgroundTerminals/list",
]);

const THREAD_WRITE_METHODS = new Set([
  "thread/start",
  "thread/resume",
  "thread/fork",
  "thread/archive",
  "thread/delete",
  "thread/unsubscribe",
  "thread/name/set",
  "thread/goal/set",
  "thread/goal/clear",
  "thread/metadata/update",
  "thread/section/move",
  "thread/settings/update",
  "thread/memoryMode/set",
  "thread/unarchive",
  "thread/compact/start",
  "thread/rollback",
  "threadSection/create",
  "threadSection/update",
  "threadSection/delete",
]);

export function requiredScopeForRpc(method: string): DeviceScope | null {
  if (method === "companion/threadResources/read" || method === "companion/threadChange/read") return "threads.read";
  if (method.startsWith("companion/queue/")) return "turns.start";
  if (method.startsWith("companion/dictation/")) return "turns.start";
  if (method.startsWith("thread/realtime/")) return "turns.start";
  if (READ_METHODS.has(method)) return "threads.read";
  if (THREAD_WRITE_METHODS.has(method)) return "threads.write";
  if (method === "turn/start" || method === "turn/interrupt" || method === "review/start") return "turns.start";
  if (method === "turn/steer") return "turns.steer";
  if (method === "thread/backgroundTerminals/clean" || method === "thread/backgroundTerminals/terminate") return "processes.manage";
  if (method === "mcpServer/tool/call") return "tools.call";
  if (method === "thread/shellCommand" || method.startsWith("command/exec")) return "shell.explicit";
  return null;
}
