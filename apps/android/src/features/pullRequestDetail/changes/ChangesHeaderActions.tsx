import { Ionicons } from "@expo/vector-icons";
import { useRef } from "react";
import { Pressable, StyleSheet } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, controlSize, iconSize } from "../../../theme";
import { ActionMenu } from "../../../ui/ActionMenu";
import { useAppDialog } from "../../../ui/AppDialog";
import type { PullRequestChangesProps } from "./changesContract";
import type { ChangesData } from "./useChangesData";
import type { DiffDisplay } from "./diffDisplay";

/** PR-wide guide and diff-reading actions in the pane header. */
export function ChangesHeaderActions({
  data,
  display,
  onSelect,
  screen,
}: {
  readonly data: ChangesData;
  readonly display: DiffDisplay;
  readonly onSelect: (key: string) => void;
  readonly screen: PullRequestChangesProps;
}): React.JSX.Element {
  const dialog = useAppDialog();
  const opening = useRef(false);
  const { agentThread, connectionId, model, offline, review } = screen;
  const params = { connectionId, source: data.source };
  const openGuide = useEvent(() => {
    if (opening.current) {
      return;
    }
    opening.current = true;
    model.changesView.set("guide");
    void review.guide
      .preload(params)
      .then(async (state) => {
        if (!offline && state.guide === null && state.pending === null) {
          await screen.reviewCapabilities.requestGuide(connectionId, {
            author:
              agentThread === null
                ? { kind: "newThread", workspace: screen.overview.localCheckout?.workspace ?? null }
                : { kind: "thread", threadId: agentThread.threadId },
            revision: state.currentRevision,
            source: params.source,
          });
        }
      })
      .catch((error: unknown) => {
        dialog.error("Could not open the review guide", error);
      })
      .finally(() => {
        opening.current = false;
      });
  });
  return (
    <>
      {data.view === "files" && (
        <Pressable
          accessibilityLabel="Open or generate review guide"
          accessibilityRole="button"
          onPress={openGuide}
          style={styles.control}
          testID="changes-view-guide"
        >
          <Ionicons color={colors.text} name="sparkles-outline" size={iconSize.action} />
        </Pressable>
      )}
      <DiffSettings display={display} onSelect={onSelect} />
    </>
  );
}

function DiffSettings({
  display,
  onSelect,
}: {
  readonly display: DiffDisplay;
  readonly onSelect: (id: string) => void;
}): React.JSX.Element {
  return (
    <ActionMenu
      accessibilityLabel="Diff settings"
      actions={[
        {
          id: "unified",
          label: "Unified",
          section: "Diff view",
          selected: display.mode === "unified",
        },
        { id: "split", label: "Split", section: "Diff view", selected: display.mode === "split" },
        { id: "wrapLines", label: "Wrap lines", section: "Display", selected: display.wrapLines },
        {
          id: "showNumbers",
          label: "Show line numbers",
          section: "Display",
          selected: display.showNumbers,
        },
        {
          id: "scrollPath",
          label: "Scrollable file path",
          section: "Display",
          selected: display.scrollPath,
        },
      ]}
      onSelect={onSelect}
      triggerSize={{ height: controlSize.touch, width: controlSize.touch }}
    >
      <Pressable accessibilityRole="button" style={styles.control}>
        <Ionicons color={colors.text} name="settings-outline" size={iconSize.action} />
      </Pressable>
    </ActionMenu>
  );
}

const styles = StyleSheet.create({
  control: {
    alignItems: "center",
    height: controlSize.touch,
    justifyContent: "center",
    width: controlSize.touch,
  },
});
