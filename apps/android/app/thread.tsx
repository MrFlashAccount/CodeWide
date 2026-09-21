import { Redirect } from "expo-router";

/** Mounts V1 so its process deep-link owner can consume the original thread URL. */
export default function ThreadRoute(): React.JSX.Element {
  return <Redirect href="/v1" />;
}
