import type {
  V2ElicitationField,
  V2PendingRequest,
  V2PermissionProfile,
  V2RequestResolution,
} from "@codewide/sync-client/v2";

import type {
  ApprovalDecision,
  PendingRequestViewModel,
  PendingRequestViewResolution,
} from "../../presentation/requests/requestViewModel";

const PERMISSION_DECISIONS: readonly ApprovalDecision[] = ["decline", "accept", "acceptForSession"];
const DENIED_PERMISSIONS: V2PermissionProfile = {
  fileSystem: null,
  network: null,
};

export function pendingRequestViewModel(request: V2PendingRequest): PendingRequestViewModel {
  if (request.kind === "commandApproval") {
    return approvalViewModel(
      request,
      request.command ?? "Run a command",
      request.cwd === null ? null : `⌁ ${request.cwd}`,
    );
  }
  if (request.kind === "fileChangeApproval") {
    return approvalViewModel(
      request,
      "Review proposed file changes",
      request.grantRoot === null ? null : `⌁ ${request.grantRoot}`,
    );
  }
  if (request.kind === "permissionApproval") {
    return {
      approvalKind: request.kind,
      availableDecisions: PERMISSION_DECISIONS,
      detail: null,
      id: request.id,
      kind: "approval",
      reason: request.reason,
      summary: permissionSummary(request.permissions),
    };
  }
  if (request.kind === "userInput") {
    return { id: request.id, kind: request.kind, questions: request.questions };
  }
  return {
    fields: request.fields,
    id: request.id,
    kind: request.kind,
    message: request.message,
    mode: request.mode,
    serverName: request.serverName,
    title: request.serverName === "" ? "External tool request" : request.serverName,
    url: request.url,
  };
}

export function pendingRequestResolution(
  request: V2PendingRequest,
  resolution: PendingRequestViewResolution,
): V2RequestResolution {
  if (request.kind === "commandApproval") {
    if (resolution.kind !== "approval") throw new Error("Mismatched request resolution");
    return { decision: resolution.decision, kind: request.kind };
  }
  if (request.kind === "fileChangeApproval") {
    if (resolution.kind !== "approval" || typeof resolution.decision !== "string") {
      throw new Error("Mismatched request resolution");
    }
    return { decision: resolution.decision, kind: request.kind };
  }
  if (request.kind === "permissionApproval") {
    if (resolution.kind !== "approval" || typeof resolution.decision !== "string") {
      throw new Error("Mismatched request resolution");
    }
    const accepted = resolution.decision === "accept" || resolution.decision === "acceptForSession";
    return {
      kind: request.kind,
      permissions: accepted ? request.permissions : DENIED_PERMISSIONS,
      scope: resolution.decision === "acceptForSession" ? "session" : "turn",
      strictAutoReview: false,
    };
  }
  if (request.kind === "userInput") {
    if (resolution.kind !== request.kind) throw new Error("Mismatched request resolution");
    return resolution;
  }
  if (resolution.kind !== request.kind) throw new Error("Mismatched request resolution");
  return {
    action: resolution.action,
    contentJson:
      resolution.action === "accept"
        ? JSON.stringify(
            Object.fromEntries(
              resolution.values.map((entry) => [
                entry.fieldId,
                elicitationValue(request.fields, entry.fieldId, entry.value),
              ]),
            ),
          )
        : null,
    kind: request.kind,
    metadataJson: request.metadataJson,
  };
}

function approvalViewModel(
  request: Extract<V2PendingRequest, { kind: "commandApproval" | "fileChangeApproval" }>,
  summary: string,
  detail: string | null,
): PendingRequestViewModel {
  return {
    approvalKind: request.kind,
    availableDecisions: request.availableDecisions,
    detail,
    id: request.id,
    kind: "approval",
    reason: request.reason,
    summary,
  };
}

function elicitationValue(
  fields: readonly V2ElicitationField[],
  fieldId: string,
  raw: readonly string[] | string | null,
): boolean | null | number | readonly string[] | string {
  const field = fields.find((candidate) => candidate.id === fieldId);
  if (field === undefined) throw new Error("Unknown elicitation field");
  if (raw === null) return null;
  if (field.type === "array") {
    if (isStringArray(raw)) return raw;
    return raw
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== "");
  }
  if (isStringArray(raw)) throw new Error("Invalid elicitation field value");
  if (field.type === "boolean") return raw === "true";
  if (field.type === "number" || field.type === "integer") {
    const value = Number(raw);
    if (!Number.isFinite(value) || (field.type === "integer" && !Number.isInteger(value))) {
      throw new Error(`Invalid elicitation ${field.type}`);
    }
    return value;
  }
  return raw;
}

function isStringArray(value: readonly string[] | string): value is readonly string[] {
  return Array.isArray(value);
}

function permissionSummary(permissions: V2PermissionProfile): string {
  const parts: string[] = [];
  if (permissions.network?.enabled === true) parts.push("Network access");
  const read = permissions.fileSystem?.read;
  if (read !== null && read !== undefined && read.length > 0) {
    parts.push(`Read: ${read.join(", ")}`);
  }
  const write = permissions.fileSystem?.write;
  if (write !== null && write !== undefined && write.length > 0) {
    parts.push(`Write: ${write.join(", ")}`);
  }
  const entries = permissions.fileSystem?.entries ?? [];
  if (entries.length > 0) {
    parts.push(
      entries.map((entry) => `${entry.access}: ${fileSystemPermissionPath(entry.path)}`).join("\n"),
    );
  }
  return parts.length === 0 ? "Additional permissions requested" : parts.join("\n");
}

function fileSystemPermissionPath(
  path: NonNullable<V2PermissionProfile["fileSystem"]>["entries"][number]["path"],
): string {
  if (path.kind === "path") return path.path;
  if (path.kind === "globPattern") return path.pattern;
  if (path.value.kind === "unknown") return path.value.path;
  return path.value.kind;
}
