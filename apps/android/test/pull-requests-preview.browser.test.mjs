// Renders the real Pull requests surfaces in React Native Web over a fake companion that answers
// with wire-contract fixtures, then checks layout and write invariants at phone and tablet widths.
// Set PULL_REQUEST_CAPTURE_DIR to also save one screenshot per frame for visual review.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const requireAndroid = createRequire(new URL("../package.json", import.meta.url));
const { build } = requireAndroid("esbuild");
const androidRoot = fileURLToPath(new URL("../", import.meta.url));
const captureDir = process.env.PULL_REQUEST_CAPTURE_DIR;
let browser;
let script;

before(async () => {
  const bundle = await build({
    absWorkingDir: androidRoot,
    entryPoints: ["test/fixtures/pullRequestPreview.tsx"],
    alias: { "react-native": "react-native-web" },
    resolveExtensions: [
      ".web.tsx",
      ".web.ts",
      ".web.jsx",
      ".web.js",
      ".tsx",
      ".ts",
      ".jsx",
      ".js",
      ".json",
    ],
    mainFields: ["browser", "module", "main"],
    conditions: ["browser", "import", "default"],
    bundle: true,
    define: {
      "process.env.NODE_ENV": '"production"',
      __DEV__: "false",
      global: "globalThis",
      "process.env.EXPO_OS": '"web"',
    },
    format: "iife",
    jsx: "automatic",
    loader: { ".ttf": "dataurl", ".png": "dataurl", ".xml": "text", ".html": "text", ".js": "jsx" },
    platform: "browser",
    write: false,
    logLevel: "error",
    plugins: [
      {
        name: "web-preview-boundaries",
        setup(builder) {
          // Expo Font's server-rendering context is unused in a browser preview.
          builder.onResolve({ filter: /^node:async_hooks$/ }, () => ({
            path: "async_hooks",
            namespace: "stub",
          }));
          builder.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
            contents:
              "export class AsyncLocalStorage { getStore() { return undefined; } run(_s, f) { return f(); } }",
            loader: "js",
          }));
          // Process-lifetime forge owners bind to the native session supervisor; the preview
          // substitutes the same owners over its fake companion.
          builder.onResolve({ filter: /\/data\/forgeRuntime$/ }, () => ({
            path: fileURLToPath(new URL("./fixtures/previewForgeRuntime.ts", import.meta.url)),
          }));
          // The shipped sheet is Android's Material sheet; the preview mirrors its geometry
          // instead of the web fallback's extra insets and uncapped height.
          builder.onResolve({ filter: /\/ui\/AppSheet$/ }, () => ({
            path: fileURLToPath(new URL("./fixtures/previewAppSheet.tsx", import.meta.url)),
          }));
          builder.onResolve({ filter: /^react-native-svg$/ }, () => ({
            path: requireAndroid.resolve("react-native-svg/lib/module/ReactNativeSVG.web.js"),
          }));
        },
      },
    ],
  });
  script = bundle.outputFiles[0].text;
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
});

async function open(scenario, width, height = 780) {
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { height, width } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // A web textarea defaults to two rows; Android sizes a multiline field to its content.
  await page.setContent(
    '<style>html,body{margin:0;background:#0F0F0F}textarea{field-sizing:content}</style><div id="app"></div>',
  );
  await page.evaluate((name) => {
    window.previewScenario = name;
    window.process = { env: { EXPO_OS: "web", NODE_ENV: "production" } };
    // about:blank is not a secure context, so the page lacks crypto.randomUUID.
    crypto.randomUUID ??= () =>
      "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
        (
          Number(c) ^
          (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))
        ).toString(16),
      );
  }, scenario);
  await page.addScriptTag({ content: script });
  await page.waitForTimeout(600);
  return { errors, page };
}

/** Sheets animate in from below; frames are taken at rest. */
async function settle(page) {
  await page.waitForTimeout(1200);
}

async function openGithubProvider(page) {
  await page.getByText("Connect a provider", { exact: true }).click();
  // React Native Web keeps the animated sheet layer above the row's hit target;
  // dispatching the event exercises the same handler without a web-only pointer hit test.
  await page.getByTestId("forge-provider-row-github").dispatchEvent("click");
  await page.getByTestId("forge-provider-card-github").waitFor();
}

async function capture(page, name) {
  if (captureDir !== undefined) {
    mkdirSync(captureDir, { recursive: true });
    await page.screenshot({ path: `${captureDir}/${name}.png` });
  }
}

