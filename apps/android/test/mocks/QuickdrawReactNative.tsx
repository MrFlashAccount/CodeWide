import { forwardRef, useEffect, useImperativeHandle } from "react";
import { View } from "react-native";

interface QuickdrawMockProps {
  onReady?(): void;
  snapshot?: unknown;
}

interface QuickdrawMockRef {
  exportPng(): Promise<string>;
  getSnapshot(): Promise<unknown>;
  setTool(tool: string): void;
}

export const Quickdraw = forwardRef<QuickdrawMockRef, QuickdrawMockProps>(
  function QuickdrawMock(props, ref): React.JSX.Element {
    const { onReady, snapshot } = props;
    useImperativeHandle(ref, () => ({
      exportPng: async () => "data:image/png;base64,AQID",
      getSnapshot: async () => snapshot ?? { document: { store: {} } },
      setTool: () => undefined,
    }));
    useEffect(() => {
      onReady?.();
    }, [onReady]);
    return <View testID="quickdraw-mock" />;
  },
);
