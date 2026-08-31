import { Redirect } from "expo-router";

/** Temporary legacy-only alias. */
export default function ThreadRoute() {
  return <Redirect href="/legacy" />;
}
