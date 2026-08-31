import { Text, View } from "react-native";

import { useV2Runtime } from "../../V2Application";
import type { SavedServerId } from "../../domain/ids";
import { ActionPressable } from "../../ui/actions/ActionPressable";
import { ResourceListView } from "../../../presentation/resources/ResourceListView";
import { V2QueryBoundary } from "../shared/V2QueryBoundary";

interface AccountSettingsScreenProps {
  savedServerId: SavedServerId;
}

export function AccountSettingsScreen({
  savedServerId,
}: AccountSettingsScreenProps): React.JSX.Element {
  const runtime = useV2Runtime();
  return (
    <V2QueryBoundary
      query={{ kind: "accounts.list" }}
      savedServerId={savedServerId}
      title="Accounts"
    >
      {(result, refresh) => {
        if (result.kind !== "accounts.list") return null;
        return (
          <ResourceListView
            empty="No account profiles"
            rows={result.profiles.map((profile) => ({
              detail: [
                profile.plan,
                profile.enabled ? "enabled" : "disabled",
                profile.exhaustedUntil === null
                  ? null
                  : `exhausted until ${profile.exhaustedUntil}`,
              ]
                .filter(Boolean)
                .join(" · "),
              id: profile.id,
              label: profile.email ?? profile.id,
              trailing: (
                <View style={{ alignItems: "flex-end", gap: 6 }}>
                  {result.activeProfileId === profile.id ? (
                    <Text style={{ color: "#35c778" }}>Active</Text>
                  ) : (
                    <ActionPressable
                      action={{
                        id: `activate-${profile.id}`,
                        label: `Activate ${profile.email ?? profile.id}`,
                        run: async () => {
                          await runtime.commands.execute(savedServerId, {
                            change: { kind: "activate", profileId: profile.id },
                            kind: "account.update",
                          });
                          await refresh();
                        },
                      }}
                    />
                  )}
                  <ActionPressable
                    action={{
                      id: `toggle-${profile.id}`,
                      label: profile.enabled
                        ? `Disable ${profile.email ?? profile.id}`
                        : `Enable ${profile.email ?? profile.id}`,
                      run: async () => {
                        await runtime.commands.execute(savedServerId, {
                          change: {
                            enabled: !profile.enabled,
                            kind: "configure",
                            priority: profile.priority,
                            profileId: profile.id,
                          },
                          kind: "account.update",
                        });
                        await refresh();
                      },
                    }}
                  />
                </View>
              ),
            }))}
          />
        );
      }}
    </V2QueryBoundary>
  );
}
