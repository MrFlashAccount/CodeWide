import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable } from "react-native";
import { colors, iconSize } from "../../theme";
import { AppListRow } from "../../ui/AppListRow";
import { listRowHeight, type AppListRowProps } from "../../ui/AppListRow.types";
import type { PortForwardingCandidate } from "./portForwardingContract";
import { styles } from "./PortForwardingManager.styles";
import { ServiceIcon, candidateIcon, shortCwd } from "./PortPresentation";

export function CandidateRow({
  candidate,
  onExclude,
  onPress,
  pending,
  position,
}: {
  candidate: PortForwardingCandidate;
  onExclude: () => void;
  onPress: () => void;
  pending: boolean;
  position: NonNullable<AppListRowProps["position"]>;
}) {
  const detail = candidate.cwd === null ? candidate.process : shortCwd(candidate.cwd);
  return (
    <AppListRow
      accessibilityLabel={`Forward ${candidate.name} port ${String(candidate.port)}`}
      description={`:${String(candidate.port)}${detail === null ? "" : ` · ${detail}`}`}
      disabled={pending}
      fixedHeight={listRowHeight.double}
      leading={<ServiceIcon name={candidateIcon(candidate.kind)} />}
      onPress={onPress}
      position={position}
      testID={`discovered-port-${String(candidate.port)}`}
      title={candidate.name}
      trailing={
        pending ? (
          <ActivityIndicator color={colors.textMuted} size="small" />
        ) : (
          <>
            <Ionicons color={colors.textMuted} name="add" size={iconSize.action} />
            <Pressable
              accessibilityLabel={`Exclude ${candidate.name} port ${String(candidate.port)}`}
              accessibilityRole="button"
              onPress={onExclude}
              style={styles.iconButton}
            >
              <Ionicons color={colors.textDim} name="ban-outline" size={iconSize.action} />
            </Pressable>
          </>
        )
      }
    />
  );
}
