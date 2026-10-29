import { useSelector } from "@legendapp/state/react";
import type { ThreadItem } from "@codewide/codex-protocol/v0.155.1/v2";
import { commandOutputReferences, type CommandOutputReference } from "@codewide/sync-client";
import type { GetTransferAccess } from "../../../data/private-transfer";
import type { ThreadDetailDatabase } from "../../../data/thread-detail-database";
import {
  useEphemeralAsyncResource,
  type AsyncResourceSnapshot,
} from "../../../rendering/async-resource-store";
import {
  followCommandOutput,
  type FollowedCommandOutput,
} from "../../../rendering/commandOutputFollow";
import { commandOutputRevision } from "../../../rendering/command-output-resource";
import { usePrivateFileAccessScope } from "../../../rendering/use-private-image-uri";
import type { CommandContentRouteRequest } from "../../../services/content/contentRouteSession";
import { formatByteSize } from "../../../ui/number-format";
import { CommandOutputScreen, type CommandOutputStatus } from "../turns/CommandOutputScreen";

/** Projects one exact command item from the live thread model into the output viewer. */
export function CommandContentViewer({
  connectionId,
  database,
  onClose,
  request,
  threadId,
}: {
  readonly connectionId: string;
  readonly database: ThreadDetailDatabase | null;
  readonly onClose: () => void;
  readonly request: CommandContentRouteRequest;
  readonly threadId: string;
}): React.JSX.Element {
  useSelector(() => database?.chat.window$(connectionId, threadId).revision.get() ?? 0);
  const current = database
    ?.getThread(connectionId, threadId)
    ?.turns.find((turn) => turn.id === request.turnId)
    ?.items.find(
      (item): item is CommandItem => item.id === request.itemId && item.type === "commandExecution",
    );
  return (
    <CommandItemOutputViewer
      current={current ?? null}
      onClose={onClose}
      request={request}
      resourceKey={`${connectionId}:${threadId}:${request.itemId}`}
    />
  );
}

type CommandItem = Extract<ThreadItem, { type: "commandExecution" }>;

/** Shows one command item's complete output, reading externalized segments on demand. */
export function CommandItemOutputViewer({
  current,
  onClose,
  request,
  resourceKey,
}: {
  readonly current: CommandItem | null;
  readonly onClose: () => void;
  readonly request: CommandContentRouteRequest;
  readonly resourceKey: string;
}): React.JSX.Element {
  // The Companion moves command output into private content and leaves an
  // empty inline string, so the referenced segments are the output itself.
  // An item its thread no longer holds is read from the segments it was opened with.
  const references = current === null ? request.references : commandOutputReferences(current);
  const resource = useReferencedCommandOutput(references, request.getTransferAccess, resourceKey);
  const output = commandOutputText(resource.value, current, request.fallbackOutput);
  const facts = commandFacts(current, request.command);
  return (
    <CommandOutputScreen
      command={facts.command}
      details={commandOutputDetails(facts.exitCode, outputByteLength(output, references))}
      error={resource.error}
      loading={output.text === "" && resource.value === null && resource.status === "loading"}
      onClose={onClose}
      output={output}
      outputSource={output.source}
      status={facts.status}
      title="Command"
    />
  );
}

/** What the live item says about the command; an item gone from its thread says nothing. */
function commandFacts(
  current: CommandItem | null,
  openedCommand: string,
): {
  readonly command: string;
  readonly exitCode: number | null;
  readonly status: CommandOutputStatus;
} {
  if (current === null) {
    return { command: openedCommand, exitCode: null, status: "unknown" };
  }
  return {
    command: current.command,
    exitCode: current.exitCode ?? null,
    status: COMMAND_STATUS[current.status],
  };
}

function commandOutputDetails(exitCode: number | null, byteLength: number): readonly string[] {
  return [
    ...(exitCode === null ? [] : [`exit ${String(exitCode)}`]),
    ...(byteLength > 0 ? [formatByteSize(byteLength)] : []),
  ];
}

/** The output the terminal shows and the source that names its text. */
type ViewedCommandOutput = {
  readonly headOmitted: boolean;
  readonly source: string;
  readonly text: string;
  readonly totalChars: number;
};

/**
 * The text the terminal shows and where it comes from. A live item's output
 * only grows, so the terminal appends it; a switch to another source (or to
 * another generation of the referenced output) replaces the text and
 * restarts the terminal.
 */
function commandOutputText(
  referenced: FollowedCommandOutput | null,
  current: CommandItem | null,
  fallbackOutput: string,
): ViewedCommandOutput {
  if (referenced !== null) {
    return {
      headOmitted: referenced.headOmitted,
      source: `referenced:${String(referenced.generation)}`,
      text: referenced.text,
      totalChars: referenced.totalChars,
    };
  }
  const inline = current?.aggregatedOutput ?? "";
  const text = inline === "" ? fallbackOutput : inline;
  return {
    headOmitted: false,
    source: inline === "" ? "fallback" : "inline",
    text,
    totalChars: text.length,
  };
}

/**
 * The whole output's size: the referenced segments' bytes, which a long live
 * output keeps only the tail of, else the bytes of the shown text.
 */
function outputByteLength(
  output: ViewedCommandOutput,
  references: readonly CommandOutputReference[],
): number {
  if (output.source.startsWith("referenced:")) {
    return references.reduce((sum, reference) => sum + reference.byteLength, 0);
  }
  return new TextEncoder().encode(output.text).byteLength;
}

const COMMAND_STATUS: Record<CommandItem["status"], CommandOutputStatus> = {
  completed: "finished",
  declined: "declined",
  failed: "failed",
  inProgress: "running",
};

const UTF16_BYTES_PER_UNIT = 2;

/**
 * Follows the referenced output while the live item adds segments: every new
 * segment is a new revision, and its read continues from the text already
 * read (`followCommandOutput`), so a steadily streaming command shows each
 * update instead of restarting a complete read that the next one aborts.
 */
function useReferencedCommandOutput(
  references: readonly CommandOutputReference[],
  getTransferAccess: GetTransferAccess | null,
  resourceKey: string,
): AsyncResourceSnapshot<FollowedCommandOutput> {
  const scope = usePrivateFileAccessScope();
  const key = `command-viewer:${scope}:${resourceKey}`;
  const totalBytes = references.reduce((sum, reference) => sum + reference.byteLength, 0);
  return useEphemeralAsyncResource<FollowedCommandOutput>(
    references.length === 0 ? null : key,
    commandOutputRevision(references, totalBytes),
    async (publish, signal) => {
      if (getTransferAccess === null) {
        throw new Error("Command output connection is unavailable");
      }
      return followCommandOutput({ getTransferAccess, key, publish, references, scope, signal });
    },
    (value) => value.text.length * UTF16_BYTES_PER_UNIT,
    true,
  );
}
