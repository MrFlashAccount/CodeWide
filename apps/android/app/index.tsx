import { Redirect } from "expo-router";

/** Opens the V1 workspace without a persisted generation gate. */
export default function IndexRoute(): React.JSX.Element {
  return <Redirect href="/v1" />;
}
