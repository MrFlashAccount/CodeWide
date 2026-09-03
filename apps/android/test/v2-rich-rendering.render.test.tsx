import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { MarkdownLink } from "../src/v2/rendering/MarkdownLink";
import { ImagePreviewModal } from "../src/v2/rendering/ImagePreviewModal";
import {
  ResolvedImageGroup,
  useResolvedMarkdownImages,
} from "../src/v2/rendering/ResolvedImageGroup";
import {
  type MarkdownImageReference,
  type V2RenderingCapabilities,
  V2RenderingCapabilityProvider,
} from "../src/v2/rendering/renderingCapabilities";
import {
  clampImageTranslation,
  containImageSize,
  doubleTapImageTranslation,
  resolveImagePreviewAxis,
  shouldDismissImage,
  shouldNavigateImage,
} from "../src/v2/presentation/preview/imagePreviewGestureModel";

const PRIVATE_REFERENCE: MarkdownImageReference = {
  alt: "Private screenshot",
  id: "private-screenshot",
  reference: "private://screenshot",
};

interface ImageResourceHarnessProps {
  resolver: NonNullable<V2RenderingCapabilities["resolveImageSource"]>;
  revision: string;
}

function ImageResourceHarness(props: ImageResourceHarnessProps): React.JSX.Element {
  return (
    <V2RenderingCapabilityProvider
      capabilities={{ imageSourceRevision: props.revision, resolveImageSource: props.resolver }}
    >
      <ResolvedImageGroup key={props.revision} references={[PRIVATE_REFERENCE]}>
        <ImageUriProbe />
      </ResolvedImageGroup>
    </V2RenderingCapabilityProvider>
  );
}

function ImageUriProbe(): React.JSX.Element {
  const images = useResolvedMarkdownImages();
  return <Text>{images[0]?.source.uri ?? "missing"}</Text>;
}

describe("V2 rich rendering interactions", () => {
  it("uses one interactive gallery surface for Markdown images", () => {
    const close = jest.fn();
    render(
      <SafeAreaProvider
        initialMetrics={{
          frame: { height: 800, width: 400, x: 0, y: 0 },
          insets: { bottom: 0, left: 0, right: 0, top: 0 },
        }}
      >
        <V2RenderingCapabilityProvider capabilities={{}}>
          <ImagePreviewModal
            initialId="first"
            items={[
              {
                alt: "First image",
                id: "first",
                order: 0,
                reference: "first.png",
                source: { uri: "file:///first.png" },
              },
              {
                alt: "Second image",
                id: "second",
                order: 1,
                reference: "second.png",
                source: { uri: "file:///second.png" },
              },
            ]}
            onClose={close}
            visible
          />
        </V2RenderingCapabilityProvider>
      </SafeAreaProvider>,
    );

    expect(screen.getByLabelText("First image full screen")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Next image"));
    expect(screen.getByLabelText("Second image full screen")).toBeTruthy();
    expect(screen.getByText("2 / 2")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("Close image"));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("preserves the V1 image gesture thresholds and bounded zoom geometry", () => {
    const viewport = { height: 800, width: 400 };
    const fitted = containImageSize({ height: 600, width: 1_200 }, viewport);

    expect(fitted).toEqual({ height: 200, width: 400 });
    expect(resolveImagePreviewAxis(7, 2)).toBe(0);
    expect(resolveImagePreviewAxis(40, 10)).toBe(1);
    expect(resolveImagePreviewAxis(10, 40)).toBe(2);
    expect(shouldNavigateImage(65, 0, viewport.width)).toBe(true);
    expect(shouldNavigateImage(0, 721, viewport.width)).toBe(true);
    expect(shouldDismissImage(113, 0, viewport.height)).toBe(true);
    expect(shouldDismissImage(0, 821, viewport.height)).toBe(true);
    expect(clampImageTranslation({ x: 999, y: -999 }, fitted, viewport, 2.5)).toEqual({
      x: 300,
      y: -0,
    });
    expect(doubleTapImageTranslation({ x: 0, y: 400 }, fitted, viewport)).toEqual({
      x: 300,
      y: 0,
    });
  });

  it("routes external, loopback and local links through separate capabilities", async () => {
    const openExternalLink = jest.fn();
    const openLocalDocument = jest.fn(() => true);
    const openLoopbackLink = jest.fn();
    render(
      <V2RenderingCapabilityProvider
        capabilities={{ openExternalLink, openLocalDocument, openLoopbackLink }}
      >
        <MarkdownLink url="https://example.test/docs">External docs</MarkdownLink>
        <MarkdownLink url="http://localhost:3000">Local service</MarkdownLink>
        <MarkdownLink url="src/app.tsx:42">Source file</MarkdownLink>
        <MarkdownLink url="javascript:alert(1)">Unsafe link</MarkdownLink>
      </V2RenderingCapabilityProvider>,
    );

    await act(async () => {
      fireEvent.press(screen.getByText("External docs"));
      fireEvent.press(screen.getByText("Local service"));
      fireEvent.press(screen.getByText("Source file"));
    });

    expect(openExternalLink).toHaveBeenCalledWith("https://example.test/docs");
    expect(openLoopbackLink).toHaveBeenCalledWith("http://localhost:3000");
    expect(openLocalDocument).toHaveBeenCalledWith("src/app.tsx:42");
    expect(screen.getByText("Unsafe link").props.accessibilityRole).toBeUndefined();
  });

  it("rebuilds private image resources when late attachment data changes the revision", () => {
    const initialResolver = jest.fn(() => null);
    const loadedResolver = jest.fn(() => ({ uri: "file:///private/screenshot.png" }));
    const view = render(<ImageResourceHarness resolver={initialResolver} revision="empty" />);

    expect(screen.getByText("missing")).toBeTruthy();
    view.rerender(<ImageResourceHarness resolver={loadedResolver} revision="loaded" />);

    expect(screen.getByText("file:///private/screenshot.png")).toBeTruthy();
    expect(initialResolver).toHaveBeenCalledWith("private://screenshot");
    expect(loadedResolver).toHaveBeenCalledWith("private://screenshot");
  });
});
