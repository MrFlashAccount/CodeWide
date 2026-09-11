import type { PrivateAssetSource } from "./private-transfer";

export type SkillSource = "repo" | "user" | "system" | "admin";
export type SkillPlugin = { id: string; label: string; icon: PrivateAssetSource | null };
export type SkillPluginLink =
  | { status: "resolved"; plugin: SkillPlugin | null }
  | { status: "unavailable" };

/** Catalog metadata is optional only for persisted controls from older clients. */
export type CatalogSkill = {
  name: string;
  path: string;
  description: string;
  enabled: boolean;
  catalog?: {
    title: string;
    description: string;
    source: SkillSource | null;
    pluginLink: SkillPluginLink;
  };
};

export type InstalledSkillPlugin = {
  plugin: SkillPlugin;
  pluginName: string;
  marketplacePath: string | null;
  remoteMarketplaceName: string | null;
};
