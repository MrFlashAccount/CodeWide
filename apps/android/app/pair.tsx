import { Redirect } from "expo-router";

/** Temporary legacy-only alias. */
export default function PairRoute() {
  return <Redirect href="/legacy" />;
}
