import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  type ForwardedRef,
  type ReactElement,
  type ReactNode,
} from "react";
import { View } from "react-native";
import type {
  CommonZoomState,
  GalleryProps,
  GalleryRefType,
  ResumableZoomProps,
  ResumableZoomRefType,
  TapGestureEvent,
} from "react-native-zoom-toolkit";

// WHY: the toolkit's gestures run on Reanimated's UI runtime, which cannot initialize in the
// Node render-test process. The mock renders the content and lets a test deliver what the
// gestures would: a tap in the active child's own frame, and that child's measured size.
type Size = { width: number; height: number };

const state = {
  childSize: { height: 0, width: 0 } as Size,
  index: 0,
  onTap: undefined as ((event: TapGestureEvent, index: number) => void) | undefined,
};

function zoomState(): CommonZoomState<number> {
  return {
    childSize: state.childSize,
    containerSize: state.childSize,
    maxScale: 1,
    scale: 1,
    translateX: 0,
    translateY: 0,
  };
}

/** The measured size of the zoomed child, as the toolkit would read it on layout. */
export function setZoomChildSize(size: Size): void {
  state.childSize = size;
}

/** A single tap at a point of the active child's own frame. */
export function tapZoomChild(x: number, y: number): void {
  // WHY: the handler reads only the tap position; a full gesture event exists only natively.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  state.onTap?.({ x, y } as TapGestureEvent, state.index);
}

function GalleryInner<T>(
  props: Partial<GalleryProps<T>> & Pick<GalleryProps<T>, "data" | "renderItem">,
  ref: ForwardedRef<GalleryRefType>,
): ReactElement | null {
  const index = props.initialIndex ?? 0;
  const onTap = props.onTap;
  useLayoutEffect(() => {
    state.index = index;
    state.onTap = onTap;
  });
  useImperativeHandle(ref, () => ({
    getState: zoomState,
    reset: () => undefined,
    setIndex: () => undefined,
  }));
  const item = props.data[index];
  return item === undefined ? null : (
    <View testID="zoom-gallery">{props.renderItem(item, index)}</View>
  );
}

export const Gallery = forwardRef(GalleryInner) as <T>(
  props: Partial<GalleryProps<T>> &
    Pick<GalleryProps<T>, "data" | "renderItem"> & { ref?: ForwardedRef<GalleryRefType> },
) => ReactElement | null;

export const ResumableZoom = forwardRef(function ResumableZoom(
  props: ResumableZoomProps & { children: ReactNode },
  ref: ForwardedRef<ResumableZoomRefType>,
): ReactElement {
  const onTap = props.onTap;
  useLayoutEffect(() => {
    state.onTap = onTap === undefined ? undefined : (event) => onTap(event);
  });
  useImperativeHandle(ref, () => ({
    getState: zoomState,
    getVisibleRect: () => ({ height: 0, width: 0, x: 0, y: 0 }),
    reset: () => undefined,
    setTransformState: () => undefined,
    zoom: () => undefined,
  }));
  return <View testID="zoom-resumable">{props.children}</View>;
});
