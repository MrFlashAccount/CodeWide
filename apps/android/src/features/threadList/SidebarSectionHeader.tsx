import { View } from "react-native";
import { threadListLayout } from "../../ui/thread-list-layout";
import { AppText as Text } from "../../ui/Typography";
import { styles } from "./SidebarSectionHeader.styles";
import { THREAD_LIST_SECTION_HEIGHT } from "./threadListModel";

export function SidebarSectionHeader({ title }: { title: string }) {
  return (
    <View
      style={{
        alignItems: "center",
        flexDirection: "row",
        height: THREAD_LIST_SECTION_HEIGHT,
        paddingRight: threadListLayout.edgeInset,
      }}
    >
      <Text numberOfLines={1} style={[styles.sectionHeader, { flex: 1 }]}>
        {title}
      </Text>
    </View>
  );
}
