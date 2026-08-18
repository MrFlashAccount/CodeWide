export type Bounds = { left: number; top: number; right: number; bottom: number };

export type UiNode = {
  text: string;
  description: string;
  bounds: Bounds;
  clickable: boolean;
};

export type LayoutEvidence = {
  screenWidth: number;
  composer: {
    menu: Bounds;
    input: Bounds;
    voice: Bounds;
    send: Bounds;
    inputShare: number;
  };
  search: Bounds;
  serverControls: { add: Bounds; settings: Bounds | null; serverCount: number };
  forbiddenTabsNearSearch: string[];
};

export function adbDeviceState(output: string, serial: string): string | null {
  const matches = output
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((columns) => columns[0] === serial);
  if (matches.length !== 1) return null;
  return matches[0]?.[1] ?? null;
}

export function isAppTopResumed(activityDump: string, packageName: string): boolean {
  return activityDump
    .split("\n")
    .some((line) => /(?:topResumedActivity|ResumedActivity):?=/.test(line) && line.includes(packageName));
}

export function containsPackageCrash(crashLog: string, packageName: string): boolean {
  return crashLog
    .split("\n")
    .some((line) => line.includes(packageName) && /(?:Cmdline:|>>>)/.test(line));
}

const FORBIDDEN_THREAD_TABS = new Set(["all", "running", "approval", "unread", "pinned"]);

export function assertShellSafeAutomationPairing(pairing: {
  displayName: string;
  endpoint: string;
  pairingToken: string;
  tlsPinSha256?: string;
}): void {
  if (!/^[A-Za-z0-9._ -]{1,80}$/.test(pairing.displayName)) throw new Error("Automated ADB pairing requires a shell-safe ASCII server name");
  if (!/^wss?:\/\/[A-Za-z0-9.:[\]-]+(?::\d+)?\/[A-Za-z0-9/_-]*$/.test(pairing.endpoint)) throw new Error("Automated ADB pairing requires a query-free shell-safe endpoint");
  if (!/^[A-Za-z0-9_-]{32,512}$/.test(pairing.pairingToken)) throw new Error("Pairing token is not shell-safe base64url");
  if (pairing.tlsPinSha256 !== undefined && !/^sha256\/[A-Za-z0-9+/=]+$/.test(pairing.tlsPinSha256)) throw new Error("TLS pin is not shell-safe");
}

export function parseUiNodes(xml: string): UiNode[] {
  const nodes: UiNode[] = [];
  for (const match of xml.matchAll(/<node\b[^>]*>/g)) {
    const tag = match[0];
    const bounds = parseBounds(attribute(tag, "bounds"));
    if (bounds === null) continue;
    nodes.push({
      text: decodeXml(attribute(tag, "text")),
      description: decodeXml(attribute(tag, "content-desc")),
      bounds,
      clickable: attribute(tag, "clickable") === "true",
    });
  }
  return nodes;
}

export function serverControlCount(nodes: UiNode[]): number {
  const visibleControls = nodes.filter(({ description }) => /, (?:live|syncing|offline|connecting|degraded|authRequired)(?:,.*)?$/.test(description)).length;
  const compactSummary = nodes
    .map(({ text }) => /^(\d+) servers?$/.exec(text)?.[1])
    .find((value): value is string => value !== undefined);
  return Math.max(visibleControls, compactSummary === undefined ? 0 : Number(compactSummary));
}

export function compactThreadControl(nodes: UiNode[]): UiNode | null {
  const search = nodes.find(({ description }) => description === "Search threads");
  if (search === undefined || !nodes.some(({ description }) => description === "Choose server")) return null;
  return nodes.find(({ clickable, description, bounds }) =>
    clickable && bounds.top > search.bounds.bottom && bounds.right - bounds.left >= 300 &&
    description !== "Archived threads" && description !== "New thread",
  ) ?? null;
}

