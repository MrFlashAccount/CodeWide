/** V1 ForwardedLoopbackBrowser owner, extracted without changing interaction or resource lifetime. */
import { useState } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../ui/Typography";
import { InternalBrowser } from "./browser/InternalBrowser";
import { styles } from "./ForwardedLoopbackBrowser.styles";

export function ForwardedLoopbackBrowser({
  bottomInset,
  onClose,
  title,
  topInset,
  url,
}: {
  bottomInset: number;
  onClose: () => void;
  title: string;
  topInset: number;
  url: string;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <View
      style={[styles.root, { paddingBottom: bottomInset, paddingTop: topInset }]}
      testID="forwarded-loopback-browser"
    >
      {error !== null && <Text style={styles.previewError}>{error}</Text>}
      <View style={styles.flex}>
        <InternalBrowser
          header={{ closeLabel: "Close browser", onClose, title }}
          onError={setError}
          onHttpError={(statusCode) => {
            setError(
              statusCode === 502
                ? "This port is currently unavailable"
                : `Preview returned HTTP ${String(statusCode)}`,
            );
          }}
          originWhitelist={[new URL(url).origin]}
          url={url}
        />
      </View>
    </View>
  );
}
