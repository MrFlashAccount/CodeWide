import { createRef, type ComponentType, type ReactNode, type RefObject } from "react";
import { ScrollView, Text, View } from "react-native";

// WHY: Interpolation is pure math; dialog render tests use the real implementation without the native runtime.
export { Extrapolation, interpolate } from "react-native-reanimated/src/interpolation";

interface SharedValue<Value> {
  value: Value;
  get(): Value;
  set(value: Value): void;
}

export const Easing = {
  bezier:
    () =>
    (value: number): number =>
      value,
  cubic: (value: number): number => value,
  ease: (value: number): number => value,
  in: <Value>(value: Value): Value => value,
  inOut: <Value>(value: Value): Value => value,
  out: <Value>(value: Value): Value => value,
};

// WHY: Reanimated constructs native layout keyframes at import time; Node renders final layout only.
export class Keyframe {
  constructor(_definitions: unknown) {}
  duration(_milliseconds: number): this {
    return this;
  }
  easing(_easing: unknown): this {
    return this;
  }
  withInitialValues(_values: unknown): this {
    return this;
  }
  springify(): this {
    return this;
  }
  damping(_value: number): this {
    return this;
  }
  dampingRatio(_value: number): this {
    return this;
  }
  stiffness(_value: number): this {
    return this;
  }
  mass(_value: number): this {
    return this;
  }
}
export const LinearTransition = new Keyframe({});
export const FadeIn = new Keyframe({});
export const FadeInDown = new Keyframe({});
export const FadeInUp = new Keyframe({});
export const FadeOut = new Keyframe({});

// WHY: Node renders content only; native layout-animation lifecycle runs on the device.
export function LayoutAnimationConfig({ children }: { readonly children: ReactNode }): ReactNode {
  return children;
}

export function useReducedMotion(): boolean {
  return true;
}
export function useDerivedValue<Value>(factory: () => Value): SharedValue<Value> {
  return useSharedValue(factory());
}

export function runOnJS<Arguments extends unknown[], Result>(
  callback: (...arguments_: Arguments) => Result,
): (...arguments_: Arguments) => Result {
  return callback;
}

export function useAnimatedStyle<Result>(factory: () => Result): Result {
  return factory();
}

export function useAnimatedRef<Value>(): RefObject<Value | null> {
  return createRef<Value>();
}

export function useAnimatedScrollHandler(_handlers: unknown): () => void {
  return () => undefined;
}

export function useAnimatedReaction<Value>(
  _prepare: () => Value,
  _react: (current: Value, previous: Value | null) => void,
): void {
  // Render tests do not run the native UI-thread reaction loop.
}

interface FrameCallback {
  setActive(active: boolean): void;
}

export function useFrameCallback(
  _callback: (frame: { readonly timeSincePreviousFrame?: number }) => void,
  _autostart?: boolean,
): FrameCallback {
  return { setActive: () => undefined };
}

export function scrollTo(
  _ref: RefObject<unknown>,
  _x: number,
  _y: number,
  _animated: boolean,
): void {
  // Render tests do not own a native scroll view.
}

export function useEvent<Handler>(handler: Handler): Handler {
  return handler;
}

export function useSharedValue<Value>(initial: Value): SharedValue<Value> {
  return makeMutable(initial);
}

// Render tests re-create shared values on each render, so a read reflects the latest props.
export function makeMutable<Value>(initial: Value): SharedValue<Value> {
  let value = initial;
  return {
    get value() {
      return value;
    },
    set value(next: Value) {
      value = next;
    },
    get: () => value,
    set: (next) => {
      value = next;
    },
  };
}

export function withTiming<Value>(
  value: Value,
  _configuration?: unknown,
  callback?: (finished: boolean) => void,
): Value {
  callback?.(true);
  return value;
}

// Native animation timing is unavailable in Node; settle at the requested value.
export function withSpring<Value>(
  value: Value,
  _configuration?: unknown,
  callback?: (finished: boolean) => void,
): Value {
  callback?.(true);
  return value;
}

export function cancelAnimation<Value>(_value: SharedValue<Value>): void {
  // Mock animations settle synchronously, so there is no scheduled frame to cancel.
}

function createAnimatedComponent<Props>(component: ComponentType<Props>): ComponentType<Props> {
  return component;
}

export default { ScrollView, Text, View, createAnimatedComponent };
