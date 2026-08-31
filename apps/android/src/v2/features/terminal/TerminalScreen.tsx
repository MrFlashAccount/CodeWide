import { useRef, useState, useSyncExternalStore } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import { useV2Runtime } from "../../V2Application";
import { useDisposableLifecycle } from "../../../boot/useDisposableLifecycle";
import type { ProjectionResource } from "../../application/resources/projectionResource";
import type { TerminalController } from "../../application/terminalController";
import type { QualifiedThread } from "../../domain/qualifiedThread";
import { ActionPressable } from "../../ui/actions/ActionPressable";
import { WorkspaceView } from "../../ui/layouts/WorkspaceView";

export function TerminalScreen({ owner }: { owner: QualifiedThread }): React.JSX.Element {
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

function ProjectedTerminal({
  owner,
  resource,
}: {
  owner: QualifiedThread;
  resource: ProjectionResource;
}): React.JSX.Element {
  const runtime = useV2Runtime();
  const snapshot = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const projection = snapshot.value.projections.live;
  const [state, setState] = useState<"closed" | "opening" | "live" | "exited" | "error">("closed");
  const [output, setOutput] = useState("");
  const [input, setInput] = useState("");
  const handle = useRef<TerminalHandle | null>(null);
  useDisposableLifecycle(handle);
  return (
    <WorkspaceView subtitle={<Text style={styles.status}>{state}</Text>} title="Terminal">
      <View style={styles.content}>
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
        <ScrollView accessibilityLabel="Terminal output" style={styles.output}>
          <Text selectable style={styles.terminalText}>
            {output === "" ? "Terminal output will appear here." : output}
          </Text>
        </ScrollView>
        <TextInput
          accessibilityLabel="Terminal input"
          autoCapitalize="none"
          autoCorrect={false}
          editable={state === "live"}
          onChangeText={setInput}
          onSubmitEditing={() => {
            if (input === "" || handle.current === null) return;
            const value = `${input}\n`;
            setInput("");
            handle.current.input(value).catch(() => setState("error"));
          }}
          placeholder="Enter a command"
          placeholderTextColor="#77777c"
          returnKeyType="send"
          style={styles.input}
          value={input}
        />
      </View>
    </WorkspaceView>
  );
}

type TerminalHandle = Awaited<ReturnType<TerminalController["open"]>>;

const styles = StyleSheet.create({
  content: { flex: 1, gap: 10, padding: 16 },
  input: {
    backgroundColor: "#1b1b1e",
    borderRadius: 10,
    color: "#fafafa",
    minHeight: 48,
    padding: 12,
  },
  output: { backgroundColor: "#09090a", borderRadius: 10, flex: 1, padding: 12 },
  status: { color: "#a8a8ad" },
  terminalText: { color: "#d7fbd7", fontFamily: "monospace", fontSize: 13 },
});
