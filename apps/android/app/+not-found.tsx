import { Redirect, useRouter } from "expo-router";

import { RouteUnavailable } from "../src/components/navigation/RouteUnavailable";
import { useEvent } from "../src/react/useEvent";

/** Recovers obsolete and unmatched links to the single application home. */
export default function UnmatchedRoute(): React.JSX.Element {
  const router = useRouter();
  const openThreads = useEvent(() => {
    router.replace("/");
  });
  return (
    <>
      <RouteUnavailable
        actionLabel="Open threads"
        message="This page is unavailable. Returning to your threads."
        onBack={openThreads}
        title="Page unavailable"
      />
      <Redirect href="/" />
    </>
  );
}
