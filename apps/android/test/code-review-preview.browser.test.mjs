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

async function samePixels(page, first, second) {
  const sources = [first, second].map((png) => "data:image/png;base64," + png.toString("base64"));
  return page.evaluate(async (images) => {
    async function pixels(src) {
      const image = new Image();
      image.src = src;
      await image.decode();
      const context = new OffscreenCanvas(image.width, image.height).getContext("2d");
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, image.width, image.height);
    }
    const [before, after] = await Promise.all(images.map(pixels));
    return (
      before.width === after.width &&
      before.height === after.height &&
      before.data.every((value, index) => value === after.data[index])
    );
  }, sources);
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

// A short document must share the editor surface down to the bottom of the viewport.
async function expectFullHeightCanvas(page) {
  const pre = page.locator("#preview diffs-container pre:visible").first();
  await expect(pre).toBeVisible();
  const codeColor = await pre.evaluate((node) => getComputedStyle(node).backgroundColor);
  const canvas = await page.locator("#preview").evaluate((preview) => {
    const bounds = preview.getBoundingClientRect();
    return {
      color: getComputedStyle(preview).backgroundColor,
      reachesBottom: Math.abs(bounds.bottom - innerHeight) < 1,
    };
  });
  assert.deepEqual(canvas, { color: codeColor, reachesBottom: true });
}

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
    await expectFullHeightCanvas(page);
    await send(page, "settings", { mode: "source", wrapLines: false });
    await expect(
      page.getByText("currentValue", { exact: true }).filter({ visible: true }),
    ).toBeVisible();
    await expectFullHeightCanvas(page);
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
        .toMatchObject({
          path: "file.ts",
          line: 21,
          side: "new",
          coordinate: "file",
          context: "afterBlank",
        });
    }
    assert.equal(
      await page.evaluate(() => window.reviewEvents.some((event) => event.type === "error")),
      false,
    );
  } finally {
    await page.close();
  }
});

test("anchors a tapped line for the native composer and draws pending and refused comments", async () => {
  const page = await openReview();
  try {
    await send(page, "workspace", {
      files,
      revision: "comment-states",
      selectedPath: "file.ts",
      sidebarOpen: false,
      compact: true,
    });
    await send(page, "settings", { mode: "unified", wrapLines: false });
    await send(page, "document", {
      requestId: 3,
      document: {
        path: "file.ts",
        source: "",
        revision: "comment-states",
        patches: [patch("before", "after")],
      },
    });
    await expect(page.getByText("after", { exact: true })).toBeVisible();
    await page.locator('[data-column-number="20"][data-line-type="change-addition"]').click();
    await expect
      .poll(() =>
        page.evaluate(
          () => window.reviewEvents.filter((event) => event.type === "lineTap").at(-1)?.reference,
        ),
      )
      .toMatchObject({ path: "file.ts", line: 20, side: "new", context: "after" });
    // The native line composer is the only one: the document never grows an inline editor.
    await expect(page.locator("textarea")).toHaveCount(0);

    await send(page, "comments", [
      {
        body: "Saving this",
        id: "pending",
        line: 20,
        path: "file.ts",
        side: "new",
        state: "pending",
      },
      {
        body: "Refused text",
        error: "The line is outside the diff",
        id: "failed",
        line: 20,
        path: "file.ts",
        side: "new",
        state: "failed",
      },
    ]);
    const pending = page.locator('.review-comment[data-state="pending"]');
    await expect(pending).toHaveText("Saving this");
    await expect(pending).toHaveAttribute("aria-busy", "true");
    const failed = page.locator('.review-comment[data-state="failed"]');
    await expect(failed.locator(".review-comment-body")).toHaveText("Refused text");
    await expect(failed.getByRole("alert")).toHaveText("The line is outside the diff");

    await send(page, "selection", null);
    await expect(page.locator("textarea")).toHaveCount(0);
    assert.equal(
      await page.evaluate(() => window.reviewEvents.some((event) => event.type === "error")),
      false,
    );
  } finally {
    await page.close();
  }
});

