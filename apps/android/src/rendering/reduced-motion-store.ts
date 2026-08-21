import { useSyncExternalStore } from "react";
import { AccessibilityInfo, type EmitterSubscription } from "react-native";

import { usePerformanceExperiment } from "../data/performance-experiments";

let reducedMotion = false;
let nativeSubscription: EmitterSubscription | null = null;
let generation = 0;
const listeners = new Set<() => void>();

function publish(next: boolean): void {
  if (reducedMotion === next) return;
  reducedMotion = next;
  listeners.forEach((listener) => listener());
}

function start(): void {
  if (nativeSubscription !== null) return;
  generation += 1;
  const currentGeneration = generation;
  nativeSubscription = AccessibilityInfo.addEventListener("reduceMotionChanged", publish);
  void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
    if (currentGeneration === generation) publish(enabled);
  }).catch(() => undefined);
}

function stop(): void {
  if (nativeSubscription === null) return;
  generation += 1;
  nativeSubscription.remove();
  nativeSubscription = null;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}

function getSnapshot(): boolean {
  return reducedMotion;
}

export function useReducedMotionPreference(): boolean {
  const nativePreference = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const experimentPreference = usePerformanceExperiment("reduceCustomMotion");
  return nativePreference || experimentPreference;
}
