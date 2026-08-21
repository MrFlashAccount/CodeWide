import type { Personality } from "@codewide/codex-protocol/v0.147.0";
import * as Haptics from "expo-haptics";
import { Menu, type MenuKey } from "heroui-native/menu";
import { SubMenu } from "heroui-native/sub-menu";
import { Text } from "heroui-native/text";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";

import { colors } from "../theme";
import type {
  ModelThinkingMenuProps,
  PermissionsMenuProps,
} from "./TurnControlMenus.types";

const PERSONALITIES = ["friendly", "pragmatic", "none"] as const satisfies readonly Personality[];
const SERVER_DEFAULT_PERSONALITY = "personality:server-default";
const SERVER_DEFAULT_PERMISSIONS = "permissions:server-default";

function selectedKey(keys: Set<MenuKey>): string | null {
  const value = keys.values().next().value;
  return typeof value === "string" ? value : null;
}

function selectionFeedback(): void {
  void Haptics.selectionAsync().catch(() => undefined);
}

function useMenuLifecycle(onOpen: () => void, onClose: () => void) {
  const [isOpen, setIsOpen] = useState(false);
  const onOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open) onOpen();
    else onClose();
  };
  return { isOpen, onOpenChange };
}

export function ModelThinkingMenu({
  accessibilityLabel,
  triggerChildren,
  triggerStyle,
  models,
  loading,
  error,
  selectedModel,
  selectedEffort,
  selectedPersonality,
  onOpen,
  onClose,
  onSelectModel,
  onSelectEffort,
  onSelectPersonality,
}: ModelThinkingMenuProps) {
  const lifecycle = useMenuLifecycle(onOpen, onClose);
  const { width } = useWindowDimensions();
  const menuWidth = Math.min(344, width - 24);
  const model = models.find((candidate) => candidate.id === selectedModel) ?? models[0];
  const effectiveModel = selectedModel ?? model?.id ?? null;
  const efforts = model === undefined
    ? []
    : model.efforts.length > 0
      ? model.efforts
      : [model.defaultEffort];
  const effectiveEffort = selectedEffort ?? model?.defaultEffort ?? null;
  const modelKeys = useMemo(
    () => effectiveModel === null ? new Set<MenuKey>() : new Set<MenuKey>([`model:${effectiveModel}`]),
    [effectiveModel],
  );
  const effortKeys = useMemo(
    () => effectiveEffort === null ? new Set<MenuKey>() : new Set<MenuKey>([`effort:${effectiveEffort}`]),
    [effectiveEffort],
  );
  const personalityKeys = useMemo(
    () => new Set<MenuKey>([selectedPersonality === null ? SERVER_DEFAULT_PERSONALITY : `personality:${selectedPersonality}`]),
    [selectedPersonality],
  );

  return (
    <Menu presentation="popover" isOpen={lifecycle.isOpen} onOpenChange={lifecycle.onOpenChange}>
      <Menu.Trigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          style={triggerStyle}
        >
          {triggerChildren}
        </Pressable>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Overlay className="bg-backdrop" />
        <Menu.Content
          presentation="popover"
          placement="top"
          align="start"
          width={menuWidth}
          offset={10}
          className="border border-border"
        >
          {loading && models.length === 0 && <Menu.Label>Loading from remote server…</Menu.Label>}
          {error !== null && <Text style={styles.error}>{error}</Text>}

          <Menu.Label>Model</Menu.Label>
          <Menu.Group
            selectionMode="single"
            selectedKeys={modelKeys}
            disallowEmptySelection
            shouldCloseOnSelect={false}
            onSelectionChange={(keys) => {
              const key = selectedKey(keys);
              if (key === null || !key.startsWith("model:")) return;
              const id = key.slice("model:".length);
              const candidate = models.find((item) => item.id === id);
              if (candidate === undefined) return;
              const nextEffort = candidate.efforts.includes(effectiveEffort ?? "")
                ? effectiveEffort ?? candidate.defaultEffort
                : candidate.defaultEffort;
              selectionFeedback();
              onSelectModel(candidate.id, nextEffort);
            }}
          >
            {models.length === 0 && !loading
              ? <Menu.Item isDisabled><Menu.ItemTitle>No models returned by the server</Menu.ItemTitle></Menu.Item>
              : models.map((candidate) => (
                  <Menu.Item key={candidate.id} id={`model:${candidate.id}`}>
                    <Menu.ItemTitle>{candidate.label}</Menu.ItemTitle>
                    <Menu.ItemIndicator />
                  </Menu.Item>
                ))}
          </Menu.Group>

          {model !== undefined && (
            <>
              <View style={styles.divider} />
              <Menu.Label>Thinking level</Menu.Label>
              <Menu.Group
                selectionMode="single"
                selectedKeys={effortKeys}
                disallowEmptySelection
                shouldCloseOnSelect
                onSelectionChange={(keys) => {
                  const key = selectedKey(keys);
                  if (key === null || !key.startsWith("effort:")) return;
                  selectionFeedback();
                  onSelectEffort(key.slice("effort:".length));
                }}
              >
                {efforts.map((effort) => (
                  <Menu.Item key={effort} id={`effort:${effort}`}>
                    <Menu.ItemTitle>{thinkingEffortLabel(effort)}</Menu.ItemTitle>
                    <Menu.ItemIndicator />
                  </Menu.Item>
                ))}
              </Menu.Group>
            </>
          )}

          {model?.supportsPersonality === true && (
            <>
              <View style={styles.divider} />
              <SubMenu>
                <SubMenu.Trigger>
                  <Text style={styles.submenuTitle}>Personality</Text>
                  <SubMenu.TriggerIndicator />
                </SubMenu.Trigger>
                <SubMenu.Content>
                  <Menu.Group
                    selectionMode="single"
                    selectedKeys={personalityKeys}
                    disallowEmptySelection
                    shouldCloseOnSelect
                    onSelectionChange={(keys) => {
                      const key = selectedKey(keys);
                      if (key === null) return;
                      const value = key === SERVER_DEFAULT_PERSONALITY
                        ? null
                        : key.slice("personality:".length) as Personality;
                      selectionFeedback();
                      onSelectPersonality(value);
                    }}
                  >
                    <Menu.Item id={SERVER_DEFAULT_PERSONALITY}>
                      <Menu.ItemTitle>Server default</Menu.ItemTitle>
                      <Menu.ItemIndicator />
                    </Menu.Item>
                    {PERSONALITIES.map((personality) => (
                      <Menu.Item key={personality} id={`personality:${personality}`}>
                        <Menu.ItemTitle>{personality}</Menu.ItemTitle>
                        <Menu.ItemIndicator />
                      </Menu.Item>
                    ))}
                  </Menu.Group>
                </SubMenu.Content>
              </SubMenu>
            </>
          )}
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  );
}

