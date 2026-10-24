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
  commandOutputRevision,
  readCommandOutput,
  type CommandOutputPage,
} from "../../../rendering/command-output-resource";
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
  const output = commandOutputText(resource.value?.text ?? null, current, request.fallbackOutput);
  const facts = commandFacts(current, request.command);
  return (
    <CommandOutputScreen
      command={facts.command}
      details={commandOutputDetails(facts.exitCode, output.text)}
      error={resource.error}
      loading={output.text === "" && resource.value === null && resource.status === "loading"}
      onClose={onClose}
      output={{ headOmitted: false, text: output.text, totalChars: output.text.length }}
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

function commandOutputDetails(exitCode: number | null, text: string): readonly string[] {
  const byteLength = new TextEncoder().encode(text).byteLength;
  return [
    ...(exitCode === null ? [] : [`exit ${String(exitCode)}`]),
    ...(byteLength > 0 ? [formatByteSize(byteLength)] : []),
  ];
}

/**
 * The text the terminal shows and where it comes from. A live item's inline
 * output only grows, so the terminal appends it; a switch to another source
 * replaces the text and restarts the terminal.
 */
function commandOutputText(
  referenced: string | null,
  current: CommandItem | null,
  fallbackOutput: string,
): { readonly source: "fallback" | "inline" | "referenced"; readonly text: string } {
  if (referenced !== null) {
    return { source: "referenced", text: referenced };
  }
  const inline = current?.aggregatedOutput ?? "";
  return inline === ""
    ? { source: "fallback", text: fallbackOutput }
    : { source: "inline", text: inline };
}

const COMMAND_STATUS: Record<CommandItem["status"], CommandOutputStatus> = {
  completed: "finished",
  declined: "declined",
  failed: "failed",
  inProgress: "running",
};

const UTF16_BYTES_PER_UNIT = 2;

function useReferencedCommandOutput(
  references: readonly CommandOutputReference[],
  getTransferAccess: GetTransferAccess | null,
  resourceKey: string,
): AsyncResourceSnapshot<CommandOutputPage> {
  const scope = usePrivateFileAccessScope();
  const totalBytes = references.reduce((sum, reference) => sum + reference.byteLength, 0);
  return useEphemeralAsyncResource<CommandOutputPage>(
    references.length === 0 ? null : `command-viewer:${scope}:${resourceKey}`,
    commandOutputRevision(references, totalBytes),
    async (_publish, signal) => {
      if (getTransferAccess === null) {
        throw new Error("Command output connection is unavailable");
      }
      return readCommandOutput(
        { byteLimit: totalBytes, getTransferAccess, references, scope },
        signal,
      );
    },
    (value) => value.text.length * UTF16_BYTES_PER_UNIT,
    true,
  );
}
