import { StyleSheet } from "react-native";

import {
  colors,
  controlSize,
  layoutSize,
  radii,
  spacing,
  typeScale,
  typeTracking,
  typeWeight,
} from "../../../theme";
import { APP_SHEET_MAX_WIDTH } from "../../../ui/appSheetGeometry";

/** A connect button keeps a readable width on tablets instead of spanning the card. */
const PRIMARY_BUTTON_MAX_WIDTH = 360;
const WELCOME_COPY_MAX_WIDTH = 408;
const WELCOME_ILLUSTRATION_MAX_WIDTH = 920;
const WELCOME_ILLUSTRATION_WIDTH = 980;
const WELCOME_ILLUSTRATION_HEIGHT = 720;
const WELCOME_ILLUSTRATION_ASPECT_RATIO = WELCOME_ILLUSTRATION_WIDTH / WELCOME_ILLUSTRATION_HEIGHT;
const REACTICX_TRAY_HORIZONTAL_INSET = 20;

/** Shared geometry of onboarding cards: 16dp inset, 12dp inner rhythm, no nested cards. */
export const onboardingStyles = StyleSheet.create({
  actions: {
    columnGap: spacing.xs,
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: spacing.xs,
  },
  authPending: {
    gap: spacing.sm,
  },
  authPendingTitle: {
    ...typeScale.title,
    color: colors.text,
  },
  body: {
    ...typeScale.body,
    color: colors.textMuted,
  },
  card: {
    backgroundColor: colors.surfaceContainer,
    borderRadius: radii.medium,
    gap: spacing.sm,
    padding: spacing.md,
  },
  code: {
    ...typeScale.heading,
    color: colors.text,
    fontFamily: "monospace",
    letterSpacing: typeTracking.pairingCode,
  },
  // Sibling actions share the row width equally, so their edges align.
  equalAction: {
    flex: 1,
    minWidth: 0,
  },
  equalActions: {
    columnGap: spacing.xs,
    flexDirection: "row",
  },
  error: {
    ...typeScale.body,
    color: colors.error,
  },
  fill: {
    flex: 1,
  },
  header: {
    alignItems: "center",
    columnGap: spacing.sm,
    flexDirection: "row",
  },
  hostLoginActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "flex-end",
  },
  hostLoginCancel: {
    alignSelf: "flex-start",
    marginLeft: -spacing.md,
  },
  hostLoginCodeBox: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderColor: colors.borderSoft,
    borderRadius: radii.small,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  hostLoginFooter: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  hostLoginLead: {
    gap: spacing.xs,
  },
  hostLoginOpenButton: {
    gap: spacing.xs,
  },
  hostLoginOpenLabel: {
    ...typeScale.body,
    color: colors.onPrimary,
  },
  hostLoginPanel: {
    gap: spacing.md,
  },
  hostLoginStatus: {
    ...typeScale.body,
    color: colors.textMuted,
    flexGrow: 1,
  },
  hostLoginTitle: {
    ...typeScale.heading,
    color: colors.text,
  },
  label: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  list: {
    gap: spacing.xs,
    padding: spacing.md,
  },
  otherWaysDivider: {
    backgroundColor: colors.borderSoft,
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  otherWaysHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  primaryButton: {
    alignSelf: "flex-start",
    maxWidth: PRIMARY_BUTTON_MAX_WIDTH,
  },
  providerCaption: {
    ...typeScale.label,
    color: colors.textMuted,
  },
  providerIdentity: {
    flex: 1,
    gap: spacing.optical,
    minWidth: 0,
  },
  providerList: {
    gap: spacing.md,
    paddingBottom: spacing.md,
    paddingHorizontal: REACTICX_TRAY_HORIZONTAL_INSET,
  },
  providerPanel: {
    gap: spacing.sm,
  },
  providerRow: {
    alignItems: "center",
    borderBottomColor: colors.borderSoft,
    borderBottomWidth: StyleSheet.hairlineWidth,
    columnGap: spacing.sm,
    flexDirection: "row",
    minHeight: layoutSize.row,
    paddingVertical: spacing.sm,
  },
  providerRowIcon: {
    alignItems: "center",
    height: controlSize.touch,
    justifyContent: "center",
    width: controlSize.touch,
  },
  providerRowTrailing: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xxs,
  },
  providerTitle: {
    ...typeScale.title,
    color: colors.text,
  },
  section: {
    gap: spacing.sm,
  },
  // The sheet surface already insets its content; a sheet list adds only rhythm.
  sheetList: {
    gap: spacing.sm,
    paddingBottom: spacing.md,
  },
  step: {
    ...typeScale.body,
    color: colors.text,
  },
  successActions: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  successCopy: {
    gap: spacing.xs,
  },
  successIcon: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.successContainer,
    borderRadius: radii.pill,
    height: controlSize.touch,
    justifyContent: "center",
    width: controlSize.touch,
  },
  successPanel: {
    gap: spacing.md,
  },
  successTitle: {
    ...typeScale.heading,
    color: colors.text,
  },
  title: {
    ...typeScale.title,
    color: colors.text,
    flexShrink: 1,
  },
  trayAccountButton: {
    flexShrink: 0,
  },
  trayAccountIcon: {
    alignItems: "center",
    height: controlSize.regular,
    justifyContent: "center",
    width: controlSize.regular,
  },
  trayAccountRow: {
    alignItems: "center",
    backgroundColor: colors.surfaceContainerHigh,
    borderColor: colors.borderSoft,
    borderRadius: radii.medium,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: layoutSize.row,
    padding: spacing.sm,
  },
  trayAlternatives: {
    gap: 0,
  },
  trayHeaderCopy: {
    alignItems: "baseline",
    flexDirection: "row",
    flexShrink: 1,
    gap: spacing.compact,
    minWidth: 0,
  },
  trayHeaderIdentity: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.compact,
    minWidth: 0,
  },
  trayIntro: {
    ...typeScale.body,
    color: colors.textMuted,
  },
  trayMethodLabel: {
    ...typeScale.body,
    color: colors.text,
    flex: 1,
  },
  trayMethodRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: controlSize.touch,
  },
  trayMethodRowSeparated: {
    borderTopColor: colors.borderSoft,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  trayMethods: {
    gap: spacing.md,
  },
  trayStep: {
    ...typeScale.label,
    color: colors.textMuted,
    flexShrink: 0,
  },
  traySurface: {
    alignSelf: "center",
    maxWidth: APP_SHEET_MAX_WIDTH,
    width: "100%",
  },
  trayTrust: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
    paddingTop: spacing.sm,
  },
  trust: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  weightMedium: {
    fontWeight: typeWeight.medium,
  },
  welcome: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingBottom: spacing.xl + controlSize.touch,
    paddingHorizontal: spacing.lg,
  },
  welcomeBody: {
    ...typeScale.body,
    color: colors.textMuted,
    marginTop: spacing.sm,
    maxWidth: WELCOME_COPY_MAX_WIDTH,
    textAlign: "center",
  },
  welcomeButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radii.pill,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    marginTop: spacing.lg,
    minHeight: controlSize.touch,
    paddingHorizontal: spacing.lg,
    width: "100%",
  },
  welcomeButtonLabel: {
    ...typeScale.title,
    color: colors.onPrimary,
  },
  welcomeCopy: {
    alignItems: "center",
    justifyContent: "center",
    maxWidth: WELCOME_COPY_MAX_WIDTH,
    width: "100%",
  },
  welcomeIllustration: {
    aspectRatio: WELCOME_ILLUSTRATION_ASPECT_RATIO,
    maxWidth: WELCOME_ILLUSTRATION_MAX_WIDTH,
    minWidth: 0,
    width: "100%",
  },
  welcomeMark: {
    alignItems: "center",
    height: controlSize.touch,
    justifyContent: "center",
    marginBottom: spacing.md,
    width: controlSize.touch,
  },
  welcomeTitle: {
    ...typeScale.heading,
    color: colors.text,
    textAlign: "center",
  },
  welcomeTrust: {
    ...typeScale.label,
    color: colors.textMuted,
    marginTop: spacing.md,
  },
});
