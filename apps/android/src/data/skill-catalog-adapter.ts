import type { PrivateAssetSource } from "./private-transfer";
import type {
  CatalogSkill,
  InstalledSkillPlugin,
  SkillPlugin,
  SkillSource,
} from "./skill-catalog-types";

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  // WHY: The object guard establishes a property bag; values remain unknown until checked below.
  return value as Record<string, unknown>;
}

function label(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function source(value: unknown): SkillSource | null {
  return value === "repo" || value === "user" || value === "system" || value === "admin"
    ? value
    : null;
}

function icon(metadata: Record<string, unknown> | null): PrivateAssetSource | null {
  for (const key of ["logoDark", "composerIcon", "logo"]) {
    const path = label(metadata?.[key]);
    if (path !== null && path.startsWith("/") && !path.includes("\0"))
      return { kind: "path", path };
  }
  for (const key of ["logoUrlDark", "composerIconUrl", "logoUrl"]) {
    const url = label(metadata?.[key]);
    if (url === null) continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" && parsed.username === "" && parsed.password === "")
        return { kind: "remote", url };
    } catch {
      // Invalid optional artwork must not hide otherwise usable skills.
    }
  }
  return null;
}

/** Decode the picker contract without trusting RPC generic type parameters. */
export function parseCatalogSkills(value: unknown): CatalogSkill[] {
  const entries = record(value)?.data;
  if (!Array.isArray(entries)) throw new Error("Invalid skills catalog response");
  const skills = new Map<string, CatalogSkill>();
  for (const entry of entries) {
    const items = record(entry)?.skills;
    if (!Array.isArray(items)) throw new Error("Invalid skills catalog entry");
    for (const item of items) {
      const skill = record(item);
      const name = label(skill?.name);
      const path = label(skill?.path);
      if (
        name === null ||
        path === null ||
        typeof skill?.description !== "string" ||
        typeof skill.enabled !== "boolean"
      )
        throw new Error("Invalid skill metadata");
      const metadata = record(skill.interface);
      skills.set(path, {
        name,
        path,
        description: skill.description,
        enabled: skill.enabled,
        catalog: {
          title: label(metadata?.displayName) ?? name,
          description:
            label(metadata?.shortDescription) ??
            label(skill.shortDescription) ??
            skill.description.trim(),
          source: source(skill.scope),
          pluginLink: { status: "unavailable" },
        },
      });
    }
  }
  return [...skills.values()];
}

/** Catalog IDs, not display-name prefixes, own plugin section identity. */
export function parseInstalledSkillPlugins(value: unknown): InstalledSkillPlugin[] {
  const response = record(value);
  if (!Array.isArray(response?.marketplaces)) throw new Error("Invalid installed plugin catalog");
  if (Array.isArray(response.marketplaceLoadErrors) && response.marketplaceLoadErrors.length > 0)
    throw new Error("Some plugin marketplaces are unavailable");
  const result: InstalledSkillPlugin[] = [];
  for (const item of response.marketplaces) {
    const marketplace = record(item);
    const marketplaceName = label(marketplace?.name);
    if (marketplaceName === null || !Array.isArray(marketplace?.plugins))
      throw new Error("Invalid plugin marketplace");
    for (const item of marketplace.plugins) {
      const plugin = record(item);
      if (plugin?.installed !== true) continue;
      const id = label(plugin.id);
      const name = label(plugin.name);
      if (id === null || name === null) throw new Error("Invalid installed plugin");
      const metadata = record(plugin.interface);
      const marketplacePath = label(marketplace.path);
      result.push({
        plugin: {
          id: `${marketplaceName}:${id}`,
          label: label(metadata?.displayName) ?? name,
          icon: icon(metadata),
        },
        pluginName: name,
        marketplacePath,
        remoteMarketplaceName: marketplacePath === null ? marketplaceName : null,
      });
    }
  }
  return result;
}

/** Exact paths from plugin/read are the authoritative membership relation. */
export function parsePluginSkillPaths(value: unknown): string[] {
  const skills = record(record(value)?.plugin)?.skills;
  if (!Array.isArray(skills)) throw new Error("Invalid plugin skills response");
  return skills.flatMap((item) => {
    const skill = record(item);
    if (skill === null || !(skill.path === null || typeof skill.path === "string"))
      throw new Error("Invalid plugin skill path");
    return typeof skill.path === "string" && skill.path !== "" ? [skill.path] : [];
  });
}

export function assignSkillPlugins(
  skills: CatalogSkill[],
  plugins: ReadonlyMap<string, SkillPlugin>,
  complete: boolean,
): CatalogSkill[] {
  return skills.map((skill) => {
    if (skill.catalog === undefined) return skill;
    const plugin = plugins.get(skill.path) ?? null;
    return {
      ...skill,
      catalog: {
        ...skill.catalog,
        pluginLink:
          plugin !== null || complete ? { status: "resolved", plugin } : { status: "unavailable" },
      },
    };
  });
}
