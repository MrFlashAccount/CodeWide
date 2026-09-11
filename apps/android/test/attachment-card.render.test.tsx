import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react-native";
import { AttachmentCard } from "../src/rendering/AttachmentCard";

describe("attachment card presentation", () => {
  it("keeps the same local preview while progressing, failing and retrying", () => {
    const open = jest.fn(), remove = jest.fn(), retry = jest.fn();
    const props = { name: "drawing.png", label: "Drawing", uri: "file:///cache/drawing.png", bytes: 100, onOpen: open, onRemove: remove, onRetry: retry };
    const view = render(<AttachmentCard {...props} state={{ status: "uploading", progress: { phase: "transferring", transferred: 50, total: 100 } }} />);
    expect(view.getByText("Uploading · 50%")).toBeTruthy();
    expect(view.getByRole("progressbar").props.accessibilityValue).toEqual({ min: 0, max: 100, now: 50 });
    expect(view.getByLabelText("drawing.png").props.source).toEqual({ uri: props.uri });
    fireEvent.press(view.getByLabelText("Open drawing.png"));
    expect(open).toHaveBeenCalledTimes(1);
    view.rerender(<AttachmentCard {...props} state={{ status: "error", message: "Upload unavailable" }} />);
    expect(view.getByText("Upload unavailable")).toBeTruthy();
    expect(view.getByText("Upload failed")).toBeTruthy();
    expect(view.queryByRole("progressbar")).toBeNull();
    fireEvent.press(view.getByLabelText("Retry drawing.png"));
    expect(retry).toHaveBeenCalledTimes(1);
    fireEvent.press(view.getByLabelText("Remove drawing.png"));
    expect(remove).toHaveBeenCalledTimes(1);
    view.rerender(<AttachmentCard {...props} state={{ status: "uploading", progress: null }} />);
    expect(view.getByText("Preparing…")).toBeTruthy();
    expect(view.queryByLabelText("Retry drawing.png")).toBeNull();
    expect(view.queryByRole("progressbar")).toBeNull();
    view.rerender(<AttachmentCard {...props} state={{ status: "ready" }} />);
    expect(view.getByText("Ready · 100 B")).toBeTruthy();
    expect(view.getByLabelText("drawing.png").props.source).toEqual({ uri: props.uri });
  });
  it("distinguishes preparation and verification from upload progress", () => {
    const view = render(<AttachmentCard name="video.mp4" label="Video" state={{ status: "uploading", progress: { phase: "hashing", transferred: 25, total: 100 } }} />);
    expect(view.getByText("Preparing · 25%")).toBeTruthy();
    view.rerender(<AttachmentCard name="video.mp4" label="Video" state={{ status: "uploading", progress: { phase: "verifying", transferred: 100, total: 100 } }} />);
    expect(view.getByText("Verifying · 100%")).toBeTruthy();
    expect(view.queryByText(/Ready/)).toBeNull();
  });
  it("uses file names, metadata and excerpts instead of a raw attachment payload", () => {
    const open = jest.fn();
    const view = render(<AttachmentCard name="plan.md" label="markdown" bytes={1024} excerpt="A short plan" onOpen={open} />);
    expect(view.getByText("A short plan")).toBeTruthy();
    expect(view.getByText("markdown · 1 KB")).toBeTruthy();
    fireEvent.press(view.getByLabelText("Open plan.md"));
    expect(open).toHaveBeenCalledTimes(1);
  });
});
