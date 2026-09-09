import { test, expect, type Page } from "@playwright/test";

async function report(page:Page) {
  await page.goto("/reports");
  const pending=page.waitForEvent("download");
  await page.getByRole("button",{name:"Export JSON",exact:true}).click();
  const stream=await(await pending).createReadStream(), chunks=[];
  for await(const chunk of stream!)chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

test("on-device and backend reports and documents match, including reanalysis",async({page})=>{
  await page.goto("/upload");
  await page.getByLabel("Analyze using").selectOption("local");
  await page.getByLabel("Choose evidence file").setInputFiles({name:"parity.csv",mimeType:"text/csv",buffer:Buffer.from(
    "src,dst,rel,frequency,date,amount\nAsha Rao,Kabir Shah,FINANCIAL_TRANSFER,2,2026-09-01,100\nKabir Shah,Meera Sen,FINANCIAL_TRANSFER,3,2026-09-02,90\nMeera Sen,Asha Rao,FINANCIAL_TRANSFER,1,2026-09-03,80\nAsha Rao,Car,OWNS_VEHICLE,1,,\nKabir Shah,Place,REGISTERED_AT,1,,\nMeera Sen,Place,REGISTERED_AT,1,,\nDev Shah,Other Person,CALLED,9,,")});
  await page.getByLabel("I’ve reviewed the mapping and cleaned records.").check();
  await page.getByRole("button",{name:"Build network",exact:true}).click();
  await expect(page).toHaveURL(/overview/);
  await page.goto("/entities");
  await page.getByRole("button",{name:"Save Asha Rao to watchlist"}).click();
  const local=await report(page);
  await page.getByLabel("Analyst notes").fill("Preserve my reasoning.");
  await page.getByRole("button",{name:"Save notes",exact:true}).click();
  await page.goto("/upload");
  await page.getByLabel("Analyze using").selectOption("backend");
  await page.getByRole("button",{name:"Reanalyze saved evidence",exact:true}).click();
  await expect(page).toHaveURL(/overview/);
  const backend=await report(page);
  for(const key of ["analysis_version","analysis_methods","entities","relationships","rankings","communities","alerts","watchlist"])
    expect(backend[key],key).toEqual(local[key]);
  expect(backend.analyst_notes).toBe("Preserve my reasoning.");
  expect(backend.analysis_version).toBe("3.0.0");
  await page.goto("/documents");
  const text="Asha Rao called Kabir Shah. Vehicle MH12AB1234 was mentioned. INR 500 was recorded on 2026-09-01. Contact asha@example.com.";
  await page.locator("textarea").fill(text);
  const document=page.waitForResponse(r=>r.url().endsWith("/api/workspace/documents"));
  await page.getByRole("button",{name:"Analyze document",exact:true}).click();
  const serverDoc=await(await document).json();
  await page.getByLabel("Analyze using").selectOption("local");
  await page.getByRole("button",{name:"Analyze document",exact:true}).click();
  await expect(page.getByText(serverDoc.summary,{exact:true})).toBeVisible();
  await page.getByRole("button",{name:"entities",exact:true}).click();
  for(const entity of serverDoc.entities)await expect(page.locator(".extracted-entities").getByText(entity.text,{exact:true})).toBeVisible();
});

test("entity filters compose with sorting and pagination",async({page})=>{
  await page.goto("/upload");
  await page.getByLabel("Analyze using").selectOption("local");
  const rows=Array.from({length:24},(_,i)=>`P${String(i).padStart(2,"0")},P${String(i+1).padStart(2,"0")},CALLED,${i+1}`);
  await page.getByLabel("Choose evidence file").setInputFiles({name:"order.csv",mimeType:"text/csv",buffer:Buffer.from("src,dst,rel,frequency\n"+rows.join("\n"))});
  await page.getByLabel("I’ve reviewed the mapping and cleaned records.").check();
  await page.getByRole("button",{name:"Build network",exact:true}).click();
  await expect(page).toHaveURL(/overview/);
  await page.goto("/entities");
  await page.getByLabel("Sort direction").selectOption("asc");
  const values=await page.locator("tbody tr td:nth-child(5)").allTextContents();
  expect(values.map(Number)).toEqual(values.map(Number).sort((a,b)=>a-b));
  await page.getByRole("button",{name:"Next",exact:true}).click();
  await page.getByLabel("Filter by role").selectOption("leader");
  await expect(page.locator("tbody tr").first()).toBeVisible();
  for(const role of await page.locator("tbody tr td:nth-child(3)").allTextContents())expect(role).toBe("leader");
  await expect(page.getByRole("button",{name:"Previous",exact:true})).toBeDisabled();
  await page.getByLabel("Filter by community").selectOption("0");
  await expect(page.locator("tbody tr td:nth-child(4)").first()).toHaveText("Group 1");
  await page.getByRole("button",{name:"Reset filters",exact:true}).click();
  await expect(page.locator(".table-footer")).toContainText("25 matching entities");
});
