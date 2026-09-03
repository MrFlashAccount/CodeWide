import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { router } from "expo-router";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { useState, type ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ReviewCommentComposer } from "../src/v2/presentation/review/ReviewCommentComposer";
import { ChangesReviewLaunchButton } from "../src/v2/features/review/ReviewEntryActions";
import { ReviewDeliveryControl } from "../src/v2/presentation/review/ReviewDeliveryControl";
import { ReviewTargetControl } from "../src/v2/presentation/review/ReviewTargetControl";
import { savedServerId, threadId } from "../src/v2/domain/ids";
import { qualifiedThread } from "../src/v2/domain/qualifiedThread";
import type { ReviewLineAnchor } from "../src/v2/rendering/review/reviewModel";
import { ActionRunner } from "../src/v2/ui/actions/ActionRunner";

const REVIEW_LINE = 7;
const SAFE_AREA_METRICS = {
  frame: { height: 800, width: 400, x: 0, y: 0 },
  insets: { bottom: 0, left: 0, right: 0, top: 0 },
};
const COMMIT_AND_CUSTOM = ["commit", "custom"] as const;
const DETACHED_ONLY = ["detached"] as const;

afterEach(() => jest.restoreAllMocks());

describe("V2 review presentation", () => {
  it("offers only review targets declared by server authority", () => {
    const onChange = jest.fn();
    render(
      <ReviewTargetControl
        availableKinds={COMMIT_AND_CUSTOM}
        onChange={onChange}
        target={{ kind: "commit", sha: "abc123" }}
      />,
    );

    expect(screen.getByText("Commit")).toBeTruthy();
    expect(screen.getByText("Custom")).toBeTruthy();
    expect(screen.queryByText("Uncommitted changes")).toBeNull();
    expect(screen.queryByText("Base branch")).toBeNull();
    fireEvent.press(screen.getByText("Custom"));
    expect(onChange).toHaveBeenCalledWith({ instructions: "", kind: "custom" });
  });

  it("offers only review deliveries declared by server authority", () => {
    const onChange = jest.fn();
    render(
      <ReviewDeliveryControl deliveries={DETACHED_ONLY} onChange={onChange} value="detached" />,
    );

    expect(screen.getByText("New thread")).toBeTruthy();
    expect(screen.queryByText("Inline")).toBeNull();
  });

  it("saves an anchored comment with the exact selected line", () => {
    const anchor = lineAnchor();
    const onSave = jest.fn();
    render(<ReviewCommentComposerHarness anchor={anchor} onSave={onSave} />, {
      wrapper: TestSafeArea,
    });

    fireEvent.changeText(screen.getByLabelText("Review comment"), "  Validate this value.  ");
    fireEvent.press(screen.getByLabelText("Save review comment"));

    expect(onSave).toHaveBeenCalledWith(anchor, "Validate this value.");
  });

  it("opens review for the authoritative changes scope", async () => {
    const push = jest.spyOn(router, "push");
    const owner = qualifiedThread(savedServerId("server-a"), threadId("thread-a"));
    render(
      <ActionRunner>
        <ChangesReviewLaunchButton owner={owner} scope="lastTurn" />
      </ActionRunner>,
    );

    await act(async () => {
      fireEvent.press(screen.getByText("Review"));
    });

    expect(push).toHaveBeenCalledWith({
      params: {
        mode: "changes",
        savedServerId: "server-a",
        scope: "lastTurn",
        threadId: "thread-a",
      },
      pathname: "/servers/[savedServerId]/threads/[threadId]/review",
    });
  });
});

interface TestSafeAreaProps {
  children: ReactNode;
}

interface ReviewCommentComposerHarnessProps {
  anchor: ReviewLineAnchor;
  onSave(anchor: ReviewLineAnchor, body: string): void;
}

function ReviewCommentComposerHarness(props: ReviewCommentComposerHarnessProps): React.JSX.Element {
  const [body, setBody] = useState("");
  return (
    <ReviewCommentComposer
      anchor={props.anchor}
      body={body}
      onBodyChange={setBody}
      onCancel={jest.fn()}
      onSave={props.onSave}
    />
  );
}

function TestSafeArea(props: TestSafeAreaProps): React.JSX.Element {
  return <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>{props.children}</SafeAreaProvider>;
}

function lineAnchor(): ReviewLineAnchor {
  return {
    context: "const value = input;",
    kind: "line",
    line: REVIEW_LINE,
    path: "src/value.ts",
    side: "new",
    target: { id: "changed-file:src/value.ts", label: "src/value.ts", reference: "src/value.ts" },
  };
}
