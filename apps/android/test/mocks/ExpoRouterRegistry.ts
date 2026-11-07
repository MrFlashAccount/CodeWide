type MockLayout = {
  readonly component: React.ComponentType;
  readonly paths: readonly string[];
};

/** Owns registered mock route components, retention policy and nested layout membership. */
export function createMockRouteRegistry(): {
  readonly clear: () => void;
  readonly component: (pathname: string) => React.ComponentType | undefined;
  readonly hasRetainedRoutes: () => boolean;
  readonly layout: (id: string) => MockLayout | undefined;
  readonly layoutContains: (pathname: string) => boolean;
  readonly registerLayout: (
    id: string,
    paths: readonly string[],
    component: React.ComponentType,
  ) => void;
  readonly registerRoute: (
    pathname: string,
    component: React.ComponentType,
    retainWhenCovered: boolean,
  ) => void;
  readonly retains: (pathname: string) => boolean;
  readonly rootLayouts: () => readonly (readonly [string, MockLayout])[];
} {
  const routeComponents = new Map<string, React.ComponentType>();
  const retainedRoutes = new Set<string>();
  const layouts = new Map<string, MockLayout>();
  return {
    clear(): void {
      routeComponents.clear();
      retainedRoutes.clear();
      layouts.clear();
    },
    component: (pathname) => routeComponents.get(pathname),
    hasRetainedRoutes: () => retainedRoutes.size > 0,
    layout: (id) => layouts.get(id),
    layoutContains: (pathname) =>
      [...layouts.values()].some((layout) => layout.paths.includes(pathname)),
    registerLayout(id, paths, component): void {
      layouts.set(id, { component, paths });
    },
    registerRoute(pathname, component, retainWhenCovered): void {
      routeComponents.set(pathname, component);
      if (retainWhenCovered) {
        retainedRoutes.add(pathname);
      }
    },
    retains: (pathname) => retainedRoutes.has(pathname),
    rootLayouts: () =>
      [...layouts].filter(([, candidate]) =>
        [...layouts].every(
          ([, possibleParent]) =>
            candidate === possibleParent ||
            !candidate.paths.every((path) => possibleParent.paths.includes(path)),
        ),
      ),
  };
}
