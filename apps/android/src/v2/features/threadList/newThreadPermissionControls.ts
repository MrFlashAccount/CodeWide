import type { V2ThreadSettings } from "@codewide/sync-client/v2";

import type { ActionMenuItem } from "../../ui/ActionMenu";
import type { NewThreadSettingsSelection } from "./newThreadControls";
import {
  allowedApprovalCount,
  changedGranularApproval,
  defaultGranularApproval,
  GRANULAR_CONTROLS,
  granularApprovalKey,
} from "./newThreadGranularApproval";

export function nextPermissionSelection(
  id: string,
  selection: NewThreadSettingsSelection,
): NewThreadSettingsSelection | null {
  if (id === "sandbox:readOnly") return changedSandbox(selection, "readOnly");
  if (id === "sandbox:workspaceWrite") return changedSandbox(selection, "workspaceWrite");
  if (id === "sandbox:unrestricted") return changedSandbox(selection, "unrestricted");
  if (id === "sandbox:external:restricted") {
    return changedSandbox(selection, { networkAccess: "restricted", type: "externalSandbox" });
  }
  if (id === "sandbox:external:enabled") {
    return changedSandbox(selection, { networkAccess: "enabled", type: "externalSandbox" });
  }
  if (id === "approval:never") return changedApproval(selection, "never");
  if (id === "approval:onRequest") return changedApproval(selection, "onRequest");
  if (id === "approval:untrusted") return changedApproval(selection, "untrusted");
  if (id === "approval:granular") {
    if (typeof selection.approvalPolicy === "object") return selection;
    return changedApproval(selection, {
      granular: defaultGranularApproval(),
    });
  }
  const granularKey = granularApprovalKey(id);
  if (granularKey === null || typeof selection.approvalPolicy !== "object") return null;
  const current = selection.approvalPolicy.granular;
  return changedApproval(selection, {
    granular: changedGranularApproval(current, granularKey),
  });
}

export function permissionMenuActions(
  selection: NewThreadSettingsSelection,
  disabled = false,
): ActionMenuItem[] {
  const granular =
    typeof selection.approvalPolicy === "object" ? selection.approvalPolicy.granular : null;
  const actions: ActionMenuItem[] = [
    {
      disabled,
      id: "sandbox:readOnly",
      label: "Read only",
      section: "Security permissions",
      selected: selection.sandbox === "readOnly",
    },
    {
      disabled,
      id: "sandbox:workspaceWrite",
      label: "Workspace",
      section: "Security permissions",
      selected: selection.sandbox === "workspaceWrite",
    },
    {
      disabled,
      id: "sandbox:unrestricted",
      label: "Full access",
      section: "Security permissions",
      selected: selection.sandbox === "unrestricted",
    },
    {
      description: "Permissions are enforced by the external sandbox; network stays restricted",
      disabled,
      id: "sandbox:external:restricted",
      label: "External sandbox",
      section: "Security permissions",
      selected:
        typeof selection.sandbox === "object" && selection.sandbox.networkAccess === "restricted",
    },
    {
      description: "Permissions are enforced by the external sandbox; network is enabled",
      disabled,
      id: "sandbox:external:enabled",
      label: "External sandbox + network",
      section: "Security permissions",
      selected:
        typeof selection.sandbox === "object" && selection.sandbox.networkAccess === "enabled",
    },
    {
      disabled,
      id: "approval:never",
      label: "Never ask",
      description: "Approval requests are rejected instead of shown",
      section: "Approval policy",
      selected: selection.approvalPolicy === "never",
    },
    {
      disabled,
      id: "approval:onRequest",
      label: "Ask when needed",
      description: "The model decides when an approval is needed",
      section: "Approval policy",
      selected: selection.approvalPolicy === "onRequest",
    },
    {
      disabled,
      id: "approval:untrusted",
      label: "Ask unless trusted",
      description: "Only known-safe read commands run without asking",
      section: "Approval policy",
      selected: selection.approvalPolicy === "untrusted",
    },
    {
      disabled,
      id: "approval:granular",
      keepOpen: true,
      label: "Custom approval flows",
      description: "Choose which prompt kinds are allowed; disabled kinds are rejected",
      section: "Approval policy",
      selected: granular !== null,
    },
  ];
  if (granular === null) return actions;
  for (const control of GRANULAR_CONTROLS) {
    actions.push({
      description: control.description,
      disabled,
      id: `approval:granular:${control.key}`,
      keepOpen: true,
      label: control.label,
      section: "Allowed approval prompts",
      selected: granular[control.key],
    });
  }
  return actions;
}

export function accessLabel(settings: V2ThreadSettings): string {
  const sandbox =
    typeof settings.sandbox === "object"
      ? settings.sandbox.networkAccess === "enabled"
        ? "External sandbox + network"
        : "External sandbox"
      : settings.sandbox === "unrestricted"
        ? "Full access"
        : settings.sandbox === "workspaceWrite"
          ? "Workspace"
          : "Read only";
  if (settings.approvalPolicy === "never") return sandbox;
  const approval =
    typeof settings.approvalPolicy === "object"
      ? `Custom approvals ${allowedApprovalCount(settings.approvalPolicy.granular)}/${GRANULAR_CONTROLS.length}`
      : settings.approvalPolicy === "onRequest"
        ? "Ask"
        : "Ask unless trusted";
  return `${sandbox} · ${approval}`;
}

function changedSandbox(
  selection: NewThreadSettingsSelection,
  sandbox: V2ThreadSettings["sandbox"],
): NewThreadSettingsSelection {
  return {
    approvalPolicy: selection.approvalPolicy,
    effort: selection.effort,
    model: selection.model,
    personality: selection.personality,
    sandbox,
  };
}

function changedApproval(
  selection: NewThreadSettingsSelection,
  approvalPolicy: V2ThreadSettings["approvalPolicy"],
): NewThreadSettingsSelection {
  return {
    approvalPolicy,
    effort: selection.effort,
    model: selection.model,
    personality: selection.personality,
    sandbox: selection.sandbox,
  };
}
