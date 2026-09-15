/** V1 ForwardedLoopbackBrowser owner, extracted without changing interaction or resource lifetime. */
import { useState } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../ui/Typography";
import { InternalBrowser } from "./browser/InternalBrowser";
import { styles } from "./ForwardedLoopbackBrowser.styles";

export function ForwardedLoopbackBrowser({
  title,
  url,
  topInset,
  bottomInset,
  onClose,
}: {
  title: string;
  url: string;
  topInset: number;
  bottomInset: number;
  onClose(): void;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <View
      testID="forwarded-loopback-browser"
      style={[styles.root, { paddingTop: topInset, paddingBottom: bottomInset }]}
    >
      {error !== null && <Text style={styles.previewError}>{error}</Text>}
      <View style={styles.flex}>
        <InternalBrowser
          url={url}
          header={{ title, closeLabel: "Close browser", onClose }}
          originWhitelist={[new URL(url).origin]}
          onHttpError={(statusCode) =>
            setError(
              statusCode === 502
                ? "This port is currently unavailable"
                : `Preview returned HTTP ${statusCode}`,
            )
          }
          onError={setError}
        />
      </View>
    </View>
  );
}
