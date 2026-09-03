import { describe, expect, it, jest } from "@jest/globals";
import type {
  V2Command,
  V2GranularApprovalConfig,
  V2ThreadSettings,
} from "@codewide/sync-client/v2";
import { fireEvent, render, screen } from "@testing-library/react-native";

import { useEvent } from "../src/react/useEvent";
import { savedServerId, threadId } from "../src/v2/domain/ids";
import { qualifiedThread } from "../src/v2/domain/qualifiedThread";
import {
  conversationPermissionContextItem,
  nextConversationPermissionSettings,
  threadSettingsUpdateCommand,
} from "../src/v2/features/conversation/conversationPermissionContext";
import { ComposerContextStripView } from "../src/v2/presentation/input/ComposerContextStripView";

const OWNER = qualifiedThread(savedServerId("server-a"), threadId("thread-a"));

interface PermissionHarnessProps {
  onCommand(command: V2Command): void;
}

function PermissionHarness(props: PermissionHarnessProps): React.JSX.Element {
  const settings = externalGranularSettings();
  const select = useEvent((id: string): void => {
    const next = nextConversationPermissionSettings(id, settings);
    if (next !== null) props.onCommand(threadSettingsUpdateCommand(OWNER, next));
  });
  return (
    <ComposerContextStripView
      items={[
        conversationPermissionContextItem({
          actionable: true,
          onSelect: select,
          pending: false,
          settings,
        }),
      ]}
      onOpen={ignoreOpen}
    />
  );
}

describe("V2 existing-thread permission controls", () => {
  it("renders and updates every granular approval kind through typed thread.update", () => {
    const onCommand = jest.fn();
    render(<PermissionHarness onCommand={onCommand} />);

    fireEvent.press(screen.getByLabelText("Permissions: External sandbox · Custom approvals 5/5"));
    for (const label of [
      "Read only",
      "Workspace",
      "Full access",
      "External sandbox",
      "External sandbox + network",
      "Never ask",
      "Ask when needed",
      "Ask unless trusted",
      "Custom approval flows",
      "Sandbox escalation prompts",
      "Exec policy rule prompts",
      "Skill script prompts",
      "Permission tool prompts",
      "MCP elicitation prompts",
    ]) {
      expect(
        screen.getByLabelText(`Permissions: External sandbox · Custom approvals 5/5: ${label}`),
      ).toBeTruthy();
    }
    fireEvent.press(
      screen.getByLabelText(
        "Permissions: External sandbox · Custom approvals 5/5: Permission tool prompts",
      ),
    );

    expect(onCommand).toHaveBeenLastCalledWith({
      change: {
        kind: "settings",
        settings: {
          approvalPolicy: {
            granular: {
              mcpElicitations: true,
              requestPermissions: false,
              rules: true,
              sandboxApproval: true,
              skillApproval: true,
            },
          },
          effort: "high",
          model: "gpt-5.6-sol",
          personality: null,
          sandbox: { networkAccess: "restricted", type: "externalSandbox" },
        },
      },
      kind: "thread.update",
      threadId: OWNER.threadId,
    });
  });

  it("preserves externalSandbox while enabling its network access", () => {
    const onCommand = jest.fn();
    render(<PermissionHarness onCommand={onCommand} />);

    fireEvent.press(screen.getByLabelText("Permissions: External sandbox · Custom approvals 5/5"));
    fireEvent.press(
      screen.getByLabelText(
        "Permissions: External sandbox · Custom approvals 5/5: External sandbox + network",
      ),
    );

    expect(onCommand).toHaveBeenLastCalledWith({
      change: {
        kind: "settings",
        settings: {
          approvalPolicy: {
            granular: {
              mcpElicitations: true,
              requestPermissions: true,
              rules: true,
              sandboxApproval: true,
              skillApproval: true,
            },
          },
          effort: "high",
          model: "gpt-5.6-sol",
          personality: null,
          sandbox: { networkAccess: "enabled", type: "externalSandbox" },
        },
      },
      kind: "thread.update",
      threadId: OWNER.threadId,
    });
  });
});

interface ExternalGranularSettings extends V2ThreadSettings {
  approvalPolicy: { granular: V2GranularApprovalConfig };
}

function externalGranularSettings(): ExternalGranularSettings {
  return {
    approvalPolicy: {
      granular: {
        mcpElicitations: true,
        requestPermissions: true,
        rules: true,
        sandboxApproval: true,
        skillApproval: true,
      },
    },
    effort: "high",
    model: "gpt-5.6-sol",
    personality: null,
    sandbox: { networkAccess: "restricted", type: "externalSandbox" },
  };
}

function ignoreOpen(): void {}
