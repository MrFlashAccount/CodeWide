import { NewSavedServerScreen } from "./features/settings/NewSavedServerScreen";
import { ExpoPairingScanner } from "./platform/pairing/ExpoPairingScanner";
import { readPairingClipboard } from "./platform/pairing/readPairingClipboard";

export function V2NewSavedServer(): React.JSX.Element {
  return <NewSavedServerScreen readClipboard={readPairingClipboard} Scanner={ExpoPairingScanner} />;
}
