import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { useState } from "react";

import type { V2QueryResult } from "@codewide/sync-client/v2";

import { useEvent } from "../src/react/useEvent";
import {
  defaultNewThreadSettings,
  newThreadContextItems,
  type NewThreadSettingsSelection,
} from "../src/v2/features/threadList/newThreadControls";
import {
  effectiveNewThreadSettings,
  nextModelSelection,
} from "../src/v2/features/threadList/newThreadModelControls";
import { nextPermissionSelection } from "../src/v2/features/threadList/newThreadPermissionControls";
import { ComposerContextStripView } from "../src/v2/presentation/input/ComposerContextStripView";

const allEfforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
const models: Extract<V2QueryResult, { kind: "models.list" }>["models"] = [
  {
    defaultEffort: "medium",
    efforts: [...allEfforts],
    id: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    supportsPersonality: true,
  },
];

interface SettingsHarnessProps {
  onChange(selection: NewThreadSettingsSelection): void;
}

function SettingsHarness(props: SettingsHarnessProps): React.JSX.Element {
  const [selection, setSelection] = useState(() =>
    effectiveNewThreadSettings(models, defaultNewThreadSettings()),
  );
  const selectModel = useEvent((id: string): void => {
    const next = nextModelSelection(id, models, selection);
    if (next === null) return;
    setSelection(next);
    props.onChange(next);
  });
  const selectPermissions = useEvent((id: string): void => {
    const next = nextPermissionSelection(id, selection);
    if (next === null) return;
    setSelection(next);
    props.onChange(next);
  });
  return (
    <ComposerContextStripView
      items={newThreadContextItems({
        error: null,
        loading: false,
        models,
        onSelectModel: selectModel,
        onSelectPermissions: selectPermissions,
        selection,
      })}
      onOpen={ignoreOpen}
    />
  );
}

describe("V2 New Thread settings controls", () => {
  it("renders every server-advertised effort and selects Ultra", () => {
    const onChange = jest.fn();
    render(<SettingsHarness onChange={onChange} />);

    fireEvent.press(screen.getByLabelText("Model and thinking: GPT-5.6 Sol, medium"));
    for (const label of [
      "None",
      "Minimal",
      "Low",
      "Medium",
      "High",
      "Extra high",
      "Max",
      "Ultra",
    ]) {
      expect(
        screen.getAllByLabelText(`Model and thinking: GPT-5.6 Sol, medium: ${label}`).length,
      ).toBeGreaterThan(0);
    }
    fireEvent.press(screen.getByLabelText("Model and thinking: GPT-5.6 Sol, medium: Ultra"));

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ effort: "ultra" }));
  });

  it("opens the complete granular editor and preserves each boolean", () => {
    const onChange = jest.fn();
    render(<SettingsHarness onChange={onChange} />);

    fireEvent.press(screen.getByLabelText("Permissions: Workspace · Ask"));
    fireEvent.press(screen.getByLabelText("Permissions: Workspace · Ask: Custom approval flows"));
    for (const label of [
      "Sandbox escalation prompts",
      "Exec policy rule prompts",
      "Skill script prompts",
      "Permission tool prompts",
      "MCP elicitation prompts",
    ]) {
      expect(
        screen.getByLabelText(`Permissions: Workspace · Custom approvals 5/5: ${label}`),
      ).toBeTruthy();
    }
    fireEvent.press(
      screen.getByLabelText(
        "Permissions: Workspace · Custom approvals 5/5: Permission tool prompts",
      ),
    );

    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        approvalPolicy: {
          granular: {
            mcpElicitations: true,
            requestPermissions: false,
            rules: true,
            sandboxApproval: true,
            skillApproval: true,
          },
        },
      }),
    );
    fireEvent.press(
      screen.getByLabelText("Permissions: Workspace · Custom approvals 4/5: External sandbox"),
    );
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sandbox: { networkAccess: "restricted", type: "externalSandbox" },
      }),
    );
  });
});

function ignoreOpen(): void {}