export function PermissionsMenu({
  accessibilityLabel,
  triggerChildren,
  triggerStyle,
  permissions,
  loading,
  error,
  selectedPermissions,
  onOpen,
  onClose,
  onSelectPermissions,
}: PermissionsMenuProps) {
  const lifecycle = useMenuLifecycle(onOpen, onClose);
  const { width } = useWindowDimensions();
  const menuWidth = Math.min(344, width - 24);
  const selectedKeys = useMemo(
    () => new Set<MenuKey>([selectedPermissions === null ? SERVER_DEFAULT_PERMISSIONS : `permissions:${selectedPermissions}`]),
    [selectedPermissions],
  );
  const disabledKeys = useMemo(
    () => new Set<MenuKey>(permissions.filter((permission) => !permission.allowed).map((permission) => `permissions:${permission.id}`)),
    [permissions],
  );

  return (
    <Menu presentation="popover" isOpen={lifecycle.isOpen} onOpenChange={lifecycle.onOpenChange}>
      <Menu.Trigger asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          style={triggerStyle}
        >
          {triggerChildren}
        </Pressable>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Overlay className="bg-backdrop" />
        <Menu.Content
          presentation="popover"
          placement="top"
          align="start"
          width={menuWidth}
          offset={10}
          className="border border-border"
        >
          {loading && permissions.length === 0 && <Menu.Label>Loading from remote server…</Menu.Label>}
          {error !== null && <Text style={styles.error}>{error}</Text>}
          <Menu.Label>Security permissions</Menu.Label>
          <Menu.Group
            selectionMode="single"
            selectedKeys={selectedKeys}
            disabledKeys={disabledKeys}
            disallowEmptySelection
            shouldCloseOnSelect
            onSelectionChange={(keys) => {
              const key = selectedKey(keys);
              if (key === null) return;
              const value = key === SERVER_DEFAULT_PERMISSIONS
                ? null
                : key.slice("permissions:".length);
              selectionFeedback();
              onSelectPermissions(value);
            }}
          >
            <Menu.Item id={SERVER_DEFAULT_PERMISSIONS} className="items-start">
              <View style={styles.itemText}>
                <Menu.ItemTitle className="flex-none">Server default</Menu.ItemTitle>
                <Menu.ItemDescription className="flex-none">Use the server's configured access level</Menu.ItemDescription>
              </View>
              <Menu.ItemIndicator />
            </Menu.Item>
            {permissions.map((permission) => (
              <Menu.Item
                key={permission.id}
                id={`permissions:${permission.id}`}
                {...(permission.description === null ? {} : { className: "items-start" })}
              >
                <View style={styles.itemText}>
                  <Menu.ItemTitle className="flex-none">{permissionLabel(permission.id)}</Menu.ItemTitle>
                  {permission.description !== null && (
                    <Menu.ItemDescription className="flex-none" numberOfLines={2}>{permission.description}</Menu.ItemDescription>
                  )}
                </View>
                <Menu.ItemIndicator />
              </Menu.Item>
            ))}
          </Menu.Group>
        </Menu.Content>
      </Menu.Portal>
    </Menu>
  );
}

function permissionLabel(id: string): string {
  if (id === ":workspace") return "Workspace";
  if (id === ":read-only") return "Read only";
  if (id === ":full-access" || id === ":danger-full-access") return "Full access";
  return id.startsWith(":") ? id.slice(1).replaceAll("-", " ") : id;
}

function thinkingEffortLabel(effort: string): string {
  if (effort === "xhigh") return "Extra high";
  return effort.length === 0 ? effort : `${effort[0]!.toUpperCase()}${effort.slice(1)}`;
}

const styles = StyleSheet.create({
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 10,
    marginVertical: 4,
    backgroundColor: colors.border,
  },
  error: {
    color: colors.red,
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  itemText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  submenuTitle: {
    color: colors.text,
    flex: 1,
    fontFamily: "RobotoFlex-Medium",
    fontSize: 15,
  },
});
