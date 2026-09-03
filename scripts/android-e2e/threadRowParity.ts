import { readFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";

import type { AppServerClient } from "./appServerClient.ts";
import type { AppiumBrowser } from "./ui.ts";

const POLL_INTERVAL_MS = 250;
const CATALOG_FIXTURE_ROW_COUNT = 40;

type Generation = "v1" | "v2";
type Layout = "phone" | "wide";
type ThreadState = "failed" | "running" | "waitingForApproval" | "waitingForInput";
type CatalogPageFaultState = "armed" | "intercepted" | "released" | "timedOut" | "triggered";

type CatalogPageFaultStatus = {
  faultId: string;
  state: CatalogPageFaultState;
};

type ThreadFixture = {
  id: string;
  preview: string | null;
  title: string;
  turnId: string | null;
};

export type ThreadRowParityFixture = {
  approval: ThreadFixture;
  catalogPageAnchor: Pick<ThreadFixture, "id" | "title">;
  catalogRows: ThreadFixture[];
  commonQuery: string;
  failed: ThreadFixture;
  running: ThreadFixture;
  unread: ThreadFixture;
  waitingInput: ThreadFixture;
};

type CaptureRow = (
  rowId: string,
  state: string,
  assertExactState: () => Promise<void>,
) => Promise<void>;

type CaptureThreadRowParityInput = {
  appServer: AppServerClient;
  capture: CaptureRow;
  disconnect(): Promise<void>;
  driver: AppiumBrowser;
  fixture: ThreadRowParityFixture;
  faultControl: ThreadRowParityFaultControl;
  generation: Generation;
  layout: Layout;
  reconnect(): Promise<void>;
  resetCatalog(): Promise<void>;
  timeoutMs: number;
};

export interface ThreadRowParityFaultControl {
  endpoint: string;
  tokenFile: string;
}

/** Creates only real App Server states consumed by the paired device run. */
export async function createThreadRowParityFixture(
  appServer: AppServerClient,
  workspace: string,
  nonce: string,
  timeoutMs: number,
): Promise<ThreadRowParityFixture> {
  const suffix = nonce.slice(-8);
  const commonQuery = `Row parity ${suffix}`;
  const stateQuery = `${commonQuery} state`;

  const running = await createFixtureThread(
    appServer,
    workspace,
    `${stateQuery} running`,
    "never",
    "Call the shell tool exactly once with `sleep 3600`. Wait for it to finish before replying.",
  );
  running.turnId = await startFixtureTurn(
    appServer,
    running.id,
    `ROW_RUNNING_${nonce}`,
    `row-running-${nonce}`,
  );
  await waitForThreadState(appServer, running.id, "running", timeoutMs);

  const approval = await createFixtureThread(
    appServer,
    workspace,
    `${stateQuery} approval`,
    "on-request",
    "Call the shell tool exactly once with `true` and explicitly request elevated execution. Do not continue until the user answers the approval request.",
    "read-only",
  );
  approval.turnId = await startFixtureTurn(
    appServer,
    approval.id,
    `ROW_APPROVAL_${nonce}`,
    `row-approval-${nonce}`,
  );
  await waitForThreadState(appServer, approval.id, "waitingForApproval", timeoutMs);
  await appServer.waitForThreadNotification(
    "item/commandExecution/requestApproval",
    approval.id,
    timeoutMs,
    (params) => params.turnId === approval.turnId,
  );

  const waitingInput = await createFixtureThread(
    appServer,
    workspace,
    `${stateQuery} input`,
    "never",
    "Call the shell tool exactly once with `sleep 3600`. Wait for it to finish before replying.",
  );
  waitingInput.turnId = await startFixtureTurn(
    appServer,
    waitingInput.id,
    `ROW_INPUT_${nonce}`,
    `row-input-${nonce}`,
  );
  await waitForThreadState(appServer, waitingInput.id, "running", timeoutMs);
  const elicitation = await appServer.request("thread/increment_elicitation", {
    threadId: waitingInput.id,
  });
  if (
    !isRecord(elicitation) ||
    elicitation.paused !== true ||
    typeof elicitation.count !== "number" ||
    elicitation.count < 1
  ) {
    throw new Error("App Server did not activate the waiting-input fixture");
  }
  await waitForThreadState(appServer, waitingInput.id, "waitingForInput", timeoutMs);

  const failed = await createFixtureThread(
    appServer,
    workspace,
    `${stateQuery} failed`,
    "never",
    "Reply exactly FAILURE_FIXTURE_SHOULD_NOT_COMPLETE.",
  );
  failed.turnId = await startFixtureTurn(
    appServer,
    failed.id,
    `ROW_FAILED_${nonce}`,
    `row-failed-${nonce}`,
    `invalid-e2e-model-${suffix}`,
  );
  await waitForThreadState(appServer, failed.id, "failed", timeoutMs);

  const unreadReply = `ROW_UNREAD_REPLY_${nonce}`;
  const unread = await createFixtureThread(
    appServer,
    workspace,
    `${stateQuery} unread`,
    "never",
    `Reply exactly ${unreadReply}. Do not call tools.`,
  );
  unread.turnId = await startFixtureTurn(
    appServer,
    unread.id,
    `ROW_UNREAD_${nonce}`,
    `row-unread-${nonce}`,
  );
  await appServer.waitForAgentText(unread.id, unreadReply, timeoutMs);
  unread.preview = unreadReply;

  const catalogPageAnchor = await createArchivedCatalogThread(
    appServer,
    workspace,
    `${commonQuery} catalog anchor`,
  );
  const catalogRows: ThreadFixture[] = [];
  for (let index = 0; index < CATALOG_FIXTURE_ROW_COUNT; index += 1) {
    catalogRows.push(
      await createArchivedCatalogThread(
        appServer,
        workspace,
        `${commonQuery} catalog ${String(index + 1).padStart(2, "0")}`,
      ),
    );
  }
  await assertAuthoritativeCatalogBoundary(appServer, catalogPageAnchor, catalogRows);

  return {
    approval,
    catalogPageAnchor,
    catalogRows,
    commonQuery,
    failed,
    running,
    unread,
    waitingInput,
  };
}

/** Captures dedicated row states; every transient is asserted against live App Server authority. */
export async function captureThreadRowParityStates(
  input: CaptureThreadRowParityInput,
): Promise<void> {
  await assertFixtureOrder(input);
  await captureStateRow(input, "ROW-02", "running-thread-row", input.fixture.running, "running");
  await captureStateRow(
    input,
    "ROW-03",
    "approval-needed-thread-row",
    input.fixture.approval,
    "waitingForApproval",
  );
  await captureStateRow(
    input,
    "ROW-04",
    "waiting-input-row-policy",
    input.fixture.waitingInput,
    "waitingForInput",
  );
  await captureStateRow(input, "ROW-05", "failed-thread-row", input.fixture.failed, "failed");
  await captureUnreadRow(input);
  await capturePressedRow(input);
  await captureLongPressMenu(input);
  await captureRetainedRow(input);
  await captureCatalogLoadingMore(input);
  if (input.layout === "phone") await captureSwipeActions(input);
  await clearSearch(input.driver);
}

export async function cleanupThreadRowParityFixture(
  appServer: AppServerClient,
  fixture: ThreadRowParityFixture,
): Promise<void> {
  await appServer
    .request("thread/decrement_elicitation", { threadId: fixture.waitingInput.id })
    .catch(() => undefined);
  for (const thread of [fixture.running, fixture.approval, fixture.waitingInput]) {
    if (thread.turnId !== null) {
      await appServer
        .request("turn/interrupt", { threadId: thread.id, turnId: thread.turnId })
        .catch(() => undefined);
    }
  }
  await appServer
    .request("thread/delete", { threadId: fixture.catalogPageAnchor.id })
    .catch(() => undefined);
  for (const thread of fixture.catalogRows) {
    await appServer.request("thread/delete", { threadId: thread.id }).catch(() => undefined);
  }
}

async function captureStateRow(
  input: CaptureThreadRowParityInput,
  rowId: string,
  suffix: string,
  fixture: ThreadFixture,
  state: ThreadState,
): Promise<void> {
  await showOnlyThread(input.driver, fixture);
  await input.capture(rowId, `${input.layout}-${suffix}`, async () => {
    await waitForThreadState(input.appServer, fixture.id, state, input.timeoutMs);
    const row = await displayedThreadRow(input, fixture);
    if (state === "running") await assertRunningIndicator(input);
    else await assertThreadStateAccessibility(input, row, state);
  });
}

async function captureUnreadRow(input: CaptureThreadRowParityInput): Promise<void> {
  await showOnlyThread(input.driver, input.fixture.unread);
  await input.capture("ROW-06", `${input.layout}-unread-thread-row`, async () => {
    await displayedThreadRow(input, input.fixture.unread);
    const unread = await input.driver.$(
      'android=new UiSelector().descriptionMatches("[1-9][0-9]* unread messages?")',
    );
    await unread.waitForDisplayed({ timeout: input.timeoutMs, interval: POLL_INTERVAL_MS });
  });
}

async function capturePressedRow(input: CaptureThreadRowParityInput): Promise<void> {
  await showOnlyThread(input.driver, input.fixture.unread);
  const row = await displayedThreadRow(input, input.fixture.unread);
  const [height, width, x, y] = await Promise.all([
    row.getSize("height"),
    row.getSize("width"),
    row.getLocation("x"),
    row.getLocation("y"),
  ]);
  await input.driver
    .action("pointer", { parameters: { pointerType: "touch" } })
    .move({ duration: 0, x: x + Math.floor(width / 2), y: y + Math.floor(height / 2) })
    .down({ button: 0 })
    .perform(true);
  try {
    await input.capture("ROW-08", `${input.layout}-pressed-thread-row`, async () => {
      await displayedThreadRow(input, input.fixture.unread);
    });
    await input.capture("INT-02", `${input.layout}-thread-row-pressed`, async () => {
      await displayedThreadRow(input, input.fixture.unread);
    });
  } finally {
    await input.driver
      .action("pointer", { parameters: { pointerType: "touch" } })
      .move({ duration: 100, x: Math.max(1, x - 24), y: Math.max(1, y - 24) })
      .up({ button: 0 })
      .perform();
    await input.driver.releaseActions();
  }
  await displayedThreadRow(input, input.fixture.unread);
}

async function captureLongPressMenu(input: CaptureThreadRowParityInput): Promise<void> {
  await showOnlyThread(input.driver, input.fixture.unread);
  const row = await displayedThreadRow(input, input.fixture.unread);
  await input.driver.execute("mobile: longClickGesture", {
    duration: 700,
    elementId: row.elementId,
  });
  await input.capture("ROW-10", `${input.layout}-thread-long-press-menu`, async () => {
    const actions: Array<{ label: string; y: number }> = [];
    for (const label of ["Copy session ID", "Pin", "Mark as read", "Archive"]) {
      const action = await input.driver.$(`android=new UiSelector().text("${label}")`);
      await action.waitForDisplayed({ timeout: input.timeoutMs, interval: POLL_INTERVAL_MS });
      if (!(await action.isEnabled())) throw new Error(`Thread action ${label} is disabled`);
      actions.push({ label, y: await action.getLocation("y") });
    }
    assertIncreasingCoordinates(actions, "long-press menu", "y");
  });
  await input.driver.back();
  await displayedThreadRow(input, input.fixture.unread);
}

async function captureSwipeActions(input: CaptureThreadRowParityInput): Promise<void> {
  await showOnlyThread(input.driver, input.fixture.unread);
  await swipeThread(input, "left");
  await input.capture("ROW-11", "phone-thread-swipe-left-actions", () =>
    assertSwipeActions(input.driver, input.timeoutMs),
  );
  await swipeThread(input, "right");
  await input.capture("ROW-12", "phone-thread-swipe-actions-dismissed", async () => {
    await waitForSwipeActionsHidden(input.driver, input.timeoutMs);
    await displayedThreadRow(input, input.fixture.unread);
  });
}

async function captureRetainedRow(input: CaptureThreadRowParityInput): Promise<void> {
  await showOnlyThread(input.driver, input.fixture.unread);
  await input.disconnect();
  try {
    await input.capture("ROW-09", `${input.layout}-retained-thread-row`, async () => {
      await displayedThreadRow(input, input.fixture.unread);
      if (input.fixture.unread.preview === null) {
        throw new Error("Retained row fixture has no authoritative preview");
      }
      await waitForVisibleUiText(input.driver, input.fixture.unread.preview, input.timeoutMs);
      if (input.generation === "v1") {
        const connecting = await input.driver.$("~Connecting");
        await connecting.waitForDisplayed({
          timeout: input.timeoutMs,
          interval: POLL_INTERVAL_MS,
        });
      } else {
        await waitForVisibleUiText(input.driver, "Connecting", input.timeoutMs);
      }
    });
  } finally {
    await input.reconnect();
  }
}

async function captureCatalogLoadingMore(input: CaptureThreadRowParityInput): Promise<void> {
  await input.resetCatalog();
  await clearSearch(input.driver);
  await openArchivedCatalog(input.driver, input.timeoutMs);
  const pendingPageAnchor = input.fixture.catalogRows[0];
  if (pendingPageAnchor === undefined) {
    throw new Error("Catalog paging fixture has no run-bound pre-page row");
  }
  try {
    await assertAuthoritativeCatalogBoundary(
      input.appServer,
      input.fixture.catalogPageAnchor,
      input.fixture.catalogRows,
    );
    const loading = await catalogLoadingIndicator(input.driver);
    if (input.generation === "v1") {
      await scrollUntilThreadDisplayed(
        input.driver,
        input.fixture.catalogPageAnchor,
        input.timeoutMs,
      );
      await input.capture("LIST-21", `${input.layout}-catalog-loading-more-policy`, async () => {
        await displayedThreadTitle(input.driver, input.fixture.catalogPageAnchor, input.timeoutMs);
        const source = await input.driver.getPageSource();
        if (!source.includes(pendingPageAnchor.title)) {
          throw new Error(
            `V1 local catalog-page artifact has no exact run-bound row ${pendingPageAnchor.title}`,
          );
        }
        if (await loading.isDisplayed().catch(() => false)) {
          throw new Error("V1 local SQLite catalog paging unexpectedly exposes Loading threads…");
        }
      });
      await captureCatalogPageResult(input, loading);
      return;
    }
    await captureHeldV2CatalogPage(input, pendingPageAnchor, loading);
  } finally {
    await closeArchivedCatalog(input.driver, input.timeoutMs);
  }
}

async function captureHeldV2CatalogPage(
  input: CaptureThreadRowParityInput,
  pendingPageAnchor: ThreadFixture,
  loading: Awaited<ReturnType<typeof catalogLoadingIndicator>>,
): Promise<void> {
  const hold = await armCatalogPageHold(input.faultControl);
  let released = false;
  try {
    await scrollCatalogUntil(
      input.driver,
      async () => {
        const state = await readCatalogPageHold(input.faultControl, hold.faultId);
        return state === "intercepted";
      },
      input.timeoutMs,
    );
    await waitForCatalogPageHold(input.faultControl, hold.faultId, "intercepted", input.timeoutMs);
    await input.capture("LIST-21", `${input.layout}-catalog-loading-more-policy`, async () => {
      const source = await input.driver.getPageSource();
      if (!source.includes(pendingPageAnchor.title)) {
        throw new Error(
          `Held catalog-page artifact has no exact run-bound row ${pendingPageAnchor.title}`,
        );
      }
      await loading.waitForDisplayed({ timeout: input.timeoutMs, interval: 50 });
    });
    await releaseCatalogPageHold(input.faultControl, hold.faultId);
    released = true;
    await waitForElementHidden(loading, input.timeoutMs);
    await scrollUntilThreadDisplayed(
      input.driver,
      input.fixture.catalogPageAnchor,
      input.timeoutMs,
    );
    await captureCatalogPageResult(input, loading);
  } finally {
    if (!released) {
      await releaseCatalogPageHold(input.faultControl, hold.faultId).catch(() => undefined);
    }
  }
}

async function captureCatalogPageResult(
  input: CaptureThreadRowParityInput,
  loading: Awaited<ReturnType<typeof catalogLoadingIndicator>>,
): Promise<void> {
  await input.capture("LIST-21", `${input.layout}-catalog-page-result`, async () => {
    await displayedThreadTitle(input.driver, input.fixture.catalogPageAnchor, input.timeoutMs);
    const source = await input.driver.getPageSource();
    if (!source.includes(input.fixture.catalogPageAnchor.title)) {
      throw new Error("Catalog page result does not expose the exact shared anchor title");
    }
    if (await loading.isDisplayed().catch(() => false)) {
      throw new Error("Catalog page result still exposes Loading threads…");
    }
  });
}

async function swipeThread(
  input: CaptureThreadRowParityInput,
  direction: "left" | "right",
): Promise<void> {
  const row = await displayedThreadRow(input, input.fixture.unread);
  await input.driver.execute("mobile: swipeGesture", {
    direction,
    elementId: row.elementId,
    percent: 0.82,
  });
}

async function assertSwipeActions(driver: AppiumBrowser, timeoutMs: number): Promise<void> {
  const actions: Array<{ label: string; x: number }> = [];
  for (const label of ["Pin thread", "Read thread", "Archive thread"]) {
    const action = await driver.$(`~${label}`);
    await action.waitForDisplayed({ timeout: timeoutMs, interval: POLL_INTERVAL_MS });
    if (!(await action.isEnabled())) throw new Error(`Thread swipe action ${label} is disabled`);
    actions.push({ label, x: await action.getLocation("x") });
  }
  assertIncreasingCoordinates(actions, "thread swipe actions", "x");
}

async function waitForSwipeActionsHidden(driver: AppiumBrowser, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const action = await driver.$("~Pin thread");
    if (!(await action.isDisplayed().catch(() => false))) return;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error("Thread swipe actions stayed open after the closing swipe");
}

async function assertFixtureOrder(input: CaptureThreadRowParityInput): Promise<void> {
  await setSearch(input.driver, `${input.fixture.commonQuery} state`);
  const fixtures = [
    input.fixture.running,
    input.fixture.approval,
    input.fixture.waitingInput,
    input.fixture.failed,
    input.fixture.unread,
  ];
  const authoritative = await authoritativeFixtureOrder(input.appServer, fixtures);
  const visible: Array<{ id: string; y: number }> = [];
  for (const fixture of fixtures) {
    const title = await displayedThreadTitle(input.driver, fixture, input.timeoutMs);
    visible.push({ id: fixture.id, y: await title.getLocation("y") });
  }
  visible.sort((left, right) => left.y - right.y);
  if (visible.map((entry) => entry.id).join("\u0000") !== authoritative.join("\u0000")) {
    throw new Error("Thread row fixtures are not rendered in App Server catalog order");
  }
}

async function showOnlyThread(driver: AppiumBrowser, fixture: ThreadFixture): Promise<void> {
  await setSearch(driver, fixture.title);
}

async function setSearch(driver: AppiumBrowser, query: string): Promise<void> {
  const search = await driver.$("~Search threads");
  await search.waitForDisplayed();
  await search.click();
  await search.setValue(query);
  await driver.hideKeyboard().catch(() => undefined);
}

async function clearSearch(driver: AppiumBrowser): Promise<void> {
  const search = await driver.$("~Search threads");
  await search.waitForDisplayed();
  await search.clearValue();
  await driver.hideKeyboard().catch(() => undefined);
}

async function openArchivedCatalog(driver: AppiumBrowser, timeoutMs: number): Promise<void> {
  const menu = await driver.$("~Thread list menu");
  await menu.waitForDisplayed({ timeout: timeoutMs, interval: POLL_INTERVAL_MS });
  await menu.click();
  const archived = await driver.$('android=new UiSelector().text("Archived threads")');
  await archived.waitForDisplayed({ timeout: timeoutMs, interval: POLL_INTERVAL_MS });
  await archived.click();
  const back = await driver.$("~Back to threads");
  await back.waitForDisplayed({ timeout: timeoutMs, interval: POLL_INTERVAL_MS });
}

async function closeArchivedCatalog(driver: AppiumBrowser, timeoutMs: number): Promise<void> {
  const back = await driver.$("~Back to threads");
  if (await back.isDisplayed().catch(() => false)) await back.click();
  const newThread = await driver.$("~New thread");
  await newThread.waitForDisplayed({ timeout: timeoutMs, interval: POLL_INTERVAL_MS });
}

async function assertRunningIndicator(input: CaptureThreadRowParityInput): Promise<void> {
  const testId = input.generation === "v1" ? "running-thread-title-shimmer" : "v2-progress-shimmer";
  const shimmer = await input.driver.$(`android=new UiSelector().resourceId("${testId}")`);
  await shimmer.waitForDisplayed({ timeout: input.timeoutMs, interval: POLL_INTERVAL_MS });
}

async function assertThreadStateAccessibility(
  input: CaptureThreadRowParityInput,
  row: Awaited<ReturnType<typeof displayedThreadRow>>,
  state: Exclude<ThreadState, "running">,
): Promise<void> {
  const expected =
    state === "waitingForApproval"
      ? input.generation === "v1"
        ? "Thread approval"
        : "Approval needed"
      : state === "waitingForInput"
        ? input.generation === "v1"
          ? "Thread approval"
          : "Waiting for input"
        : input.generation === "v1"
          ? "Thread failed"
          : "Failed";
  if (input.generation === "v1") {
    const status = await input.driver.$(`~${expected}`);
    await status.waitForDisplayed({ timeout: input.timeoutMs, interval: POLL_INTERVAL_MS });
    return;
  }
  const values = await Promise.all(
    ["stateDescription", "content-desc", "hint", "text"].map((attribute) =>
      row.getAttribute(attribute).catch(() => null),
    ),
  );
  if (!values.some((value) => typeof value === "string" && value.includes(expected))) {
    throw new Error(`Thread row accessibility does not expose ${expected}`);
  }
}

async function catalogLoadingIndicator(driver: AppiumBrowser) {
  for (const selector of [
    'android=new UiSelector().textContains("Loading threads")',
    'android=new UiSelector().descriptionContains("Loading threads")',
  ]) {
    const indicator = await driver.$(selector);
    if (await indicator.isDisplayed().catch(() => false)) return indicator;
  }
  return driver.$('android=new UiSelector().textContains("Loading threads")');
}

async function waitForVisibleUiText(
  driver: AppiumBrowser,
  expected: string,
  timeoutMs: number,
): Promise<void> {
  const text = await driver.$(`android=new UiSelector().textContains("${expected}")`);
  await text.waitForDisplayed({ timeout: timeoutMs, interval: POLL_INTERVAL_MS });
}

async function waitForElementHidden(
  element: Awaited<ReturnType<typeof catalogLoadingIndicator>>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await element.isDisplayed().catch(() => false))) return;
    await delay(50);
  }
  throw new Error("Catalog loading indicator stayed visible after its page result");
}

