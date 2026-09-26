// Exercises the shipped WebView bundle, including Pierre, without a Companion or device.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { chromium, expect } from "@playwright/test";

let browser;
before(async () => {
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
});

async function openReview() {
  const page = await browser.newPage({ viewport: { width: 420, height: 780 } });
  await page.addInitScript(() => {
    window.reviewEvents = [];
    window.ReactNativeWebView = {
      postMessage: (text) => window.reviewEvents.push(JSON.parse(text)),
    };
  });
  await page.goto(
    new URL("../android/app/src/main/assets/code-review-editor.html", import.meta.url).href,
  );
  await page.waitForFunction(() => window.reviewEvents.some((event) => event.type === "ready"));
  return page;
}

async function send(page, command, payload) {
  await page.evaluate(
    ({ command, payload }) => {
      window.reviewSequence = (window.reviewSequence ?? 0) + 1;
      window.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({ version: 1, sequence: window.reviewSequence, command, payload }),
        }),
      );
    },
    { command, payload },
  );
}

const patch = (before, after) => ({
  kind: "update",
  diff: `--- a/file.ts\n+++ b/file.ts\n@@ -20 +20 @@\n-${before}\n+${after}\n`,
});
const files = [
  { path: "file.ts", treePath: "file.ts", status: "modified", additions: 1, deletions: 1 },
];

test("keeps file navigation while replacing unsupported content with a placeholder", async () => {
  const page = await openReview();
  try {
    const selectedFiles = [
      { path: "archive.zip", treePath: "archive.zip", status: "added", additions: 0, deletions: 0 },
      { path: "chart.png", treePath: "chart.png", status: "added", additions: 0, deletions: 0 },
    ];
    await send(page, "workspace", {
      files: selectedFiles,
      revision: "mixed-files",
      selectedPath: "archive.zip",
      sidebarOpen: true,
      compact: true,
    });
    await page.locator('button[data-item-path="archive.zip"]').click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.reviewEvents
            .filter((event) => event.type === "fileSelect")
            .map((event) => event.path),
        ),
      )
      .toEqual(["archive.zip"]);
    await send(page, "workspace", {
      files: selectedFiles,
      revision: "mixed-files",
      selectedPath: "archive.zip",
      sidebarOpen: false,
      compact: true,
    });
    await send(page, "document", {
      requestId: 1,
      document: {
        displayState: "unsupported",
        path: "archive.zip",
        source: "",
        revision: "binary",
        patches: [],
      },
    });
    await expect(page.getByText("Unsupported format", { exact: true })).toBeVisible();
    await expect(page.locator("#preview .pierre-preview-host:visible")).toHaveCount(0);

    const imageDataUrl = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red"/></svg>').toString("base64")}`;
    await send(page, "workspace", {
      files: selectedFiles,
      revision: "mixed-files",
      selectedPath: "archive.zip",
      sidebarOpen: true,
      compact: true,
    });
    await expect(page.locator('button[data-item-path="archive.zip"]')).toBeVisible();
    await page.locator('button[data-item-path="chart.png"]').click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.reviewEvents
            .filter((event) => event.type === "fileSelect")
            .map((event) => event.path),
        ),
      )
      .toEqual(["archive.zip", "chart.png"]);
    await send(page, "workspace", {
      files: selectedFiles,
      revision: "mixed-files",
      selectedPath: "chart.png",
      sidebarOpen: false,
      compact: true,
    });
    await send(page, "document", {
      requestId: 2,
      document: {
        displayState: "image",
        imageDataUrl,
        path: "chart.png",
        source: "",
        revision: "image",
        patches: [],
      },
    });
    await expect(page.locator("#review-image")).toBeVisible();
    await expect
      .poll(() => page.locator("#review-image").evaluate((image) => image.naturalWidth))
      .toBe(1);
    await expect(page.getByText("Unsupported format", { exact: true })).toBeHidden();
    await send(page, "workspace", {
      files: selectedFiles,
      revision: "mixed-files",
      selectedPath: "chart.png",
      sidebarOpen: true,
      compact: true,
    });
    await page.locator('button[data-item-path="archive.zip"]').click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.reviewEvents
            .filter((event) => event.type === "fileSelect")
            .map((event) => event.path),
        ),
      )
      .toEqual(["archive.zip", "chart.png", "archive.zip"]);
    await send(page, "workspace", {
      files: selectedFiles,
      revision: "mixed-files",
      selectedPath: "archive.zip",
      sidebarOpen: false,
      compact: true,
    });
    await send(page, "document", {
      requestId: 3,
      document: {
        displayState: "unsupported",
        path: "archive.zip",
        source: "",
        revision: "unsupported-again",
        patches: [],
      },
    });
    await expect(page.getByText("Unsupported format", { exact: true })).toBeVisible();
    assert.equal(await page.locator("#review-image").getAttribute("src"), null);
  } finally {
    await page.close();
  }
});

