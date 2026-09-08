import { test, expect } from "@playwright/test";
const routes = [
  "/",
  "/overview",
  "/network",
  "/entities",
  "/communities",
  "/alerts",
  "/documents",
  "/reports",
  "/upload",
  "/settings",
];
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("si-mode", '"demo"');
    localStorage.setItem("shadowintel-theme", "dark");
  });
});
test("landing opens a functional workspace and saved entities export with notes", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("link", { name: "Explore demo", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/overview/);
  await page.goto("/entities");
  await page
    .getByRole("button", { name: "Save Mohan Yadav to watchlist" })
    .click();
  await page.goto("/reports");
  await expect(
    page.locator(".entity-row").getByText("Mohan Yadav"),
  ).toBeVisible();
  await page.getByLabel("Analyst notes").fill("Verify the source evidence.");
  await page.getByRole("button", { name: "Save notes", exact: true }).click();
  await page.reload();
  await expect(page.getByLabel("Analyst notes")).toHaveValue(
    "Verify the source evidence.",
  );
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download report", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("shadow-intel-report.md");
});
test("graph supports dossiers, neighbourhoods and connected paths", async ({
  page,
}) => {
  await page.goto("/network");
  await page.getByLabel("Find an entity in the graph").selectOption("P01");
  await expect(
    page
      .locator(".entity-dossier")
      .getByRole("heading", { name: "Mohan Yadav" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Focus neighbourhood", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Show full graph", exact: true })
    .click();
  await page.getByRole("button", { name: "Find a path", exact: true }).click();
  await page
    .getByLabel("Path start entity", { exact: true })
    .selectOption("P01");
  await page.getByLabel("Path end entity", { exact: true }).selectOption("P07");
  await page.getByRole("button", { name: "Trace path", exact: true }).click();
  await expect(page.getByText(/connecting paths found/)).toBeVisible();
});
test("documents lead to entity search and upload resets malformed files", async ({
  page,
}) => {
  await page.goto("/documents");
  await page.getByRole("button", { name: "Load example", exact: true }).click();
  await page
    .getByRole("button", { name: "Analyze document", exact: true })
    .click();
  await page.getByRole("button", { name: "entities", exact: true }).click();
  await page
    .locator(".extracted-entities")
    .getByRole("link", { name: "Mohan Yadav Person" })
    .click();
  await expect(page.getByLabel("Search entities", { exact: true })).toHaveValue(
    "Mohan Yadav",
  );
  await page.goto("/upload");
  await page
    .getByLabel("Choose evidence file")
    .setInputFiles({
      name: "valid.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("src,dst\na,b\n"),
    });
  await expect(page.getByText("1 usable relationships")).toBeVisible();
  await page
    .getByLabel("Choose evidence file")
    .setInputFiles({
      name: "invalid.json",
      mimeType: "application/json",
      buffer: Buffer.from("null"),
    });
  await expect(page.getByRole("alert")).toContainText("JSON must be an object");
  await expect(page.locator(".mapping-panel")).toHaveCount(0);
});
for (const theme of ["dark", "light"])
  test(`${theme} mobile routes fit and navigation works`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(
      (t) => localStorage.setItem("shadowintel-theme", t),
      theme,
    );
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const route of routes) {
      await page.goto(route);
      await expect(page.locator("h1")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        route,
      ).toBe(true);
    }
    await page
      .getByRole("button", { name: "Open navigation", exact: true })
      .click();
    await page
      .locator(".app-sidebar.open")
      .getByRole("link", { name: "Entities & Search", exact: true })
      .click();
    await expect(page.locator(".app-sidebar.open")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
