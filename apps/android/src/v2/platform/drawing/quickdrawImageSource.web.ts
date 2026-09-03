import { createQuickdrawImageSource } from "../../infrastructure/drawing/quickdrawImageSource.web";

/** Web QuickDraw image decoder injected at the route composition boundary. */
export const quickdrawImageSource = createQuickdrawImageSource();