test("activating the selected file returns from the compact file tree to its preview", async () => {
  const page = await openReview();
  try {
    const workspace = {
      files,
      revision: "files-1",
      selectedPath: "file.ts",
      sidebarOpen: true,
      compact: true,
    };
    await send(page, "workspace", workspace);
    await page.locator('button[data-item-path="file.ts"]').click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.reviewEvents
            .filter((event) => event.type === "fileSelect")
            .map((event) => event.path),
        ),
      )
      .toEqual(["file.ts"]);
    await send(page, "workspace", { ...workspace, sidebarOpen: false });
    await expect(page.getByText("Loading file…", { exact: true })).toBeVisible();
  } finally {
    await page.close();
  }
});

test("keeps final session files in the tree without cumulative step counts", async () => {
  const page = await openReview();
  try {
    await send(page, "workspace", {
      files: [{
        path: "file.ts",
        treePath: "file.ts",
        status: "added",
        additions: 12,
        deletions: 5,
        countsAreNet: false,
      }],
      revision: "final-session-file",
      selectedPath: "file.ts",
      sidebarOpen: true,
      compact: true,
    });
    await expect(page.locator('button[data-item-path="file.ts"]')).toBeVisible();
    await expect(page.getByText("+12 −5", { exact: true })).toHaveCount(0);
  } finally { await page.close(); }
});

test("renders every recorded edit even when no complete current file exists", async () => {
  const page = await openReview();
  try {
    await send(page, "workspace", {
      files,
      revision: "files-1",
      selectedPath: "file.ts",
      sidebarOpen: false,
      compact: true,
    });
    await expect(page.getByText("Loading file…", { exact: true })).toBeVisible();
    for (const mode of ["unified", "split"]) {
      await send(page, "settings", { mode, wrapLines: false });
      await send(page, "document", {
        requestId: 1,
        document: {
          path: "file.ts",
          source: "",
          revision: "recorded-1",
          patches: [patch("beforeFirst", "afterFirst"), patch("beforeSecond", "afterSecond")],
        },
      });
      for (const text of ["beforeFirst", "afterFirst", "beforeSecond", "afterSecond"]) {
        await expect(page.getByText(text, { exact: true })).toBeVisible();
      }
      const first = await page.getByText("beforeFirst", { exact: true }).boundingBox();
      const second = await page.getByText("beforeSecond", { exact: true }).boundingBox();
      assert.ok(
        first !== null && second !== null && first.y < second.y,
        "recorded edits retain their original order",
      );
    }
    assert.equal(
      await page.evaluate(() => window.reviewEvents.some((event) => event.type === "error")),
      false,
    );
    await send(page, "settings", { mode: "source", wrapLines: false });
    await expect(page.getByText("No source content", { exact: true })).toBeVisible();
  } finally {
    await page.close();
  }
});

