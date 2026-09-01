interface ThreadListCopy {
  preview: string;
  title: string;
}

interface ThreadListCopySource {
  preview: string;
  title: string | null;
}

export function threadListCopy(thread: ThreadListCopySource): ThreadListCopy {
  return {
    preview: thread.preview,
    title: semanticTitle(thread.title) ?? firstPreviewLine(thread.preview) ?? "New Chat",
  };
}

function semanticTitle(value: string | null): string | null {
  const title = value?.trim();
  if (title === undefined || title === "" || title.toLocaleLowerCase() === "untitled thread") {
    return null;
  }
  return title;
}

function firstPreviewLine(value: string): string | null {
  const line = value
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part !== "");
  return line ?? null;
}
