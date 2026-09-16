import { Host, Snackbar, SnackbarHost, type SnackbarHostRef } from "@expo/ui/jetpack-compose";
import { useRef, type ReactNode } from "react";
import { StyleSheet } from "react-native";

import { appLogger } from "../observability/logger";
import { useEvent } from "../react/useEvent";
import { colors, spacing } from "../theme";
import { AppNoticeContext, type AppNoticeRequest } from "./appNoticeContext";

const SHORT_NOTICE_MAX_MS = 4000;
const RESOLVED_NOTICE_QUEUE = Promise.resolve();

/** Presents transient notices through the platform Material snackbar queue. */
export function AppNoticeProvider({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  const hostRef = useRef<SnackbarHostRef>(null);
  const queueRef = useRef(RESOLVED_NOTICE_QUEUE);
  const show = useEvent((request: AppNoticeRequest) => {
    queueRef.current = queueRef.current
      .then(async () => {
        const host = hostRef.current;
        if (host === null) {
          return;
        }
        const result = await host.showSnackbar({
          ...(request.actionLabel === undefined ? {} : { actionLabel: request.actionLabel }),
          duration:
            request.duration !== undefined && request.duration <= SHORT_NOTICE_MAX_MS
              ? "short"
              : "long",
          message:
            request.description === undefined
              ? request.label
              : `${request.label}\n${request.description}`,
          withDismissAction: true,
        });
        if (result === "actionPerformed") {
          request.onActionPress?.();
        }
      })
      .catch((error: unknown) => {
        appLogger.warnCaught({ error, event: "notice.present.failed" });
      });
  });

  return (
    <AppNoticeContext.Provider value={{ show }}>
      {children}
      <NoticeHost hostRef={hostRef} />
    </AppNoticeContext.Provider>
  );
}

function NoticeHost({
  hostRef,
}: {
  readonly hostRef: React.RefObject<SnackbarHostRef | null>;
}): React.JSX.Element {
  return (
    <Host colorScheme="dark" matchContents pointerEvents="box-none" style={styles.host}>
      <SnackbarHost ref={hostRef}>
        <NoticeSnackbar />
      </SnackbarHost>
    </Host>
  );
}

function NoticeSnackbar(): React.JSX.Element {
  return (
    <Snackbar
      actionContentColor={colors.primary}
      containerColor={colors.surfaceContainerHighest}
      contentColor={colors.text}
      dismissActionContentColor={colors.textMuted}
    />
  );
}

const styles = StyleSheet.create({
  host: {
    bottom: spacing.md,
    left: spacing.md,
    position: "absolute",
    right: spacing.md,
  },
});