/** Compact controls never wrap or leave the viewport (N-05/N-06). */
async function assertControlsFit(page, width) {
  const offenders = await page.evaluate((viewportWidth) => {
    const controls = [...document.querySelectorAll('[role="button"],[role="tab"]')];
    return controls
      .filter(
        (node) =>
          node.offsetParent !== null &&
          node.closest('[data-testid="pull-request-category-strip"]') === null,
      )
      .map((node) => ({
        label: node.getAttribute("aria-label") ?? "unlabelled",
        rect: node.getBoundingClientRect(),
        text: node.textContent ?? "",
      }))
      .filter(({ rect }) => rect.width > 0 && (rect.right > viewportWidth + 1 || rect.left < -1))
      .map(({ label, text }) => (text.length > 0 ? text : label));
  }, width);
  assert.deepEqual(
    offenders.filter((text) => text.length > 0),
    [],
  );
}

for (const width of [320, 360, 1024]) {
  for (const scenario of ["list", "onboarding", "onboarding-flow", "onboarding-failed", "pr"]) {
    test(`${scenario} at ${width}dp renders without errors and keeps controls inside`, async () => {
      const { errors, page } = await open(scenario, width);
      try {
        assert.deepEqual(errors, []);
        await assertControlsFit(page, width);
        await capture(page, `${scenario}-${width}`);
      } finally {
        await page.close();
      }
    });
  }
}

test("the welcome action opens the server-declared provider tray", async () => {
  const { errors, page } = await open("onboarding", 360);
  try {
    await page.getByText("Connect a provider", { exact: true }).click();
    await page.getByTestId("forge-provider-row-github").waitFor();
    await page.getByTestId("forge-provider-row-arcanum").waitFor();
    await settle(page);
    assert.deepEqual(errors, []);
    await capture(page, "onboarding-provider-tray-360");
  } finally {
    await page.close();
  }
});

test("a stale head writes once, shows the banner and keeps the screen", async () => {
  const { errors, page } = await open("pr", 360);
  try {
    await page.getByText("Update branch", { exact: true }).first().click();
    await page.waitForTimeout(500);
    // The confirmation's action is the last "Update branch"; the web sheet animates in from below.
    await page.getByText("Update branch", { exact: true }).last().dispatchEvent("click");
    await page.getByText("PR changed since this screen loaded", { exact: false }).waitFor();
    const writes = await page.evaluate(() => window.previewWrites);
    assert.equal(writes.length, 1);
    assert.match(writes[0], /"confirmation":"confirm".*"headRevision":"3fa9e12"/u);
    assert.deepEqual(errors, []);
    await capture(page, "pr-stale-360");
  } finally {
    await page.close();
  }
});

test("opening files, the guide and Submit writes nothing to the forge", async () => {
  const { page } = await open("pr", 360);
  try {
    await page.getByTestId("pull-request-tab-changes").click();
    await capture(page, "pr-changes-files-360");
    await page.getByTestId("changes-view-guide").click();
    await page.getByTestId("review-guide-strip").waitFor();
    await capture(page, "pr-changes-guide-360");
    await page.getByTestId("review-dock-submit").click();
    await page.getByTestId("submit-review-sheet").waitFor();
    await settle(page);
    await capture(page, "pr-submit-360");
    assert.deepEqual(await page.evaluate(() => window.previewWrites), []);
  } finally {
    await page.close();
  }
});

for (const scenario of [
  "offline",
  "companion-old",
  "onboarding-failed",
  "conflict",
  "checks-unavailable",
]) {
  test(`${scenario} renders its degraded state in place`, async () => {
    const { errors, page } = await open(scenario, 360);
    try {
      assert.deepEqual(errors, []);
      const expected = {
        "checks-unavailable": "No Arc CI token",
        "companion-old": "Update the companion",
        "onboarding-failed": "did not finish",
        conflict: "Conflicts with main",
        offline: "Offline · last updated",
      }[scenario];
      if (scenario === "onboarding-failed") {
        await openGithubProvider(page);
        await page
          .getByTestId("forge-provider-card-github")
          .getByRole("button", { name: "Sign in with GitHub" })
          .dispatchEvent("click");
      }
      await page.getByText(expected, { exact: false }).first().waitFor();
      await capture(page, `${scenario}-360`);
    } finally {
      await page.close();
    }
  });
}

test("thread rows show the PR badge with its provider mark and +N", async () => {
  const { errors, page } = await open("thread-badge", 360, 320);
  try {
    await page.getByText("#91", { exact: true }).waitFor();
    await page.getByText("#4120 +1", { exact: true }).waitFor();
    assert.equal(await page.getByTestId("thread-pull-request-badge").count(), 2);
    assert.deepEqual(errors, []);
    await capture(page, "thread-badge-360");
  } finally {
    await page.close();
  }
});

