import * as Haptics from "expo-haptics";
import { Easing } from "react-native-reanimated";
import { SWIPE_REVEAL } from "./inlineQueueLayout";

export const QUEUE_SPRING_GLIDE = { damping: 32, stiffness: 170, mass: 1 };

export const QUEUE_SPRING_SNAPPY = { damping: 24, stiffness: 280, mass: 0.8 };

export const SWIPE_EASING = Easing.bezier(0.22, 0.82, 0.18, 1);

export function playTargetHaptic(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

export function playCommitHaptic(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
}

export function resistedSwipe(distance: number): number {
  "worklet";
  if (distance <= SWIPE_REVEAL) return distance;
  return SWIPE_REVEAL + Math.sqrt(distance - SWIPE_REVEAL) * 7;
}