function assertIncreasingCoordinates<T extends { label: string }>(
  values: T[],
  surface: string,
  axis: keyof T,
): void {
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (
      previous === undefined ||
      current === undefined ||
      typeof previous[axis] !== "number" ||
      typeof current[axis] !== "number" ||
      current[axis] <= previous[axis]
    ) {
      throw new Error(`${surface} is not rendered in its authoritative action order`);
    }
  }
}

async function armCatalogPageHold(
  control: ThreadRowParityFaultControl,
): Promise<CatalogPageFaultStatus> {
  return catalogPageFaultRequest(control, "POST", "/internal/e2e/v2-surface-fault", {
    action: { kind: "hold" },
    target: "catalogPage",
  });
}

async function readCatalogPageHold(
  control: ThreadRowParityFaultControl,
  faultId: string,
): Promise<CatalogPageFaultState> {
  return catalogPageFaultRequest(
    control,
    "GET",
    `/internal/e2e/v2-surface-fault/${encodeURIComponent(faultId)}`,
  ).then((status) => status.state);
}

async function waitForCatalogPageHold(
  control: ThreadRowParityFaultControl,
  faultId: string,
  expected: CatalogPageFaultState,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await readCatalogPageHold(control, faultId);
    if (state === expected) return;
    if (state === "timedOut") throw new Error(`Catalog page fault ${faultId} timed out`);
    await delay(50);
  }
  throw new Error(`Timed out waiting for catalog page fault ${faultId} state ${expected}`);
}

