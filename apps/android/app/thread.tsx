import { Redirect } from "expo-router";

/** Keep notification deeplinks on the one workspace/store owner. */
export default function ThreadRoute() {
  return <Redirect href="/" />;
}
