import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  createElement,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";

import { useEvent } from "../../react/useEvent";
import type { TokenCostEstimate } from "../../turn-cost";
import { ContentMenu } from "../../ui/ContentMenu";
import { CostBreakdownContent } from "./CostBreakdownContent";
import {
  CostMenuContext,
  type CostMenuAnchor,
  type CostMenuController,
  type CostMenuRequest,
} from "./CostBreakdownMenuContext";

const MENU_MAX_WIDTH = 300;
const MENU_WINDOW_GUTTER = 24;

type Selection = {
  readonly anchor: CostMenuAnchor;
  readonly estimate: TokenCostEstimate;
  readonly generation: number;
  readonly request: CostMenuRequest;
};

/** One cost popup per conversation; rows retain only their ordinary RN trigger. */
export function CostBreakdownMenuProvider({
  children,
}: {
  readonly children: ReactNode;
}): ReactElement {
  const controller = useRef<CostMenuController | null>(null);
  return (
    <CostMenuContext.Provider value={controller}>
      {children}
      <CostBreakdownMenuHost controller={controller} />
    </CostMenuContext.Provider>
  );
}

function CostBreakdownMenuHost({
  controller,
}: {
  readonly controller: RefObject<CostMenuController | null>;
}) {
  const root = useRef<View>(null);
  const generation = useRef(0);
  const activeRequest = useRef<CostMenuRequest | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const window = useWindowDimensions();
  const dismiss = useEvent(() => {
    activeRequest.current = null;
    setSelection(null);
  });
  const toggle = useEvent((request: CostMenuRequest) => {
    if (activeRequest.current?.owner === request.owner) {
      dismiss();
      return;
    }
    activeRequest.current = request;
    setSelection(null);
    request.measure((anchor) => {
      root.current?.measureInWindow((left, top) => {
        if (activeRequest.current !== request) {
          return;
        }
        generation.current += 1;
        setSelection({
          anchor: {
            height: anchor.height,
            left: anchor.left - left,
            top: anchor.top - top,
            width: anchor.width,
          },
          estimate: request.getEstimate(),
          generation: generation.current,
          request,
        });
      });
    });
  });
  const update = useEvent((owner: symbol, estimate: TokenCostEstimate) => {
    if (activeRequest.current?.owner !== owner) {
      return;
    }
    setSelection((current) =>
      current?.request.owner === owner && current.estimate !== estimate
        ? { ...current, estimate }
        : current,
    );
  });
  const remove = useEvent((owner: symbol) => {
    if (activeRequest.current?.owner === owner) {
      dismiss();
    }
  });
  useImperativeHandle(controller, () => ({ remove, toggle, update }), [remove, toggle, update]);
  // Screen/window changes invalidate the measured anchor; reopening measures the new bounds.
  useEffect(() => {
    dismiss();
  }, [dismiss, window.fontScale, window.height, window.scale, window.width]);
  const onDismiss = useEvent((request: CostMenuRequest) => {
    if (activeRequest.current === request) {
      dismiss();
    }
  });
  return (
    <View collapsable={false} pointerEvents="box-none" ref={root} style={styles.host}>
      {selection !== null && (
        <CostMenuPopup key={selection.generation} onDismiss={onDismiss} selection={selection} />
      )}
    </View>
  );
}

function CostMenuPopup({
  onDismiss,
  selection,
}: {
  readonly onDismiss: (request: CostMenuRequest) => void;
  readonly selection: Selection;
}): ReactElement {
  const window = useWindowDimensions();
  const onOpenChange = useEvent((open: boolean) => {
    if (!open) {
      onDismiss(selection.request);
    }
  });
  const trigger = createElement(View, {
    pointerEvents: "none",
    style: { height: selection.anchor.height, width: selection.anchor.width },
  });
  return (
    <View style={[styles.anchor, selection.anchor]} testID="cost-menu-anchor">
      <ContentMenu
        align="end"
        onOpenChange={onOpenChange}
        open
        placement="top"
        trigger={trigger}
        width={Math.max(1, Math.min(MENU_MAX_WIDTH, window.width - MENU_WINDOW_GUTTER))}
      >
        <CostBreakdownContent estimate={selection.estimate} />
      </ContentMenu>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: "absolute",
  },
  host: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
});
