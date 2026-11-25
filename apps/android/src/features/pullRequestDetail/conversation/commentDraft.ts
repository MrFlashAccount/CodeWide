import { observable, type Observable } from "@legendapp/state";

import {
  MAX_COMMENT_ATTACHMENT_BYTES,
  type CommentAttachment,
} from "../../../data/forgeCommentAttachment";
import { pickUploadFile, selectedUploadUri } from "../../../native/file-transfer";
import type { MessageSendResult } from "../../messageContent/messageContent";
import { attachmentMarkdown } from "./commentMarkdown";

type Submission =
  | { readonly status: "editing" | "sending" | "picking" }
  | { readonly message: string; readonly status: "failed" };

/** Draft state and intents shared by sheet controls for one PR. */
export type CommentDraft = {
  readonly busy: () => boolean;
  readonly change: (text: string) => void;
  readonly failure: (error: unknown) => void;
  readonly files: Observable<readonly CommentAttachment[]>;
  readonly pick: () => Promise<void>;
  readonly remove: (uri: string) => void;
  readonly send: (
    publish: (markdown: string) => Promise<MessageSendResult>,
    upload: ((file: CommentAttachment) => Promise<string>) | null,
  ) => Promise<boolean>;
  readonly source: Observable<string>;
  readonly state: Observable<{ readonly value: Submission }>["value"];
};

async function pickCommentFile(): Promise<CommentAttachment | null> {
  const file = await pickUploadFile();
  if (file === null) {
    return null;
  }
  const uri = selectedUploadUri(file);
  if (uri === null || file.size <= 0) {
    throw new Error("The selected file is empty or unavailable.");
  }
  if (file.size > MAX_COMMENT_ATTACHMENT_BYTES) {
    throw new Error("Each attachment must be 10 MiB or smaller.");
  }
  return {
    name: file.name,
    size: file.size,
    type: file.mimeType === "" ? "application/octet-stream" : file.mimeType,
    uri,
  };
}

/** One PR's draft survives closing the editor; completed uploads survive a failed comment write. */
export function createCommentDraft(): CommentDraft {
  const source = observable("");
  const files = observable<readonly CommentAttachment[]>([]);
  const operation = observable<{ readonly value: Submission }>({ value: { status: "editing" } });
  const state = operation.value;
  const setState = (value: Submission): void => {
    operation.set({ value });
  };
  const failure = (error: unknown) => {
    setState({
      message: error instanceof Error ? error.message : "The operation failed.",
      status: "failed",
    });
  };
  const busy = () => state.status.peek() === "sending" || state.status.peek() === "picking";
  const change = (text: string) => {
    source.set(text);
    if (state.status.peek() === "failed") {
      setState({ status: "editing" });
    }
  };
  const remove = (uri: string) => {
    files.set(files.peek().filter((file) => file.uri !== uri));
  };
  const pick = async () => {
    if (busy()) {
      return;
    }
    setState({ status: "picking" });
    try {
      const file = await pickCommentFile();
      if (file !== null && !files.peek().some((other) => other.uri === file.uri)) {
        files.set([...files.peek(), file]);
      }
      setState({ status: "editing" });
    } catch (error) {
      failure(error);
    }
  };
  const uploadFiles = async (upload: ((file: CommentAttachment) => Promise<string>) | null) => {
    for (const file of files.peek()) {
      if (upload === null) {
        throw new Error("This forge cannot attach files.");
      }
      const url = await upload(file);
      const link = attachmentMarkdown(file.name, url, file.type.startsWith("image/"));
      const current = source.peek();
      source.set(current.length > 0 ? current + "\n\n" + link : link);
      remove(file.uri);
    }
  };
  const send = async (
    publish: (markdown: string) => Promise<MessageSendResult>,
    upload: ((file: CommentAttachment) => Promise<string>) | null,
  ) => {
    if (busy() || (source.peek().trim().length === 0 && files.peek().length === 0)) {
      return false;
    }
    setState({ status: "sending" });
    try {
      if (files.peek().length > 0) {
        await uploadFiles(upload);
      }
      const result = await publish(source.peek());
      if (result.status === "sent") {
        source.set("");
      }
      setState(
        result.status === "failed"
          ? { message: result.message, status: "failed" }
          : { status: "editing" },
      );
      return result.status === "sent";
    } catch (error) {
      failure(error);
      return false;
    }
  };
  return { busy, change, failure, files, pick, remove, send, source, state };
}
