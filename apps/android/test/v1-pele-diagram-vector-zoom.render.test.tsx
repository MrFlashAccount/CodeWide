import {
  peleDiagramTextureTransform,
  peleDiagramViewBox,
} from "../src/rendering/peleDiagramViewBox";

it("zooms by narrowing the SVG viewBox instead of scaling rendered pixels", () => {
  expect(
    peleDiagramViewBox({
      fitHeight: 500,
      fitWidth: 1000,
      scale: 1,
      sourceHeight: 500,
      sourceWidth: 1000,
      translateX: 0,
      translateY: 0,
    }),
  ).toBe("0 0 1000 500");
  expect(
    peleDiagramViewBox({
      fitHeight: 500,
      fitWidth: 1000,
      scale: 2,
      sourceHeight: 500,
      sourceWidth: 1000,
      translateX: 0,
      translateY: 0,
    }),
  ).toBe("250 125 500 250");
});

it("maps screen-space panning into the narrowed source-space viewBox", () => {
  expect(
    peleDiagramViewBox({
      fitHeight: 500,
      fitWidth: 1000,
      scale: 2,
      sourceHeight: 500,
      sourceWidth: 1000,
      translateX: 100,
      translateY: -50,
    }),
  ).toBe("200 150 500 250");
});

it("composes the committed vector viewport into one transient texture transform", () => {
  const texture = peleDiagramTextureTransform({
    committedScale: 2,
    committedTranslateX: 100,
    committedTranslateY: -40,
    scale: 3,
    translateX: 80,
    translateY: 10,
  });

  expect(texture).toEqual({ scale: 1.5, translateX: -70, translateY: 70 });
  expect(texture.translateX + texture.scale * 100).toBe(80);
  expect(texture.translateY + texture.scale * -40).toBe(10);
});
