import type { PairingPreview } from "./application/ports/savedServerRepository";
import type { V2Runtime } from "./application/v2Runtime";
import { NewSavedServerScreen } from "./features/settings/NewSavedServerScreen";
import { ExpoPairingScanner } from "./platform/pairing/ExpoPairingScanner";
import { readPairingClipboard } from "./platform/pairing/readPairingClipboard";
import { useV2Runtime } from "./V2Application";

interface V2NewSavedServerProps {
  initialCode: string | null;
}

interface InitialPairingState {
  error: string | null;
  preview: PairingPreview | null;
}

export function V2NewSavedServer(props: V2NewSavedServerProps): React.JSX.Element {
  const runtime = useV2Runtime();
  const initial = resolveInitialPairing(props.initialCode, runtime);
  return (
    <NewSavedServerScreen
      initialError={initial.error}
      initialPairing={initial.preview}
      key={props.initialCode}
      readClipboard={readPairingClipboard}
      Scanner={ExpoPairingScanner}
    />
  );
}

function resolveInitialPairing(
  initialCode: string | null,
  runtime: V2Runtime,
): InitialPairingState {
  if (initialCode === null) return { error: null, preview: null };
  try {
    return { error: null, preview: runtime.parseSavedServerLink(initialCode) };
  } catch (cause) {
    return {
      error: cause instanceof Error ? cause.message : "Could not read this connection link.",
      preview: null,
    };
  }
}
