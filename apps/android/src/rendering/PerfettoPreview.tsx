import { QueryClient, useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { privateAssetCacheKey } from "../data/private-transfer";
import { useEvent } from "../react/useEvent";
import { colors, spacing } from "../theme";
import { OverflowMenu } from "../ui/OverflowMenu";
import { ThreePanelsHeader } from "../ui/ThreePanelsHeader";
import { AppText } from "../ui/Typography";
import type { DocumentPreviewRequest } from "./document-preview";
import { PerfettoTimeline } from "./nativePerfettoTimeline";
import { stagePerfettoFile } from "./perfettoFile";

// The fullscreen host also mounts outside the workspace query provider.
const client = new QueryClient();
/** In-app trace viewer shared by attachment routes and the fullscreen document host. */
export function PerfettoPreview({
  onClose,
  onDownload,
  request,
}: {
  readonly onClose: () => void;
  readonly onDownload: (() => void) | null;
  readonly request: Extract<DocumentPreviewRequest, { readonly kind: "perfetto" }>;
}): React.JSX.Element {
  const owner = useId();
  const source = request.source ?? { kind: "path" as const, path: request.path };
  const key = ["perfetto-preview", owner, privateAssetCacheKey(source)] as const;
  const file = useQuery(
    {
      enabled: PerfettoTimeline !== null,
      gcTime: 0,
      networkMode: "always",
      queryFn: async ({ signal }) =>
        stagePerfettoFile({ client, getAccess: request.getTransferAccess, key, signal, source }),
      queryKey: key,
      retry: false,
      staleTime: "static",
    },
    client,
  );
  const retry = useEvent(() => {
    void file.refetch().catch(() => undefined);
  });
  return (
    <View style={styles.root}>
      <ThreePanelsHeader
        back={{ kind: "nested", label: "Close trace", run: onClose }}
        menu={
          onDownload === null ? undefined : (
            <OverflowMenu
              accessibilityLabel="Trace actions"
              actions={[{ icon: "download-outline", id: "download", label: "Download" }]}
              onSelect={onDownload}
            />
          )
        }
        testID="perfetto-header"
        title={
          <AppText
            ellipsizeMode="middle"
            numberOfLines={1}
            shimmering={PerfettoTimeline !== null && file.isPending}
            style={styles.title}
          >
            {request.name}
          </AppText>
        }
      />
      {PerfettoTimeline === null ? (
        <AppText>This build does not include the Android trace viewer.</AppText>
      ) : file.isError ? (
        <Pressable accessibilityRole="button" onPress={retry} style={styles.status}>
          <AppText>{file.error.message} · Retry</AppText>
        </Pressable>
      ) : file.data !== undefined ? (
        <PerfettoTimeline sourceUri={file.data} style={styles.body} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  root: { flex: 1 },
  status: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    padding: spacing.md,
  },
  title: {
    color: colors.text,
    flexShrink: 1,
  },
});
