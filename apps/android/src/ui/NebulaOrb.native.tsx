import { requireNativeComponent, type ViewProps } from "react-native";

type NativeNebulaOrbProps = ViewProps & {
  readonly level?: number;
};

const NativeNebulaOrb = requireNativeComponent<NativeNebulaOrbProps>("CodeWideNebulaOrb");

/** Reacticx Nebula Orb rendered by the shared Android runtime-shader view. */
export function NebulaOrb(props: NativeNebulaOrbProps): React.JSX.Element {
  return <NativeNebulaOrb {...props} />;
}