test("a long filename has its settled appearance when scrolled into view", async () => {
  const page = await openReview();
  try {
    await page.setViewportSize({ width: 720, height: 650 });
    const basename = "WorkspaceNotificationPreferences.tsx";
    const target = "src/notifications/" + basename;
    const paths = Array.from({ length: 80 }, (_, i) => "src/notifications/Channel" + i + ".ts");
    paths.push(target);
    const workspace = {
      compact: false,
      files: paths.map((path) => ({ ...files[0], path, treePath: path })),
      revision: "long-filenames",
      sidebarOpen: true,
    };
    await send(page, "workspace", { ...workspace, selectedPath: paths[0] });
    await expect(page.getByRole("treeitem", { name: "Channel0.ts" })).toBeVisible();
    const row = page.getByRole("treeitem", { name: basename });
    await expect(row).toHaveCount(0);

    // Hold the first painted state independently of how long a screenshot takes on CI.
    const session = await page.context().newCDPSession(page);
    await session.send("Animation.enable");
    await session.send("Animation.setPlaybackRate", { playbackRate: 0 });
    await send(page, "workspace", { ...workspace, selectedPath: target });
    await expect(row).toBeInViewport();
    const firstPaint = await row.screenshot();
    await session.send("Animation.setPlaybackRate", { playbackRate: 1 });
    await row.evaluate(async (element) => {
      const animations = element.getAnimations({ subtree: true });
      await Promise.all(animations.map((animation) => animation.finished));
    });
    const settled = await row.screenshot();
    assert.ok(await samePixels(page, firstPaint, settled), "the visible filename should not flash");
  } finally {
    await page.close();
  }
});

test("keeps file navigation available in the mobile sheet and beside a pending diff", async () => {
  const page = await openReview();
  try {
    const items = [
      "src/ui/index.ts",
      "tests/ui/index.ts",
      "src/ui/NotificationPreferencesForTheCurrentWorkspace.test.tsx",
    ].map((path) => ({ ...files[0], path, treePath: path }));
    let state = {
      files: items,
      selectedPath: items[0].path,
      revision: "sidebar-files",
      compact: true,
      sidebarOpen: false,
    };
    const update = async (next) => {
      state = { ...state, ...next };
      await send(page, "workspace", state);
    };
    const lastOpen = () =>
      page.evaluate(() => window.reviewEvents.filter((e) => e.type === "filesOpen").at(-1)?.open);
    await update({});
    await update({ sidebarOpen: true });
    const dialog = page.getByRole("dialog", { name: "Changed files" });
    await expect(dialog).toBeVisible();
    assert.equal(await dialog.evaluate((d) => d.matches(":modal")), true);
    await expect(dialog.getByText("Files", { exact: true })).toHaveCount(0);
    const longName = dialog.getByRole("treeitem", {
      name: "NotificationPreferencesForTheCurrentWorkspace.test.tsx",
    });
    await expect(longName).toBeVisible();
    const duplicate = dialog.locator('[role="treeitem"][data-item-path="tests/ui/index.ts"]');
    const shortName = dialog.locator('[data-item-path="src/ui/index.ts"]');
    assert.equal(
      await longName.evaluate((row) => row.clientHeight),
      await shortName.evaluate((row) => row.clientHeight),
      "a long name occupies the same single row as a short name",
    );
    await update({
      files: items.map((file) =>
        file === items[2] ? { ...file, review: { drafts: 2, viewed: true } } : file,
      ),
    });
    await expect(longName).toContainText("✎2 ✓");
    await dialog.getByRole("treeitem", { name: "tests / ui" }).click();
    await expect(duplicate).toHaveCount(0);
    const filter = dialog.getByRole("searchbox", { name: "Filter changed files" });
    await filter.fill("Tests/UI/index");
    await expect(filter).toHaveValue("Tests/UI/index");
    await expect(duplicate).toBeVisible();
    await expect(longName).toHaveCount(0);
    await filter.fill("missing path");
    await expect(dialog.getByText("No matching files")).toBeVisible();
    await expect(dialog.getByRole("tree")).toBeHidden();
    await filter.fill("");
    await expect(duplicate).toHaveCount(0);
    await dialog.press("Escape");
    assert.equal(await lastOpen(), false);
    await update({ sidebarOpen: false });
    await expect(dialog).toHaveCount(0);
    await page.setViewportSize({ width: 740, height: 650 });
    await update({ compact: false });
    await update({ sidebarOpen: true });
    assert.equal(await dialog.evaluate((d) => d.matches(":modal")), false);
    await expect(filter).toBeVisible();
    await expect(filter).not.toBeFocused();
    await filter.fill("index");
    await send(page, "document", { requestId: 2, document: null });
    await update({ selectedPath: items[1].path });
    await expect(filter).toHaveValue("index");
    await expect(dialog.getByText("Loading file…")).toHaveCount(0);
    await expect(page.locator("#preview-panel").getByText("Loading file…")).toBeVisible();
    for (const [width, expected] of [[740, 320], [1200, 408], [1600, 480]]) {
      await page.setViewportSize({ width, height: 650 });
      const tree = await dialog.boundingBox();
      const diff = await page.locator("#preview-panel").boundingBox();
      assert.equal(tree.width, expected);
      assert.equal(diff.x, expected);
      assert.equal(diff.width, width - expected);
    }
    await update({ sidebarOpen: false });
    await expect(dialog).toHaveCount(0);
    assert.equal((await page.locator("#preview-panel").boundingBox()).x, 0);
  } finally {
    await page.close();
  }
});
