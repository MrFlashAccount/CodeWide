/**
 * Owner of the Changes diff's whole-file decisions: for each file view it
 * decides once whether the diff shows the whole head file or the recorded
 * patch, so the editor receives exactly one document per view instead of a
 * patch that is later swapped for the whole file.
 */
import type { PullRequestFile } from "../../../data/forgeMutationContract";
import type { PullRequestFileContent } from "../../../data/forgeFileContentContract";
import type { ForgeResources } from "../../../data/forgeResources";
import type { PullRequestTarget } from "../workspaceCapabilities";
import { showsWholeFile, type DiffContent } from "./changesPresentation";

/**
 * How long a file view waits for its whole head file before it settles on the
 * recorded patch. The patch is already on the device, so this bound is the
 * only reading delay a slow forge can cause: long enough for an ordinary
 * Companion → forge contents read (normally well under a second) to land, short
 * enough that a stalled read never keeps the reader from the code. A view
 * that settled on the patch keeps it; a late answer only serves the next visit.
 */
export const WHOLE_FILE_WAIT_MS = 2500;
/** Files whose whole content is read ahead when Files changed first decides a view. */
const OPENING_PREFETCH_FILES = 3;

/** Where the whole head files of one PR head come from. */
export type HeadFileSource = {
  /** The PR's plugin declares `forge.fileContent@1`. */
  readonly capable: boolean;
  readonly resource: ForgeResources["fileContent"];
  readonly target: PullRequestTarget;
};

/** A view's decision: settled, or the read the view suspends on. */
type HeadFileDecision =
  | { readonly content: DiffContent; readonly status: "settled" }
  | { readonly promise: Promise<DiffContent>; readonly status: "pending" };

/** Per-screen owner of file view decisions; see {@link createHeadFileViews}. */
export type HeadFileViews = {
  /** The view's decision, deciding (and reading ahead its neighbours) on first sight. */
  readonly decide: (
    source: HeadFileSource,
    files: readonly PullRequestFile[],
    file: PullRequestFile,
  ) => HeadFileDecision;
  /** Identity of one file view: connection, PR, head and path. */
  readonly keyOf: (source: HeadFileSource, file: PullRequestFile) => string;
  /** Forgets settled decisions of every view except the shown one, so a revisit decides afresh. */
  readonly retainOnly: (key: string) => void;
};

const PATCH: DiffContent = { state: "patch" };

/**
 * Creates the decision owner of one mounted files view. A decision is made
 * from the process-owned file-content query: a cached answer settles at once;
 * otherwise the read races {@link WHOLE_FILE_WAIT_MS} and the view suspends on
 * that race. Each new view also reads ahead its neighbours (and, for the first
 * view, the first few files) through the same query client, so stepping
 * through files usually finds the answer cached.
 */
export function createHeadFileViews(): HeadFileViews {
  const decisions = new Map<string, HeadFileDecision>();
  let opened = false;
  const keyOf = (source: HeadFileSource, file: PullRequestFile): string =>
    JSON.stringify(source.resource.keyOf(paramsOf(source, file)));
  const readAhead = (
    source: HeadFileSource,
    files: readonly PullRequestFile[],
    file: PullRequestFile,
  ): void => {
    const index = files.indexOf(file);
    const ahead = [files[index - 1], files[index + 1]];
    if (!opened) {
      opened = true;
      ahead.push(...files.slice(0, OPENING_PREFETCH_FILES));
    }
    for (const neighbour of ahead) {
      if (neighbour !== undefined && neighbour !== file && wanted(source, neighbour)) {
        source.resource.preload(paramsOf(source, neighbour)).catch(() => undefined);
      }
    }
  };
  return {
    decide(source, files, file) {
      const key = keyOf(source, file);
      const known = decisions.get(key);
      if (known !== undefined) {
        return known;
      }
      const decision = firstDecision(source, file, (content) => {
        if (decisions.get(key) === decision) {
          decisions.set(key, { content, status: "settled" });
        }
      });
      decisions.set(key, decision);
      readAhead(source, files, file);
      return decision;
    },
    keyOf,
    retainOnly(key) {
      for (const [other, decision] of decisions) {
        if (other !== key && decision.status === "settled") {
          decisions.delete(other);
        }
      }
    },
  };
}

function firstDecision(
  source: HeadFileSource,
  file: PullRequestFile,
  settle: (content: DiffContent) => void,
): HeadFileDecision {
  if (!wanted(source, file)) {
    return { content: PATCH, status: "settled" };
  }
  const params = paramsOf(source, file);
  const cached = source.resource.data(params);
  if (cached !== null) {
    return { content: contentOf(cached), status: "settled" };
  }
  const promise = boundedRead(source.resource.preload(params));
  promise.then(settle, () => undefined);
  return { promise, status: "pending" };
}

/** The read's content, or the patch once it fails or outlasts {@link WHOLE_FILE_WAIT_MS}. */
async function boundedRead(read: Promise<PullRequestFileContent>): Promise<DiffContent> {
  const bound = expiry();
  try {
    return await Promise.race([read.then(contentOf, () => PATCH), bound.expired]);
  } finally {
    bound.cancel();
  }
}

/** Settles on the patch after {@link WHOLE_FILE_WAIT_MS} unless cancelled first. */
function expiry(): { readonly cancel: () => void; readonly expired: Promise<DiffContent> } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<DiffContent>((resolve) => {
    timer = setTimeout(() => {
      resolve(PATCH);
    }, WHOLE_FILE_WAIT_MS);
  });
  return {
    cancel: () => {
      clearTimeout(timer);
    },
    expired,
  };
}

function contentOf(answer: PullRequestFileContent): DiffContent {
  return answer.state === "text" ? { content: answer.content, state: "wholeFile" } : PATCH;
}

function wanted(source: HeadFileSource, file: PullRequestFile): boolean {
  return source.capable && showsWholeFile(file);
}

function paramsOf(source: HeadFileSource, file: PullRequestFile) {
  return { ...source.target, path: file.path };
}
