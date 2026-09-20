import { act, renderHook } from "@testing-library/react-native";
import { useState } from "react";
import { useComposerAccessoryActions } from "../src/features/composer/ComposerAccessoryTray";

it("offers the existing terminal activation from the composer menu", () => {
  const openComposerFeature = jest.fn();
  const hook = renderHook(() => {
    const [, setComposerTrayVisible] = useState(true);
    return useComposerAccessoryActions({
      fileAttachmentEnabled: true,
      goalEnabled: true,
      openComposerFeature,
      setComposerTrayVisible,
      terminalEnabled: true,
    });
  });

  expect(hook.result.current.anchoredComposerActions).toContainEqual({
    disabled: false,
    icon: "terminal-outline",
    id: "terminal",
    label: "Terminal",
  });

  act(() => {
    hook.result.current.handleAnchoredComposerAction("terminal");
  });

  expect(openComposerFeature).toHaveBeenCalledWith("terminal");
});

it("keeps terminal visible but disabled before a thread exists", () => {
  const hook = renderHook(() => {
    const [, setComposerTrayVisible] = useState(false);
    return useComposerAccessoryActions({
      fileAttachmentEnabled: true,
      goalEnabled: true,
      openComposerFeature: jest.fn(),
      setComposerTrayVisible,
      terminalEnabled: false,
    });
  });

  expect(hook.result.current.anchoredComposerActions).toContainEqual({
    disabled: true,
    icon: "terminal-outline",
    id: "terminal",
    label: "Terminal",
  });
});
