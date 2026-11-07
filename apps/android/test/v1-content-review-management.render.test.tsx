import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { Pressable } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { useEvent } from "../src/react/useEvent";
import {
  ContentReviewComments,
  ContentReviewComposer,
  ContentReviewHost,
  useContentReview,
  useContentReviewRuntime,
} from "../src/rendering/ContentReviewHost";
import type { ContentReviewAnchor } from "../src/rendering/content-review";
import { AppText as Text } from "../src/ui/AppText";
import { invokeAppDialogAction, resetAppDialog } from "./mocks/AppDialog";

const target = {
  id: "video:review-management",
  label: "Review video",
  reference: "scoped:attachments:review-video.mp4",
};
const firstAnchor: ContentReviewAnchor = {
  kind: "video",
  target,
  timeSeconds: 4.189,
  x: 0.637,
  y: 0.618,
};
const secondAnchor: ContentReviewAnchor = {
  kind: "video",
  target,
  timeSeconds: 2.21,
  x: 0.521,
  y: 0.621,
};

const attach = jest.fn(async (_markdown: string): Promise<string> => "content-review-attachment");
const removeAttachment = jest.fn((_attachmentId: string): void => undefined);

function ReviewManagementFixture(): React.JSX.Element {
  const begin = useContentReview();
  useContentReviewRuntime({
    attach,
    attachmentId: null,
    removeAttachment,
    resources: null,
    thread: null,
    voiceController: null,
    voiceScope: "thread",
  });
  const addFirst = useEvent(() => {
    begin(firstAnchor);
  });
  const addSecond = useEvent(() => {
    begin(secondAnchor);
  });
  return (
    <>
      <Pressable onPress={addFirst}>
        <Text>Add first comment</Text>
      </Pressable>
      <Pressable onPress={addSecond}>
        <Text>Add second comment</Text>
      </Pressable>
      <ContentReviewComments targetId={target.id} />
      <ContentReviewComposer anchorKind="video" targetId={target.id} />
    </>
  );
}

function renderReviewManagement() {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 800, width: 400, x: 0, y: 0 },
        insets: { bottom: 0, left: 0, right: 0, top: 24 },
      }}
    >
      <ContentReviewHost>
        <ReviewManagementFixture />
      </ContentReviewHost>
    </SafeAreaProvider>,
  );
}

async function addComment(
  view: ReturnType<typeof renderReviewManagement>,
  trigger: "Add first comment" | "Add second comment",
  body: string,
): Promise<void> {
  const previousAttachmentCount = attach.mock.calls.length;
  fireEvent.press(view.getByText(trigger));
  fireEvent.changeText(view.getByPlaceholderText("What should change here?"), body);
  fireEvent.press(view.getByLabelText("Save review comment"));
  await waitFor(() => expect(attach).toHaveBeenCalledTimes(previousAttachmentCount + 1));
  await waitFor(() => expect(view.queryByPlaceholderText("What should change here?")).toBeNull());
}

beforeEach(() => {
  attach.mockClear();
  removeAttachment.mockClear();
  resetAppDialog();
});

it("edits one comment and republishes the aggregate review without moving its anchor", async () => {
  const view = renderReviewManagement();
  await addComment(view, "Add first comment", "Original note");
  fireEvent.press(view.getByLabelText("Show 1 review comments"));
  fireEvent.press(view.getByLabelText("Edit review comment 1"));

  expect(view.getByPlaceholderText("What should change here?").props.value).toBe("Original note");
  fireEvent.changeText(view.getByPlaceholderText("What should change here?"), "Updated note");
  fireEvent.press(view.getByLabelText("Save review comment"));

  await waitFor(() => expect(attach).toHaveBeenCalledTimes(2));
  const updatedMarkdown = attach.mock.calls[1]?.[0];
  expect(updatedMarkdown).toContain("Updated note");
  expect(updatedMarkdown).not.toContain("Original note");
  expect(updatedMarkdown).toContain("00:04.189");
  expect(updatedMarkdown).toContain("(63.7%, 61.8%)");
});

it("deletes one comment and republishes the aggregate review with the survivor", async () => {
  const view = renderReviewManagement();
  await addComment(view, "Add first comment", "Keep this note");
  await addComment(view, "Add second comment", "Remove this note");
  fireEvent.press(view.getByLabelText("Show 2 review comments"));
  fireEvent.press(view.getByLabelText("Delete review comment 2"));
  act(() => {
    invokeAppDialogAction("Delete");
  });

  await waitFor(() => expect(attach).toHaveBeenCalledTimes(3));
  const updatedMarkdown = attach.mock.calls[2]?.[0];
  expect(updatedMarkdown).toContain("comments: 1");
  expect(updatedMarkdown).toContain("Keep this note");
  expect(updatedMarkdown).not.toContain("Remove this note");
  expect(view.getByLabelText("Hide 1 review comments")).toBeTruthy();
  expect(removeAttachment).not.toHaveBeenCalled();
});

it("deletes the last comment by removing its aggregate review attachment", async () => {
  const view = renderReviewManagement();
  await addComment(view, "Add first comment", "Only note");
  fireEvent.press(view.getByLabelText("Show 1 review comments"));
  fireEvent.press(view.getByLabelText("Delete review comment 1"));
  act(() => {
    invokeAppDialogAction("Delete");
  });

  await waitFor(() => expect(removeAttachment).toHaveBeenCalledWith("content-review-attachment"));
  expect(attach).toHaveBeenCalledTimes(1);
  expect(view.queryByLabelText("Show 1 review comments")).toBeNull();
  expect(view.queryByLabelText("Hide 1 review comments")).toBeNull();
});
