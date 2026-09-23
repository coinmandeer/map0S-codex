import { expect, test } from "./fixtures/offlineTest";

/**
 * §E4: a spreadsheet becomes a choropleth.
 *
 * The claim under test is the whole point of the table import — someone downloads a statistical
 * export, and without writing anything it colours the map by territory. So this drives the real
 * path: a Windows-1250 CSV with semicolons and decimal commas goes in, the server's own column
 * detection decides which column is the code and which the value, and the layer that comes out
 * asks the API for vector tiles.
 *
 * The file is built here as bytes rather than read from disk, because the encoding is half of
 * what is being tested and a repository would normalise it.
 */

const CSV_ROWS = [
  "kod;nazev;hodnota",
  "CZ031;Jihočeský kraj;640,1",
  "CZ032;Plzeňský kraj;811,4",
  "CZ041;Karlovarský kraj;1 002",
  "CZ010;Praha;1 240,7"
];

/** The same characters a Czech statistical office export carries, in the codepage it uses. */
function windows1250(text: string): Buffer {
  const map: Record<string, number> = {
    á: 0xe1,
    č: 0xe8,
    é: 0xe9,
    ě: 0xec,
    í: 0xed,
    ř: 0xf8,
    š: 0xb9,
    ý: 0xfd,
    ž: 0xbe,
    ů: 0xf9,
    ó: 0xf3,
    J: 0x4a
  };
  return Buffer.from(
    [...text].map((character) => map[character] ?? character.charCodeAt(0) & 0xff)
  );
}

async function openLayersSection(page: import("@playwright/test").Page) {
  await page.goto("/?mode=personal&lng=14.42&lat=50.08&z=7");
  const panel = page.getByTestId("personal-panel");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await panel.getByTestId("personal-accordion-layers").click();
  return panel;
}

test.describe("import tabulky", () => {
  test("a semicolon CSV in Windows-1250 is detected, joined and drawn", async ({ page }) => {
    const tileRequests: string[] = [];
    page.on("request", (request) => {
      if (/\/api\/v2\/tables\/.+\/tiles\//.test(request.url())) tileRequests.push(request.url());
    });

    const panel = await openLayersSection(page);
    await panel.getByTestId("add-table-open").click();

    const dialog = page.getByTestId("add-table-dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByTestId("add-table-file").setInputFiles({
      name: "kriminalita.csv",
      mimeType: "text/csv",
      buffer: windows1250(CSV_ROWS.join("\n"))
    });

    // The confirmation step exists because detection is a guess; what it guessed has to be
    // visible, and the accented name proves the codepage survived.
    const preview = dialog.getByTestId("add-table-preview");
    await expect(preview).toBeVisible({ timeout: 15_000 });
    await expect(preview).toContainText("Jihočeský kraj");
    // The trigger shows the column it picked, which is the header of the first and third column
    // of this file — detection reads the values, not the names.
    await expect(dialog.getByTestId("add-table-code-column")).toContainText("kod");
    await expect(dialog.getByTestId("add-table-value-column")).toContainText("hodnota");

    await dialog.getByTestId("add-table-name").fill("Vlastní kriminalita");
    await dialog.getByTestId("add-table-save").click();
    await expect(dialog).toBeHidden({ timeout: 15_000 });

    // Four rows, four fixture territories: a table that joined on nothing is the failure this
    // guards, and it is invisible on the finished map.
    await expect(page.locator(".kit-toast-title")).toContainText("4 území", { timeout: 15_000 });

    const layer = await page.evaluate(async () => {
      const response = await fetch("/api/v2/tables", { credentials: "include" });
      const body = (await response.json()) as { tables: Array<{ id: string; name: string }> };
      return body.tables.at(-1) ?? null;
    });
    expect(layer?.name).toBe("Vlastní kriminalita");

    await page.getByTestId("layers-btn").click();
    const drawer = page.getByTestId("overflow-menu");
    await expect(drawer).toBeVisible();
    await drawer.getByTestId("layers-search").fill("Vlastní kriminalita");
    const id = `table-${layer!.id.toLowerCase().replace(/[^a-z0-9._-]/g, "-")}`;
    const row = drawer.getByTestId(`catalog-mine-${id}`);
    await expect(row).toContainText("Vlastní kriminalita", { timeout: 15_000 });
    await row.getByRole("switch").check();

    await expect.poll(() => tileRequests.length, { timeout: 20_000 }).toBeGreaterThan(0);
  });
});
