import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ObservableResource } from "../src/v2/application/resources/resource";
import { V2RuntimeProvider } from "../src/v2/application/react/V2RuntimeContext";
import type { V2Runtime } from "../src/v2/application/v2Runtime";
import { savedServerId, threadId } from "../src/v2/domain/ids";
import {
  ContentReviewSurfaceProvider,
  contentReviewDiagramCapability,
} from "../src/v2/features/review/ContentReviewSurface";
import { contentReviewAnchor } from "../src/v2/features/review/contentReviewAnchor";
import { DiagramFullscreen } from "../src/v2/rendering/DiagramFullscreen.native";
import { DiagramSurface } from "../src/v2/rendering/DiagramSurface.native";
import { MERMAID_ENGINE } from "../src/v2/rendering/diagramModel";
import { V2RenderingCapabilityProvider } from "../src/v2/rendering/renderingCapabilities";
import type { ReviewAnchor, ReviewComment } from "../src/v2/rendering/review/reviewModel";
import { reviewResponseTarget } from "../src/v2/rendering/review/reviewModel";
import { latestWebViewProps, webViewInjectedJavaScript } from "./mocks/ReactNativeWebView";

const owner = {
  savedServerId: savedServerId("saved-server-a"),
  threadId: threadId("thread-a"),
};
const target = reviewResponseTarget("turn-a", "item-a");
const anchor: ReviewAnchor = {
  diagramId: "diagram-a",
  kind: "diagram",
  source: "graph TD; A-->B",
  target,
  x: 0.25,
  y: 0.75,
};

describe("V2 fullscreen diagram review", () => {
  it("renders saved markers and comments inside the fullscreen modal", () => {
    const comment: ReviewComment = { anchor, body: "Move this node.", id: "comment-a", order: 1 };
    renderDiagram({ comments: [comment], selectedAnchor: null });

    expect(screen.getByText("Move this node.")).toBeTruthy();
    expect(screen.UNSAFE_getByType(DiagramSurface).props.reviewPoints).toEqual([
      {
        diagramId: "diagram-a",
        id: "comment-a",
        pending: false,
        targetId: target.id,
        x: 0.25,
        y: 0.75,
      },
    ]);
  });

  it("keeps point taps and the review composer reachable above the native modal", async () => {
    const beginReview = jest.fn();
    const save = jest.fn();
    renderDiagram({ beginReview, onSave: save, selectedAnchor: anchor });

    expect(screen.getByLabelText("Review comment")).toBeTruthy();
    await act(async () => {
      screen.UNSAFE_getByType(DiagramSurface).props.onReviewPoint(0.4, 0.6);
    });
    expect(beginReview).toHaveBeenCalledWith({
      diagramId: "diagram-a",
      kind: "diagram",
      source: "graph TD; A-->B",
      targetId: target.id,
      x: 0.4,
      y: 0.6,
    });

    fireEvent.changeText(screen.getByLabelText("Review comment"), "Use a clearer label.");
    fireEvent.press(screen.getByLabelText("Save review comment"));
    expect(save).toHaveBeenCalledWith(anchor, "Use a clearer label.");
  });

  it("injects review markers after the renderer produces the fullscreen SVG", () => {
    webViewInjectedJavaScript.length = 0;
    render(
      <DiagramSurface
        engine={MERMAID_ENGINE}
        mode="fullscreen"
        reviewPoints={
          contentReviewDiagramCapability(
            [{ anchor, body: "Move this node.", id: "comment-a", order: 1 }],
            null,
          ).points
        }
        source="graph TD; A-->B"
        style={{ flex: 1 }}
      />,
    );
    fireEvent(screen.UNSAFE_getAllByType(View)[0], "layout", {
      nativeEvent: { layout: { height: 400, width: 400, x: 0, y: 0 } },
    });
    act(() => latestWebViewProps?.onMessage?.({ nativeEvent: { data: '{"type":"ready"}' } }));
    act(() =>
      latestWebViewProps?.onMessage?.({
        nativeEvent: { data: '{"height":200,"requestId":1,"type":"rendered"}' },
      }),
    );

    expect(webViewInjectedJavaScript).toEqual(
      expect.arrayContaining([expect.stringContaining("window.diagramSetReviewPoints")]),
    );
    expect(webViewInjectedJavaScript.join("\n")).toContain('"id":"comment-a"');
  });

  it("preserves diagram coordinates when renderer anchors enter the review model", () => {
    expect(
      contentReviewAnchor(
        {
          diagramId: "diagram-a",
          kind: "diagram",
          source: "graph TD; A-->B",
          targetId: target.id,
          x: 0.125,
          y: 0.875,
        },
        target,
      ),
    ).toEqual({ ...anchor, x: 0.125, y: 0.875 });
  });
});

interface RenderDiagramInput {
  beginReview?(anchor: unknown): void;
  comments?: readonly ReviewComment[];
  onSave?(anchor: ReviewAnchor, body: string): void;
  selectedAnchor: ReviewAnchor | null;
}

function renderDiagram(input: RenderDiagramInput): ReturnType<typeof render> {
  const comments = input.comments ?? [];
  const diagramReview = contentReviewDiagramCapability(comments, input.selectedAnchor);
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 800, width: 400, x: 0, y: 0 },
        insets: { bottom: 0, left: 0, right: 0, top: 0 },
      }}
    >
      <V2RuntimeProvider runtime={reviewRuntime()}>
        <ContentReviewSurfaceProvider
          comments={comments}
          onCancel={jest.fn()}
          onRemove={jest.fn()}
          onSave={input.onSave ?? jest.fn()}
          owner={owner}
          selectedAnchor={input.selectedAnchor}
        >
          <V2RenderingCapabilityProvider
            capabilities={{
              ...(input.beginReview === undefined ? {} : { beginReview: input.beginReview }),
              diagramReview,
            }}
          >
            <DiagramFullscreen
              diagramId="diagram-a"
              engine={MERMAID_ENGINE}
              onClose={jest.fn()}
              reviewTargetId={target.id}
              source="graph TD; A-->B"
              visible
            />
          </V2RenderingCapabilityProvider>
        </ContentReviewSurfaceProvider>
      </V2RuntimeProvider>
    </SafeAreaProvider>,
  );
}

function reviewRuntime(): V2Runtime {
  const projection = new ObservableResource<unknown>(null);
  return {
    projection: () => projection,
  } as unknown as V2Runtime;
}