async function releaseCatalogPageHold(
  control: ThreadRowParityFaultControl,
  faultId: string,
): Promise<void> {
  const status = await catalogPageFaultRequest(
    control,
    "POST",
    `/internal/e2e/v2-surface-fault/${encodeURIComponent(faultId)}/release`,
  );
  if (status.state !== "released") {
    throw new Error(`Catalog page fault ${faultId} did not release`);
  }
}

async function catalogPageFaultRequest(
  control: ThreadRowParityFaultControl,
  method: "GET" | "POST",
  requestPath: string,
  body?: object,
): Promise<CatalogPageFaultStatus> {
  const token = (await readFile(control.tokenFile, "utf8")).trim();
  return new Promise((resolve, reject) => {
    const encoded = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const request = httpRequest(
      {
        headers: {
          authorization: `Bearer ${token}`,
          ...(encoded === null
            ? {}
            : {
                "content-length": String(encoded.length),
                "content-type": "application/json",
              }),
        },
        method,
        path: requestPath,
        socketPath: control.endpoint,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          const responseBody = Buffer.concat(chunks).toString("utf8");
          if (
            response.statusCode === undefined ||
            response.statusCode < 200 ||
            response.statusCode >= 300
          ) {
            reject(
              new Error(
                `Companion catalog-page fault returned ${response.statusCode ?? "unknown"}: ${responseBody}`,
              ),
            );
            return;
          }
          try {
            resolve(parseCatalogPageFaultStatus(JSON.parse(responseBody)));
          } catch (cause) {
            reject(cause);
          }
        });
      },
    );
    request.once("error", reject);
    request.end(encoded ?? undefined);
  });
}

