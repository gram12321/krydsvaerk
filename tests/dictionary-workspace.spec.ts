import { expect, test, type Page } from "@playwright/test";

// Exercise the real browser UI with isolated persistence; never change live dictionaries.
async function openDictionaries(page: Page, empty = false) {
  // Layout generation is unrelated to dictionary controls and has variable search time.
  await page.route("**/src/crossword/designerGeneration.worker.ts*", route => route.fulfill({
    contentType: "application/javascript",
    body: "self.onmessage = () => self.postMessage({ type: 'failed', attempts: 1, limited: 0 });",
  }));
  const entries = [{ word: "CYKEL", clue: "Køretøj", length: 5, source: "custom" }];
  const dictionaries = empty ? [] : [
    { id: "places", name: "Steder", entries, enabled: true },
    { id: "animals", name: "Dyr", entries: [], enabled: false },
    { id: "shared", name: "Fælles ord", entries, shared: true, sharedId: "public", enabled: false },
  ];
  await page.route("**/src/lib/persistence.ts*", route => route.fulfill({
    contentType: "application/javascript",
    body: `
      export const STORAGE_KEYS = { library: 'krydsvaerk-library-v1', drafts: 'krydsvaerk-drafts-v1', dictionaries: 'krydsvaerk-ordboger-v1', builtinDictionarySettings: 'krydsvaerk-indbyggede-ordboger-v1', legacyDictionary: 'krydsvaerk-ordbog', play: 'krydsvaerk-play-v1' };
      export async function loadPersistedData() { return { [STORAGE_KEYS.dictionaries]: ${JSON.stringify(dictionaries)}, __user_id: 'test', __public_crosswords: [], __shared_dictionaries: [] }; }
      export async function savePersistedValue() {}
      export async function setSharedDictionary() {}
      export async function publishPublicCrossword() { throw new Error('Outside this test'); }
    `,
  }));
  await page.goto("/");
  await page.getByRole("button", { name: "Designerværksted", exact: true }).click();
  await page.getByRole("button", { name: /^Ordbøger/ }).click();
  await expect(page.getByRole("heading", { name: "Dine ordbøger", exact: true })).toBeVisible();
}

test("wide dictionary panels resize by pointer and keyboard independently of the crossword", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openDictionaries(page);
  const separator = page.getByRole("separator", { name: "Juster bredden på ordbogspanelerne" });
  const archive = page.getByRole("region", { name: "Dine ordbøger", exact: true });
  const editor = page.locator("#custom-dictionary-editor");
  const left = (await archive.boundingBox())!;
  const right = (await editor.boundingBox())!;
  expect(Math.abs(left.y - right.y)).toBeLessThan(1);
  expect(left.x + left.width).toBeLessThan(right.x);
  await separator.focus();
  await page.keyboard.press("ArrowRight");
  await expect(separator).toHaveAttribute("aria-valuenow", "40");
  await page.keyboard.press("Home");
  await expect(separator).toHaveAttribute("aria-valuenow", "28");
  await page.keyboard.press("End");
  await expect(separator).toHaveAttribute("aria-valuenow", "52");
  const bounds = (await page.locator(".dictionary-layout").boundingBox())!;
  const grip = (await separator.boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 45);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .35, grip.y + 45, { steps: 5 });
  await page.mouse.up();
  await expect(separator).toHaveAttribute("aria-valuenow", "35");
  await page.getByRole("button", { name: "Krydsord", exact: true }).click();
  const boardSeparator = page.getByRole("separator", { name: "Juster bredden på panelerne", exact: true });
  await expect(boardSeparator).toHaveAttribute("aria-valuenow", "70");
  await boardSeparator.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(boardSeparator).toHaveAttribute("aria-valuenow", "68");
  await page.getByRole("button", { name: /^Ordbøger/ }).click();
  await expect(separator).toHaveAttribute("aria-valuenow", "35");
  await page.getByRole("button", { name: "Se ord i Håndskrevne grundord", exact: true }).click();
  await expect(editor.getByRole("heading", { name: "Håndskrevne grundord", exact: true })).toBeVisible();
  await expect(editor.getByRole("textbox", { name: "Ordbogens navn" })).toHaveCount(0);
  await editor.getByRole("searchbox").fill("Danmark");
  await expect(editor.getByRole("status")).toContainText("fundet");
  await editor.getByRole("button", { name: "Luk", exact: true }).click();
  await expect(editor.getByRole("heading", { name: "Steder", exact: true })).toBeVisible();
  await page.screenshot({ path: "test-results/dictionaries-desktop.png", fullPage: true });
});

