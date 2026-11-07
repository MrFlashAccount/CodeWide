/**
 * Compatibility of the on-disk Forge/review query cache with the current decoded contracts.
 *
 * Restored query data is already-decoded data: it never passes the wire decoders again, so a
 * snapshot written by an older app version reaches components exactly as it was stored. The only
 * protection is the persistence buster, which discards snapshots of another value. This test owns
 * the rule that every change to a persisted decoded shape changes the buster: it derives a
 * structural signature (key sets, value kinds and `kind`/`state` variants, never values) of what
 * a restart restores for every persisted query kind, and requires the buster to name that
 * signature. Recording a new signature therefore always discards the old snapshots.
 *
 * A hand-made `-<n>` suffix after the signature marks a semantic change with an unchanged shape
 * (entry order, the meaning of a value), which a structural signature cannot see.
 *
 * Adding a fixture variant that exercises a new key, null branch or variant also changes the
 * signature; the resulting one-time cache discard is the safe direction.
 */
import { createHash } from "node:crypto";

import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { parseForgeAccounts } from "../src/data/forgeContract";
import { parseConversationPage } from "../src/data/forgeConversationContract";
import { parseFilesPage } from "../src/data/forgeMutationContract";
import {
  parseActivityPage,
  parsePullRequestListPage,
  parsePullRequestOverview,
} from "../src/data/forgePullRequestContract";
import {
  PERSISTED_FORGE_QUERY_KINDS,
  persistForgeQueryClient,
} from "../src/data/forgeQueryPersistence";
import { parseHunkCatalog } from "../src/data/reviewContract";
import { parseDrafts } from "../src/data/reviewDraftContract";
import { parseGuideState } from "../src/data/reviewGuideContract";
import {
  conversation91,
  conversationArcanum,
  conversationComment,
  draftsSnapshot,
  failedFlow,
  filesPage,
  guideState,
  hostLoginFlow,
  involvedPage,
  onboardingAccounts,
  overview91,
  reviewRequestedPage,
} from "./fixtures/forgeWireFixtures";
import { createMemoryQueryPersister } from "./fixtures/queryPersister";

type PersistedKind = (typeof PERSISTED_FORGE_QUERY_KINDS)[number];

function decoded<Value>(value: Value | null, kind: PersistedKind): Value {
  if (value === null) {
    throw new Error(`the ${kind} wire fixture must decode`);
  }
  return value;
}

/**
 * Exercises the nullable branches of the conversation contract that the shared fixtures leave
 * `null`: a push event with commits and a line thread with a code excerpt.
 */
const conversationBranches = {
  entries: [
    {
      author: null,
      category: "push",
      commits: {
        items: [{ authorLogin: "dana-r", sha: "3fa9e12aa", shortSha: "3fa9e12", title: "Fix" }],
        total: 4,
      },
      createdAt: "2026-10-21T10:05:00Z",
      id: "e-2",
      kind: "event",
      text: "pushed 4 commits",
    },
    {
      kind: "reviewThread",
      thread: {
        anchor: {
          kind: "line",
          line: 12,
          path: "src/read.rs",
          side: "new",
          startLine: 10,
        },
        comments: [conversationComment("c-9", { body: "Keep the old name?" })],
        excerpt: {
          lines: [
            { kind: "context", newLine: 10, oldLine: 10, text: "fn read() {" },
            { kind: "removed", oldLine: 11, text: "  old()" },
            { kind: "added", newLine: 11, text: "  new()" },
          ],
        },
        id: "rt-9",
        iteration: { id: "it-1", number: 1 },
        outdated: false,
        resolution: { kind: "none" },
        reviewId: null,
        viewerCanReply: false,
      },
    },
  ],
  nextCursor: "older",
  openIssuesBlockMerge: true,
};

const decodedFiles = decoded(parseFilesPage(filesPage), "forge/files");

/** Decoded values of every persisted kind, built from wire fixtures through the real decoders. */
const samples: Readonly<Record<PersistedKind, readonly unknown[]>> = {
  "forge/accounts": [
    decoded(
      parseForgeAccounts({ ...onboardingAccounts, flows: [hostLoginFlow, failedFlow] }),
      "forge/accounts",
    ),
  ],
  "forge/activity": [decoded(parseActivityPage(overview91.activity), "forge/activity")],
  "forge/conversation": [conversation91, conversationArcanum, conversationBranches].map((page) =>
    decoded(parseConversationPage(page), "forge/conversation"),
  ),
  "forge/files": [decodedFiles],
  "forge/lists": [reviewRequestedPage, involvedPage].map((page) =>
    decoded(parsePullRequestListPage(page), "forge/lists"),
  ),
  "forge/overview": [
    decoded(
      parsePullRequestOverview(overview91, () => undefined),
      "forge/overview",
    ),
  ],
  "review/drafts": [decoded(parseDrafts(draftsSnapshot), "review/drafts")],
  "review/guide": [decoded(parseGuideState(guideState), "review/guide")],
  "review/hunks": [
    decoded(
      parseHunkCatalog({
        files: decodedFiles.files.map((file) => ({
          hunks: file.patch.state === "present" ? file.patch.hunks : [],
          path: file.path,
        })),
        revision: decodedFiles.headRevision,
      }),
      "review/hunks",
    ),
  ],
};

