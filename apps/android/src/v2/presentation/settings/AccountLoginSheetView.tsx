import { Pressable, StyleSheet, View } from "react-native";

import { useEvent } from "../../../react/useEvent";
import { colors, radii, spacing, touchTarget, typeScale, typeWeight } from "../../theme";
import { PresentationIcon } from "../icons/PresentationIcon";
import { PresentationSheetView } from "../surfaces/PresentationSheetView";
import { ProductText } from "../text/ProductText";
import { ShimmerText } from "../text/ShimmerText";

interface AccountLoginSheetViewProps {
  codeCopied: boolean;
  error: string | null;
  onClose(): void;
  onCopy(): void;
  onOpen(): void;
  pending: boolean;
  userCode: string;
}

export function AccountLoginSheetView(props: AccountLoginSheetViewProps): React.JSX.Element {
  const { codeCopied, error, onClose, onCopy, onOpen, pending, userCode } = props;
  const changeOpen = useEvent((open: boolean) => {
    if (!open) onClose();
  });
  return (
    <PresentationSheetView
      contentProps={{ enableDynamicSizing: true, enableOverDrag: false, index: 0 }}
      isOpen
      onOpenChange={changeOpen}
    >
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={styles.iconBadge}>
            <PresentationIcon color={colors.primary} name="people" size={21} />
          </View>
          <View style={styles.copy}>
            <ProductText style={styles.title} weight="semibold">
              Connect Codex account
            </ProductText>
            <ProductText style={styles.subtitle} tone="muted">
              Sign in to add this account as an automatic fallback.
            </ProductText>
          </View>
          <Pressable
            accessibilityLabel="Close Codex account sign-in"
            disabled={pending}
            onPress={onClose}
            style={styles.iconButton}
          >
            <PresentationIcon color={colors.text} name="close" size={21} />
          </Pressable>
        </View>
        <View style={styles.codeCard}>
          <View style={styles.copy}>
            <ProductText style={styles.codeLabel} tone="muted">
              One-time code
            </ProductText>
            <ProductText selectable style={styles.code} weight="semibold">
              {userCode}
            </ProductText>
          </View>
          <Pressable
            accessibilityLabel="Copy one-time Codex sign-in code"
            accessibilityRole="button"
            accessibilityState={{ disabled: pending }}
            disabled={pending}
            onPress={onCopy}
            style={[styles.copyButton, codeCopied && styles.copyButtonDone]}
          >
            {codeCopied ? (
              <PresentationIcon color={colors.green} name="checkCircle" size={17} />
            ) : null}
            <ProductText style={codeCopied ? styles.copyLabelDone : styles.copyLabel}>
              {codeCopied ? "Copied" : "Copy"}
            </ProductText>
          </Pressable>
        </View>
        <ProductText style={styles.hint} tone="muted">
          The code is copied automatically when you open sign-in. Paste it in the browser to finish
          connecting.
        </ProductText>
        {error === null ? null : (
          <ProductText accessibilityLiveRegion="polite" style={styles.error} tone="danger">
            {error}
          </ProductText>
        )}
        <Pressable
          accessibilityLabel="Open Codex sign-in"
          accessibilityRole="button"
          accessibilityState={{ busy: pending, disabled: pending }}
          disabled={pending}
          onPress={onOpen}
          style={[styles.primaryButton, pending && styles.disabled]}
        >
          {pending ? (
            <ShimmerText style={styles.primaryText} text="Opening sign-in" />
          ) : (
            <>
              <PresentationIcon color={colors.onPrimary} name="forward" size={19} />
              <ProductText style={styles.primaryText} weight="semibold">
                Open sign-in
              </ProductText>
            </>
          )}
        </Pressable>
      </View>
    </PresentationSheetView>
  );
}

const styles = StyleSheet.create({
  code: typeScale.heading,
  codeCard: {
    alignItems: "center",
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.large,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
  },
  codeLabel: typeScale.caption,
  copy: { flex: 1, minWidth: 0 },
  copyButton: {
    alignItems: "center",
    borderColor: colors.borderSoft,
    borderRadius: radii.large,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: touchTarget,
    paddingHorizontal: spacing.sm,
  },
  copyButtonDone: { borderColor: colors.green },
  copyLabel: { color: colors.text, ...typeScale.label },
  copyLabelDone: { color: colors.green, ...typeScale.label },
  disabled: { opacity: 0.55 },
  error: { ...typeScale.label },
  header: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  hint: typeScale.label,
  iconBadge: {
    alignItems: "center",
    backgroundColor: colors.primaryContainer,
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  iconButton: {
    alignItems: "center",
    borderRadius: radii.large,
    height: touchTarget,
    justifyContent: "center",
    width: touchTarget,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radii.large,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    minHeight: touchTarget,
  },
  primaryText: { color: colors.onPrimary, ...typeScale.body, fontWeight: typeWeight.semibold },
  root: { gap: spacing.md, paddingBottom: spacing.md },
  subtitle: typeScale.label,
  title: typeScale.title,
});
