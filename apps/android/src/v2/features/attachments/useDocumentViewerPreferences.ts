import { useState, useSyncExternalStore } from "react";

import { useV2Runtime } from "../../application/react/V2RuntimeContext";
import { DocumentViewerPreferenceResource } from "./documentViewerPreferenceResource";

export function useDocumentViewerPreferences(): DocumentViewerPreferenceResource {
  const runtime = useV2Runtime();
  const [current] = useState(
    () => new DocumentViewerPreferenceResource(runtime.documentViewerPreferences),
  );
  useSyncExternalStore(current.subscribe, current.snapshot, current.snapshot);
  return current;
}