test("still renders a complete source file and a reconstructed diff", async () => {
  const page = await openReview();
  try {
    await send(page, "workspace", {
      files,
      revision: "files-1",
      selectedPath: "file.ts",
      sidebarOpen: false,
      compact: true,
    });
    await send(page, "settings", { mode: "unified", wrapLines: false });
    await send(page, "document", {
      requestId: 1,
      document: {
        path: "file.ts",
        source: "currentValue",
        revision: "complete-1",
        patches: [
          {
            kind: "update",
            diff: "--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-previousValue\n+currentValue",
          },
        ],
      },
    });
    await expect(page.getByText("previousValue", { exact: true })).toBeVisible();
    await expect(
      page.getByText("currentValue", { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await send(page, "settings", { mode: "source", wrapLines: false });
    await expect(
      page.getByText("currentValue", { exact: true }).filter({ visible: true }),
    ).toBeVisible();
  } finally {
    await page.close();
  }
});

test("shows a file created in this session against an empty baseline after unrecorded edits", async () => {
  const page = await openReview();
  try {
    await send(page, "workspace", {
      files,
      revision: "created-file",
      selectedPath: "file.ts",
      sidebarOpen: false,
      compact: true,
    });
    await send(page, "settings", { mode: "unified", wrapLines: false });
    await send(page, "document", {
      requestId: 1,
      document: {
        fullFileDiff: true,
        path: "file.ts",
        source: "one\nnew(value)\n",
        revision: "created-then-formatted",
        patches: [
          { kind: "add", diff: "one\nlong(\n value\n)\n" },
          { kind: "update", diff: "@@ -2 +2 @@\n-long(value)\n+new(value)\n" },
        ],
      },
    });
    await expect(page.getByText("new(value)", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Recorded edits could not be aligned with the current file"),
    ).toBeHidden();
    await expect(page.locator("#preview .pierre-preview-host:visible")).toHaveCount(1);
    await expect(page.getByText("long(value)", { exact: true })).toHaveCount(0);
  } finally {
    await page.close();
  }
});

test("does not stack recorded steps for a file created and deleted in one session", async () => {
  const page = await openReview();
  try {
    await send(page, "workspace", {
      files,
      revision: "created-deleted",
      selectedPath: "file.ts",
      sidebarOpen: false,
      compact: true,
    });
    await send(page, "settings", { mode: "unified", wrapLines: false });
    await send(page, "document", {
      requestId: 1,
      document: {
        displayState: "deleted",
        fullFileDiff: true,
        path: "file.ts",
        source: "",
        revision: "created-deleted-file",
        patches: [
          { kind: "add", diff: "firstVersion\n" },
          { kind: "update", diff: "@@ -1 +1 @@\n-firstVersion\n+secondVersion\n" },
          { kind: "delete", diff: "secondVersion\n" },
        ],
      },
    });
    await expect(page.getByText("No net changes", { exact: true })).toBeVisible();
    await expect(page.locator("#preview .pierre-preview-host:visible")).toHaveCount(0);
    await expect(page.getByText("firstVersion", { exact: true })).toHaveCount(0);
    await expect(page.getByText("secondVersion", { exact: true })).toHaveCount(0);
    await send(page, "settings", { mode: "source", wrapLines: false });
    await expect(page.getByText("No net changes", { exact: true })).toBeVisible();
  } finally {
    await page.close();
  }
});

test("does not present unaligned session steps as one file diff", async () => {
  const page = await openReview();
  try {
    await send(page, "workspace", {
      files,
      revision: "unaligned",
      selectedPath: "file.ts",
      sidebarOpen: false,
      compact: true,
    });
    await send(page, "settings", { mode: "unified", wrapLines: false });
    await send(page, "document", {
      requestId: 1,
      document: {
        fullFileDiff: true,
        path: "file.ts",
        source: "actualCurrentValue",
        revision: "unaligned-file",
        patches: [patch("oldValue", "otherValue")],
      },
    });
    await expect(page.getByText("Diff unavailable", { exact: true })).toBeVisible();
    await expect(page.locator("#preview .pierre-preview-host:visible")).toHaveCount(0);
    await expect(page.getByText("otherValue", { exact: true })).toHaveCount(0);
    await send(page, "settings", { mode: "source", wrapLines: false });
    await expect(page.getByText("actualCurrentValue", { exact: true })).toBeVisible();
  } finally {
    await page.close();
  }
});

test("renders suppressed blank context and retains authoritative line references", async () => {
  const page = await openReview();
  try {
    await send(page, "workspace", {
      files,
      revision: "files-blank",
      selectedPath: "file.ts",
      sidebarOpen: false,
      compact: true,
    });
    for (const mode of ["unified", "split"]) {
      await send(page, "settings", { mode, wrapLines: false });
      await send(page, "document", {
        requestId: 2,
        document: {
          path: "file.ts",
          source: "",
          revision: "blank-context",
          patches: [
            { kind: "update", diff: "@@ -20,3 +20,3 @@\n\n-beforeBlank\n+afterBlank\n \n" },
          ],
        },
      });
      await expect(page.getByText("beforeBlank", { exact: true })).toBeVisible();
      await expect(page.getByText("afterBlank", { exact: true })).toBeVisible();
      await page.locator('[data-column-number="21"][data-line-type="change-addition"]').click();
      await expect
        .poll(() =>
          page.evaluate(
            () => window.reviewEvents.filter((event) => event.type === "lineTap").at(-1)?.reference,
          ),
        )
        .toMatchObject({ path: "file.ts", line: 21, side: "new", coordinate: "file" });
    }
    assert.equal(
      await page.evaluate(() => window.reviewEvents.some((event) => event.type === "error")),
      false,
    );
  } finally {
    await page.close();
  }
});
