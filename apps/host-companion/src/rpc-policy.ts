type RpcObject = Record<string, unknown>;

export type RpcPolicyDecision =
  | { action: "allow"; frame: RpcObject }
  | { action: "reject"; response: RpcObject }
  | { action: "close"; code: number; reason: string };

const ALLOWED_METHODS = new Set([
  "initialize",
  "initialized",
  "thread/start",
  "thread/resume",
  "thread/fork",
  "thread/archive",
  "thread/delete",
  "thread/unsubscribe",
  "thread/name/set",
  "thread/goal/set",
  "thread/goal/get",
  "thread/goal/clear",
  "thread/metadata/update",
  "thread/section/move",
  "thread/settings/update",
  "thread/memoryMode/set",
  "thread/unarchive",
  "thread/compact/start",
  "account/rateLimits/read",
  "thread/rollback",
  "thread/list",
  "threadSection/list",
  "threadSection/create",
  "threadSection/update",
  "threadSection/delete",
  "thread/search",
  "thread/searchOccurrences",
  "thread/loaded/list",
  "thread/read",
  "thread/turns/list",
  "thread/items/list",
  "companion/threadResources/read",
  "companion/threadChange/read",
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
  "turn/start",
  "turn/steer",
  "turn/interrupt",
  "thread/realtime/start",
  "thread/realtime/appendAudio",
  "thread/realtime/stop",
  "review/start",
  "model/list",
  "modelProvider/capabilities/read",
  "permissionProfile/list",
  "collaborationMode/list",
  "mcpServerStatus/list",
  "mcpServer/resource/read",
  "mcpServer/tool/call",
  "thread/backgroundTerminals/list",
  "thread/backgroundTerminals/clean",
  "thread/backgroundTerminals/terminate",
  "thread/shellCommand",
  "command/exec",
  "command/exec/write",
  "command/exec/terminate",
  "command/exec/resize",
]);

export class RpcPolicySession {
  #state: "new" | "initializing" | "ready" = "new";

  evaluate(rawFrame: string): RpcPolicyDecision {
    let frame: RpcObject;
    try {
      const parsed = JSON.parse(rawFrame) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { action: "close", code: 1007, reason: "invalid_json_object" };
      }
      frame = parsed as RpcObject;
    } catch {
      return { action: "close", code: 1007, reason: "invalid_json" };
    }

    const method = frame.method;
    if (typeof method !== "string") {
      if (this.#state !== "ready" || !("id" in frame) || !("result" in frame || "error" in frame)) {
        return { action: "close", code: 1008, reason: "unexpected_rpc_response" };
      }
      return { action: "allow", frame };
    }

    if (this.#state === "new") {
      if (method !== "initialize" || !("id" in frame)) {
        return { action: "close", code: 1008, reason: "initialize_required" };
      }
      this.#state = "initializing";
      return { action: "allow", frame };
    }
    if (method === "initialize") {
      return this.#reject(frame, -32600, "initialize may only be sent once");
    }
    if (method === "initialized") {
      if (this.#state !== "initializing") {
        return { action: "close", code: 1008, reason: "unexpected_initialized" };
      }
      this.#state = "ready";
      return { action: "allow", frame };
    }
    if (this.#state !== "ready") {
      return this.#reject(frame, -32002, "initialized notification required");
    }
    if (!ALLOWED_METHODS.has(method)) {
      return this.#reject(frame, -32601, `Method is not exposed by CodeWide: ${method}`);
    }
    return { action: "allow", frame };
  }

  #reject(frame: RpcObject, code: number, message: string): RpcPolicyDecision {
    if (!("id" in frame)) {
      return { action: "close", code: 1008, reason: "denied_notification" };
    }
    return {
      action: "reject",
      response: { id: frame.id, error: { code, message } },
    };
  }
}

export const exposedRpcMethods = (): string[] => [...ALLOWED_METHODS].sort();

export const isExposedRpcMethod = (method: string): boolean => ALLOWED_METHODS.has(method);
