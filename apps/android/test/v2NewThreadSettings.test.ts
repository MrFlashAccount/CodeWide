import { describe, expect, it } from "vitest";

import type { V2QueryResult } from "@codewide/sync-client/v2";

import { defaultNewThreadSettings } from "../src/v2/features/threadList/newThreadControls";
import {
  newThreadModelActions,
  nextModelSelection,
} from "../src/v2/features/threadList/newThreadModelControls";
import {
  accessLabel,
  nextPermissionSelection,
  permissionMenuActions,
} from "../src/v2/features/threadList/newThreadPermissionControls";

const efforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
const models: Extract<V2QueryResult, { kind: "models.list" }>["models"] = [
  {
    defaultEffort: "medium",
    efforts: [...efforts],
    id: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    supportsPersonality: true,
  },
];

describe("V2 New Thread settings", () => {
  it("accepts and presents every effort allowed by the V2 contract", () => {
    let selection = nextModelSelection("model:gpt-5.6-sol", models, defaultNewThreadSettings());
    expect(selection).not.toBeNull();

    for (const effort of efforts) {
      if (selection === null) throw new Error("Model selection was rejected");
      selection = nextModelSelection(`effort:${effort}`, models, selection);
      expect(selection?.effort).toBe(effort);
    }

    const actions = newThreadModelActions(
      models,
      selection ?? defaultNewThreadSettings(),
      false,
      null,
    );
    expect(actions.filter((action) => action.section === "Thinking level")).toHaveLength(
      efforts.length,
    );
    expect(actions.find((action) => action.id === "effort:ultra")?.label).toBe("Ultra");
  });

  it("edits the complete granular approval object without losing simple presets", () => {
    const initial = defaultNewThreadSettings();
    const granular = nextPermissionSelection("approval:granular", initial);
    expect(granular?.approvalPolicy).toStrictEqual({
      granular: {
        mcpElicitations: true,
        requestPermissions: true,
        rules: true,
        sandboxApproval: true,
        skillApproval: true,
      },
    });
    if (granular === null) throw new Error("Granular approval was rejected");

    const granularKeys = [
      "sandboxApproval",
      "rules",
      "skillApproval",
      "requestPermissions",
      "mcpElicitations",
    ] as const;
    for (const key of granularKeys) {
      const toggled = nextPermissionSelection(`approval:granular:${key}`, granular);
      expect(toggled?.approvalPolicy).toMatchObject({ granular: { [key]: false } });
    }

    const changed = nextPermissionSelection("approval:granular:requestPermissions", granular);
    expect(changed?.approvalPolicy).toStrictEqual({
      granular: {
        mcpElicitations: true,
        requestPermissions: false,
        rules: true,
        sandboxApproval: true,
        skillApproval: true,
      },
    });
    if (changed === null) throw new Error("Granular approval edit was rejected");

    const actions = permissionMenuActions(changed);
    expect(actions.find((action) => action.id === "approval:untrusted")?.label).toBe(
      "Ask unless trusted",
    );
    expect(
      actions.find((action) => action.id === "approval:granular:requestPermissions")?.selected,
    ).toBe(false);
    expect(accessLabel(changed)).toBe("Workspace · Custom approvals 4/5");
    expect(nextPermissionSelection("approval:granular", changed)).toBe(changed);
    expect(nextPermissionSelection("approval:never", changed)?.approvalPolicy).toBe("never");
  });

  it("represents the contract-owned external sandbox without coercion", () => {
    const external = nextPermissionSelection(
      "sandbox:external:restricted",
      defaultNewThreadSettings(),
    );
    expect(external?.sandbox).toStrictEqual({
      networkAccess: "restricted",
      type: "externalSandbox",
    });
    if (external === null) throw new Error("External sandbox was rejected");
    expect(accessLabel(external)).toBe("External sandbox · Ask");

    const networked = nextPermissionSelection("sandbox:external:enabled", external);
    expect(networked?.sandbox).toStrictEqual({
      networkAccess: "enabled",
      type: "externalSandbox",
    });
    expect(accessLabel(networked ?? external)).toBe("External sandbox + network · Ask");
  });
});
