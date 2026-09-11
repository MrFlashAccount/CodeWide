import { assignSkillPlugins, parseCatalogSkills, parseInstalledSkillPlugins, parsePluginSkillPaths } from "./skill-catalog-adapter";
import type { CatalogSkill, InstalledSkillPlugin, SkillPlugin } from "./skill-catalog-types";

type SkillCatalogReader = {
  skills(): Promise<unknown>;
  installedPlugins(): Promise<unknown>;
  plugin(input: InstalledSkillPlugin): Promise<unknown>;
};

async function readPluginMembership(reader: SkillCatalogReader, signal: AbortSignal): Promise<{ paths: Map<string, SkillPlugin>; complete: boolean }> {
  const paths = new Map<string, SkillPlugin>();
  const ambiguous = new Set<string>();
  const plugins = parseInstalledSkillPlugins(await reader.installedPlugins());
  let next = 0;
  let complete = true;
  const worker = async () => {
    while (!signal.aborted && next < plugins.length) {
      const plugin = plugins[next++];
      if (plugin === undefined) return;
      try {
        for (const path of parsePluginSkillPaths(await reader.plugin(plugin))) {
          const previous = paths.get(path);
          if (ambiguous.has(path) || (previous !== undefined && previous.id !== plugin.plugin.id)) {
            paths.delete(path);
            ambiguous.add(path);
            complete = false;
          } else {
            paths.set(path, plugin.plugin);
          }
        }
      } catch {
        // Optional grouping failure must not make executable skills unavailable.
        complete = false;
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { paths, complete };
}

/** Decoration has its own budget so it cannot consume the controls loader's 12s deadline. */
export async function loadSkillCatalog(reader: SkillCatalogReader, metadataBudgetMs = 3_000): Promise<CatalogSkill[]> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const metadata = Promise.race([
    readPluginMembership(reader, controller.signal).catch(() => null),
    new Promise<null>((resolve) => { timer = setTimeout(() => { controller.abort(); resolve(null); }, metadataBudgetMs); }),
  ]);
  try {
    const skills = parseCatalogSkills(await reader.skills());
    const membership = await metadata;
    return membership === null ? skills : assignSkillPlugins(skills, membership.paths, membership.complete);
  } finally {
    controller.abort();
    clearTimeout(timer);
  }
}
