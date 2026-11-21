import { act, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { DownloadManagerProvider } from "../src/data/DownloadManagerProvider";
import type { DownloadManager } from "../src/data/downloadManager";
import { ThreadListMenu } from "../src/features/threadList/ThreadListMenus";
import type { RunningDownload } from "../src/native/file-transfer";
import { createTestDownloadManager } from "./downloads.fixture";

type Transfer = {
  readonly finish: () => void;
  readonly pause: jest.Mock;
  readonly progress: (transferred: number, total: number) => void;
};

const access = async () => {
  await Promise.resolve();
  throw new Error("Transfers are faked in this test");
};
const folder = { name: "Downloads", native: {}, uri: "content://downloads" };

function downloadsHarness(): {
  readonly manager: DownloadManager;
  readonly transfers: Transfer[];
} {
  const transfers: Transfer[] = [];
  const manager = createTestDownloadManager({
    pickDirectory: async () => {
      await Promise.resolve();
      return folder;
    },
    start: ({ onProgress, source }): RunningDownload => {
      let resolve: (value: Awaited<RunningDownload["promise"]>) => void = () => undefined;
      let reject: (error: Error) => void = () => undefined;
      const promise = new Promise<Awaited<RunningDownload["promise"]>>((onResolve, onReject) => {
        resolve = onResolve;
        reject = onReject;
      });
      const pause = jest.fn(() => {
        reject(new Error("Transfer cancelled"));
      });
      transfers.push({
        finish: () => {
          resolve({ bytes: 2048, sha256: "a".repeat(64), uri: `content://downloads${source.path}` });
        },
        pause,
        progress: (transferred, total) => {
          onProgress({ phase: "transferring", total, transferred });
        },
      });
      return { cancel: pause, pause, promise };
    },
  });
  return { manager, transfers };
}

function Providers({
  children,
  manager,
}: {
  readonly children: ReactNode;
  readonly manager: DownloadManager;
}): React.JSX.Element {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 800, width: 400, x: 0, y: 0 },
        insets: { bottom: 0, left: 0, right: 0, top: 0 },
      }}
    >
      <DownloadManagerProvider manager={manager}>{children}</DownloadManagerProvider>
    </SafeAreaProvider>
  );
}

async function startDownload(
  manager: DownloadManager,
  transfers: Transfer[],
  name: string,
): Promise<Transfer> {
  await act(async () => {
    void manager.start({ getAccess: access, name, source: { kind: "path", path: `/srv/${name}` } });
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(transfers).toHaveLength(manager.entries$.peek().length);
  });
  const transfer = transfers.at(-1);
  if (transfer === undefined) {
    throw new Error(`${name} did not start`);
  }
  return transfer;
}

function threadListMenu(): React.JSX.Element {
  return (
    <ThreadListMenu
      accountDatabase={null}
      accountServers={[]}
      agentProviders={null}
      archived={false}
      onManageProjects={() => undefined}
      onManageTerminals={() => undefined}
      onOpenDownloads={() => undefined}
      onSettings={() => undefined}
      onToggleArchive={() => undefined}
    />
  );
}

it("replaces the thread list dots with a progress ring while a download runs", async () => {
  const { manager, transfers } = downloadsHarness();
  const view = render(<Providers manager={manager}>{threadListMenu()}</Providers>);
  expect(view.getByLabelText("Thread list menu")).toBeTruthy();
  expect(view.queryByTestId("overflow-menu-activity-ring")).toBeNull();

  const transfer = await startDownload(manager, transfers, "repro.mp4");
  act(() => {
    transfer.progress(512, 2048);
  });
  expect(view.getByLabelText("Thread list menu, downloading 25%")).toBeTruthy();
  expect(view.getByTestId("overflow-menu-activity-ring")).toBeTruthy();

  await act(async () => {
    transfer.finish();
    await Promise.resolve();
  });
  await waitFor(() => {
    expect(view.getByLabelText("Thread list menu")).toBeTruthy();
  });
  expect(view.queryByTestId("overflow-menu-activity-ring")).toBeNull();
});

