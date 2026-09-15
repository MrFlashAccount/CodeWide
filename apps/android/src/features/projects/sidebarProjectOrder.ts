/** Device-local sidebar order; project pin state remains authoritative on Companion. */
export const SIDEBAR_PROJECT_ORDER_ID = "sidebar-project-order";

export function decodeProjectOrder(value: string | null | undefined): string[] {
  if (value == null) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((key): key is string => typeof key === "string");
  } catch {
    return [];
  }
}

export function orderSidebarProjects<Project extends { key: string }>(
  projects: readonly Project[],
  order: readonly string[],
): Project[] {
  const ranks = new Map(order.map((key, index) => [key, index]));
  return projects
    .slice()
    .sort((left, right) => (ranks.get(left.key) ?? Infinity) - (ranks.get(right.key) ?? Infinity));
}

/** Reorders only visible shortcuts, retaining preferences for other servers. */
export function moveSidebarProject(
  order: readonly string[],
  visibleKeys: readonly string[],
  key: string,
  direction: -1 | 1,
): string[] {
  const keys = orderSidebarProjects(
    visibleKeys.map((key) => ({ key })),
    order,
  ).map((project) => project.key);
  const index = keys.indexOf(key);
  const neighbour = keys[index + direction];
  if (index < 0 || neighbour === undefined)
    return keys.concat(order.filter((entry) => !keys.includes(entry)));
  keys[index] = neighbour;
  keys[index + direction] = key;
  return keys.concat(order.filter((entry) => !keys.includes(entry)));
}
