import { render } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { LargeContentViewerContext } from "../src/features/conversation/content/contentViewerContext";
import { ActivityDetailSheet } from "../src/features/conversation/turns/ActivityDetailSheet";
import { TurnActivityMetricsContext } from "../src/features/conversation/turns/turnContexts";
import { colors, typeScale } from "../src/theme";

// WHY: Node cannot mount the native bottom-sheet window. Keep the real Activity header and list.
jest.mock("@expo/ui/community/bottom-sheet", () => {
  const { ScrollView, View } = jest.requireActual<typeof import("react-native")>("react-native");
  return {
    BottomSheet: ({ children }: { readonly children: ReactNode }) => <View>{children}</View>,
    BottomSheetScrollView: ScrollView,
    BottomSheetView: View,
  };
});
it("uses a readable stable Activity heading instead of the block summary", () => {
  const view = render(
    <ActivityDetailSheet
      blocks={[]}
      onClose={() => undefined}
      turnKey="turn-1"
      turnStatus="completed"
      visible
    />,
  );

  const heading = view.getByRole("header", { name: "Activity" });
  expect(heading).toHaveStyle({ color: colors.text, fontSize: typeScale.heading.fontSize });
  expect(view.queryByText("File, Run, Comments 18")).toBeNull();
});

it("keeps tool icon, server output tokens, tool name and failed status in the list row", () => {
  const footprint = {
    basis: "approxBytesPerToken" as const,
    bytes: 548,
    estimatedInputCostUsd: null,
    estimatedTokens: 137,
    version: 1 as const,
  };
  const view = render(
    <TurnActivityMetricsContext.Provider
      value={{
        commands: { command: footprint },
        ranges: [],
        total: { count: 1, kinds: ["commandExecution"], outputFootprint: footprint },
        version: 1,
      }}
    >
      <ActivityDetailSheet
        blocks={[
          {
            body: "failed",
            collapsible: true,
            content: null,
            durationMs: 10,
            key: "command:command",
            kind: "commandExecution",
            raw: { command: "pnpm test", id: "command" },
            status: "failed",
            title: "pnpm test",
            tone: "danger",
          },
        ]}
        onClose={() => undefined}
        turnKey="turn-1"
        turnStatus="failed"
        visible
      />
    </TurnActivityMetricsContext.Provider>,
  );

  expect(view.getByText("terminal-outline")).toBeOnTheScreen();
  expect(view.getByText("≈⟡137 · commandExecution")).toBeOnTheScreen();
  expect(view.getByText("alert-circle")).toBeOnTheScreen();
  expect(view.queryByRole("button", { name: "Open pnpm test, failed" })).toBeNull();
});

it("exposes an unknown protocol output as a direct semantic action", () => {
  const view = render(
    <LargeContentViewerContext.Provider value={jest.fn()}>
      <ActivityDetailSheet
        blocks={[
          {
            body: "raw output",
            collapsible: true,
            content: null,
            durationMs: null,
            key: "unknown:item",
            kind: "unknown",
            raw: { id: "item", payload: { result: "raw output" }, type: "providerExtension" },
            status: "completed",
            title: "Provider extension",
            tone: "neutral",
          },
        ]}
        onClose={() => undefined}
        turnKey="turn-1"
        turnStatus="completed"
        visible
      />
    </LargeContentViewerContext.Provider>,
  );

  expect(view.getByRole("button", { name: "Open Provider extension output" })).toBeOnTheScreen();
});

it("exposes web search as an explicit detail-sheet action", () => {
  const view = render(
    <ActivityDetailSheet
      blocks={[
        {
          body: null,
          collapsible: false,
          content: null,
          durationMs: null,
          key: "search:item",
          kind: "webSearch",
          raw: {
            id: "item",
            query: "CodeWide",
            results: [
              { snippet: "Agent workspace", title: "CodeWide", url: "https://example.com" },
            ],
          },
          status: "completed",
          title: "Web search",
          tone: "neutral",
        },
      ]}
      onClose={() => undefined}
      turnKey="turn-1"
      turnStatus="completed"
      visible
    />,
  );

  expect(view.getByRole("button", { name: "Open Web search · CodeWide" })).toBeOnTheScreen();
});
