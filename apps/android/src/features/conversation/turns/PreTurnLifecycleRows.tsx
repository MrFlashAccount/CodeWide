/** V1 PreTurnLifecycleRows owner, extracted without changing interaction or resource lifetime. */
import { type RenderBlock } from "@codewide/renderers";
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
  turnStatus,
  turnKey,
  getTransferAccess,
  onFixUnsupportedBlock,
}: {
  blocks: RenderBlock[];
  turnStatus: "completed" | "interrupted" | "failed" | "inProgress";
  turnKey: string;
  getTransferAccess?(): Promise<{ baseUrl: string; authorization: string }>;
  onFixUnsupportedBlock?(block: RenderBlock): Promise<void>;
}) {
  return (
    <View testID="pre-turn-lifecycle" style={styles.preTurnLifecycleList}>
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
            key={block.key}
            accessible
            accessibilityLabel={`${block.title}, ${running ? "running" : "completed"}`}
            testID="pre-turn-lifecycle-row"
            style={styles.preTurnLifecycleRow}
          >
            <View style={styles.preTurnLifecycleIcon}>
              {running && turnStatus === "inProgress" ? (
                <CalmSpinner size={10} color={colors.textMuted} durationMs={3_000} />
              ) : (
                <Ionicons
                  name="checkmark-circle-outline"
                  size={iconSize.inline}
                  color={colors.textMuted}
                />
              )}
            </View>
            {running && turnStatus === "inProgress" ? (
              <WaveText
                text={block.title}
                style={styles.preTurnLifecycleText}
                containerStyle={styles.preTurnLifecycleWave}
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
