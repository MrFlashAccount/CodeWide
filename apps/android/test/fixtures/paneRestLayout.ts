import type { ViewStyle } from "react-native";

/** At rest Yoga uses the settled split percentage so rotation keeps the two sizes complementary. */
export function restingSidebar(percent: number):ViewStyle {
 return {maxWidth:"100%",minWidth:0,width:`${percent}%`};
}