test("stacked tools support adding, editing, searching, copying and moving entries", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDictionaries(page);
  await expect(page.getByRole("separator")).toBeHidden();
  const editor = page.locator("#custom-dictionary-editor");
  const archive = (await page.locator(".dictionary-archive").boundingBox())!;
  expect((await editor.boundingBox())!.y).toBeGreaterThan(archive.y + archive.height);
  await expect(page.getByRole("textbox", { name: "Ord og ledetråde", exact: true })).toBeHidden();
  await page.locator(".dictionary-entry-add summary").click();
  await page.getByRole("textbox", { name: "Ord og ledetråde", exact: true }).fill("ABE;Dyr");
  await page.getByRole("button", { name: "Tilføj ord", exact: true }).click();
  await expect(page.getByRole("table", { name: "Ord i Steder" }).getByText("ABE", { exact: true })).toBeVisible();
  await editor.getByRole("searchbox").fill("ABE");
  await expect(editor.getByText("CYKEL", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Rediger ABE: Dyr", exact: true }).click();
  await page.getByRole("textbox", { name: "Rediger ord og ledetråd", exact: true }).fill("ABE;Primat");
  await page.getByRole("button", { name: "Gem", exact: true }).click();
  await page.getByRole("combobox", { name: "Målordbog for ABE: Primat" }).selectOption("animals");
  await page.getByRole("button", { name: "Kopiér", exact: true }).click();
  await expect(editor.getByText("ABE", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Flyt", exact: true }).click();
  await expect(editor.getByText("ABE", { exact: true })).toHaveCount(0);
  await page.locator(".personal-dictionary-card").filter({ has: page.getByText("Dyr", { exact: true }) }).getByRole("link", { name: "Rediger" }).click();
  await expect(editor.getByRole("heading", { name: "Dyr", exact: true })).toBeVisible();
  await expect(editor.getByText("ABE", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/dictionaries-mobile.png", fullPage: true });
  for (const width of [320, 768, 1100, 1101]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (width <= 1100) await expect(page.getByRole("separator")).toBeHidden();
    else await expect(page.getByRole("separator")).toBeVisible();
  }
});

test("empty archives can create a dictionary and shared dictionaries stay read-only", async ({ page }) => {
  await openDictionaries(page, true);
  await expect(page.getByRole("heading", { name: "Ingen ordbøger endnu" })).toBeVisible();
  await page.getByRole("textbox", { name: "Ny ordbog", exact: true }).fill("Nye ord");
  await page.getByRole("button", { name: "Opret ordbog", exact: true }).click();
  await expect(page.locator("#custom-dictionary-editor").getByRole("heading", { name: "Nye ord", exact: true })).toBeVisible();
  await openDictionaries(page);
  await page.locator(".personal-dictionary-card").filter({ has: page.getByText("Fælles ord", { exact: true }) }).getByRole("link", { name: "Åbn" }).click();
  const editor = page.locator("#custom-dictionary-editor");
  await expect(editor.getByText(/Kun læsning/)).toBeVisible();
  await expect(editor.getByRole("textbox", { name: "Ordbogens navn" })).toBeHidden();
  await expect(editor.locator(".dictionary-entry-add")).toBeHidden();
  await expect(editor.getByRole("button", { name: "Slet ordbog" })).toBeHidden();
  await expect(editor.getByRole("table").getByText("CYKEL", { exact: true })).toBeVisible();
});


test("dictionary files export and import without replacing existing dictionaries", async ({ page }) => {
  await openDictionaries(page);
  const editor = page.locator("#custom-dictionary-editor");
  const downloadPromise = page.waitForEvent("download");
  await editor.getByRole("button", { name: "Eksportér JSON" }).click();
  const download = await downloadPromise;
  const content = await (await import("node:fs/promises")).readFile((await download.path())!);
  expect(JSON.parse(content.toString()).entries[0]).toMatchObject({ word: "CYKEL", clue: "Køretøj" });
  await page.getByLabel("Importér ordbog (JSON)").setInputFiles({ name: "ordbog.json", mimeType: "application/json", buffer: content });
  await expect(editor.getByRole("heading", { name: "Steder", exact: true })).toBeVisible();
  await expect(page.locator(".personal-dictionary-card").filter({ hasText: "Steder" })).toHaveCount(2);
  await expect(page.getByRole("status").filter({ hasText: "importeret og slået fra" }).first()).toBeVisible();
  await page.getByLabel("Importér ordbog (JSON)").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"format":"bad"}') });
  await expect(page.getByRole("status").filter({ hasText: "Filen kunne ikke importeres" }).first()).toBeVisible();
  await expect(page.locator(".personal-dictionary-card").filter({ hasText: "Steder" })).toHaveCount(2);
  await page.getByRole("button", { name: "Se ord i DanNet" }).click();
  const builtinDownload = page.waitForEvent("download");
  await editor.getByRole("button", { name: "Eksportér JSON" }).click();
  const builtinFile = await builtinDownload;
  const builtinData = JSON.parse(await (await import("node:fs/promises")).readFile((await builtinFile.path())!, "utf8"));
  expect(builtinData.attribution).toContain("CC BY-SA 4.0");
  expect(builtinData.entries.length).toBeGreaterThan(100);
});
