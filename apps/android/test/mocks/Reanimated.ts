import type { ComponentType, ReactNode } from "react";
import { Text, View } from "react-native";

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

export function useEvent<Handler>(handler: Handler): Handler {
  return handler;
}

export function useSharedValue<Value>(initial: Value): SharedValue<Value> {
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
export function withSpring<Value>(value: Value, _configuration?: unknown): Value {
  return value;
}

export function cancelAnimation<Value>(_value: SharedValue<Value>): void {
  // Mock animations settle synchronously, so there is no scheduled frame to cancel.
}

function createAnimatedComponent<Props>(component: ComponentType<Props>): ComponentType<Props> {
  return component;
}

export default { Text, View, createAnimatedComponent };
