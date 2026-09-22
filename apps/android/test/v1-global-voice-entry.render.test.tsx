import { act, render } from "@testing-library/react-native";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { StyleSheet } from "react-native";

import { GlobalVoiceEntryAction } from "../src/features/threadList/GlobalVoiceEntryAction";
import { writeGlobalVoiceOrbStylePreference } from "../src/data/globalVoiceOrbStylePreference";

it("toggles Global Voice without creating an application route", () => {
  const composition = readFileSync(
    join(__dirname, "../src/routeComposition/WorkspaceRouteComposition.tsx"),
    "utf8",
  );
  const shell = readFileSync(join(__dirname, "../src/routeComposition/WorkspaceShell.tsx"), "utf8");

  expect(existsSync(join(__dirname, "../app/(workspace)/global-voice.tsx"))).toBe(false);
  expect(composition).not.toContain("/global-voice");
  expect(composition).not.toContain("reportGlobalError");
  expect(composition).toContain("useAppNotice");
  expect(shell).not.toContain('name="global-voice"');
});

it("hands the idle header orb off and removes the duplicate while the session is active", () => {
  const onToggle = jest.fn();
  const view = render(<GlobalVoiceEntryAction state="idle" orbState="idle" onToggle={onToggle} />);
  const visibleSlotWidth = StyleSheet.flatten(
    view.getByTestId("global-voice-slot").props.style,
  ).width;

  expect(view.getByTestId("global-voice-orb", { includeHiddenElements: true }).props.orbState).toBe(
    "disabled",
  );
  expect(visibleSlotWidth).toBeGreaterThan(0);
  expect(view.getByTestId("global-voice-orb-motion").props.entering).toBeDefined();
  view.rerender(
    <GlobalVoiceEntryAction state="starting" orbState="connecting" onToggle={onToggle} />,
  );
  expect(StyleSheet.flatten(view.getByTestId("global-voice-slot").props.style).width).toBe(0);
  expect(view.queryByTestId("global-voice-orb", { includeHiddenElements: true })).toBeNull();
  expect(view.getByTestId("global-voice-orb-anchor", { includeHiddenElements: true })).toBeTruthy();
  expect(view.queryByRole("button")).toBeNull();
  view.rerender(<GlobalVoiceEntryAction state="idle" orbState="idle" onToggle={onToggle} />);
  expect(StyleSheet.flatten(view.getByTestId("global-voice-slot").props.style).width).toBe(
    visibleSlotWidth,
  );
});

it.each(["starting", "active", "reconnecting", "stopping"] as const)(
  "keeps the header empty during %s so only the floating orb is visible",
  (state) => {
    const view = render(
      <GlobalVoiceEntryAction state={state} orbState="disabled" onToggle={jest.fn()} />,
    );
    expect(view.queryByTestId("global-voice-progress")).toBeNull();
    expect(view.queryByTestId("global-voice-orb", { includeHiddenElements: true })).toBeNull();
    expect(
      view.getByTestId("global-voice-orb-anchor", { includeHiddenElements: true }),
    ).toBeTruthy();
    expect(view.queryByRole("button")).toBeNull();
  },
);

it("returns the failed orb to its muted inactive appearance after three seconds", () => {
  jest.useFakeTimers();
  try {
    const view = render(
      <GlobalVoiceEntryAction state="idle" orbState="error" onToggle={jest.fn()} />,
    );
    expect(
      view.getByTestId("global-voice-orb", { includeHiddenElements: true }).props.orbState,
    ).toBe("error");

    act(() => {
      jest.advanceTimersByTime(2999);
    });
    expect(
      view.getByTestId("global-voice-orb", { includeHiddenElements: true }).props.orbState,
    ).toBe("error");

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(
      view.getByTestId("global-voice-orb", { includeHiddenElements: true }).props.orbState,
    ).toBe("disabled");
  } finally {
    jest.useRealTimers();
  }
});

it("places the assistant before search so its active placeholder stays next to the title", () => {
  for (const file of ["MobileThreadsHeader.tsx", "ThreadSidebarHeader.tsx"]) {
    const source = readFileSync(join(__dirname, `../src/features/threadList/${file}`), "utf8");
    expect(source.indexOf("<GlobalVoiceEntryAction")).toBeLessThan(
      source.indexOf('accessibilityLabel="Search threads and messages"'),
    );
  }
});

it("reacts to a persisted orb-style change without remounting", async () => {
  await act(async () => {
    await writeGlobalVoiceOrbStylePreference("nebula");
  });
  const view = render(<GlobalVoiceEntryAction state="idle" orbState="idle" onToggle={jest.fn()} />);
  const firstOrb = view.getByTestId("global-voice-orb", { includeHiddenElements: true });
  expect(firstOrb.props.orbStyle).toBe("nebula");

  await act(async () => {
    await writeGlobalVoiceOrbStylePreference("particles");
  });

  expect(view.getByTestId("global-voice-orb", { includeHiddenElements: true })).toBe(firstOrb);
  expect(firstOrb.props.orbStyle).toBe("particles");

  await act(async () => {
    await writeGlobalVoiceOrbStylePreference("nebula");
  });
});
