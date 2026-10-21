import { View } from "react-native";

import { CaptionBadge } from "../../../ui/CaptionBadge";
import { AppText as Text } from "../../../ui/Typography";
import { overviewStyles as styles } from "./overview.styles";

/** Card title with an optional meta line and badge, shared by Overview cards. */
export function CardHeader({
  badge = null,
  meta = null,
  title,
}: {
  readonly badge?: string | null;
  readonly meta?: string | null;
  readonly title: string;
}): React.JSX.Element {
  return (
    <View style={styles.cardHeader}>
      <Text accessibilityRole="header" style={styles.cardTitle}>
        {title}
      </Text>
      <Text numberOfLines={1} style={[styles.meta, styles.fill]}>
        {meta ?? ""}
      </Text>
      {badge === null ? null : <CaptionBadge label={badge} />}
    </View>
  );
}

/** One muted text line inside a card. */
export function CardNote({ text }: { readonly text: string }): React.JSX.Element {
  return (
    <View style={styles.cardLine}>
      <Text style={styles.meta}>{text}</Text>
    </View>
  );
}
