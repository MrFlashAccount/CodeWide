import { Slot as LinkSlot } from "expo-router/build/ui/Slot";
import { resolveHref } from "expo-router/build/link/href";
import {
  createContext,
  createElement,
  Fragment,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";
import { View } from "react-native";

type MockRoute = {
  readonly params: Readonly<Record<string, string>>;
  readonly pathname: string;
};

type MockHref =
  | string
  | {
      readonly params?: Readonly<Record<string, string | number>>;
      readonly pathname: string;
    };

let entries: MockRoute[] = [{ params: {}, pathname: "/" }];
let currentIndex = 0;
let localParamsOverride: Readonly<Record<string, string>> | null = null;
const listeners = new Set<() => void>();
const routeComponents = new Map<string, React.ComponentType>();
const retainedRoutes = new Set<string>();
const layouts = new Map<
  string,
  { readonly paths: readonly string[]; readonly component: React.ComponentType }
>();
const NestedRoutes = createContext<readonly MockRoute[] | null>(null);
const LocalRouteParams = createContext<Readonly<Record<string, string>> | null>(null);

const routeKeys = new WeakMap<MockRoute, string>();
let nextRouteKey = 0;
function keyFor(entry: MockRoute): string {
  let key = routeKeys.get(entry);
  if (key === undefined) {
    key = `route-${++nextRouteKey}`;
    routeKeys.set(entry, key);
  }
  return key;
}
function catalogEntry(entry: MockRoute): boolean {
  return entry.pathname === "/" || entry.pathname === "/project/[sessionId]";
}
function navigationSnapshot() {
  const history = entries.slice(0, currentIndex + 1);
  const catalog = history.filter(catalogEntry);
  const catalogRoutes =
    catalog.length === 0
      ? [{ key: "initial-catalog", name: "index", params: {} }]
      : catalog.map((entry) => ({
          key: keyFor(entry),
          name: entry.pathname === "/" ? "index" : "project/[sessionId]",
          params: entry.params,
        }));
  const other = history.filter((entry) => !catalogEntry(entry));
  const workspaceRoutes = [
    {
      key: "catalog",
      name: "(lists)",
      params: {},
      state: { key: "catalog-stack", index: catalogRoutes.length - 1, routes: catalogRoutes },
    },
    ...other.map((entry) => ({
      key: keyFor(entry),
      name: entry.pathname.slice(1),
      params: entry.params,
    })),
  ];
  return {
    key: "app",
    index: 0,
    routes: [
      {
        key: "workspace",
        name: "(workspace)",
        state: {
          key: "workspace-stack",
          index: catalogEntry(current()) ? 0 : workspaceRoutes.length - 1,
          routes: workspaceRoutes,
        },
      },
    ],
  };
}
let navigationState = navigationSnapshot();
const navigationRef = {
  isReady: () => true,
  addListener: (_event: "state", listener: () => void) => subscribe(listener),
  getRootState: () => navigationState,
  dispatch(action: {
    type: string;
    target?: string;
    payload?: { name?: string; params?: Record<string, string> };
  }) {
    if (action.target !== "catalog-stack") throw new Error("Unexpected mock navigation target");
    const active = current();
    const history = entries
      .slice(0, currentIndex + 1)
      .filter((entry) => entry.pathname !== "/project/[sessionId]");
    if (!history.some((entry) => entry.pathname === "/")) history.unshift(route("/"));
    const rootIndex = history.findIndex((entry) => entry.pathname === "/");
    let destination = history[rootIndex];
    if (action.type !== "POP_TO_TOP") {
      destination = route({ pathname: "/project/[sessionId]", params: action.payload?.params });
      history.splice(rootIndex + 1, 0, destination);
    }
    entries = history;
    currentIndex = catalogEntry(active) ? entries.indexOf(destination) : entries.indexOf(active);
    publish();
  },
};
export function useNavigationContainerRef() {
  return navigationRef;
}
export function useRootNavigationState() {
  return useSyncExternalStore(
    subscribe,
    () => navigationState,
    () => navigationState,
  );
}

function route(href: MockHref): MockRoute {
  if (typeof href === "string") {
    return { params: {}, pathname: href };
  }
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(href.params ?? {})) {
    params[key] = String(value);
  }
  return { params, pathname: href.pathname };
}

