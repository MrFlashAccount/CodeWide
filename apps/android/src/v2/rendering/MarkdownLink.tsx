import type { ReactNode } from "react";

import { useEvent } from "../../react/useEvent";
import { colors } from "../theme";
import { useAsyncAction } from "../presentation/actions/useAsyncAction";
import { PresentationText as Text } from "../presentation/text/ProductText";
import { classifyMarkdownLink } from "./linkClassification";
import { useV2RenderingCapabilities } from "./renderingCapabilities";

interface MarkdownLinkProps {
  children: ReactNode;
  url: string;
}

export function MarkdownLink(props: MarkdownLinkProps): React.JSX.Element {
  const { children, url } = props;
  const capabilities = useV2RenderingCapabilities();
  const classification = classifyMarkdownLink(url);
  const action = useAsyncAction();
  const open = useEvent(() => {
    action.run({
      action: async () => openClassifiedLink(url, classification, capabilities),
      failure: "Could not open link.",
      pending: "Opening link…",
    });
  });
  const enabled = linkEnabled(url, classification.kind, capabilities);
  if (!enabled) return <Text style={styles.disabled}>{children}</Text>;
  return (
    <Text
      accessibilityHint="Opens the link"
      accessibilityRole="link"
      accessibilityState={{ busy: action.pending, disabled: action.pending }}
      onPress={open}
      style={styles.link}
    >
      {children}
      {action.pending ? (
        <Text style={styles.pending}> · Opening…</Text>
      ) : action.error === null ? null : (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {` · ${action.error} · Retry`}
        </Text>
      )}
    </Text>
  );
}

async function openClassifiedLink(
  rawUrl: string,
  classification: ReturnType<typeof classifyMarkdownLink>,
  capabilities: ReturnType<typeof useV2RenderingCapabilities>,
): Promise<void> {
  switch (classification.kind) {
    case "external":
      await capabilities.openExternalLink?.(classification.url);
      return;
    case "loopback":
      await capabilities.openLoopbackLink?.(classification.url);
      return;
    case "remoteFile":
      await requireOpened(capabilities.openLocalDocument?.(classification.href));
      return;
    case "anchor":
      await requireOpened(capabilities.openLocalDocument?.(rawUrl));
      return;
    case "rejected":
      return;
  }
}

async function requireOpened(result: boolean | Promise<boolean> | undefined): Promise<void> {
  if ((await result) === false) throw new Error("The document could not be opened.");
}

function linkEnabled(
  url: string,
  kind: ReturnType<typeof classifyMarkdownLink>["kind"],
  capabilities: ReturnType<typeof useV2RenderingCapabilities>,
): boolean {
  if (kind === "external") return capabilities.openExternalLink !== undefined;
  if (kind === "loopback") return capabilities.openLoopbackLink !== undefined;
  if (kind === "remoteFile" || kind === "anchor") {
    return (
      capabilities.openLocalDocument !== undefined &&
      capabilities.canOpenLocalDocument?.(url) !== false
    );
  }
  return false;
}

const styles = {
  disabled: { color: colors.textMuted },
  error: { color: colors.red },
  link: { color: colors.accent, textDecorationLine: "underline" as const },
  pending: { color: colors.textMuted },
};
