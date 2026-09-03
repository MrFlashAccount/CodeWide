import { createContext, type ReactNode, useContext } from "react";

interface ProductTextScaleProviderProps {
  children: ReactNode;
  scale: number;
}

const ProductTextScaleContext = createContext(1);

/** Applies an explicit reader scale without changing the device accessibility scale. */
export function ProductTextScaleProvider(props: ProductTextScaleProviderProps): React.JSX.Element {
  return (
    <ProductTextScaleContext.Provider value={props.scale}>
      {props.children}
    </ProductTextScaleContext.Provider>
  );
}

export function useProductTextScale(): number {
  return useContext(ProductTextScaleContext);
}
