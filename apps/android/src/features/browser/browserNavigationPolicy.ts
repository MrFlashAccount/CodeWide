import { BROWSER_HOME_URL } from "../../services/browser/browserTab";

/** Accepts page navigation without granting credentials or invoking an external application. */
export function browserPageUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname !== "" &&
      url.username === "" &&
      url.password === ""
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** Applies the caller's origin policy equally to main-page and popup URL admissions. */
export function browserAllowedPageUrl(value: string, origins: readonly string[]): string | null {
  const target = browserPageUrl(value);
  if (target === null) {
    return null;
  }
  const parsed = new URL(target);
  return origins.some(
    (origin) => origin === "*" || origin === `${parsed.protocol}//*` || origin === parsed.origin,
  )
    ? target
    : null;
}

/** Displays a safe page location in tab chrome; full addresses remain private navigation data. */
export function browserTabLabel(url: string): string {
  if (url === BROWSER_HOME_URL) {
    return "Home";
  }
  if (url === "about:blank") {
    return "New tab";
  }
  try {
    return new URL(url).host;
  } catch {
    return "Browser";
  }
}

/** Validates Android's optional native view tag without assuming it exists in the library DTO. */
export function browserNativeTarget(value: unknown): number | null {
  return value !== null &&
    typeof value === "object" &&
    "target" in value &&
    typeof value.target === "number" &&
    Number.isSafeInteger(value.target)
    ? value.target
    : null;
}
