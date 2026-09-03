import type { V2GranularApprovalConfig } from "@codewide/sync-client/v2";

export type GranularApprovalKey = keyof V2GranularApprovalConfig;

interface GranularControl {
  description: string;
  key: GranularApprovalKey;
  label: string;
}

export const GRANULAR_CONTROLS: readonly GranularControl[] = [
  {
    description: "Allow shell and inline permission approval requests",
    key: "sandboxApproval",
    label: "Sandbox escalation prompts",
  },
  {
    description: "Allow prompts required by exec policy rules",
    key: "rules",
    label: "Exec policy rule prompts",
  },
  {
    description: "Allow approval prompts for skill script execution",
    key: "skillApproval",
    label: "Skill script prompts",
  },
  {
    description: "Allow prompts from the request_permissions tool",
    key: "requestPermissions",
    label: "Permission tool prompts",
  },
  {
    description: "Allow MCP servers to ask the user for input",
    key: "mcpElicitations",
    label: "MCP elicitation prompts",
  },
];

export function defaultGranularApproval(): V2GranularApprovalConfig {
  return {
    mcpElicitations: true,
    requestPermissions: true,
    rules: true,
    sandboxApproval: true,
    skillApproval: true,
  };
}

export function granularApprovalKey(id: string): GranularApprovalKey | null {
  if (id === "approval:granular:sandboxApproval") return "sandboxApproval";
  if (id === "approval:granular:rules") return "rules";
  if (id === "approval:granular:skillApproval") return "skillApproval";
  if (id === "approval:granular:requestPermissions") return "requestPermissions";
  if (id === "approval:granular:mcpElicitations") return "mcpElicitations";
  return null;
}

export function changedGranularApproval(
  current: V2GranularApprovalConfig,
  key: GranularApprovalKey,
): V2GranularApprovalConfig {
  return {
    mcpElicitations: key === "mcpElicitations" ? !current.mcpElicitations : current.mcpElicitations,
    requestPermissions:
      key === "requestPermissions" ? !current.requestPermissions : current.requestPermissions,
    rules: key === "rules" ? !current.rules : current.rules,
    sandboxApproval: key === "sandboxApproval" ? !current.sandboxApproval : current.sandboxApproval,
    skillApproval: key === "skillApproval" ? !current.skillApproval : current.skillApproval,
  };
}

export function allowedApprovalCount(config: V2GranularApprovalConfig): number {
  let count = 0;
  for (const control of GRANULAR_CONTROLS) {
    if (config[control.key]) count += 1;
  }
  return count;
}
