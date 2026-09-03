import type { ComponentType } from "react";
import { View } from "react-native";

interface SharedValue<Value> {
  get(): Value;
  set(value: Value): void;
}

export const Easing = {
  cubic: (value: number): number => value,
  out: <Value>(value: Value): Value => value,
};

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

function createAnimatedComponent<Props>(component: ComponentType<Props>): ComponentType<Props> {
  return component;
}

export default { View, createAnimatedComponent };
