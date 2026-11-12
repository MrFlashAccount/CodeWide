import { describe, expect, it, vi } from "vitest";
import Yoga, { Edge, FlexDirection, PositionType, type Config, type Node } from "yoga-layout";

import { paneGeometry, type PaneArrangement } from "../src/routeComposition/paneGeometry";
import {
  REST_CENTER_CONTENT_FRAME,
  restCatalogFrame,
  restCenterClipFrame,
  restDestinationFrame,
  restRightFrame,
} from "../src/routeComposition/paneRestFrames";

// WHY: the spring spec module imports Reanimated, whose native runtime cannot load in Node; the
// rest frames only read its catalog opacity constant.
vi.mock("react-native-reanimated", () => ({ withSpring: () => 1 }));

/*
 * The settled pane layout is owned by Yoga: the frame publishes only relative styles at rest
 * (`paneRestFrames.ts`), and a motion's explicit end is `paneGeometry`. This lays the rest styles
 * out with Yoga itself and requires the result to equal that explicit end for representative
 * frame widths, including both sidebar clamps, so settling a motion causes no visible jump.
 */

type Dimension = number | "auto" | `${number}%`;

type BoxStyle = {
  readonly bottom?: number;
  readonly flexBasis?: number;
  readonly flexDirection?: "row";
  readonly flexGrow?: number;
  readonly flexShrink?: number;
  readonly left?: Dimension;
  readonly maxWidth?: Dimension;
  readonly minWidth?: Dimension;
  readonly position?: "absolute" | "relative";
  readonly top?: number;
  readonly width?: Dimension;
};

function inset(value: Dimension): number | `${number}%` {
  if (value === "auto") throw new Error("An edge cannot be auto");
  return value;
}

function bound(value: Dimension): number | `${number}%` {
  if (value === "auto") throw new Error("A width bound cannot be auto");
  return value;
}

function box(config: Config, style: BoxStyle, children: readonly Node[] = []): Node {
  const node = Yoga.Node.create(config);
  if (style.flexDirection === "row") node.setFlexDirection(FlexDirection.Row);
  if (style.position !== undefined) {
    node.setPositionType(
      style.position === "absolute" ? PositionType.Absolute : PositionType.Relative,
    );
  }
  if (style.flexGrow !== undefined) node.setFlexGrow(style.flexGrow);
  if (style.flexShrink !== undefined) node.setFlexShrink(style.flexShrink);
  if (style.flexBasis !== undefined) node.setFlexBasis(style.flexBasis);
  if (style.width !== undefined) node.setWidth(style.width);
  if (style.minWidth !== undefined) node.setMinWidth(bound(style.minWidth));
  if (style.maxWidth !== undefined) node.setMaxWidth(bound(style.maxWidth));
  if (style.left !== undefined) node.setPosition(Edge.Left, inset(style.left));
  if (style.top !== undefined) node.setPosition(Edge.Top, style.top);
  if (style.bottom !== undefined) node.setPosition(Edge.Bottom, style.bottom);
  for (const [index, child] of children.entries()) node.insertChild(child, index);
  return node;
}

/** The frame's pane tree with the static styles of the frame and the center layout. */
function layOut(arrangement: PaneArrangement, frameWidth: number, pointScaleFactor: number) {
  const config = Yoga.Config.create();
  config.setPointScaleFactor(pointScaleFactor);
  const anchored = { bottom: 0, left: 0, position: "absolute", top: 0 } as const;
  const centerContent = box(config, { ...anchored, ...REST_CENTER_CONTENT_FRAME });
  const centerClip = box(config, { ...anchored, ...restCenterClipFrame(arrangement) }, [
    centerContent,
  ]);
  const right = box(config, { ...anchored, ...restRightFrame(arrangement) });
  const centerLayout = box(config, { flexGrow: 1, minWidth: 0 }, [centerClip, right]);
  const destination = box(
    config,
    {
      bottom: 0,
      flexBasis: 0,
      flexShrink: 1,
      minWidth: 0,
      top: 0,
      ...restDestinationFrame(arrangement),
    },
    [centerLayout],
  );
  const catalog = box(config, { flexShrink: 0, ...restCatalogFrame(arrangement) });
  const frame = box(config, { flexDirection: "row", position: "relative", width: frameWidth }, [
    catalog,
    destination,
  ]);
  frame.setHeight(800);
  frame.calculateLayout(frameWidth, 800);
  const detailX = destination.getComputedLeft();
  const layout = {
    catalogWidth: catalog.getComputedWidth(),
    centerClipWidth: centerClip.getComputedWidth(),
    centerWidth: centerContent.getComputedWidth(),
    detailWidth: destination.getComputedWidth(),
    detailX,
    rightWidth: right.getComputedWidth(),
    rightX: detailX + right.getComputedLeft(),
  };
  frame.freeRecursive();
  config.free();
  return layout;
}

const LEFTS = ["alone", "beside", "covered", "under"] as const;
const RIGHTS = ["beside", "cover", "offscreen"] as const;
const COMBINATIONS = LEFTS.flatMap((left) =>
  RIGHTS.map((right): PaneArrangement => ({
    centerLeftRadius: 0,
    centerRightRadius: 0,
    left,
    right,
    sidebar: left !== "under",
  })),
);

describe("Yoga lays out the resting panes exactly where a motion ends", () => {
  // 840 clamps the sidebar to its minimum, 1600 to its maximum; 1200 takes the plain share.
  const widths = [840, 1200, 1600] as const;
  // A unit grid, and the Fold's inner display density, where Yoga rounds to physical pixels.
  const scales = [1, 2.625] as const;

  it.each(widths.flatMap((width) => scales.map((scale) => [width, scale] as const)))(
    "matches the explicit end in a %d dp frame at %d px/dp",
    (frameWidth, scale) => {
      for (const arrangement of COMBINATIONS) {
        const end = paneGeometry(arrangement, frameWidth);
        const laidOut = layOut(arrangement, frameWidth, scale);
        // Yoga snaps edges to the physical pixel grid; anything closer than one pixel is no jump.
        const pixel = 1 / scale;
        for (const key of Object.keys(laidOut) as (keyof typeof laidOut)[]) {
          expect(
            Math.abs(laidOut[key] - end[key]),
            `${arrangement.left}/${arrangement.right} ${key}`,
          ).toBeLessThanOrEqual(pixel);
        }
      }
    },
  );

  it("absorbs a frame size change with no JavaScript input", () => {
    const beside: PaneArrangement = {
      centerLeftRadius: 0,
      centerRightRadius: 0,
      left: "beside",
      right: "offscreen",
      sidebar: true,
    };
    // The same rest styles resize with the frame: an unfolded, rotated or inset frame needs no
    // new measurement for the settled panes to fill it.
    expect(layOut(beside, 900, 1)).toMatchObject({ catalogWidth: 320, detailWidth: 580 });
    expect(layOut(beside, 1300, 1)).toMatchObject({ catalogWidth: 442, detailWidth: 858 });
  });
});
