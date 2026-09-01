import { Text, type TextProps } from "react-native";

interface IconProps extends TextProps {
  color?: string;
  name: string;
  size?: number;
}

export function Ionicons({ color, name, size, style, ...props }: IconProps): React.JSX.Element {
  return (
    <Text {...props} style={[style, { color, fontSize: size }]}>
      {name}
    </Text>
  );
}

export const MaterialIcons = Ionicons;

export default Ionicons;
