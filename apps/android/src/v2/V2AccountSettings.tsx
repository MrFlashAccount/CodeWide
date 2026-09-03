import type { SavedServerId } from "./domain/ids";
import { AccountSettingsScreen } from "./features/settings/AccountSettingsScreen";
import {
  copyAccountLoginCode,
  openAccountLoginUrl,
} from "./platform/accounts/accountLoginPlatform";

interface V2AccountSettingsProps {
  savedServerId: SavedServerId;
}

export function V2AccountSettings(props: V2AccountSettingsProps): React.JSX.Element {
  const { savedServerId } = props;
  return (
    <AccountSettingsScreen
      copyLoginCode={copyAccountLoginCode}
      openLoginUrl={openAccountLoginUrl}
      savedServerId={savedServerId}
    />
  );
}
