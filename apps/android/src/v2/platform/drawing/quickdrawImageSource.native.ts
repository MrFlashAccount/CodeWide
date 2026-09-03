import { createQuickdrawImageSource } from "../../infrastructure/drawing/quickdrawImageSource.native";

/** Native QuickDraw image decoder injected at the route composition boundary. */
export const quickdrawImageSource = createQuickdrawImageSource();
