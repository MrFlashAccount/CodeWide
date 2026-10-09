/**
 * Permission profiles → Agent SDK query options.
 *
 * Profile security rests on `settingSources`, `strictMcpConfig` and the MCP
 * server set, not on `tools` alone (experiment P1: with only `tools`, MCP
 * tools still wrote files). `:read-only` therefore loads no settings, no MCP
 * server and only read tools, and `canUseTool` denies everything else.
 * Only an explicit full-access profile enables `bypassPermissions`.
 */

import type { PermissionProfileEntry } from "../protocol.js";
import { READ_ONLY_TOOLS } from "../mapping/tools.js";

export type ProfileId = ":read-only" | ":workspace" | ":full-access" | ":danger-full-access";

export type SettingSource = "user" | "project" | "local";
export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions";

/** The permission-related query options a profile fixes. */
export type ProfileOptions =
  | {
      readonly profile: ":read-only";
      readonly permissionMode: "default";
      readonly settingSources: readonly [];
      readonly strictMcpConfig: true;
      readonly mcpServers: Readonly<Record<string, never>>;
      readonly tools: readonly string[];
      readonly allowDangerouslySkipPermissions: false;
    }
  | {
      readonly profile: ":workspace";
      readonly permissionMode: "acceptEdits";
      readonly settingSources: readonly SettingSource[];
      readonly strictMcpConfig: false;
      readonly mcpServers: null;
      readonly tools: null;
      readonly allowDangerouslySkipPermissions: false;
    }
  | {
      readonly profile: ":full-access" | ":danger-full-access";
      readonly permissionMode: "bypassPermissions";
      readonly settingSources: readonly SettingSource[];
      readonly strictMcpConfig: false;
      readonly mcpServers: null;
      readonly tools: null;
      readonly allowDangerouslySkipPermissions: true;
    };

const ALL_SOURCES: readonly SettingSource[] = ["user", "project", "local"];

export const unsupportedProfileMessage = (id: string): string => `Unsupported permission profile for Claude: ${id}`;

export function isProfileId(value: string): value is ProfileId {
  return value === ":read-only" || value === ":workspace" || value === ":full-access" || value === ":danger-full-access";
}

export function profileOptions(profile: ProfileId): ProfileOptions {
  switch (profile) {
    case ":read-only":
      return {
        profile,
        permissionMode: "default",
        settingSources: [],
        strictMcpConfig: true,
        mcpServers: {},
        tools: READ_ONLY_TOOLS,
        allowDangerouslySkipPermissions: false,
      };
    case ":workspace":
      return {
        profile,
        permissionMode: "acceptEdits",
        settingSources: ALL_SOURCES,
        strictMcpConfig: false,
        mcpServers: null,
        tools: null,
        allowDangerouslySkipPermissions: false,
      };
    case ":full-access":
    case ":danger-full-access":
      return {
        profile,
        permissionMode: "bypassPermissions",
        settingSources: ALL_SOURCES,
        strictMcpConfig: false,
        mcpServers: null,
        tools: null,
        allowDangerouslySkipPermissions: true,
      };
  }
}

/** Whether `canUseTool` may ask the user about this tool under the profile. */
export function profileAllowsTool(options: ProfileOptions, toolName: string): boolean {
  return options.profile !== ":read-only" || READ_ONLY_TOOLS.includes(toolName);
}

export const PERMISSION_PROFILES: readonly PermissionProfileEntry[] = [
  { id: ":read-only", displayName: "Read only", description: "Reads files. Every other tool is refused." },
  {
    id: ":workspace",
    displayName: "Workspace",
    description: "Edits files in the workspace. Other actions ask for approval unless your Claude settings allow them.",
  },
  { id: ":full-access", displayName: "Full access", description: "Runs every tool without asking." },
];
