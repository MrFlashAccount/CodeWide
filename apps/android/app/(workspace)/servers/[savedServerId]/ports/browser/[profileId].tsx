import { Redirect, Stack, useLocalSearchParams } from "expo-router";

import { BrowserScreen } from "../../../../../../src/v2/features/ports/BrowserScreen";
import {
  tunnelSourcePath,
  type LocalhostBrowserSession,
} from "../../../../../../src/v2/application/ports/localhostBrowser";
import { TunnelBrowserScreen } from "../../../../../../src/v2/features/ports/TunnelBrowserScreen";
import { NativeInternalBrowser } from "../../../../../../src/v2/platform/browser/NativeInternalBrowser";
import { TunnelLifecycle } from "../../../../../../src/v2/platform/browser/TunnelLifecycle";
import {
  opaqueRouteParam,
  savedServerRouteParam,
} from "../../../../../../src/v2/features/navigation/routeParams";

const SCREEN_OPTIONS = { animation: "none", headerShown: false } as const;

export default function BrowserRoute(): React.JSX.Element {
  const params = useLocalSearchParams<"/servers/[savedServerId]/ports/browser/[profileId]">();
  const profileId = opaqueRouteParam(params.profileId);
  const savedServerId = savedServerRouteParam(params.savedServerId);
  if (profileId === null || savedServerId === null) return <Redirect href="/servers" />;
  const tunnel =
    params.mode === "tunnel"
      ? parseTunnelSession(profileId, {
          expiresAt: params.expiresAt,
          label: params.label,
          port: params.port,
          suffix: params.suffix,
        })
      : null;
  if (params.mode === "tunnel" && tunnel === null) return <Redirect href="/servers" />;
  return (
    <>
      <Stack.Screen options={SCREEN_OPTIONS} />
      {tunnel === null ? (
        <BrowserScreen
          browser={NativeInternalBrowser}
          profileId={profileId}
          savedServerId={savedServerId}
        />
      ) : (
        <TunnelBrowserScreen
          browser={NativeInternalBrowser}
          initialSession={tunnel}
          lifecycle={TunnelLifecycle}
          savedServerId={savedServerId}
        />
      )}
    </>
  );
}

interface TunnelRouteParams {
  expiresAt: string | string[] | undefined;
  label: string | string[] | undefined;
  port: string | string[] | undefined;
  suffix: string | string[] | undefined;
}

function parseTunnelSession(
  tunnelId: string,
  params: TunnelRouteParams,
): LocalhostBrowserSession | null {
  const label = scalar(params.label, 128);
  const suffix = scalar(params.suffix, 4096);
  const expiresAt = integer(params.expiresAt, 0, Number.MAX_SAFE_INTEGER);
  const port = integer(params.port, 1, 65_535);
  if (label === null || suffix === null || expiresAt === null || port === null) return null;
  return {
    expiresAt,
    label,
    port,
    sourcePath: tunnelSourcePath(tunnelId, suffix),
    suffix,
    tunnelId,
  };
}

function scalar(value: string | string[] | undefined, maximum: number): string | null {
  return typeof value === "string" && value.length <= maximum ? value : null;
}

function integer(
  value: string | string[] | undefined,
  minimum: number,
  maximum: number,
): number | null {
  if (typeof value !== "string" || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}