function parseCatalogPageFaultStatus(value: unknown): CatalogPageFaultStatus {
  if (
    !isRecord(value) ||
    typeof value.faultId !== "string" ||
    value.target !== "catalogPage" ||
    !isCatalogPageFaultState(value.state)
  ) {
    throw new Error("Companion returned an invalid catalog-page fault status");
  }
  return { faultId: value.faultId, state: value.state };
}

function isCatalogPageFaultState(value: unknown): value is CatalogPageFaultState {
  return (
    value === "armed" ||
    value === "intercepted" ||
    value === "released" ||
    value === "timedOut" ||
    value === "triggered"
  );
}

async function displayedThreadRow(input: CaptureThreadRowParityInput, fixture: ThreadFixture) {
  if (input.generation === "v2") {
    const row = await input.driver.$(
      `android=new UiSelector().descriptionStartsWith("Open thread ").descriptionContains("${fixture.id}")`,
    );
    await row.waitForDisplayed({ timeout: input.timeoutMs, interval: POLL_INTERVAL_MS });
    return row;
  }
  const row = await input.driver.$(
    '//android.widget.TextView[@resource-id="thread-time"]/parent::android.widget.Button',
  );
  await row.waitForDisplayed({ timeout: input.timeoutMs, interval: POLL_INTERVAL_MS });
  return row;
}

