import { createCollection, localOnlyCollectionOptions } from "@tanstack/db";
import { act, render, waitFor } from "@testing-library/react-native";
import { HeroUINativeProviderRaw } from "heroui-native/provider-raw";
import { Pressable, Text } from "react-native";

import type { AccountRateLimitsRow } from "../src/data/account-rate-limits";
import type { VoiceInputRow } from "../src/data/workspace-resource-database";
import { WorkspaceVoiceAura } from "../src/ui/WorkspaceVoiceAura";
import { VoiceAura } from "../src/ui/VoiceAura.native";
import { WorkspaceAccountUsagePopover } from "../src/ui/WorkspaceAccountUsagePopover";
import { UsagePopover } from "../src/ui/UsagePopover";
import { useScopedVoiceInputResource } from "../src/ui/VoiceInputRuntime";

function voiceRow(scope: string, phase: VoiceInputRow["phase"]): VoiceInputRow {
  return { id: scope, scope, phase, backend: "remote", level: 0, seconds: 0,
    error: null, retryAvailable: false, pendingSelection: null, updatedAt: 0 };
}

it("updates recording aura without rerendering its workspace children", async () => {
  const voiceInputs = createCollection(localOnlyCollectionOptions<VoiceInputRow, string>({ getKey: row => row.id }));
  const resources = { voiceInputs };
  const workspaceRender = jest.fn();
  function Workspace() { workspaceRender(); return <Text>Workspace</Text>; }
  const view = render(<WorkspaceVoiceAura resources={resources} controller={null}><Workspace /></WorkspaceVoiceAura>);
  const baseline = workspaceRender.mock.calls.length;
  await act(async () => { voiceInputs.insert(voiceRow("server\u0000other-thread", "recording")); });
  await waitFor(() => expect(view.UNSAFE_getByType(VoiceAura).props.phase).toBe("recording"));
  await act(async () => { voiceInputs.update("server\u0000other-thread", row => { row.phase = "idle"; }); });
  await waitFor(() => expect(view.UNSAFE_getByType(VoiceAura).props.phase).toBe("idle"));
  await act(async () => { voiceInputs.insert(voiceRow("review:other-thread:file:line", "recording")); });
  await waitFor(() => {
    expect(view.UNSAFE_getByType(VoiceAura).props.phase).toBe("recording");
    expect(view.UNSAFE_getByType(VoiceAura).props.scope).toBe("review:other-thread:file:line");
  });
  await act(async () => { voiceInputs.update("review:other-thread:file:line", row => { row.phase = "finishing"; }); });
  await waitFor(() => expect(view.UNSAFE_getByType(VoiceAura).props.phase).toBe("idle"));
  expect(workspaceRender).toHaveBeenCalledTimes(baseline);
  view.unmount();
  await voiceInputs.cleanup();
});

it("reads the current voice scope immediately and ignores other chats", async () => {
  const voiceInputs = createCollection(localOnlyCollectionOptions<VoiceInputRow, string>({ getKey: row => row.id }));
  voiceInputs.insert(voiceRow("first", "recording"));
  voiceInputs.insert(voiceRow("second", "finishing"));
  const resources = { voiceInputs };
  const renderScope = jest.fn();
  function Composer({ scope }: { scope: string | null }) {
    const value = useScopedVoiceInputResource(resources, scope);
    renderScope();
    return <Text>{value?.phase ?? "absent"}</Text>;
  }
  const view = render(<Composer scope="first" />);
  expect(view.getByText("recording")).toBeTruthy();
  const baseline = renderScope.mock.calls.length;
  await act(async () => { voiceInputs.update("second", row => { row.seconds = 5; }); });
  expect(renderScope).toHaveBeenCalledTimes(baseline);
  view.rerender(<Composer scope="second" />);
  expect(view.getByText("finishing")).toBeTruthy();
  await act(async () => { voiceInputs.update("first", row => { row.phase = "idle"; }); });
  expect(view.getByText("finishing")).toBeTruthy();
  await act(async () => { voiceInputs.update("second", row => { row.phase = "idle"; }); });
  expect(view.getByText("idle")).toBeTruthy();
  view.rerender(<Composer scope={null} />);
  expect(view.getByText("absent")).toBeTruthy();
  view.unmount();
  await voiceInputs.cleanup();
});

it("updates account menus without rerendering their workspace owner", async () => {
  const collection = createCollection(localOnlyCollectionOptions<AccountRateLimitsRow, string>({ getKey: row => row.id }));
  const database = { collection };
  const workspaceRender = jest.fn();
  function Workspace() {
    workspaceRender();
    return <WorkspaceAccountUsagePopover database={database} servers={[{ id: "server", name: "Server" }]}>
      <Pressable><Text>Menu</Text></Pressable>
    </WorkspaceAccountUsagePopover>;
  }
  const view = render(<HeroUINativeProviderRaw config={{ animation: "disable-all", devInfo: { stylingPrinciples: false } }}>
    <Workspace />
  </HeroUINativeProviderRaw>);
  const baseline = workspaceRender.mock.calls.length;
  await act(async () => { collection.insert({ id: "server", connectionId: "server", status: "ready",
    snapshot: null, accountPool: null, error: null, updatedAt: 0 }); });
  await waitFor(() => expect(view.UNSAFE_getByType(UsagePopover).props.accountSources[0].rateLimits?.status).toBe("ready"));
  await act(async () => { collection.update("server", row => { row.status = "loading"; }); });
  await waitFor(() => expect(view.UNSAFE_getByType(UsagePopover).props.accountSources[0].rateLimits?.status).toBe("loading"));
  expect(workspaceRender).toHaveBeenCalledTimes(baseline);
  view.unmount();
  await collection.cleanup();
});
