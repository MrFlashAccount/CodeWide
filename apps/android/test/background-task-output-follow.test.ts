import { describe, expect, it, vi } from "vitest";

import {
  followBackgroundTaskOutput,
  type BackgroundTaskOutput,
  type BackgroundTaskOutputPage,
} from "../src/data/backgroundTaskOutput";

/** A task whose output file holds `text`, served in pages of `pageBytes`. */
function taskFile(
  text: string,
  pageBytes: number,
  statusAt: (offset: number) => BackgroundTaskOutputPage["status"] = () => "completed",
) {
  return vi.fn(async (_taskId: string, offset: number): Promise<BackgroundTaskOutputPage> => {
    const end = Math.min(text.length, offset + pageBytes);
    return {
      nextOffset: end < text.length ? end : null,
      sizeBytes: text.length,
      status: statusAt(offset),
      taskId: "task",
      text: text.slice(offset, end),
    };
  });
}

const options = { pollMs: 1, residentBytes: 1_000 };

describe("following a background task's output", () => {
  it("reads every page without being asked and publishes each step", async () => {
    const text = "line one\nline two\nline three\n";
    const read = taskFile(text, 10);
    const first = await read("task", 0);
    const published: BackgroundTaskOutput[] = [];

    const output = await followBackgroundTaskOutput({
      first,
      options: options,
      publish: (step) => published.push(step),
      read,
      signal: new AbortController().signal,
    });

    expect(output.text).toBe(text);
    expect(output.headOmitted).toBe(false);
    expect(output.status).toBe("completed");
    // The first page shows at once, then one step per page read.
    expect(published[0]?.text).toBe(text.slice(0, 10));
    expect(published.at(-1)?.text).toBe(text);
    expect(read.mock.calls.map(([, offset]) => offset)).toEqual([0, 10, 20]);
  });

  it("starts a long output at its newest part and says the beginning is hidden", async () => {
    const text = `${"old line\n".repeat(400)}newest line\n`;
    const read = taskFile(text, 300);
    const first = await read("task", 0);

    const output = await followBackgroundTaskOutput({
      first,
      options: options,
      publish: () => undefined,
      read,
      signal: new AbortController().signal,
    });

    expect(output.headOmitted).toBe(true);
    expect(output.text.endsWith("newest line\n")).toBe(true);
    expect(output.text.length).toBeLessThanOrEqual(options.residentBytes);
    // The head between the first page and the kept tail is never read.
    expect(read.mock.calls[1]?.[1]).toBe(text.length - options.residentBytes);
  });

  it("follows a running task until it finishes", async () => {
    let written = "building";
    let finished = false;
    const read = vi.fn(async (_taskId: string, offset: number): Promise<BackgroundTaskOutputPage> => {
      const page: BackgroundTaskOutputPage = {
        nextOffset: null,
        sizeBytes: written.length,
        status: finished ? "completed" : "running",
        taskId: "task",
        text: written.slice(offset),
      };
      // The task writes more after each read, and finishes after a while.
      written += ".";
      finished = written.length > 12;
      return page;
    });
    const first = await read("task", 0);

    const output = await followBackgroundTaskOutput({
      first,
      options: options,
      publish: () => undefined,
      read,
      signal: new AbortController().signal,
    });

    expect(output.status).toBe("completed");
    expect(output.text.startsWith("building....")).toBe(true);
  });

  it("stops reading when the dialog closes", async () => {
    const read = taskFile("still going", 100, () => "running");
    const first = await read("task", 0);
    const controller = new AbortController();

    const following = followBackgroundTaskOutput({
      first,
      options: { pollMs: 50, residentBytes: 1_000 },
      publish: () => undefined,
      read,
      signal: controller.signal,
    });
    controller.abort();

    await expect(following).rejects.toMatchObject({ name: "AbortError" });
    expect(read).toHaveBeenCalledTimes(1);
  });
});
