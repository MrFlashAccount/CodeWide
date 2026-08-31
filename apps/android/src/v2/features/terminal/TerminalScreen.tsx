import { useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, StyleSheet, Text } from "react-native";

import { useV2Runtime } from "../../V2Application";
import { useDisposableLifecycle } from "../../../boot/useDisposableLifecycle";
import type { ProjectionResource } from "../../application/resources/projectionResource";
import type { TerminalController } from "../../application/terminalController";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import { ActionPressable } from "../../ui/actions/ActionPressable";
import { WorkspaceView } from "../../../presentation/layouts/WorkspaceView";
import { TerminalWorkspaceView } from "../../../presentation/terminal/TerminalWorkspaceView";
import { useEvent } from "../../../react/useEvent";

interface TerminalScreenProps {
  owner: QualifiedThread;
}

interface ProjectedTerminalProps extends TerminalScreenProps {
  resource: ProjectionResource;
}

export function TerminalScreen({ owner }: TerminalScreenProps): React.JSX.Element {
  const runtime = useV2Runtime();
  const [outer] = useState(() => runtime.projection(owner.savedServerId, owner.threadId));
  const opened = useSyncExternalStore(outer.subscribe, outer.snapshot, outer.snapshot);
  if (opened.value === null) {
    return (
      <WorkspaceView title="Terminal">
        <ActivityIndicator accessibilityLabel="Loading terminal" />
      </WorkspaceView>
    );
  }
  return <ProjectedTerminal owner={owner} resource={opened.value} />;
}

function ProjectedTerminal({ owner, resource }: ProjectedTerminalProps): React.JSX.Element {
  const runtime = useV2Runtime();
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const projection = snapshot.value.projections.live;
  const [state, setState] = useState<"closed" | "opening" | "live" | "exited" | "error">("closed");
  const [output, setOutput] = useState("");
  const [input, setInput] = useState("");
  const handle = useRef<TerminalHandle | null>(null);
  useDisposableLifecycle(handle);
  const submitInput = useEvent(() => {
    if (input === "" || handle.current === null) return;
    const value = `${input}\n`;
    setInput("");
    handle.current.input(value).catch(() => setState("error"));
  });
  return (
    <WorkspaceView subtitle={<Text style={styles.status}>{state}</Text>} title="Terminal">
      <TerminalWorkspaceView
        input={input}
        live={state === "live"}
        onInputChange={setInput}
        onSubmit={submitInput}
        openControl={
          <ActionPressable
            action={{
              disabled: projection === null || state === "opening" || state === "live",
              id: "open-terminal",
              label: state === "exited" || state === "error" ? "Reopen terminal" : "Open terminal",
              run: async () => {
                if (projection === null) return;
                setOutput("");
                setState("opening");
                handle.current = await runtime.terminal.open(
                  owner,
                  projection.sourceGeneration,
                  projection.currentThread?.thread.workspace ?? null,
                  (event) => {
                    if (event.type === "opened") setState("live");
                    else if (event.type === "output") setOutput((current) => current + event.data);
                    else if (event.type === "exited") setState("exited");
                    else {
                      setOutput((current) => `${current}\n${event.message}`);
                      setState("error");
                    }
                  },
                );
              },
            }}
          />
        }
        output={output}
        state={state}
      />
    </WorkspaceView>
  );
}

type TerminalHandle = Awaited<ReturnType<TerminalController["open"]>>;

const styles = StyleSheet.create({
  status: { color: "#a8a8ad" },
});
