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
import { unreachable } from "../support/unreachable.js";

export type ProfileId = ":read-only" | ":workspace" | ":full-access" | ":danger-full-access";

export type SettingSource = "user" | "project" | "local";
export type PermissionMode = "default" | "acceptEdits" | "bypassPermissions";

/** The permission-related query options a profile fixes. */
export type ProfileOptions =
  | {
      readonly allowDangerouslySkipPermissions: false;
      readonly mcpServers: Readonly<Record<string, never>>;
      readonly permissionMode: "default";
      readonly profile: ":read-only";
      readonly settingSources: readonly [];
      readonly strictMcpConfig: true;
      readonly tools: readonly string[];
    }
  | {
      readonly allowDangerouslySkipPermissions: false;
      readonly mcpServers: null;
      readonly permissionMode: "acceptEdits";
      readonly profile: ":workspace";
      readonly settingSources: readonly SettingSource[];
      readonly strictMcpConfig: false;
      readonly tools: null;
    }
  | {
      readonly allowDangerouslySkipPermissions: true;
      readonly mcpServers: null;
      readonly permissionMode: "bypassPermissions";
      readonly profile: ":full-access" | ":danger-full-access";
      readonly settingSources: readonly SettingSource[];
      readonly strictMcpConfig: false;
      readonly tools: null;
    };

const ALL_SOURCES: readonly SettingSource[] = ["user", "project", "local"];

export const unsupportedProfileMessage = (id: string): string =>
  `Unsupported permission profile for Claude: ${id}`;

export function isProfileId(value: string): value is ProfileId {
  return (
    value === ":read-only" ||
    value === ":workspace" ||
    value === ":full-access" ||
    value === ":danger-full-access"
  );
}

export function profileOptions(profile: ProfileId): ProfileOptions {
  switch (profile) {
    case ":read-only":
      return {
        allowDangerouslySkipPermissions: false,
        mcpServers: {},
        permissionMode: "default",
        profile,
        settingSources: [],
        strictMcpConfig: true,
        tools: READ_ONLY_TOOLS,
      };
    case ":workspace":
      return {
        allowDangerouslySkipPermissions: false,
        mcpServers: null,
        permissionMode: "acceptEdits",
        profile,
        settingSources: ALL_SOURCES,
        strictMcpConfig: false,
        tools: null,
      };
    case ":full-access":
    case ":danger-full-access":
      return {
        allowDangerouslySkipPermissions: true,
        mcpServers: null,
        permissionMode: "bypassPermissions",
        profile,
        settingSources: ALL_SOURCES,
        strictMcpConfig: false,
        tools: null,
      };
    default:
      return unreachable(profile);
  }
}

/**
 * Whether a live query can move from one profile to the other with
 * `setPermissionMode` alone. Both must load the same settings, MCP servers
 * and tools, so `:read-only` (its own tool set, no settings, no MCP) changes
 * only when the query reopens at a turn boundary.
 */
export function switchesLive(from: ProfileOptions, to: ProfileOptions): boolean {
  return from.profile !== ":read-only" && to.profile !== ":read-only";
}

/** Whether `canUseTool` may ask the user about this tool under the profile. */
export function profileAllowsTool(options: ProfileOptions, toolName: string): boolean {
  return options.profile !== ":read-only" || READ_ONLY_TOOLS.includes(toolName);
}

export const PERMISSION_PROFILES: readonly PermissionProfileEntry[] = [
  {
    description: "Reads files. Every other tool is refused.",
    displayName: "Read only",
    id: ":read-only",
  },
  {
    description:
      "Edits files in the workspace. Other actions ask for approval unless your Claude settings allow them.",
    displayName: "Workspace",
    id: ":workspace",
  },
  {
    description: "Runs every tool without asking.",
    displayName: "Full access",
    id: ":full-access",
  },
];
