import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ImagePreviewModal } from "../src/v2/rendering/ImagePreviewModal";
import { MarkdownImage } from "../src/v2/rendering/MarkdownImage";
import { MarkdownLink } from "../src/v2/rendering/MarkdownLink";
import { ResolvedImageGroup } from "../src/v2/rendering/ResolvedImageGroup";
import { useReviewSelectionAction } from "../src/v2/rendering/review/useReviewSelectionAction";
import {
  V2RenderingCapabilityProvider,
  type MarkdownImageReference,
  type RenderingImageItem,
  type V2RenderingCapabilities,
} from "../src/v2/rendering/renderingCapabilities";

const REFERENCE: MarkdownImageReference = {
  alt: "Screenshot",
  id: "screenshot",
  link: "https://example.test/source",
  reference: "https://example.test/screenshot.png",
};
const IMAGE: RenderingImageItem = { ...REFERENCE, order: 0, source: { uri: REFERENCE.reference } };

describe("V2 async rich-rendering actions", () => {
  it("locks duplicate annotation, shows the exact rejection and retries", async () => {
    const annotateImage = jest
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("Annotation workspace unavailable"))
      .mockResolvedValueOnce(undefined);
    renderPreview({ annotateImage });

    fireEvent.press(screen.getByLabelText("Annotate image"));
    fireEvent.press(screen.getByLabelText("Annotate image"));
    await screen.findByText("Annotation workspace unavailable");
    expect(annotateImage).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByLabelText("Retry failed action"));
    await act(async () => undefined);
    expect(annotateImage).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Annotation workspace unavailable")).toBeNull();
  });

  it("keeps image-source progress visible, reports rejection and retries once", async () => {
    const pending = deferred<void>();
    const openExternalLink = jest
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(undefined);
    renderPreview({ openExternalLink });

    fireEvent.press(screen.getByLabelText("Open image source"));
    fireEvent.press(screen.getByLabelText("Open image source"));
    expect(openExternalLink).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Opening image source…")).toBeTruthy();

    await act(async () => pending.reject(new Error("Image source permission expired")));
    expect(screen.getByText("Image source permission expired")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Retry failed action"));
    await act(async () => undefined);
    expect(openExternalLink).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Image source permission expired")).toBeNull();
  });

  it("surfaces and retries Markdown link rejection without reporting success early", async () => {
    const pending = deferred<void>();
    const openExternalLink = jest
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(undefined);
    renderWithCapabilities(
      { openExternalLink },
      <MarkdownLink url="https://example.test/docs">External docs</MarkdownLink>,
    );

    fireEvent.press(screen.getByRole("link"));
    fireEvent.press(screen.getByRole("link"));
    expect(openExternalLink).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Opening…/u)).toBeTruthy();

    await act(async () => pending.reject(new Error("External app refused the link")));
    expect(screen.getByText(/External app refused the link/u)).toBeTruthy();
    fireEvent.press(screen.getByText(/External app refused the link/u));
    await act(async () => undefined);
    expect(openExternalLink).toHaveBeenCalledTimes(2);
  });

  it("does not convert rejected image preview activation into a false local success", async () => {
    const openImagePreview = jest
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error("Preview host rejected activation"))
      .mockResolvedValueOnce(true);
    renderWithCapabilities(
      { openImagePreview },
      <ResolvedImageGroup references={[REFERENCE]}>
        <MarkdownImage references={[REFERENCE]} selectedId={REFERENCE.id} />
      </ResolvedImageGroup>,
    );

    fireEvent.press(await screen.findByLabelText("Open Screenshot"));
    fireEvent.press(screen.getByLabelText("Open Screenshot"));
    await act(async () => undefined);
    await screen.findByText("Preview host rejected activation");
    expect(openImagePreview).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Close image")).toBeNull();

    fireEvent.press(screen.getByLabelText("Retry failed action"));
    await act(async () => undefined);
    expect(openImagePreview).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Preview host rejected activation")).toBeNull();
  });

  it("surfaces native review activation failure and retries the same selection", async () => {
    const beginReview = jest
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("Review target expired"))
      .mockResolvedValueOnce(undefined);
    const action = renderHook(() =>
      useReviewSelectionAction({
        beginReview,
        blockPath: "body.0",
        offset: 0,
        targetId: "response-a",
      }),
    );
    act(() => {
      action.result.current.activate({ end: 6, start: 0, text: "Review" });
    });
    await waitFor(() => expect(action.result.current.action.error).toBe("Review target expired"));
    expect(beginReview).toHaveBeenCalledTimes(1);
    expect(beginReview).toHaveBeenCalledWith({
      blockPath: "body.0",
      end: 6,
      kind: "text",
      quote: "Review",
      start: 0,
      targetId: "response-a",
    });
    act(() => action.result.current.action.retry());
    await waitFor(() => expect(action.result.current.action.error).toBeNull());
    expect(beginReview).toHaveBeenCalledTimes(2);
  });
});

interface Deferred<T> {
  promise: Promise<T>;
  reject(cause: unknown): void;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let reject!: (cause: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete, fail) => {
    reject = fail;
    resolve = complete;
  });
  return { promise, reject, resolve };
}

function renderPreview(capabilities: V2RenderingCapabilities): ReturnType<typeof render> {
  return renderWithCapabilities(
    capabilities,
    <ImagePreviewModal initialId={IMAGE.id} items={[IMAGE]} onClose={jest.fn()} visible />,
  );
}

function renderWithCapabilities(
  capabilities: V2RenderingCapabilities,
  child: React.JSX.Element,
): ReturnType<typeof render> {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 800, width: 400, x: 0, y: 0 },
        insets: { bottom: 0, left: 0, right: 0, top: 0 },
      }}
    >
      <V2RenderingCapabilityProvider capabilities={capabilities}>
        {child}
      </V2RenderingCapabilityProvider>
    </SafeAreaProvider>,
    { createNodeMock: () => ({ _nativeTag: 1 }) },
  );
}
