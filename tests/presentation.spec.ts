import { expect, test, type Page } from "@playwright/test";

const answer = "KRYDSORD";
const entry = { word: answer, clue: "Ordleg", length: 8, source: "custom" };
const puzzle = {
  size: 9,
  cells: Array.from({ length: 9 }, (_, row) => Array.from({ length: 9 }, (_, col) => row > 0
    ? { kind: "block" }
    : col === 0 ? { kind: "clue", placementIds: [0], width: 1, height: 1 }
      : { kind: "letter", solution: answer[col - 1], placementIds: [0] })),
  placements: [{ ...entry, id: 0, row: 0, col: 1, direction: "across", clueRow: 0, clueCol: 0, cueKind: "clue", arrow: "→" }],
};
const layout = {
  width: 9, height: 9,
  clues: [{ id: "clue", row: 0, col: 0, width: 1, height: 1 }], images: [], arrows: [],
  words: [{ id: "word", start: { row: 0, col: 1 }, direction: "across", length: 8, clueId: "clue" }],
  blocks: Array.from({ length: 72 }, (_, i) => ({ row: Math.floor(i / 9) + 1, col: i % 9 })),
};

async function openApp(page: Page) {
  await page.route("**/src/crossword/designerGeneration.worker.ts*", route => route.fulfill({
    contentType: "application/javascript",
    body: `self.onmessage = () => self.postMessage({ type: 'generated', layout: ${JSON.stringify(layout)}, answers: { word: ${JSON.stringify(entry)} } });`,
  }));
  await page.route("**/src/lib/persistence.ts*", route => route.fulfill({
    contentType: "application/javascript",
    body: `
      export const STORAGE_KEYS = { library: 'krydsvaerk-library-v1', drafts: 'krydsvaerk-drafts-v1', dictionaries: 'krydsvaerk-ordboger-v1', builtinDictionarySettings: 'krydsvaerk-indbyggede-ordboger-v1', legacyDictionary: 'krydsvaerk-ordbog', play: 'krydsvaerk-play-v1' };
      const fixture = { id: 'fixture', name: 'Sommerord', puzzle: ${JSON.stringify(puzzle)} };
      export async function loadPersistedData() { return { [STORAGE_KEYS.library]: [fixture], [STORAGE_KEYS.dictionaries]: [{ id: 'words', name: 'Mine ord', enabled: true, entries: [${JSON.stringify(entry)}] }], __user_id: 'fixture', __public_crosswords: [], __shared_dictionaries: [] }; }
      export async function savePersistedValue() {}
      export async function setSharedDictionary() {}
      export async function publishPublicCrossword() { throw new Error('Outside this test'); }
    `,
  }));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Ord, der krydser." })).toBeVisible();
}

async function noPageOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test("player uses shared compact headings, resizable cards and working clue actions", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openApp(page);
  const separator = page.getByRole("separator", { name: "Juster bredden på spillerpanelerne" });
  const choices = (await page.locator(".intro-panel").boundingBox())!;
  const board = (await page.getByRole("region", { name: "Krydsord", exact: true }).boundingBox())!;
  expect(Math.abs(choices.y - board.y)).toBeLessThan(1);
  await expect(separator).toHaveAttribute("aria-valuenow", "32");
  await separator.focus();
  await page.keyboard.press("ArrowRight");
  await expect(separator).toHaveAttribute("aria-valuenow", "34");
  const bounds = (await page.locator(".player-workspace").boundingBox())!;
  const grip = (await separator.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 45);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .38, grip.y + 45, { steps: 5 });
  await page.mouse.up();
  await expect(separator).toHaveAttribute("aria-valuenow", "38");
  const headingSize = await page.getByRole("heading", { name: "Dit krydsord", exact: true }).evaluate(el => getComputedStyle(el).fontSize);
  expect(headingSize).toBe("24px");
  await page.getByRole("textbox", { name: "Række 1, kolonne 2", exact: true }).fill("K");
  await expect(page.locator(".active-clue strong")).toHaveText("Ordleg");
  await expect(page.locator(".progress-row")).toContainText("1 af 8 bogstaver");
  await page.getByRole("button", { name: "Vis et bogstav", exact: true }).click();
  await expect(page.locator(".progress-row")).toContainText("2 af 8 bogstaver");
  await page.getByRole("button", { name: "Tjek svar", exact: true }).click();
  await page.getByRole("button", { name: "Start forfra", exact: true }).click();
  await expect(page.locator(".progress-row")).toContainText("0 af 8 bogstaver");
  await page.getByRole("button", { name: "Vis gitter i fuld skærm", exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.className ?? "no fullscreen")).toBe("board-wrap");
  await page.locator(".fullscreen-grid-exit").click();
  await noPageOverflow(page);
  await page.screenshot({ path: "test-results/player-desktop.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("player cards stack across small screens and keep dictionary controls available", async ({ page }) => {
  await openApp(page);
  for (const width of [320, 390, 768, 1100, 1101]) {
    await page.setViewportSize({ width, height: 900 });
    await noPageOverflow(page);
    const separator = page.getByRole("separator", { name: "Juster bredden på spillerpanelerne" });
    if (width <= 1100) {
      await expect(separator).toBeHidden();
      const choices = (await page.locator(".intro-panel").boundingBox())!;
      expect((await page.locator(".puzzle-panel").boundingBox())!.y).toBeGreaterThan(choices.y + choices.height);
    } else await expect(separator).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".dictionary-section summary").click();
  await expect(page.getByRole("textbox", { name: /Ledetråd: svar/ })).toBeVisible();
  await noPageOverflow(page);
  await page.screenshot({ path: "test-results/player-mobile.png", fullPage: true });
});

test("workshop, dictionary and preview reuse the same brand and card headings", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openApp(page);
  await page.getByRole("button", { name: "Designerværksted", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Opret et felt", exact: true })).toBeVisible();
  await expect(page.locator(".site-header:visible .brand-mark")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Gem dit arbejde", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Del dit krydsord", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ord og ledetråd", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/workshop-desktop.png", fullPage: true });
  for (const width of [320, 390, 768, 1100, 1101]) {
    await page.setViewportSize({ width, height: 900 });
    await noPageOverflow(page);
    const separator = page.getByRole("separator", { name: "Juster bredden på panelerne", exact: true });
    if (width <= 1100) await expect(separator).toBeHidden();
    else await expect(separator).toBeVisible();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "test-results/workshop-mobile.png", fullPage: true });
  await page.getByRole("button", { name: /^Ordbøger/ }).click();
  await expect(page.getByRole("heading", { name: "Dine ordbøger", exact: true })).toBeVisible();
  await noPageOverflow(page);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByRole("button", { name: "Se ord i DanNet", exact: true }).click();
  await noPageOverflow(page);
  await expect(page.getByRole("heading", { name: "DanNet", exact: true })).toBeVisible();
  await page.locator("#custom-dictionary-editor").getByRole("button", { name: "Luk", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Krydsord", exact: true }).click();
  await page.getByRole("button", { name: "Forhåndsvis", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Se dit krydsord.", exact: true })).toBeVisible();
  await expect(page.locator(".player-workspace.preview-workspace .panel-resizer")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tilbage til designeren", exact: true })).toBeVisible();
  expect(await page.locator(".preview-notice").evaluate(el => getComputedStyle(el).fontSize)).toBe("11px");
  await noPageOverflow(page);
  await page.screenshot({ path: "test-results/preview-mobile.png", fullPage: true });
});