/** Merged structure of every value seen at one position of a persisted value. */
type ShapeNode = {
  readonly array: { element: ShapeNode | null };
  readonly objects: Map<string, Map<string, ShapeNode>>;
  readonly scalars: Set<string>;
};

const DISCRIMINANTS = ["kind", "state"] as const;

function emptyNode(): ShapeNode {
  return { array: { element: null }, objects: new Map(), scalars: new Set() };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Names an object's variant by its literal discriminants so union members stay distinct. */
function variantOf(value: Readonly<Record<string, unknown>>): string {
  return DISCRIMINANTS.flatMap((key) => {
    const tag = value[key];
    return typeof tag === "string" ? [`${key}=${tag}`] : [];
  }).join(",");
}

function absorb(node: ShapeNode, value: unknown): void {
  if (Array.isArray(value)) {
    node.scalars.add("array");
    const element = node.array.element ?? emptyNode();
    node.array.element = element;
    for (const item of value) {
      absorb(element, item);
    }
    return;
  }
  if (isRecord(value)) {
    const variant = variantOf(value);
    const fields = node.objects.get(variant) ?? new Map<string, ShapeNode>();
    node.objects.set(variant, fields);
    for (const [key, field] of Object.entries(value)) {
      const child = fields.get(key) ?? emptyNode();
      fields.set(key, child);
      absorb(child, field);
    }
    return;
  }
  node.scalars.add(value === null ? "null" : typeof value);
}

function render(node: ShapeNode): string {
  const parts = [...node.scalars].filter((scalar) => scalar !== "array").sort();
  if (node.array.element !== null) {
    parts.push(`[${render(node.array.element)}]`);
  }
  for (const [variant, fields] of [...node.objects].sort(([a], [b]) => a.localeCompare(b))) {
    const body = [...fields]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${key}:${render(child)}`)
      .join(",");
    parts.push(`<${variant}>{${body}}`);
  }
  return parts.join("|");
}

function shapeSignature(restored: ReadonlyMap<string, readonly unknown[]>): string {
  return [...restored]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([kind, values]) => {
      const node = emptyNode();
      for (const value of values) {
        absorb(node, value);
      }
      return `${kind}=${render(node)}`;
    })
    .join("\n");
}

/** Persists every sample, restarts on the same storage and returns what was restored per kind. */
async function persistAndRestore(): Promise<{
  readonly buster: unknown;
  readonly restored: ReadonlyMap<string, readonly unknown[]>;
}> {
  const memory = createMemoryQueryPersister();
  const writer = new QueryClient();
  const writing = persistForgeQueryClient(writer, memory.persister);
  await writing.restored;
  for (const [kind, values] of Object.entries(samples)) {
    const [owner, name] = kind.split("/");
    values.forEach((value, index) => {
      writer.setQueryData([owner, name, "server", `sample-${index}`], value);
    });
  }
  // Excluded families must never reach storage.
  writer.setQueryData(["forge", "scenarios", "server", "sample-0"], { running: true });
  writer.setQueryData(["forge", "fileContent", "server", "sample-0"], { text: "" });
  const expectedQueries = Object.values(samples).reduce(
    (total, values) => total + values.length,
    0,
  );
  await expect
    .poll(() => {
      const payload: unknown = JSON.parse(memory.read() ?? "{}");
      return isRecord(payload) && isRecord(payload.clientState)
        ? payload.clientState.queries
        : null;
    })
    .toHaveLength(expectedQueries);
  writing.stop();

  const payload: unknown = JSON.parse(memory.read() ?? "{}");
  const reader = new QueryClient();
  const reading = persistForgeQueryClient(reader, memory.persister);
  await reading.restored;
  reading.stop();
  const restored = new Map<string, unknown[]>();
  for (const query of reader.getQueryCache().getAll()) {
    const [owner, name] = query.queryKey;
    const kind = `${String(owner)}/${String(name)}`;
    restored.set(kind, [...(restored.get(kind) ?? []), query.state.data]);
  }
  return { buster: isRecord(payload) ? payload.buster : null, restored };
}

describe("forge query cache compatibility", () => {
  it("restores exactly the persisted kinds and names their decoded shapes in the buster", async () => {
    const { buster, restored } = await persistAndRestore();

    expect([...restored.keys()].sort()).toStrictEqual([...PERSISTED_FORGE_QUERY_KINDS].sort());
    const signature = shapeSignature(restored);
    const expected = `forge-query-cache-${createHash("sha256").update(signature).digest("hex").slice(0, 12)}`;
    expect(
      buster,
      `persisted forge query shapes changed: set FORGE_QUERY_CACHE_BUSTER to "${expected}" ` +
        "and note the shape change in its history comment.\nCurrent signature:\n" +
        signature,
    ).toMatch(new RegExp(`^${expected}(?:-\\d+)?$`, "u"));
  });
});
