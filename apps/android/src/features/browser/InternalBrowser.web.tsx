import { StyleSheet, View } from "react-native";

import { colors } from "../../theme";
import type { BrowserFeedbackCapability } from "./feedback";
import type { BrowserTabsControl } from "./browserContract";

export function InternalBrowser({
  url,
}: {
  active?: boolean;
  credentialOrigin?: string;
  feedback?: BrowserFeedbackCapability;
  header?: {
    closeIcon?: "arrow-back" | "close";
    closeLabel: string;
    onClose: () => void;
    status?: string;
    title: string;
  };
  headers?: Readonly<Record<string, string>>;
  onError?: (description: string) => void;
  onFavicon?: (icon: string | null) => void;
  onHttpError?: (statusCode: number) => void;
  onNavigation?: (metadata: {
    readonly loading: boolean;
    readonly title: string;
    readonly url: string;
  }) => void;
  onOpenWindow?: (url: string) => boolean;
  originWhitelist?: string[];
  showCloseButton?: boolean;
  tabsControl?: BrowserTabsControl;
  url: string;
  wide?: boolean;
}) {
  return <View accessibilityLabel={`Internal browser: ${url}`} style={styles.root} />;
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.background,
    flex: 1,
  },
});
