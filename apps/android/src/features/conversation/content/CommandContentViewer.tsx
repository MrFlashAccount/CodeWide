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
import { ActivityContentViewer } from "./ActivityContentViewer";

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
  const references = current === null ? [] : commandOutputReferences(current);
  const resource = useReferencedCommandOutput(references, request.getTransferAccess, resourceKey);
  const inline = current?.aggregatedOutput ?? "";
  const output = resource.value?.text ?? (inline === "" ? request.fallbackOutput : inline);
  return (
    <ActivityContentViewer
      error={resource.error}
      loading={resource.value === null && resource.status === "loading"}
      onClose={onClose}
      presentation="terminal"
      text={output}
      title={request.title}
    />
  );
}

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
