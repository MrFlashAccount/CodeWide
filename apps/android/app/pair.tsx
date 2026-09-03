import { Redirect, useLocalSearchParams } from "expo-router";

import { useUiGenerationSnapshot } from "../src/boot/useUiGenerationSnapshot";
import {
  newSavedServerDestination,
  pairingDestination,
} from "../src/v2/features/navigation/routeDestinations";
import { pairingDeepLinkRouteParam } from "../src/v2/features/navigation/routeParams";

/** Routes the public pairing URL into the selected UI generation. */
export default function PairRoute(): React.JSX.Element | null {
  const params = useLocalSearchParams<"/pair">();
  const generation = useUiGenerationSnapshot();
  if (generation.status === "loading") return null;
  if (generation.status === "error") return <Redirect href="/" />;
  if (generation.generation === "legacy") return <Redirect href="/legacy" />;
  const pairingCode = pairingDeepLinkRouteParam({
    e: params.e,
    i: params.i,
    n: params.n,
    p: params.p,
    t: params.t,
    v: params.v,
    x: params.x,
    y: params.y,
  });
  return (
    <Redirect
      href={pairingCode === null ? newSavedServerDestination() : pairingDestination(pairingCode)}
    />
  );
}