function current(): MockRoute {
  const value = entries[currentIndex];
  if (value === undefined) {
    throw new Error("Mock Router has no current entry");
  }
  return value;
}

function publish(): void {
  navigationState = navigationSnapshot();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): MockRoute {
  return current();
}

function updateDestination(destination: MockRoute): void {
  const previous = current();
  if (JSON.stringify(previous.params) === JSON.stringify(destination.params)) return;
  routeKeys.set(destination, keyFor(previous));
  entries[currentIndex] = destination;
}

export function Link({
  children,
  href,
  dismissTo,
}: {
  readonly children: React.ReactNode;
  readonly href: MockHref;
  readonly dismissTo?: boolean;
  readonly asChild?: boolean;
}): React.ReactElement {
  return createElement(LinkSlot, {
    children,
    href: resolveHref(href),
    accessibilityRole: "link",
    onPress: () => {
      if (dismissTo) router.dismissTo(href);
      else router.navigate(href);
    },
  });
}

export const router = {
  back(): void {
    if (currentIndex > 0) {
      currentIndex -= 1;
      publish();
    }
  },
  canGoBack(): boolean {
    return currentIndex > 0;
  },
  dismissTo(href: MockHref): void {
    const destination = route(href);
    let match = -1;
    for (let index = currentIndex; index >= 0; index -= 1) {
      if (entries[index]?.pathname === destination.pathname) {
        match = index;
        break;
      }
    }
    if (match >= 0) {
      currentIndex = match;
      entries = entries.slice(0, currentIndex + 1);
      updateDestination(destination);
    } else {
      entries[currentIndex] = destination;
    }
    publish();
  },
  navigate(href: MockHref): void {
    const destination = route(href);
    if (current().pathname === destination.pathname) {
      updateDestination(destination);
      publish();
    } else router.push(href);
  },
  prefetch(_href: MockHref): void {},
  push(href: MockHref): void {
    entries = [...entries.slice(0, currentIndex + 1), route(href)];
    currentIndex += 1;
    publish();
  },
  replace(href: MockHref): void {
    entries[currentIndex] = route(href);
    publish();
  },
  setParams(params: Readonly<Record<string, string | undefined>>): void {
    const nextParams = { ...current().params };
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) {
        delete nextParams[key];
      } else {
        nextParams[key] = value;
      }
    }
    updateDestination({ params: nextParams, pathname: current().pathname });
    publish();
  },
};

export function resetMockRouter(initial: MockHref = "/"): void {
  entries = [route(initial)];
  currentIndex = 0;
  localParamsOverride = null;
  publish();
}

export function setMockLocalSearchParams(params: Readonly<Record<string, string>> | null): void {
  localParamsOverride = params;
  publish();
}

export function mockRouterHistory(): readonly MockRoute[] {
  return entries.slice(0, currentIndex + 1);
}

export function registerMockRoute(
  pathname: string,
  component: React.ComponentType,
  options: { readonly retainWhenCovered?: boolean } = {},
): void {
  routeComponents.set(pathname, component);
  if (options.retainWhenCovered) retainedRoutes.add(pathname);
}

export function registerMockLayout(
  id: string,
  paths: readonly string[],
  component: React.ComponentType,
): void {
  layouts.set(id, { paths, component });
}

export function clearMockRoutes(): void {
  routeComponents.clear();
  retainedRoutes.clear();
  layouts.clear();
}

export function useRouter() {
  return router;
}

export function useFocusEffect(effect: () => void | (() => void)): void {
  useEffect(effect, [effect]);
}

export const useIsFocused = jest.fn((): boolean => true);

export function usePathname(): string {
  const value = useSyncExternalStore(subscribe, snapshot, snapshot);
  return value.pathname.replace(
    /\[([^\]]+)\]/gu,
    (segment, name: string) => value.params[name] ?? segment,
  );
}

export function useLocalSearchParams(): Readonly<Record<string, string>> {
  const params = useSyncExternalStore(subscribe, snapshot, snapshot).params;
  const localParams = useContext(LocalRouteParams);
  return localParamsOverride ?? localParams ?? params;
}

export function useGlobalSearchParams(): Readonly<Record<string, string>> {
  return useSyncExternalStore(subscribe, snapshot, snapshot).params;
}