test("Accounts sheet shows connected, expired and error accounts", async () => {
  const { errors, page } = await open("accounts", 360);
  try {
    await page.getByText("ghe.example.com", { exact: false }).first().waitFor();
    await settle(page);
    assert.deepEqual(errors, []);
    await capture(page, "accounts-sheet-360");
  } finally {
    await page.close();
  }
});

test("the PR tab counts only connected review requests", async () => {
  for (const [scenario, expected] of [
    ["list", "Pull requests 2"],
    ["onboarding", "Pull requests"],
    ["companion-old", "Pull requests"],
  ]) {
    const { page } = await open(scenario, 360);
    try {
      const label = await page
        .getByRole("tab", { name: /^Pull requests/ })
        .getAttribute("aria-label");
      assert.equal(label, expected, scenario);
    } finally {
      await page.close();
    }
  }
});

test("Accounts sheet at 1024dp", async () => {
  const { errors, page } = await open("accounts", 1024);
  try {
    await page.getByText("ghe.example.com", { exact: false }).first().waitFor();
    await settle(page);
    assert.deepEqual(errors, []);
    await capture(page, "accounts-sheet-1024");
  } finally {
    await page.close();
  }
});

for (const width of [360, 1024]) {
  test(`Paste a token opens its sheet at ${width}dp`, async () => {
    const { errors, page } = await open("onboarding", width);
    try {
      await openGithubProvider(page);
      await settle(page);
      await capture(page, `onboarding-provider-github-${width}`);
      await page
        .getByTestId("forge-provider-card-github")
        .getByRole("button", { name: "Paste a token" })
        .dispatchEvent("click");
      await page.getByTestId("forge-tray-token-panel").waitFor();
      await settle(page);
      assert.deepEqual(errors, []);
      await capture(page, `token-sheet-${width}`);
    } finally {
      await page.close();
    }
  });

  test(`the comment sheet explains Agent, PR and Both at ${width}dp`, async () => {
    const { errors, page } = await open("pr", width);
    try {
      await page.getByTestId("pull-request-tab-changes").click();
      await page.getByTestId("changes-view-guide").click();
      await page
        .getByTestId("review-guide-stop-actions")
        .getByText("Comment", { exact: true })
        .click();
      await page.getByTestId("review-comment-sheet").waitFor();
      await settle(page);
      await capture(page, `comment-sheet-${width}`);
      await page.getByTestId("review-comment-sheet").getByText("Both", { exact: true }).click();
      await capture(page, `comment-sheet-both-${width}`);
      assert.deepEqual(errors, []);
      assert.deepEqual(await page.evaluate(() => window.previewWrites), []);
    } finally {
      await page.close();
    }
  });
}

test("a host login in progress keeps the card in its connecting state", async () => {
  const { errors, page } = await open("onboarding-connecting", 360);
  try {
    await openGithubProvider(page);
    await page
      .getByTestId("forge-provider-card-github")
      .getByRole("button", { name: "Sign in with GitHub" })
      .dispatchEvent("click");
    await page.waitForTimeout(300);
    const writes = await page.evaluate(() => window.previewWrites);
    assert.equal(
      writes.filter((write) => write.startsWith("companion/forge/auth/start")).length,
      1,
    );
    assert.deepEqual(errors, []);
    await capture(page, "onboarding-connecting-360");
  } finally {
    await page.close();
  }
});

test("Submit publishes once and the dock reports the outcome", async () => {
  const { errors, page } = await open("submit-ok", 360);
  try {
    await page.getByTestId("pull-request-tab-changes").click();
    await page.getByTestId("review-dock-submit").click();
    await page.getByTestId("submit-review-sheet").waitFor();
    await settle(page);
    await page
      .getByTestId("submit-review-sheet")
      .getByText("Submit review · Approve", { exact: true })
      .click();
    await page.getByTestId("review-dock-outcome").waitFor();
    await settle(page);
    const writes = await page.evaluate(() => window.previewWrites);
    assert.equal(
      writes.filter((write) => write.startsWith("companion/pullRequest/review/submit")).length,
      1,
    );
    await page.getByText("View on forge", { exact: true }).waitFor();
    await page.getByText("Approved on github.com", { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await capture(page, "submit-result-360");
  } finally {
    await page.close();
  }
});

test("the PR chat action resolves the branch-linked canonical thread", async () => {
  const { errors, page } = await open("pr", 360);
  try {
    const action = page.getByTestId("pull-request-linked-chat");
    assert.equal(
      await action.getAttribute("aria-label"),
      "Open linked review chat: Forge auth state",
    );
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
});

test("keyboard focus draws the N-04 ring on PR actions", async () => {
  const { page } = await open("pr", 360);
  try {
    await page.getByTestId("catalog-action-review").focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await page.waitForTimeout(200);
    await capture(page, "focus-ring-360");
  } finally {
    await page.close();
  }
});
