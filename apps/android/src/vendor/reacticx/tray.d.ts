import type { FC, ReactNode } from "react";
import type {
  StyleProp,
  TextStyle,
  ViewStyle,
} from "react-native";
import type {
  WithSpringConfig,
  WithTimingConfig,
} from "react-native-reanimated";

export type TTrayTheme = "dark" | "light";
export type TTrayDetent = number | `${number}%`;
export type TTrayViewAxis = "none" | "x" | "y";

export interface ITrayPalette {
  readonly backdrop: string;
  readonly border: string;
  readonly handle: string;
  readonly mutedText: string;
  readonly surface: string;
  readonly text: string;
}

export interface ITrayMotion {
  readonly activeOffsetY: [number, number];
  readonly backdropFalloff: number;
  readonly detentSpring: WithSpringConfig;
  readonly dragReturnSpring: WithSpringConfig;
  readonly failOffsetX: [number, number];
  readonly flickProjection: number;
  readonly heightSpring: WithSpringConfig;
  readonly overDragFactor: number;
  readonly presentSpring: WithSpringConfig;
  readonly scrollDeceleration: number;
  readonly startScale: number;
  readonly travelPadding: number;
  readonly viewAxis: TTrayViewAxis;
  readonly viewInSpring: WithSpringConfig;
  readonly viewOutTiming: WithTimingConfig;
  readonly viewSlide: number;
  readonly viewStartScale: number;
}

export interface ITray {
  readonly children: ReactNode;
  readonly closeThreshold?: number;
  readonly closeVelocity?: number;
  readonly defaultOpen?: boolean;
  readonly defaultView?: string;
  readonly detents?: readonly TTrayDetent[];
  readonly dismissOnBackdropPress?: boolean;
  readonly enableDragToDismiss?: boolean;
  readonly initialDetent?: number;
  readonly motion?: Partial<ITrayMotion>;
  readonly onDetentChange?: (index: number) => void;
  readonly onOpenChange?: (open: boolean) => void;
  readonly onViewChange?: (view: string) => void;
  readonly open?: boolean;
  readonly palette?: Partial<ITrayPalette>;
  readonly radius?: number;
  readonly theme?: TTrayTheme;
}

export interface ITrayTrigger {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
  readonly view?: string;
}

export interface ITrayContent {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
}

export interface ITrayView {
  readonly children: ReactNode;
  readonly id: string;
  readonly style?: StyleProp<ViewStyle>;
}

export interface ITrayHeader {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
}

export interface ITrayTitle {
  readonly children: ReactNode;
  readonly style?: StyleProp<TextStyle>;
}

export interface ITrayBody {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
}

export interface ITrayFooter {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
}

interface TrayIconState {
  readonly color: string;
  readonly size: number;
}

export interface ITrayClose {
  readonly children?: ReactNode | ((state: TrayIconState) => ReactNode);
  readonly style?: StyleProp<ViewStyle>;
}

export interface ITrayScrollView {
  readonly children: ReactNode;
  readonly contentContainerStyle?: StyleProp<ViewStyle>;
  readonly maxHeight?: number;
  readonly style?: StyleProp<ViewStyle>;
}

interface TrayController {
  readonly canGoBack: boolean;
  readonly close: () => void;
  readonly goBack: () => void;
  readonly open: (view?: string) => void;
  readonly setView: (view: string) => void;
  readonly view: string;
  readonly visible: boolean;
}

interface TrayCompound extends FC<ITray> {
  readonly Back: FC<ITrayClose>;
  readonly Body: FC<ITrayBody>;
  readonly Close: FC<ITrayClose>;
  readonly Content: FC<ITrayContent>;
  readonly Footer: FC<ITrayFooter>;
  readonly Header: FC<ITrayHeader>;
  readonly Icon: FC<{ readonly children: ReactNode }>;
  readonly ScrollView: FC<ITrayScrollView>;
  readonly Subtitle: FC<ITrayTitle>;
  readonly Title: FC<ITrayTitle>;
  readonly Trigger: FC<ITrayTrigger>;
  readonly View: FC<ITrayView>;
}

export const Tray: TrayCompound;
export const TrayRoot: FC<ITray>;
export const TrayTrigger: FC<ITrayTrigger>;
export const TrayContent: FC<ITrayContent>;
export const TrayView: FC<ITrayView>;
export const TrayHeader: FC<ITrayHeader>;
export const TrayTitle: FC<ITrayTitle>;
export const TraySubtitle: FC<ITrayTitle>;
export const TrayBody: FC<ITrayBody>;
export const TrayFooter: FC<ITrayFooter>;
export const TrayClose: FC<ITrayClose>;
export const TrayBack: FC<ITrayClose>;
export const TrayScrollView: FC<ITrayScrollView>;
export function useTray(): TrayController;

export default Tray;
