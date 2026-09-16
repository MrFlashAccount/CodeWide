/** V1 PreTurnLifecycleRows owner, extracted without changing interaction or resource lifetime. */
import type { RenderBlock } from "@codewide/renderers";
import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { colors, iconSize } from "../../../theme";
import { CalmSpinner } from "../../../ui/CalmSpinner";
import { AppText as Text } from "../../../ui/Typography";
import { WaveText } from "../../../ui/WaveText";
import { ProtocolBlock } from "../protocol/ProtocolBlock";
import { styles } from "./PreTurnLifecycleRows.styles";
import { ExpansionItemKeyContext } from "./turnContexts";
import { preTurnBlockUsesDisclosure } from "./turnProjection";

export function PreTurnLifecycleRows({
  blocks,
  getTransferAccess,
  onFixUnsupportedBlock,
  turnKey,
  turnStatus,
}: {
  blocks: RenderBlock[];
  getTransferAccess?: () => Promise<{ authorization: string; baseUrl: string }>;
  onFixUnsupportedBlock?: (block: RenderBlock) => Promise<void>;
  turnKey: string;
  turnStatus: "completed" | "interrupted" | "failed" | "inProgress";
}) {
  return (
    <View style={styles.preTurnLifecycleList} testID="pre-turn-lifecycle">
      {blocks.map((block) => {
        const lifecyclePhase = block.raw.codewideLifecyclePhase;
        const running =
          lifecyclePhase === "started" ||
          block.status === "inProgress" ||
          block.status === "running";
        const simpleStatus = !preTurnBlockUsesDisclosure(block);
        if (!simpleStatus) {
          return (
            <ExpansionItemKeyContext.Provider
              key={block.key}
              value={`${turnKey}:pre-turn:${block.key}`}
            >
              <View style={styles.preTurnLifecycleDetail}>
                <ProtocolBlock
                  block={block}
                  {...(getTransferAccess === undefined ? {} : { getTransferAccess })}
                  {...(onFixUnsupportedBlock === undefined ? {} : { onFixUnsupportedBlock })}
                />
              </View>
            </ExpansionItemKeyContext.Provider>
          );
        }
        return (
          <View
            accessibilityLabel={`${block.title}, ${running ? "running" : "completed"}`}
            accessible
            key={block.key}
            style={styles.preTurnLifecycleRow}
            testID="pre-turn-lifecycle-row"
          >
            <View style={styles.preTurnLifecycleIcon}>
              {running && turnStatus === "inProgress" ? (
                <CalmSpinner color={colors.textMuted} durationMs={3000} size={10} />
              ) : (
                <Ionicons
                  color={colors.textMuted}
                  name="checkmark-circle-outline"
                  size={iconSize.inline}
                />
              )}
            </View>
            {running && turnStatus === "inProgress" ? (
              <WaveText
                containerStyle={styles.preTurnLifecycleWave}
                style={styles.preTurnLifecycleText}
                text={block.title}
              />
            ) : (
              <Text numberOfLines={1} style={styles.preTurnLifecycleText}>
                {block.title}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}
