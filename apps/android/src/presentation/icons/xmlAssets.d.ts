// Metro resolves vector XML files to native image sources in both UI generations.
declare module "*.xml" {
  import type { ImageSourcePropType } from "react-native";
  const source: ImageSourcePropType;
  export default source;
}