export function analyzeAdaptiveLayout(listXml: string, conversationXml?: string): LayoutEvidence {
  const listNodes = parseUiNodes(listXml);
  const conversationNodes = conversationXml === undefined ? listNodes : parseUiNodes(conversationXml);
  if (listNodes.length === 0 || conversationNodes.length === 0) throw new Error("UIAutomator returned no nodes");

  const menu = requiredDescription(conversationNodes, "Composer menu");
  const input = requiredDescription(conversationNodes, "Message Codex");
  const voice = conversationNodes.find(({ description }) => description === "Voice input" || description === "Stop voice input");
  if (voice === undefined) throw new Error("Missing accessibility node: Voice input");
  const send = conversationNodes.find(({ description }) =>
    description === "Send message" || description === "Stop response"
  );
  if (send === undefined) throw new Error("Missing accessibility node: Send message or Stop response");
  const search = requiredDescription(listNodes, "Search threads");
  const add = requiredDescription(listNodes, "Add server");
  const compact = listNodes.some(({ description }) => description === "Choose server");
  const settings = listNodes.find(({ description }) => description === "Settings") ?? null;
  if (!compact && settings === null) throw new Error("Missing accessibility node: Settings");
  if (compact && settings !== null) throw new Error("Settings must be inside the compact server menu");
  if (conversationXml !== undefined) requiredDescription(conversationNodes, "Back to threads");

  assertHorizontalOrder(menu.bounds, input.bounds, "Composer menu", "Message Codex");
  assertHorizontalOrder(input.bounds, voice.bounds, "Message Codex", "Voice input");
  assertHorizontalOrder(voice.bounds, send.bounds, "Voice input", send.description);

  const composerSpan = send.bounds.right - menu.bounds.left;
  const inputWidth = input.bounds.right - input.bounds.left;
  const inputShare = composerSpan <= 0 ? 0 : inputWidth / composerSpan;
  if (inputWidth < 120 || inputShare < 0.45) {
    throw new Error(`Composer input is not maximally wide enough: ${inputWidth}px / ${(inputShare * 100).toFixed(1)}%`);
  }

  const forbiddenTabsNearSearch = listNodes
    .filter(({ text, bounds, clickable }) => {
      const normalized = text.trim().toLocaleLowerCase();
      return clickable
        && FORBIDDEN_THREAD_TABS.has(normalized)
        && bounds.top >= search.bounds.bottom
        && bounds.top <= search.bounds.bottom + 140;
    })
    .map(({ text }) => text);
  if (forbiddenTabsNearSearch.length > 0) {
    throw new Error(`Forbidden tabs below thread search: ${forbiddenTabsNearSearch.join(", ")}`);
  }

  return {
    screenWidth: Math.max(...listNodes.map(({ bounds }) => bounds.right), ...conversationNodes.map(({ bounds }) => bounds.right)),
    composer: {
      menu: menu.bounds,
      input: input.bounds,
      voice: voice.bounds,
      send: send.bounds,
      inputShare,
    },
    search: search.bounds,
    serverControls: {
      add: add.bounds,
      settings: settings?.bounds ?? null,
      serverCount: serverControlCount(listNodes),
    },
    forbiddenTabsNearSearch,
  };
}

export function parsePackageFacts(output: string): {
  versionName: string | null;
  versionCode: number | null;
  firstInstallTime: string | null;
  lastUpdateTime: string | null;
  userId: number | null;
} {
  return {
    versionName: firstMatch(output, /^\s*versionName=(.+)$/m),
    versionCode: optionalInteger(firstMatch(output, /^\s*versionCode=(\d+)/m)),
    firstInstallTime: firstMatch(output, /^\s*firstInstallTime=(.+)$/m),
    lastUpdateTime: firstMatch(output, /^\s*lastUpdateTime=(.+)$/m),
    userId: optionalInteger(firstMatch(output, /^\s*(?:userId|appId)=(\d+)/m)),
  };
}

export function parseStartTiming(output: string): {
  status: string | null;
  launchState: string | null;
  totalTimeMs: number | null;
  waitTimeMs: number | null;
} {
  return {
    status: firstMatch(output, /^Status:\s*(.+)$/m),
    launchState: firstMatch(output, /^LaunchState:\s*(.+)$/m),
    totalTimeMs: optionalInteger(firstMatch(output, /^TotalTime:\s*(\d+)$/m)),
    waitTimeMs: optionalInteger(firstMatch(output, /^WaitTime:\s*(\d+)$/m)),
  };
}

function requiredDescription(nodes: UiNode[], description: string): UiNode {
  const result = nodes.find((node) => node.description === description);
  if (result === undefined) throw new Error(`Missing accessibility node: ${description}`);
  return result;
}

function assertHorizontalOrder(left: Bounds, right: Bounds, leftName: string, rightName: string): void {
  // UIAutomator rounds adjacent density-scaled edges independently. A single
  // physical pixel of overlap is the same shared edge, not a hit-target clash.
  if (left.right - right.left > 1) throw new Error(`${leftName} overlaps or follows ${rightName}`);
}

function attribute(tag: string, name: string): string {
  const match = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
  return match?.[1] ?? "";
}

function parseBounds(value: string): Bounds | null {
  const match = /^\[(\d+),(\d+)]\[(\d+),(\d+)]$/.exec(value);
  if (match === null) return null;
  return {
    left: Number(match[1]),
    top: Number(match[2]),
    right: Number(match[3]),
    bottom: Number(match[4]),
  };
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function firstMatch(value: string, pattern: RegExp): string | null {
  return pattern.exec(value)?.[1]?.trim() ?? null;
}

function optionalInteger(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
