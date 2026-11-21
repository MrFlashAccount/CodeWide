import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { DownloadManagerProvider } from "../src/data/DownloadManagerProvider";
import type { DownloadManager } from "../src/data/downloadManager";
import { DownloadsSheet } from "../src/features/downloads/DownloadsSheet";
import { DownloadSettings } from "../src/features/settings/DownloadSettings";
import type { RunningDownload } from "../src/native/file-transfer";
import { createTestDownloadManager } from "./downloads.fixture";

// WHY: Node cannot create the external Compose sheet window; the mock renders its content inline
// so the real AppSheet lifecycle stays under test.
jest.mock("@expo/ui/jetpack-compose", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  const { View: NativeView } = jest.requireActual<typeof import("react-native")>("react-native");
  const Host = ({ children }: { readonly children?: ReactNode }) => (
    <NativeView>{children}</NativeView>
  );
  const ModalBottomSheet = React.forwardRef(function MockModalBottomSheet(
    { children }: { readonly children?: ReactNode },
    ref,
  ) {
    React.useImperativeHandle(ref, () => ({ hide: async () => undefined }), []);
    return <NativeView testID="native-sheet-window">{children}</NativeView>;
  });
  return { Host, ModalBottomSheet, RNHostView: Host };
});

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

it("lists downloads with progress, pause and the completed file's actions", async () => {
  const { manager, transfers } = downloadsHarness();
  const finished = await startDownload(manager, transfers, "first.mp4");
  await act(async () => {
    finished.finish();
    await Promise.resolve();
  });
  const running = await startDownload(manager, transfers, "second.zip");
  act(() => {
    running.progress(1024 * 1024, 4 * 1024 * 1024);
  });

  const view = render(
    <Providers manager={manager}>
      <DownloadsSheet onClose={() => undefined} openedAt={Date.now()} />
    </Providers>,
  );
  expect(view.getByText("Today")).toBeTruthy();
  expect(view.getByText("1.0 MB of 4.0 MB")).toBeTruthy();
  expect(view.getByText("2 KB")).toBeTruthy();

  fireEvent.press(view.getByLabelText("Pause second.zip"));
  expect(running.pause).toHaveBeenCalledTimes(1);
  await waitFor(() => {
    expect(view.getByText("Paused · 1.0 MB of 4.0 MB")).toBeTruthy();
  });
  expect(view.getByLabelText("Resume second.zip")).toBeTruthy();
  expect(view.getByLabelText("Cancel second.zip")).toBeTruthy();

  fireEvent.press(view.getByLabelText("Download actions, first.mp4"));
  expect(view.getByText("Open")).toBeTruthy();
  expect(view.getByText("Remove from list")).toBeTruthy();
  fireEvent.press(view.getByLabelText("Download actions, first.mp4: Delete"));
  await waitFor(() => {
    expect(view.queryByText("first.mp4")).toBeNull();
  });
});

it("shows the download location in Settings and changes it there", async () => {
  const { manager } = downloadsHarness();
  const view = render(
    <Providers manager={manager}>
      <DownloadSettings />
    </Providers>,
  );
  expect(view.getByText("Ask on the first download")).toBeTruthy();
  fireEvent.press(view.getByLabelText("Download location"));
  await waitFor(() => {
    expect(view.getByText("Downloads")).toBeTruthy();
  });
});