async function displayedThreadTitle(
  driver: AppiumBrowser,
  fixture: Pick<ThreadFixture, "id" | "title">,
  timeoutMs: number,
) {
  for (const selector of [
    `android=new UiSelector().text("${fixture.title}")`,
    `android=new UiSelector().description("${fixture.title}")`,
    `android=new UiSelector().descriptionContains("${fixture.id}")`,
  ]) {
    const title = await driver.$(selector);
    if (await title.isDisplayed().catch(() => false)) return title;
  }
  const title = await driver.$(`android=new UiSelector().text("${fixture.title}")`);
  await title.waitForDisplayed({ timeout: timeoutMs, interval: POLL_INTERVAL_MS });
  return title;
}

async function scrollUntilThreadDisplayed(
  driver: AppiumBrowser,
  fixture: Pick<ThreadFixture, "id" | "title">,
  timeoutMs: number,
): Promise<void> {
  await scrollCatalogUntil(driver, () => isThreadTitleDisplayed(driver, fixture), timeoutMs);
  await displayedThreadTitle(driver, fixture, timeoutMs);
}

async function scrollCatalogUntil(
  driver: AppiumBrowser,
  done: () => Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const viewport = await driver.getWindowSize();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await done()) return;
    await driver.execute("mobile: scrollGesture", {
      direction: "down",
      height: Math.max(1, viewport.height - 180),
      left: 0,
      percent: 0.92,
      top: 120,
      width: viewport.width,
    });
    await delay(100);
  }
  throw new Error("Timed out scrolling the thread catalog to its exact parity boundary");
}