function scene(entry: MockRoute, active: boolean, key: string): React.JSX.Element | null {
  const Component = routeComponents.get(entry.pathname);
  if (Component === undefined || (!active && !retainedRoutes.has(entry.pathname))) return null;
  return createElement(
    View,
    { key, style: { display: active ? "flex" : "none" } },
    createElement(LocalRouteParams.Provider, { value: entry.params }, createElement(Component)),
  );
}

export function Slot(): React.JSX.Element {
  const routeSnapshot = useSyncExternalStore(subscribe, snapshot, snapshot);
  const nested = useContext(NestedRoutes);
  if (nested !== null) {
    return createElement(
      Fragment,
      null,
      nested.map((entry, index) =>
        scene(entry, entry === nested.at(-1), `${index}:${entry.pathname}`),
      ),
    );
  }
  if (layouts.size > 0) {
    const history = entries.slice(0, currentIndex + 1);
    const layoutScenes = [...layouts].map(([id, layout]) => {
      const routes = history.filter((entry) => layout.paths.includes(entry.pathname));
      const active = routes.at(-1) === routeSnapshot;
      if (
        routes.length === 0 ||
        (!active && !routes.some((entry) => retainedRoutes.has(entry.pathname)))
      )
        return null;
      return createElement(
        View,
        { key: id, style: { display: active ? "flex" : "none" } },
        createElement(NestedRoutes.Provider, { value: routes }, createElement(layout.component)),
      );
    });
    const otherScenes = history.map((entry, index) => {
      if ([...layouts.values()].some((layout) => layout.paths.includes(entry.pathname)))
        return null;
      return scene(entry, entry === routeSnapshot, `${index}:${entry.pathname}`);
    });
    return createElement(Fragment, null, ...layoutScenes, ...otherScenes);
  }
  if (retainedRoutes.size > 0) {
    return createElement(
      Fragment,
      null,
      entries
        .slice(0, currentIndex + 1)
        .map((entry, index) => scene(entry, entry === routeSnapshot, `${index}:${entry.pathname}`)),
    );
  }
  const RouteComponent = routeComponents.get(routeSnapshot.pathname);
  return RouteComponent === undefined ? createElement(Fragment) : createElement(RouteComponent);
}

type MockScreen = { key: string; name: string; params: Readonly<Record<string, string>> };
type MockStackProps = {
  layout?: (props: {
    state: ReturnType<typeof navigationSnapshot>["routes"][number]["state"];
    descriptors: Record<string, { render: () => React.JSX.Element }>;
    children: React.ReactNode;
  }) => React.JSX.Element;
  screenLayout?: (props: { route: MockScreen; children: React.ReactNode }) => React.JSX.Element;
};
export const Stack = Object.assign(
  function MockStack(props: MockStackProps): React.JSX.Element {
    useRootNavigationState();
    const nested = useContext(NestedRoutes);
    if (!props.layout || nested !== null) return createElement(Slot);
    const state = navigationState.routes[0].state;
    const history = entries.slice(0, currentIndex + 1);
    const descriptors: Record<string, { render: () => React.JSX.Element }> = {};
    for (const entry of state.routes) {
      descriptors[entry.key] = {
        render() {
          const catalog = layouts.get("lists");
          const original = history.find((candidate) => keyFor(candidate) === entry.key);
          const catalogRoutes = history.filter(catalogEntry);
          const children =
            entry.name === "(lists)" && catalog
              ? createElement(
                  NestedRoutes.Provider,
                  { value: catalogRoutes.length ? catalogRoutes : [{ params: {}, pathname: "/" }] },
                  createElement(catalog.component),
                )
              : original
                ? scene(original, original === current(), keyFor(original))
                : null;
          return props.screenLayout
            ? props.screenLayout({ route: entry, children })
            : createElement(Fragment, null, children);
        },
      };
    }
    return props.layout({
      state,
      descriptors,
      children: createElement(
        Fragment,
        null,
        state.routes.map((entry, index) =>
          createElement(
            View,
            { key: entry.key, style: { display: index === state.index ? "flex" : "none" } },
            descriptors[entry.key]?.render(),
          ),
        ),
      ),
    });
  },
  {
    Screen(): null {
      return null;
    },
  },
);

export function Redirect({ href }: { readonly href: MockHref }): null {
  useEffect(() => {
    router.replace(href);
  }, [href]);
  return null;
}
