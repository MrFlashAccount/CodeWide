import { Redirect } from "expo-router";

/** Keep deeplinks on the one workspace/store owner mounted at `/`. */
export default function PairRoute() {
  return <Redirect href="/" />;
}
