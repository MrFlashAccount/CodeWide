import { observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import { useQueries } from "@tanstack/react-query";

import { classifyForgeError } from "../../../data/forgeErrors";
import type { PullRequestFileContent } from "../../../data/forgeFileContentContract";
import type { PullRequestFile } from "../../../data/forgeMutationContract";
import type { ForgeResources } from "../../../data/forgeResources";
import { useConstant } from "../../../react/useConstant";
import { useEvent } from "../../../react/useEvent";
import type { CodeReviewDocument } from "../../review/editor/editorBridge";
import type { PullRequestTarget } from "../workspaceCapabilities";
import { showsWholeFile, wholeFileDocument } from "./changesPresentation";

/** The immutable head revision and the plugin that can read its source. */
export type HeadFileSource = {
  readonly capable: boolean;
  readonly resource: ForgeResources["fileContent"];
  readonly target: PullRequestTarget;
};

/** Display of the chosen file's surrounding unchanged lines. */
export type FileExpansion =
  | { readonly state: "hidden" | "compact" | "loading" }
  | { readonly document: CodeReviewDocument; readonly state: "expanded" }
  | { readonly reason: string; readonly state: "failed" | "unavailable" };

type HeadOptions = ReturnType<HeadFileSource["resource"]["options"]>;
type ExpandableFile = {
  readonly file: PullRequestFile;
  readonly key: string;
  readonly options: HeadOptions;
};

function expandableFile(
  source: HeadFileSource,
  file: PullRequestFile | null,
): ExpandableFile | null {
  if (file === null || !source.capable || !showsWholeFile(file)) {
    return null;
  }
  const options = source.resource.options({ ...source.target, path: file.path });
  return { file, key: JSON.stringify(options.queryKey), options };
}

/** Remembers explicit expansion per head and path. Only the expanded, visible file demands source. */
export function useFileExpansion(
  source: HeadFileSource,
  file: PullRequestFile | null,
): {
  readonly toggle: () => void;
  readonly view: FileExpansion;
} {
  const choices = useConstant(() => observable(new Map<string, boolean | undefined>()));
  const entry = expandableFile(source, file);
  const expanded = useSelector(() => entry !== null && (choices.get(entry.key).get() ?? false));
  const queries: HeadOptions[] = entry !== null && expanded ? [entry.options] : [];
  const [read] = useQueries({ queries }, source.resource.client);
  const view: FileExpansion =
    entry === null
      ? { state: "hidden" }
      : read === undefined
        ? { state: "compact" }
        : expandedView(entry.file, read.data, read.error);
  const toggle = useEvent(() => {
    if (read !== undefined && view.state === "failed") {
      void read.refetch().catch(() => undefined);
    } else if (entry !== null) {
      choices.set(entry.key, !(choices.get(entry.key).peek() ?? false));
    }
  });
  return { toggle, view };
}

function expandedView(
  file: PullRequestFile,
  blob: PullRequestFileContent | undefined,
  error: Error | null,
): FileExpansion {
  if (blob === undefined) {
    return error === null
      ? { state: "loading" }
      : { reason: classifyForgeError(error).message, state: "failed" };
  }
  if (blob.state !== "text") {
    return { reason: unavailable[blob.state], state: "unavailable" };
  }
  const document = wholeFileDocument(file, blob.content);
  return document === null
    ? { reason: "File content does not match this patch.", state: "unavailable" }
    : { document, state: "expanded" };
}

const unavailable = {
  binary: "Binary file",
  missing: "File is unavailable at this revision",
  tooLarge: "File is too large to display",
} as const;
