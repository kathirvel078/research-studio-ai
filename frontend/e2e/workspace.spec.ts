import { expect, test, type Page } from "@playwright/test";

const api = "http://127.0.0.1:8000/api";

async function clearSources(page: Page) {
  const response = await page.request.get(`${api}/sources`);
  for (const source of await response.json())
    await page.request.delete(`${api}/sources/${source.id}`);
}

function observeBrowser(page: Page) {
  const consoleErrors: string[] = [];
  const requestFailures: string[] = [];
  const serverFailures: string[] = [];
  page.on("console", message => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", request => requestFailures.push(`${request.method()} ${request.url()}`));
  page.on("response", response => {
    if (response.url().includes("/api/") && response.status() >= 500)
      serverFailures.push(`${response.status()} ${response.url()}`);
  });
  return { consoleErrors, requestFailures, serverFailures };
}

function textPdf(text: string): Buffer {
  const stream = Buffer.from(`BT /F1 14 Tf 20 100 Td (${text}) Tj ET`);
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>"),
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`), stream, Buffer.from("\nendstream")]),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
  ];
  const parts = [Buffer.from("%PDF-1.4\n")];
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.concat(parts).length);
    parts.push(Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from("\nendobj\n"));
  }
  const xref = Buffer.concat(parts).length;
  parts.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`));
  for (const offset of offsets.slice(1)) parts.push(Buffer.from(`${offset.toString().padStart(10, "0")} 00000 n \n`));
  parts.push(Buffer.from(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`));
  return Buffer.concat(parts);
}

test.beforeEach(async ({ page }) => {
  await clearSources(page);
  await page.goto("/");
});

test.afterEach(async ({ page }) => {
  await clearSources(page);
});

test("shows the empty workspace and remains usable at a narrow viewport", async ({ page }) => {
  const observed = observeBrowser(page);
  await expect(page.getByRole("heading", { name: "Build your source library" })).toBeVisible();
  await expect(page.getByText("Start with evidence, not guesses.")).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "+ New transcript" })).toBeVisible();
  await expect(page.getByLabel("Upload PDF or text source")).toBeAttached();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  expect(observed.consoleErrors).toEqual([]);
  expect(observed.requestFailures).toEqual([]);
  expect(observed.serverFailures).toEqual([]);
});

test("uploads text, adds a multiline transcript, retrieves cited evidence, and deletes it", async ({ page }, testInfo) => {
  const observed = observeBrowser(page);
  await page.getByLabel("Upload PDF or text source").setInputFiles({
    name: "mars-notes.txt", mimeType: "text/plain", buffer: Buffer.from("Mars has two moons, Phobos and Deimos."),
  });
  await expect(page.locator(".source", { hasText: "mars-notes.txt" })).toBeVisible();

  await page.getByRole("button", { name: "+ New transcript" }).click();
  await page.getByLabel("Source name").fill("Triton interview");
  await page.getByRole("textbox", { name: "Text" }).fill("Triton orbits Neptune.\nTriton is an icy moon.");
  const saved = page.waitForResponse(response => response.url().endsWith("/api/sources/manual") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Save source" }).click();
  const transcriptId = (await (await saved).json()).id as string;
  await expect(page.locator(".source", { hasText: "Triton interview" })).toBeVisible();

  await page.locator(".source", { hasText: "mars-notes.txt" }).click();
  await expect(page.getByText("1 source selected")).toBeVisible();
  await page.getByPlaceholder(/Ask a question about the selected sources/).fill("Which moon orbits Neptune?");
  await page.getByRole("button", { name: /Ask/ }).click();
  await expect(page.getByText("Triton orbits Neptune.")).toBeVisible();
  const citation = page.locator(".citations").getByRole("button", { name: /Triton interview/ });
  await expect(citation).toBeVisible();
  const citationDetail = page.waitForResponse(response => response.url().endsWith(`/api/sources/${transcriptId}`));
  await citation.click();
  await citationDetail;
  await expect(page.locator(".passages")).toContainText("Triton is an icy moon.");

  await page.getByPlaceholder(/Ask a question about the selected sources/).fill("What is the capital of Iceland?");
  await page.getByRole("button", { name: /Ask/ }).click();
  await expect(page.getByText("The selected sources do not establish an answer to this question.")).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath("source-workflow.png"), fullPage: true });
  await page.getByRole("button", { name: "Remove source" }).click();
  await expect(page.getByText("Triton interview", { exact: true })).toHaveCount(0);
  expect((await page.request.get(`${api}/sources/${transcriptId}`)).status()).toBe(404);
  expect(observed.consoleErrors).toEqual([]);
  expect(observed.requestFailures).toEqual([]);
  expect(observed.serverFailures).toEqual([]);
});

test("shows server validation errors for unsupported uploads and blank transcript text", async ({ page }) => {
  const observed = observeBrowser(page);
  await page.getByLabel("Upload PDF or text source").setInputFiles({ name: "unsafe.exe", mimeType: "application/octet-stream", buffer: Buffer.from("not executable") });
  await expect(page.getByRole("alert")).toContainText("Use a PDF, TXT, or Markdown text file.");
  await page.getByRole("button", { name: "+ New transcript" }).click();
  await page.getByLabel("Source name").fill("Whitespace only");
  await page.getByRole("textbox", { name: "Text" }).fill("   ");
  await page.getByRole("button", { name: "Save source" }).click();
  await expect(page.getByRole("alert")).toContainText("Transcript text cannot be empty.");
  expect(observed.consoleErrors).toEqual([
    "Failed to load resource: the server responded with a status of 415 (Unsupported Media Type)",
    "Failed to load resource: the server responded with a status of 422 (Unprocessable Content)",
  ]);
  expect(observed.requestFailures).toEqual([]);
  expect(observed.serverFailures).toEqual([]);
});

test("uploads a text-bearing PDF through the file picker and shows page evidence", async ({ page }) => {
  const observed = observeBrowser(page);
  await page.getByLabel("Upload PDF or text source").setInputFiles({ name: "europa.pdf", mimeType: "application/pdf", buffer: textPdf("Europa may contain a subsurface ocean.") });
  await expect(page.locator(".source", { hasText: "europa.pdf" })).toBeVisible();
  await page.getByPlaceholder(/Ask a question about the selected sources/).fill("Which moon may contain an ocean?");
  await page.getByRole("button", { name: /Ask/ }).click();
  await expect(page.locator(".answer pre")).toContainText("Europa may contain a subsurface ocean.");
  await expect(page.getByRole("button", { name: /europa.pdf.*p\. 1/ })).toBeVisible();
  expect(observed.consoleErrors).toEqual([]);
  expect(observed.requestFailures).toEqual([]);
  expect(observed.serverFailures).toEqual([]);
});

test("accepts a text file through drag and drop", async ({ page }) => {
  const observed = observeBrowser(page);
  await page.locator(".empty").evaluate(element => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["Callisto is a moon of Jupiter."], "callisto.txt", { type: "text/plain" }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });
  await expect(page.locator(".source", { hasText: "callisto.txt" })).toBeVisible();
  expect(observed.consoleErrors).toEqual([]);
  expect(observed.requestFailures).toEqual([]);
  expect(observed.serverFailures).toEqual([]);
});

test("complete end-to-end integration workflow with PDF, text, transcript, source restrictions, and persistence", async ({ page }) => {
  const observed = observeBrowser(page);

  // 1. Upload synthetic PDF with unique fact: "The ORION calibration code is 73184."
  await page.getByLabel("Upload PDF or text source").setInputFiles({
    name: "orion.pdf",
    mimeType: "application/pdf",
    buffer: textPdf("The ORION calibration code is 73184."),
  });
  await expect(page.locator(".source", { hasText: "orion.pdf" })).toBeVisible();

  // 2. Upload synthetic text document with different unique fact: "The VELA inspection interval is 43 days."
  await page.getByLabel("Upload PDF or text source").setInputFiles({
    name: "vela.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("The VELA inspection interval is 43 days."),
  });
  await expect(page.locator(".source", { hasText: "vela.txt" })).toBeVisible();

  // 3. Submit a multiline transcript: "Project Lyra was established in 2024.\nIt monitors deep space anomalies."
  await page.getByRole("button", { name: "+ New transcript" }).click();
  await page.getByLabel("Source name").fill("Lyra briefing");
  await page.getByRole("textbox", { name: "Text" }).fill("Project Lyra was established in 2024.\nIt monitors deep space anomalies.");
  await page.getByRole("button", { name: "Save source" }).click();
  await expect(page.locator(".source", { hasText: "Lyra briefing" })).toBeVisible();

  // 4. Verify all successfully ingested sources appear in the UI
  await expect(page.locator(".source")).toHaveCount(3);
  await expect(page.getByText("3 sources selected")).toBeVisible();

  // 5. Ask question about PDF unique fact ("What is the ORION calibration code?")
  await page.getByPlaceholder(/Ask a question about the selected sources/).fill("What is the ORION calibration code?");
  await page.getByRole("button", { name: /Ask/ }).click();
  await expect(page.locator(".answer pre")).toContainText("The ORION calibration code is 73184.");

  // 6. Click the citation and verify it opens the correct passage
  const orionCitation = page.locator(".citations").getByRole("button", { name: /orion\.pdf/ });
  await expect(orionCitation).toBeVisible();
  await orionCitation.click();
  await expect(page.locator(".passages")).toContainText("The ORION calibration code is 73184.");

  // 7. Select ONLY the text source (vela.txt) and ask about the PDF fact
  await page.locator(".source", { hasText: "orion.pdf" }).click();
  await page.locator(".source", { hasText: "Lyra briefing" }).click();
  await expect(page.getByText("1 source selected")).toBeVisible();

  await page.getByPlaceholder(/Ask a question about the selected sources/).fill("What is the ORION calibration code?");
  await page.getByRole("button", { name: /Ask/ }).click();
  await expect(page.getByText("The selected sources do not establish an answer to this question.")).toBeVisible();

  // 8. Refresh the page and verify persistence
  await page.reload();
  await expect(page.locator(".source")).toHaveCount(3);
  await expect(page.locator(".source", { hasText: "orion.pdf" })).toBeVisible();
  await expect(page.locator(".source", { hasText: "vela.txt" })).toBeVisible();
  await expect(page.locator(".source", { hasText: "Lyra briefing" })).toBeVisible();

  // 9. Delete a synthetic source (vela.txt) through the UI
  await page.locator(".source", { hasText: "vela.txt" }).click();
  await page.getByRole("button", { name: "Remove source" }).click();
  await expect(page.locator(".source", { hasText: "vela.txt" })).toHaveCount(0);
  await expect(page.locator(".source")).toHaveCount(2);

  // 10. Check observed errors
  expect(observed.consoleErrors).toEqual([]);
  expect(observed.requestFailures).toEqual([]);
  expect(observed.serverFailures).toEqual([]);
});
