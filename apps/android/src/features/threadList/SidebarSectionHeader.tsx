import { View } from "react-native";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./SidebarSectionHeader.styles";

export function SidebarSectionHeader({ title }: { title: string }) {
  return (
    <View style={styles.section}>
      <Text numberOfLines={1} style={styles.sectionHeader}>
        {title}
      </Text>
    </View>
  );
}
