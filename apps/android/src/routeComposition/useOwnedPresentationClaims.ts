import { useState } from "react";

import { useEvent } from "../react/useEvent";

/** Tracks independent mounted owners without allowing one cleanup to clear another owner's claim. */
export function useOwnedPresentationClaims(): {
  readonly claimed: boolean;
  readonly setClaimed: (owner: symbol, claimed: boolean) => void;
} {
  const [owners, setOwners] = useState<ReadonlySet<symbol>>(() => new Set());
  const setClaimed = useEvent((owner: symbol, claimed: boolean): void => {
    setOwners((current) => updateOwners(current, owner, claimed));
  });
  return { claimed: owners.size > 0, setClaimed };
}

function updateOwners(
  current: ReadonlySet<symbol>,
  owner: symbol,
  claimed: boolean,
): ReadonlySet<symbol> {
  if (current.has(owner) === claimed) {
    return current;
  }
  const next = new Set(current);
  if (claimed) {
    next.add(owner);
  } else {
    next.delete(owner);
  }
  return next;
}
