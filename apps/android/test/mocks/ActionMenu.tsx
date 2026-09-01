import type { PropsWithChildren } from "react";
import { View } from "react-native";

export function ActionMenu({ children }: PropsWithChildren): React.JSX.Element {
  return <View>{children}</View>;
}
