import { useState } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../ui/Typography";
import { InternalBrowser } from "./InternalBrowser";
import { styles } from "./BrowserWorkspace.styles";

/** Standalone V1 browser surface for route-owned URL destinations. */
export function BrowserWorkspace({
  headers,
  onClose,
  title,
  url,
}: {
  headers?: Readonly<Record<string, string>>;
  onClose: () => void;
  title: string;
  url: string;
}) {
  const [error, setError] = useState<string | null>(null);
  return (
    <View style={styles.root} testID="browser-workspace">
      {error !== null && <Text style={styles.previewError}>{error}</Text>}
      <View style={styles.flex}>
        <InternalBrowser
          header={{ closeLabel: "Close browser", onClose, title }}
          onError={setError}
          onHttpError={(statusCode) => {
            setError(
              statusCode === 502
                ? "This page is currently unavailable"
                : `Page returned HTTP ${String(statusCode)}`,
            );
          }}
          originWhitelist={[new URL(url).origin]}
          url={url}
          {...(headers === undefined ? {} : { headers })}
        />
      </View>
    </View>
  );
}