async function isThreadTitleDisplayed(
  driver: AppiumBrowser,
  fixture: Pick<ThreadFixture, "id" | "title">,
): Promise<boolean> {
  for (const selector of [
    `android=new UiSelector().text("${fixture.title}")`,
    `android=new UiSelector().description("${fixture.title}")`,
    `android=new UiSelector().descriptionContains("${fixture.id}")`,
  ]) {
    const title = await driver.$(selector);
    if (await title.isDisplayed().catch(() => false)) return true;
  }
  return false;
}

async function authoritativeFixtureOrder(
  appServer: AppServerClient,
  fixtures: ThreadFixture[],
): Promise<string[]> {
  const result = await appServer.request("thread/list", {
    archived: false,
    cursor: null,
    limit: 100,
    sortDirection: "desc",
    sortKey: "updated_at",
    useStateDbOnly: true,
  });
  if (!isRecord(result) || !Array.isArray(result.data)) {
    throw new Error("App Server returned an invalid row-fixture thread/list response");
  }
  const fixtureIds = new Set(fixtures.map((fixture) => fixture.id));
  const order = result.data.flatMap((value) =>
    isRecord(value) && typeof value.id === "string" && fixtureIds.has(value.id) ? [value.id] : [],
  );
  if (order.length !== fixtures.length) {
    throw new Error(`App Server catalog omitted ${fixtures.length - order.length} row fixtures`);
  }
  return order;
}

