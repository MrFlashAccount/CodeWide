import { TerminalOutputActions } from "./TerminalOutputActions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { startTransition, useId, useState } from "react";
import { useEvent } from "../../../react/useEvent";
import type { TerminalOutputRequest } from "../../../services/content/terminalOutputRequest";
import { CommandOutputScreen } from "./CommandOutputScreen";
import {
  followTerminalOutput,
  initialTerminalOutput,
  type TerminalOutputState,
} from "./followTerminalOutput";

/** The shared Ghostty output screen with viewer-scoped stream and completion recovery. */
export function BackgroundTerminalOutputScreen({
  onClose,
  request,
}: {
  readonly onClose: () => void;
  readonly request: TerminalOutputRequest;
}): React.JSX.Element {
  const viewer = useId();
  const [attempt, setAttempt] = useState(0);
  const opening = `${viewer}:${String(attempt)}`;
  const retry = useEvent(() => {
    startTransition(() => {
      setAttempt((value) => value + 1);
    });
  });
  const queryClient = useQueryClient();
  const queryKey = [
    "background-terminal-output",
    request.connectionId,
    request.threadId,
    request.itemId,
    opening,
  ];
  const query = useQuery({
    gcTime: 0,
    queryFn: async ({ signal }) =>
      followTerminalOutput({
        key: opening,
        publish: (value) => {
          queryClient.setQueryData<TerminalOutputState>(queryKey, value);
        },
        request,
        signal,
      }),
    queryKey,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Infinity,
  });
  const state = query.data ?? initialTerminalOutput(request.command);
  return (
    <CommandOutputScreen
      command={state.command}
      details={[]}
      error={query.error?.message ?? null}
      footer={<TerminalOutputActions retry={query.error === null ? null : retry} />}
      loading={false}
      onClose={onClose}
      output={state.output}
      outputSource={`${opening}:${state.phase}`}
      status={state.status}
      title="Background command"
    />
  );
}
