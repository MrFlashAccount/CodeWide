import type { PrivateAssetSource } from "./private-transfer";

export type SkillSource = "repo" | "user" | "system" | "admin";
export type SkillPlugin = { icon: PrivateAssetSource | null; id: string; label: string };
type SkillPluginLink =
  | { plugin: SkillPlugin | null; status: "resolved" }
  | { status: "unavailable" };

/** Catalog metadata is optional only for persisted controls from older clients. */
export type CatalogSkill = {
  catalog?: {
    description: string;
    pluginLink: SkillPluginLink;
    source: SkillSource | null;
    title: string;
  };
  description: string;
  enabled: boolean;
  name: string;
  path: string;
};

export type InstalledSkillPlugin = {
  marketplacePath: string | null;
  plugin: SkillPlugin;
  pluginName: string;
  remoteMarketplaceName: string | null;
};
