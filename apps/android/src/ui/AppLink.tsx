import { Link, type Href } from "expo-router";
import type { ReactElement } from "react";

/** Renders a supplied destination as a native/web link without owning route policy. */
export function AppLink({
  children,
  dismissTo,
  href,
}: {
  readonly children: ReactElement;
  readonly dismissTo: boolean;
  readonly href: Href;
}): React.JSX.Element {
  return (
    <Link asChild dismissTo={dismissTo} href={href}>
      {children}
    </Link>
  );
}