async function createFixtureThread(
  appServer: AppServerClient,
  workspace: string,
  title: string,
  approvalPolicy: "never" | "on-request",
  instructions: string,
  sandbox = "danger-full-access",
): Promise<ThreadFixture> {
  const result = await appServer.request("thread/start", {
    allowProviderModelFallback: false,
    approvalPolicy,
    baseInstructions: instructions,
    cwd: workspace,
    developerInstructions: instructions,
    sandbox,
  });
  const id = readThreadId(result);
  await appServer.request("thread/name/set", { name: title, threadId: id });
  await appServer.subscribeThread(id);
  return { id, preview: null, title, turnId: null };
}

async function createArchivedCatalogThread(
  appServer: AppServerClient,
  workspace: string,
  title: string,
): Promise<ThreadFixture> {
  const instructions = "Do not start a turn for this catalog-only fixture.";
  const result = await appServer.request("thread/start", {
    allowProviderModelFallback: false,
    approvalPolicy: "never",
    baseInstructions: instructions,
    cwd: workspace,
    developerInstructions: instructions,
    sandbox: "danger-full-access",
  });
  const id = readThreadId(result);
  await appServer.request("thread/name/set", { name: title, threadId: id });
  await appServer.request("thread/archive", { threadId: id });
  return { id, preview: null, title, turnId: null };
}

