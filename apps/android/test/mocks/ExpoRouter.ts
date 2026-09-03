import { useEffect } from "react";

export const router = {
  back: () => undefined,
  navigate: () => undefined,
  push: () => undefined,
  replace: () => undefined,
};

export function useFocusEffect(effect: () => void | (() => void)): void {
  useEffect(effect, [effect]);
}

export function usePathname(): string {
  return "/";
}
