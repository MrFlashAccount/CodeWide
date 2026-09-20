import { describe, expect, it, jest } from "@jest/globals";
import { act, render } from "@testing-library/react-native";
import { useLayoutEffect, type Dispatch, type SetStateAction } from "react";
import { Text, View } from "react-native";

import { useConversationCleanup, useConversationRef, useConversationState } from "../src/ui/use-conversation-scope";
import { useConversationOwner, type ConversationOwner } from "../src/ui/use-conversation-owner";
import {
  useComposerSession,
  type ComposerSessionOwner,
} from "../src/features/composer/composerSession";
import { TEST_COMPOSER_PREFERENCES } from "./composer-session-fixture";

interface ProbeHandle {
  setSearch: Dispatch<SetStateAction<string>>;
  owner: ConversationOwner;
  scroll: { current: number };
  composer: ComposerSessionOwner;
}

interface ProbeProps {
  scope: string;
  handles: ProbeHandle[];
  mounted(): void;
  disposed(scope: string, scroll: number, search: string): void;
}

function Probe(props: ProbeProps) {
  const [search, setSearch] = useConversationState(props.scope, () => "");
  const scroll = useConversationRef(props.scope, () => 0);
  const owner = useConversationOwner(props.scope);
  const composer = useComposerSession(props.scope, {
    attachments: [],
    plainText: `draft-${props.scope}`,
    preferences: TEST_COMPOSER_PREFERENCES,
  });
  useLayoutEffect(() => {
    props.handles.push({ setSearch, owner, scroll, composer: composer.capture() });
  });
  useConversationCleanup(props.scope, () => props.disposed(props.scope, scroll.current, search));
  return <View><StableChrome mounted={props.mounted} /><Text>{`${props.scope}:${search}`}</Text></View>;
}

function StableChrome(props: { mounted(): void }) {
  useLayoutEffect(() => { props.mounted(); }, [props.mounted]);
  return <Text>Composer shell</Text>;
}

describe("persistent conversation shell", () => {
  it("resets chat-local state before commit while retaining the mounted chrome", () => {
    const handles: ProbeHandle[] = [];
    const mounted = jest.fn();
    const disposed = jest.fn();
    const view = render(<Probe scope="a" handles={handles} mounted={mounted} disposed={disposed} />);
    const first = handles.at(-1)!;
    act(() => { first.setSearch("needle"); first.scroll.current = 123; });
    expect(view.getByText("a:needle")).toBeTruthy();
    view.rerender(<Probe scope="b" handles={handles} mounted={mounted} disposed={disposed} />);
    expect(view.getByText("b:")).toBeTruthy();
    expect(handles.at(-1)!.scroll.current).toBe(0);
    expect(disposed).toHaveBeenCalledWith("a", 123, "needle");
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(first.owner.isCurrent()).toBe(false);
    expect(handles.at(-1)!.owner.isCurrent()).toBe(true);
    act(() => first.setSearch("late completion"));
    expect(view.getByText("b:")).toBeTruthy();
    view.rerender(<Probe scope="a" handles={handles} mounted={mounted} disposed={disposed} />);
    act(() => first.setSearch("old activation"));
    expect(view.getByText("a:")).toBeTruthy();
    expect(first.owner.hasReplacement()).toBe(true);
    expect(first.owner.isCurrent()).toBe(false);
    view.unmount();
    expect(disposed).toHaveBeenCalledTimes(3);
  });

  it("keeps delayed composer recovery attached to the original chat's values", () => {
    const handles: ProbeHandle[] = [];
    const mounted = jest.fn();
    const disposed = jest.fn();
    const view = render(<Probe scope="a" handles={handles} mounted={mounted} disposed={disposed} />);
    const first = handles.at(-1)!;
    view.rerender(<Probe scope="b" handles={handles} mounted={mounted} disposed={disposed} />);
    const second = handles.at(-1)!;
    expect(first.composer.read().plainText).toBe("draft-a");
    expect(second.composer.read().plainText).toBe("draft-b");
    first.composer.updateText({ markdown: "recovered-a", plainText: "recovered-a" });
    expect(second.composer.read().plainText).toBe("draft-b");
  });
});