async function assertAuthoritativeCatalogBoundary(
  appServer: AppServerClient,
  anchor: Pick<ThreadFixture, "id" | "title">,
  rows: ThreadFixture[],
): Promise<void> {
  const result = await appServer.request("thread/list", {
    archived: true,
    cursor: null,
    limit: CATALOG_FIXTURE_ROW_COUNT + 1,
    sortDirection: "desc",
    sortKey: "updated_at",
    useStateDbOnly: true,
  });
  if (!isRecord(result) || !Array.isArray(result.data)) {
    throw new Error("App Server returned an invalid archived catalog fixture page");
  }
  const actual = result.data.flatMap((value) =>
    isRecord(value) && typeof value.id === "string" ? [value.id] : [],
  );
  const expected = rows.map((row) => row.id).reverse();
  expected.push(anchor.id);
  if (actual.join("\u0000") !== expected.join("\u0000")) {
    throw new Error("Archived catalog parity fixtures do not own the exact first-page boundary");
  }
}

async function startFixtureTurn(
  appServer: AppServerClient,
  threadId: string,
  text: string,
  clientUserMessageId: string,
  model?: string,
): Promise<string> {
  const result = await appServer.request("turn/start", {
    clientUserMessageId,
    input: [{ text, text_elements: [], type: "text" }],
    ...(model === undefined ? {} : { model }),
    threadId,
  });
  if (!isRecord(result) || !isRecord(result.turn) || typeof result.turn.id !== "string") {
    throw new Error("App Server returned an invalid row-fixture turn/start response");
  }
  return result.turn.id;
}

async function waitForThreadState(
  appServer: AppServerClient,
  threadId: string,
  expected: ThreadState,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const thread = await appServer.readThread(threadId);
    if (readThreadState(thread) === expected) return;
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for ${threadId} to enter ${expected}`);
}

function readThreadState(value: unknown): ThreadState | "idle" {
  if (!isRecord(value) || !isRecord(value.status) || typeof value.status.type !== "string") {
    throw new Error("App Server returned a thread without a valid status");
  }
  if (value.status.type === "systemError") return "failed";
  if (value.status.type !== "active") return "idle";
  if (!Array.isArray(value.status.activeFlags)) {
    throw new Error("App Server returned an active thread without activeFlags");
  }
  if (value.status.activeFlags.includes("waitingOnApproval")) return "waitingForApproval";
  if (value.status.activeFlags.includes("waitingOnUserInput")) return "waitingForInput";
  return "running";
}

function readThreadId(value: unknown): string {
  if (!isRecord(value) || !isRecord(value.thread) || typeof value.thread.id !== "string") {
    throw new Error("App Server returned an invalid row-fixture thread/start response");
  }
  return value.thread.id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
