import { expect, test } from "@playwright/test";
import { createDesignerTemplateLayout } from "../src/crossword/templateLayouts";
import { mergeImageArea } from "../src/crossword/editLayout";
import { validateLayout, type GridLayout } from "../src/crossword/layout";

test("generated image areas provide adjacent image clues", () => {
  for (const size of [9, 11, 13]) {
    const layout = createDesignerTemplateLayout(size, { image: { width: 2, height: 2 } });
    expect(layout).not.toBeNull();
    const image = layout!.images[0];
    const words = layout!.words.filter(word => word.clueId === image.id);
    expect(words.length).toBeGreaterThan(0);
    for (const word of words) expect(word.direction === "across"
      ? word.start.col === image.col + image.width && word.start.row >= image.row && word.start.row < image.row + image.height
      : word.start.row === image.row + image.height && word.start.col >= image.col && word.start.col < image.col + image.width).toBe(true);
    expect(validateLayout(layout!)).toEqual([]);
  }
});

test("overlapping image selections merge and retain existing image settings", () => {
  const layout: GridLayout = { width: 9, height: 9, clues: [], words: [], images: [{ id: "old", row: 2, col: 2, width: 2, height: 2, illustration: "preset:flower", fit: "contain", offsetX: 25 }], blocks: [] };
  const merged = mergeImageArea(layout, { row: 3, col: 3 }, 3, 3, "preset:house");
  expect(merged?.images).toEqual([{ id: "image-2-2", row: 2, col: 2, width: 4, height: 4, illustration: "preset:flower", fit: "contain", offsetX: 25, offsetY: undefined }]);
});
