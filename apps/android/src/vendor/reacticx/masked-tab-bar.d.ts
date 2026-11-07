import type { FC, ReactNode } from "react";
import type { StyleProp, TextStyle, ViewStyle } from "react-native";

export type TMaskedTabBarTheme = "dark" | "light";

export interface IMaskedTabBarPalette {
  readonly track: string;
  readonly pill: string;
  readonly inactive: string;
  readonly active: string;
}

export interface IMaskedTabIconState {
  readonly active: boolean;
  readonly color: string;
  readonly size: number;
}

export interface IMaskedTabBarRoot {
  readonly children: ReactNode;
  readonly defaultValue?: string;
  readonly draggable?: boolean;
  readonly fontSize?: number;
  readonly fontWeight?: TextStyle["fontWeight"];
  readonly gap?: number;
  readonly height?: number;
  readonly iconSize?: number;
  readonly onValueChange?: (value: string) => void;
  readonly onSelectedValueActivate?: (value: string) => void;
  readonly padding?: number;
  readonly palette?: Partial<IMaskedTabBarPalette>;
  readonly radius?: number;
  readonly style?: StyleProp<ViewStyle>;
  readonly theme?: TMaskedTabBarTheme;
  readonly value?: string;
}

export interface IMaskedTabBarList {
  readonly children: ReactNode;
  readonly style?: StyleProp<ViewStyle>;
}

export interface IMaskedTabBarTrigger {
  readonly children: ReactNode;
  readonly disabled?: boolean;
  readonly style?: StyleProp<ViewStyle>;
  readonly value: string;
}

export interface IMaskedTabBarLabel {
  readonly children: ReactNode;
  readonly style?: StyleProp<TextStyle>;
}

export interface IMaskedTabBarIcon {
  readonly children: ReactNode | ((state: IMaskedTabIconState) => ReactNode);
  readonly size?: number;
  readonly style?: StyleProp<ViewStyle>;
}

interface MaskedTabBarCompound extends FC<IMaskedTabBarRoot> {
  readonly Icon: FC<IMaskedTabBarIcon>;
  readonly Label: FC<IMaskedTabBarLabel>;
  readonly List: FC<IMaskedTabBarList>;
  readonly Trigger: FC<IMaskedTabBarTrigger>;
}

export const MaskedTabBar: MaskedTabBarCompound;
export const MaskedTabBarRoot: FC<IMaskedTabBarRoot>;
export const MaskedTabBarList: FC<IMaskedTabBarList>;
export const MaskedTabBarTrigger: FC<IMaskedTabBarTrigger>;
export const MaskedTabBarLabel: FC<IMaskedTabBarLabel>;
export const MaskedTabBarIcon: FC<IMaskedTabBarIcon>;

export default MaskedTabBar;
