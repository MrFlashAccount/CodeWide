import { createElement, Fragment, useEffect, useSyncExternalStore } from "react";

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
const listeners = new Set<() => void>();
const routeComponents = new Map<string, React.ComponentType>();

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
    } else {
      entries[currentIndex] = destination;
    }
    publish();
  },
  navigate(href: MockHref): void {
    this.push(href);
  },
  push(href: MockHref): void {
    entries = [...entries.slice(0, currentIndex + 1), route(href)];
    currentIndex += 1;
    publish();
  },
  replace(href: MockHref): void {
    entries[currentIndex] = route(href);
    publish();
  },
};

export function resetMockRouter(initial: MockHref = "/"): void {
  entries = [route(initial)];
  currentIndex = 0;
  publish();
}

export function mockRouterHistory(): readonly MockRoute[] {
  return entries.slice(0, currentIndex + 1);
}

export function registerMockRoute(pathname: string, component: React.ComponentType): void {
  routeComponents.set(pathname, component);
}

export function clearMockRoutes(): void {
  routeComponents.clear();
}

export function useRouter() {
  return router;
}

export function useFocusEffect(effect: () => void | (() => void)): void {
  useEffect(effect, [effect]);
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, snapshot, snapshot).pathname;
}

export function useLocalSearchParams(): Readonly<Record<string, string>> {
  return useSyncExternalStore(subscribe, snapshot, snapshot).params;
}

export function Slot(): React.JSX.Element {
  const routeSnapshot = useSyncExternalStore(subscribe, snapshot, snapshot);
  const RouteComponent = routeComponents.get(routeSnapshot.pathname);
  return RouteComponent === undefined ? createElement(Fragment) : createElement(RouteComponent);
}

export function Redirect({ href }: { readonly href: MockHref }): null {
  useEffect(() => {
    router.replace(href);
  }, [href]);
  return null;
}
