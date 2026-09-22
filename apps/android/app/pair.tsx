import { Redirect } from "expo-router";

/** Mounts V1 so its process deep-link owner can consume the original pairing URL. */
export default function PairRoute(): React.JSX.Element {
  return <Redirect href="/" />;
}
