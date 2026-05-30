const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const baseURL = process.env.LENSWALK_PROJECT_PAGE_URL || "http://127.0.0.1:8097/";

async function expectText(locator, text) {
  const content = await locator.textContent();
  assert.match(content || "", text);
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

  await page.goto(baseURL);
  await assertVisible(page.getByRole("heading", { name: /LensWalk:/ }));
  await assertVisible(page.getByAltText(/static video understanding/));

  await page.getByRole("tab", { name: "Segment Focus" }).click();
  await page.locator("#segment-start").fill("20");
  await page.locator("#segment-end").fill("42");
  await page.locator("#segment-frames").fill("6");
  await expectText(page.locator("#payload-fields"), /segment_observer/);
  await expectText(page.locator("#payload-fields"), /00:20/);
  await page.getByRole("button", { name: "Run Tool" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".sample-frame img").length >= 1, null, { timeout: 15000 });
  await expectText(page.locator("#run-status"), /Rendered/);

  const box = await page.locator("#handle-end").boundingBox();
  assert.ok(box, "Timeline handle is visible");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await expectText(page.locator("#run-status"), /Arguments changed/);

  await page.getByRole("tab", { name: "Stitched Verify" }).click();
  await page.getByRole("button", { name: "Select stitched segment S2" }).click();
  await page.locator("#stitch-fps").fill("3");
  await expectText(page.locator("#payload-fields"), /stitched_observer/);
  await expectText(page.locator("#payload-fields"), /S2/);
  await expectText(page.locator("#payload-fields"), /3 fps/);

  await page.getByRole("tab", { name: "Registry Update" }).click();
  await page.locator("#memory-id").fill("S9");
  await page.locator("#memory-subject").fill("person in red jacket");
  await expectText(page.locator("#payload-fields"), /S9/);
  await expectText(page.locator("#payload-fields"), /person in red jacket/);

  await page.getByRole("button", { name: "Reasoning" }).click();
  await page.locator("#result-filter").fill("LensWalk");
  await expectText(page.locator("#results-table"), /LensWalk \(o3\)/);
  await expectText(page.locator("#bar-chart"), /78\.33/);

  await page.getByRole("button", { name: "Accuracy and cost" }).click();
  const gallerySrc = await page.locator("#gallery-image").getAttribute("src");
  assert.match(gallerySrc || "", /acc_cost_comparison\.png/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseURL);
  await assertVisible(page.getByRole("heading", { name: /LensWalk:/ }));
  await page.getByRole("link", { name: "Try Observer Demo" }).click();
  await assertVisible(page.getByRole("heading", { name: "See what each tool sends to the observer" }));
  await assertVisible(page.locator("#payload-fields"));

  await browser.close();
}

async function assertVisible(locator) {
  const visible = await locator.isVisible();
  assert.equal(visible, true);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
