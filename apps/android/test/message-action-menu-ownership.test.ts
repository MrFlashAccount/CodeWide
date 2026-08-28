import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const screen = readFileSync(new URL("../src/CodeWideScreen.tsx", import.meta.url), "utf8");
const bubble = readFileSync(new URL("../src/rendering/Bubble.tsx", import.meta.url), "utf8");
const nativeMenu = readFileSync(new URL("../src/ui/MessageActionMenu.native.tsx", import.meta.url), "utf8");
const codeWideMenu = readFileSync(new URL("../src/ui/CodeWideMenu.native.tsx", import.meta.url), "utf8");
const webMenu = readFileSync(new URL("../src/ui/MessageActionMenu.web.tsx", import.meta.url), "utf8");

describe("conversation-owned message actions", () => {
  it("mounts one shared native menu host instead of one menu per bubble", () => {
    expect(screen.match(/<MessageActionMenuProvider>/gu)).toHaveLength(1);
    expect(screen).not.toContain("function MessageContextMenu");
    expect(screen).not.toContain("messageContextRoot");
    expect(nativeMenu.match(/<CodeWideMenu/gu)).toHaveLength(1);
    expect(nativeMenu).not.toContain("heroui-native/menu");
    expect(nativeMenu).toContain("<MessageActionMenuHost ref={hostRef} />");
    expect(webMenu).toContain("<MessageActionMenuHost ref={hostRef} />");
  });

  it("lets Compose own popup placement and dismissal", () => {
    expect(codeWideMenu).toContain('from "@expo/ui/jetpack-compose"');
    expect(codeWideMenu).toContain("<DropdownMenu");
    expect(codeWideMenu).toContain("<DropdownMenu.Items>");
    expect(codeWideMenu).toContain('<MenuIcon icon="checkmark" size={18} color={colors.text} />');
    expect(codeWideMenu).not.toContain(">✓</Text>");
    expect(nativeMenu).not.toContain("requestAnimationFrame");
    expect(nativeMenu).not.toContain("Menu.Portal");
    expect(codeWideMenu).toContain("<Host colorScheme=\"dark\" matchContents");
    expect(codeWideMenu).toContain("<RNHostView matchContents>{children}</RNHostView>");
    expect(codeWideMenu).not.toContain("<Box");
  });

  it("keeps menu state inside the imperative host", () => {
    expect(nativeMenu).toContain("hostRef.current?.open(request, event)");
    expect(nativeMenu).toContain("useImperativeHandle(ref, () => ({ open }), [open])");
    expect(nativeMenu).toContain("setMenu(null)");
    expect(nativeMenu).toContain("collapsable={false}");
    expect(nativeMenu).toContain('key={menu?.generation ?? "closed"}');
    expect(webMenu).toContain("if (!openState) setRequest(null)");
  });

  it("keeps native text selection free and exposes actions beside the agent bubble", () => {
    expect(bubble).not.toContain("onLongPress");
    expect(bubble).not.toContain("Gesture.LongPress()");
    expect(bubble).not.toContain("<Pressable");
    expect(screen).toContain('accessibilityLabel="Message actions"');
    expect(screen).toContain("styles.messageActionButton");
    expect(screen).toContain("<MessageActionRail completedAt={rawTurn.completedAt} showActions={showMessageActions} request={{");
    expect(screen).not.toContain("onLongPress={(event) => openMessageActions");
  });

  it("offers response review from the explicit action menu", () => {
    expect(nativeMenu).toContain('icon: "copy-outline"');
    expect(nativeMenu).toContain('icon: "git-branch-outline"');
    expect(nativeMenu).toContain('icon: "chatbubble-ellipses-outline"');
    expect(nativeMenu).not.toContain("assets/menu-icons");
    expect(webMenu).toContain('<Text style={styles.label}>Review response</Text>');
    expect(screen).toContain('beginContentReview({ kind: "response", target: agentReviewTarget })');
  });

  it("keeps message actions tap-only so the rail cannot steal vertical scrolling", () => {
    expect(screen).not.toContain("const reviewGesture = Gesture.Pan()");
    expect(screen).not.toContain("translationX <= -28 || velocityX <= -500");
    expect(screen).toContain("<View style={styles.messageActionRail}>");
    expect(screen).toContain("<Text style={styles.messageRailTime}>{formatClockTime(completedAt)}</Text>");
    expect(screen).toContain('name="ellipsis-vertical"');
    expect(screen).toContain("actionButtonRef.current?.measureInWindow");
    expect(screen).not.toContain("event.nativeEvent.pageX");
    expect(nativeMenu).toContain("left: pageX - rootX, top: pageY - rootY, width, height");
  });
});
