import type {
  PersistedNewThreadDraft,
  PersistedNewThreadWorkspaceMode,
} from "../../application/ports/composerDraftStore";

/** Parses the New Thread-only portion of a durable composer record. */
export function parsePersistedNewThreadDraft(
  value: unknown,
): PersistedNewThreadDraft | null | undefined {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return undefined;
  const settings = parseThreadSettings(value.settings);
  const workspace = value.workspace;
  const workspaceMode = parseWorkspaceMode(value.workspaceMode);
  if (
    settings === null ||
    (workspace !== null && typeof workspace !== "string") ||
    workspaceMode === null
  ) {
    return undefined;
  }
  return { settings, workspace, workspaceMode };
}

function parseWorkspaceMode(value: unknown): PersistedNewThreadWorkspaceMode | null {
  if (!isRecord(value)) return null;
  if (value.kind === "current") return { kind: "current" };
  if (value.kind !== "isolated" || !isRecord(value.support)) return null;
  const support = value.support;
  if (
    typeof support.canCreate !== "boolean" ||
    typeof support.provider !== "string" ||
    support.provider.length === 0 ||
    support.provider.length > 256 ||
    typeof support.repositoryRoot !== "string"
  ) {
    return null;
  }
  return {
    kind: "isolated",
    support: {
      canCreate: support.canCreate,
      provider: support.provider,
      repositoryRoot: support.repositoryRoot,
    },
  };
}

function parseThreadSettings(value: unknown): PersistedNewThreadDraft["settings"] | null {
  if (!isRecord(value)) return null;
  const model = value.model;
  const effort = value.effort;
  const personality = value.personality;
  const approvalPolicy = parseApprovalPolicy(value.approvalPolicy);
  const sandbox = parseSandbox(value.sandbox);
  if (
    (model !== null && typeof model !== "string") ||
    !isEffort(effort) ||
    !isPersonality(personality) ||
    approvalPolicy === null ||
    sandbox === null
  ) {
    return null;
  }
  return { approvalPolicy, effort, model, personality, sandbox };
}

function parseApprovalPolicy(
  value: unknown,
): PersistedNewThreadDraft["settings"]["approvalPolicy"] | null {
  if (value === "never" || value === "onRequest" || value === "untrusted") return value;
  if (!isRecord(value) || !isRecord(value.granular)) return null;
  const granular = value.granular;
  if (
    typeof granular.mcpElicitations !== "boolean" ||
    typeof granular.requestPermissions !== "boolean" ||
    typeof granular.rules !== "boolean" ||
    typeof granular.sandboxApproval !== "boolean" ||
    typeof granular.skillApproval !== "boolean"
  ) {
    return null;
  }
  return {
    granular: {
      mcpElicitations: granular.mcpElicitations,
      requestPermissions: granular.requestPermissions,
      rules: granular.rules,
      sandboxApproval: granular.sandboxApproval,
      skillApproval: granular.skillApproval,
    },
  };
}

function parseSandbox(value: unknown): PersistedNewThreadDraft["settings"]["sandbox"] | null {
  if (value === "readOnly" || value === "workspaceWrite" || value === "unrestricted") return value;
  if (
    !isRecord(value) ||
    value.type !== "externalSandbox" ||
    (value.networkAccess !== "restricted" && value.networkAccess !== "enabled")
  ) {
    return null;
  }
  return { networkAccess: value.networkAccess, type: "externalSandbox" };
}

function isEffort(value: unknown): value is PersistedNewThreadDraft["settings"]["effort"] {
  return (
    value === null ||
    value === "none" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max" ||
    value === "ultra"
  );
}

function isPersonality(
  value: unknown,
): value is PersistedNewThreadDraft["settings"]["personality"] {
  return value === null || value === "none" || value === "friendly" || value === "pragmatic";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
