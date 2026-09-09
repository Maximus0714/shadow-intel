import { test, expect } from "@playwright/test";
test("own data runs locally, persists, exports and stays separate from demo", async ({
  page,
}) => {
  const network: string[] = [];
  page.on("request", (r) => {
    if (["fetch", "xhr"].includes(r.resourceType())) network.push(r.url());
  });
  await page.goto("/");
  await page
    .getByRole("link", { name: "Add your own data", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/upload/);
  await page.getByLabel("Analyze using").selectOption("local");
  await expect(
    page.getByRole("heading", { name: "What can X-Tracer process?" }),
  ).toBeVisible();
  await page
    .getByLabel("Choose evidence file")
    .setInputFiles({
      name: "my-case.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "src,dst,rel,frequency,date,amount\nAsha Rao,Kabir Shah,FINANCIAL_TRANSFER,1,2026-09-01,100\nKabir Shah,Meera Sen,FINANCIAL_TRANSFER,1,2026-09-02,90\nMeera Sen,Asha Rao,FINANCIAL_TRANSFER,1,2026-09-03,80\nMeera Sen,Dev Shah,CALLED,4,,",
      ),
    });
  await page
    .getByLabel("I’ve reviewed the mapping and cleaned records.")
    .check();
  await page
    .getByRole("button", { name: "Build network", exact: true })
    .click();
  await expect(page).toHaveURL(/overview/);
  await expect(
    page.locator(".mode-strip").filter({ hasText: "Local workspace" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.locator(".mode-strip").filter({ hasText: "Local workspace" }),
  ).toBeVisible();
  await page.goto("/entities");
  await page
    .getByRole("button", { name: "Save Asha Rao to watchlist" })
    .click();
  await page.goto("/network");
  await page.getByLabel("Find an entity in the graph").selectOption("Asha Rao");
  await expect(page.locator(".entity-dossier h2")).toHaveText("Asha Rao");
  await page.goto("/alerts");
  await expect(
    page.getByText(/circular transfer links/i).first(),
  ).toBeVisible();
  await page.goto("/reports");
  await expect(page.locator(".entity-row").getByText("Asha Rao", {exact:true})).toBeVisible();
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download report", exact: true })
    .click();
  expect((await download).suggestedFilename()).toBe("x-tracer-report.md");
  await page.getByRole("button", { name: "Explore demo", exact: true }).click();
  await expect(page.locator(".entity-row").getByText("Asha Rao", {exact:true})).toHaveCount(
    0,
  );
  await page.goto("/upload");
  await page.getByRole("button", { name: "Resume investigation" }).click();
  await expect(
    page.locator(".mode-strip").filter({ hasText: "Local workspace" }),
  ).toBeVisible();
  await page.goto("/settings");
  await expect(page).toHaveURL(/upload/);
  await expect(page.getByLabel("API key", { exact: true })).toHaveCount(0);
  expect(network).toEqual([]);
});
test("custom document text is analyzed without credentials", async ({
  page,
}) => {
  await page.goto("/documents");
  await page.getByLabel("Analyze using").selectOption("local");
  await page
    .locator("textarea")
    .fill("Asha Rao called Kabir Shah. Vehicle MH12AB1234 was mentioned.");
  await page
    .getByRole("button", { name: "Analyze document", exact: true })
    .click();
  await page.getByRole("button", { name: "entities", exact: true }).click();
  await expect(
    page.locator(".extracted-entities").getByText("Asha Rao", {exact:true}),
  ).toBeVisible();
  await expect(page.getByText("API key")).toHaveCount(0);
});
