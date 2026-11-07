import { View, type ViewProps } from "react-native";

interface FluidLayoutProps extends ViewProps {
  readonly animate: boolean;
}

/** Preserves ordinary View geometry while omitting the Android-only animation. */
export function FluidLayoutFrame({
  animate: _animate,
  ...props
}: FluidLayoutProps): React.JSX.Element {
  return <View {...props} />;
}
