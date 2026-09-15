import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Pressable } from "react-native";
import { colors, iconSize } from "../../theme";
import { AppListRow } from "../../ui/AppListRow";
import { listRowHeight, type AppListRowProps } from "../../ui/AppListRow.types";
import { type PortForwardingCandidate } from "./portForwardingContract";
import { styles } from "./PortForwardingManager.styles";
import { ServiceIcon, candidateIcon, shortCwd } from "./PortPresentation";
export function CandidateRow({
  candidate,
  position,
  pending,
  onPress,
  onExclude,
}: {
  candidate: PortForwardingCandidate;
  position: NonNullable<AppListRowProps["position"]>;
  pending: boolean;
  onPress(): void;
  onExclude(): void;
}) {
  const detail = candidate.cwd === null ? candidate.process : shortCwd(candidate.cwd);
  return (
    <AppListRow
      testID={`discovered-port-${candidate.port}`}
      title={candidate.name}
      description={`:${candidate.port}${detail === null ? "" : ` · ${detail}`}`}
      accessibilityLabel={`Forward ${candidate.name} port ${candidate.port}`}
      disabled={pending}
      onPress={onPress}
      fixedHeight={listRowHeight.double}
      position={position}
      leading={<ServiceIcon name={candidateIcon(candidate.kind)} />}
      trailing={
        pending ? (
          <ActivityIndicator size="small" color={colors.textMuted} />
        ) : (
          <>
            <Ionicons name="add" size={iconSize.action} color={colors.textMuted} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Exclude ${candidate.name} port ${candidate.port}`}
              onPress={onExclude}
              style={styles.iconButton}
            >
              <Ionicons name="ban-outline" size={iconSize.action} color={colors.textDim} />
            </Pressable>
          </>
        )
      }
    />
  );
}
