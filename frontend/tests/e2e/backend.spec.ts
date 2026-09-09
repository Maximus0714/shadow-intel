import { test, expect } from "@playwright/test";

test("real backend upload, saved results, documents and reports through same-origin proxy", async ({
  page,
}) => {
  await page.goto("/upload");
  await expect(page.getByLabel("Analyze using")).toHaveValue("backend");
  await page
    .getByLabel("Choose evidence file")
    .setInputFiles({
      name: "server-case.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "src,dst,rel,amount\nAsha Rao,Kabir Shah,FINANCIAL_TRANSFER,100\nKabir Shah,Meera Sen,FINANCIAL_TRANSFER,90\nMeera Sen,Asha Rao,FINANCIAL_TRANSFER,80",
      ),
    });
  await page
    .getByLabel("I’ve reviewed the mapping and cleaned records.")
    .check();
  const response = page.waitForResponse((r) =>
    r.url().endsWith("/api/workspace/analyze"),
  );
  await page
    .getByRole("button", { name: "Build network", exact: true })
    .click();
  const result = await response;
  expect(result.status()).toBe(200);
  expect((await result.json()).engine).toBe("backend");
  await expect(page).toHaveURL(/overview/);
  await expect(page.locator(".mode-strip")).toContainText("Backend analysis");
  await page.reload();
  await expect(page.locator(".mode-strip")).toContainText("Backend analysis");
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
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const stream = await (await download).createReadStream();
  const chunks = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const report = JSON.parse(Buffer.concat(chunks).toString());
  expect(report.rankings).toHaveLength(3);
  expect(report.watchlist[0].id).toBe("Asha Rao");
  await page.goto("/documents");
  await page.locator("textarea").fill("Asha Rao called Kabir Shah.");
  const document = page.waitForResponse((r) =>
    r.url().endsWith("/api/workspace/documents"),
  );
  await page
    .getByRole("button", { name: "Analyze document", exact: true })
    .click();
  expect((await document).status()).toBe(200);
  await page.getByRole("button", { name: "entities", exact: true }).click();
  await expect(
    page.locator(".extracted-entities").getByText("Asha Rao", { exact: true }),
  ).toBeVisible();
});

test("backend outage reports an error and never silently substitutes demo", async ({
  page,
}) => {
  await page.route("**/api/workspace/analyze", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"detail":"Analysis is busy. Please retry shortly."}',
    }),
  );
  await page.goto("/upload");
  await page
    .getByLabel("Choose evidence file")
    .setInputFiles({
      name: "test.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("src,dst\nA,B"),
    });
  await page
    .getByLabel("I’ve reviewed the mapping and cleaned records.")
    .check();
  await page
    .getByRole("button", { name: "Build network", exact: true })
    .click();
  await expect(
    page.getByText("Analysis is busy. Please retry shortly."),
  ).toBeVisible();
  await expect(page).toHaveURL(/upload/);
});
