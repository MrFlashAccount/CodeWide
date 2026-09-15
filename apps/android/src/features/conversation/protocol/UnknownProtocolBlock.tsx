/** V1 UnknownProtocolBlock owner, extracted without changing interaction or resource lifetime. */
import { type RenderBlock } from "@codewide/renderers";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { useInsideBubbleSurface } from "../../../rendering/Bubble";
import { colors, iconSize } from "../../../theme";
import { InlineIcon } from "../../../ui/InlineIcon";
import { AppText as Text } from "../../../ui/Typography";
import { CopyButton } from "../turns/MessageActionRail";
import { protocolCopyText } from "./protocolCopyText";
import { styles } from "./UnknownProtocolBlock.styles";

export function UnknownProtocolBlock({
  block,
  onFixUnsupportedBlock,
}: {
  block: RenderBlock;
  onFixUnsupportedBlock?(block: RenderBlock): Promise<void>;
}) {
  const insideBubbleSurface = useInsideBubbleSurface();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rawType = typeof block.raw.type === "string" ? block.raw.type : block.kind;
  const fix = async () => {
    if (onFixUnsupportedBlock === undefined || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onFixUnsupportedBlock(block);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create renderer fix thread");
      setBusy(false);
    }
  };
  return (
    <View style={[styles.unknownCard, insideBubbleSurface && styles.bubbleNestedSurface]}>
      <Ionicons name="cube-outline" size={iconSize.action} color={colors.amber} />
      <View style={styles.flex}>
        <Text style={styles.unknownText}>Unsupported · {rawType}</Text>
        {error !== null && <Text style={styles.errorText}>{error}</Text>}
      </View>
      <CopyButton getText={() => protocolCopyText(block)} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Fix unsupported block ${rawType} in new thread`}
        disabled={busy || onFixUnsupportedBlock === undefined}
        onPress={() => void fix()}
        style={[
          styles.unknownFixButton,
          (busy || onFixUnsupportedBlock === undefined) && styles.disabled,
        ]}
      >
        <InlineIcon
          name={busy ? "hourglass-outline" : "construct-outline"}
          role="label"
          color={colors.onPrimary}
        />
        <Text style={styles.unknownFixText}>{busy ? "Starting" : "Fix"}</Text>
      </Pressable>
    </View>
  );
}
