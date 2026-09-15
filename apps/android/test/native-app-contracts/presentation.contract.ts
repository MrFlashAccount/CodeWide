import { expect, it } from "vitest";
import {
  heroUiRoot,
  appSheet,
  appFullscreenModal,
  turnControlMenus,
  actionMenu,
  messageActionMenu,
  appDialog,
  appDialogSurface,
  heroUIRoot,
  conversationPanelUnderlay,
  conversationChromeLayout,
  swipeDiscardAction,
  resourceContextChip,
  resourceContextChipStyles,
} from "./presentation-sources";

it("preserves presentation integration contracts", () => {
  expect(heroUiRoot).toContain('from "heroui-native/provider-raw"');
  expect(heroUiRoot).toContain('from "heroui-native/portal"');
  expect(heroUiRoot).toContain("<AppDialogProvider>");
  expect(heroUiRoot).toContain("<PortalHost />");
  expect(heroUiRoot.indexOf("<AppDialogProvider>")).toBeLessThan(
    heroUiRoot.indexOf("<PortalHost />"),
  );
  expect(heroUiRoot).toContain('Uniwind.setTheme("dark")');
  expect(appSheet).toContain('from "@expo/ui/jetpack-compose"');
  expect(appSheet).toContain('<Host colorScheme="dark"');
  expect(appSheet).toContain("<ModalBottomSheet");
  expect(appSheet).toContain("showDragHandle={contentProps.enablePanDownToClose ?? true}");
  expect(appSheet).toContain("<RNHostView matchContents={fitToContents}");
  expect(appSheet).toContain("!fitToContents && styles.fixedHostContent");
  expect(appSheet).toContain("fixedHostContent: { flexGrow: 1, height: 0 }");
  expect(appSheet).toContain("useWindowDimensions");
  expect(appSheet).not.toContain("borderRadius:");
  expect(appSheet).not.toContain("backgroundColor:");
  expect(appSheet).toContain("sheetRef.current");
  expect(appSheet).toContain("sheetRef.current?.hide()");
  expect(appSheet).toContain("onOpenChange(false)");
  expect(appSheet).toContain("<RecoverableRenderBoundary");
  expect(appSheet).toContain('label="Bottom sheet content"');
  expect(appSheet).toContain('resetKey={isOpen ? "open" : "closed"}');
  expect(appSheet).toContain("detached");
  expect(appSheet).toContain(
    "<ScrollView {...props} nestedScrollEnabled={props.nestedScrollEnabled ?? true} />",
  );
  expect(appSheet).toContain("export function AppSheetScrollView");
  expect(appFullscreenModal).toContain('presentationStyle="fullScreen"');
  expect(turnControlMenus).toContain('section: "Model"');
  expect(turnControlMenus).toContain('section: "Thinking level"');
  expect(turnControlMenus).toContain('section: "Security permissions"');
  expect(turnControlMenus).toContain('section: "Personality"');
  expect(turnControlMenus).toContain("<ActionMenu");
  expect(turnControlMenus).not.toContain("heroui-native/menu");
  expect(turnControlMenus).not.toContain("heroui-native/sub-menu");
  expect(actionMenu).toContain('from "./CodeWideMenu.native"');
  expect(actionMenu).toContain("<CodeWideMenu");
  expect(actionMenu).not.toContain('from "heroui-native/menu"');
  expect(actionMenu).not.toContain("Menu.Portal");
  expect(actionMenu).not.toContain("requestAnimationFrame");
  expect(actionMenu).toContain("style={[styles.root, style]}");
  expect(actionMenu).toContain("children.props.onPress?.(event)");
  expect(actionMenu).toContain("expanded={isOpen}");
  expect(actionMenu).not.toContain("triggerLayout");
  expect(actionMenu).not.toContain("event.nativeEvent.locationX");
  expect(actionMenu).toContain("children.props.onLongPress?.(event)");
  expect(actionMenu).toContain("destructive: action.destructive");
  expect(actionMenu).toContain("selected: action.selected");
  expect(messageActionMenu.match(/<CodeWideMenu/gu)).toHaveLength(1);
  expect(messageActionMenu).not.toContain("heroui-native/menu");
  expect(messageActionMenu).toContain("hostRef.current?.open(request, event)");
  expect(turnControlMenus).toContain("id: SERVER_DEFAULT_PERMISSIONS");
  expect(turnControlMenus).toContain('description: "Use the server\'s configured access level"');
  expect(appDialog).toContain("{state.isOpen && <AppDialogSurface isOpen request={state.request}");
  expect(appDialogSurface).toContain('from "heroui-native/dialog"');
  expect(appDialogSurface).toContain('<Dialog.Overlay variant="blur"');
  expect(appDialogSurface).toContain("<Dialog.Portal style={styles.portal}>");
  expect(appDialogSurface).toContain('alignItems: "center"');
  expect(appDialogSurface).toContain('justifyContent: "center"');
  expect(appDialogSurface).toContain('alignSelf: "center"');
  expect(heroUIRoot).toContain("<ImagePreviewHost>");
  expect(conversationPanelUnderlay).toContain("backgroundColor: surfaceColor");
  expect(conversationPanelUnderlay).not.toMatch(/blur/iu);
  expect(conversationChromeLayout).not.toContain("conversationBlurExtent");
  expect(swipeDiscardAction).toContain("accessibilityState={{ disabled }}");
  expect(resourceContextChip).toMatch(
    /containerStyle=\{\[\s*styles\.composerContextValue,\s*refreshing && styles\.composerContextCountHidden,?\s*\]\}/,
  );
  expect(resourceContextChipStyles).toMatch(
    /composerContextValue: \{\s*alignSelf: "center",\s*justifyContent: "center",?\s*\}/,
  );
  expect(messageActionMenu).toMatch(/\{\s*id: "copy",\s*label: "Copy",\s*icon: "copy-outline"/);
  expect(messageActionMenu).toMatch(
    /\{\s*id: "fork",\s*label: "Fork",\s*icon: "git-branch-outline"/,
  );
});
