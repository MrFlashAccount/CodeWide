import { Redirect } from "expo-router";

/** Selects and mounts the complete V1 application route. */
export default function LegacyRoute(): React.JSX.Element {
  return <Redirect href="/v1" />;
}
