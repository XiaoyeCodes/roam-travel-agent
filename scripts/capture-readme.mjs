import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { browserExecutable } from "../server/src/pdf.ts";

// Capture the real local UI with its built-in demo. No mocked API responses,
// DOM replacements, credentials, or live model calls are used for these images.
const destination = "docs/screenshots";
fs.mkdirSync(destination, { recursive: true });
fs.mkdirSync("output/html", { recursive: true });
const browser = await chromium.launch({
  executablePath: browserExecutable(),
  headless: true,
});
const errors = [];
const files = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1300 },
    deviceScaleFactor: 1,
  });
  page.on("pageerror", (error) => errors.push(error.message));
  async function top(target = page) {
    await target.evaluate(() =>
      window.scrollTo({ top: 0, behavior: "instant" }),
    );
  }
  async function capture(name, target = page, locator) {
    await target.evaluate(() => document.fonts.ready);
    const filename = `${destination}/${name}.png`;
    await (locator || target).screenshot({
      path: filename,
      animations: "disabled",
    });
    files.push({
      name: path.basename(filename),
      bytes: fs.statSync(filename).size,
    });
  }
  await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: "体验南京示例", exact: true })
    .waitFor();
  await page.locator(".hero").evaluate(async (element) => {
    const url = getComputedStyle(element).backgroundImage.match(
      /url\(["']?(.*?)["']?\)/,
    )?.[1];
    if (url) {
      const img = new Image();
      img.src = url;
      await img.decode();
    }
  });
  await capture("01-planner");
  await page.setViewportSize({ width: 1440, height: 1120 });

  await page.getByRole("button", { name: "体验南京示例", exact: true }).click();
  await page
    .getByRole("heading", { name: "在金陵，拾一段慢时光", exact: true })
    .waitFor({ timeout: 30000 });
  // Retry a fresh page load if an external photo temporarily fails to load.
  for (let attempt = 0; ; attempt++) {
    try {
      await page.locator(".stop-photo img").first().waitFor({ timeout: 15000 });
      await page
        .locator(".stop-photo img")
        .first()
        .evaluate((img) => img.decode());
      break;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.reload({ waitUntil: "networkidle" });
    }
  }
  for (const img of await page.locator(".stop-photo img").all()) {
    await img.scrollIntoViewIfNeeded();
    await img.evaluate((el) => el.decode());
  }
  await page
    .locator(".map-image img")
    .first()
    .evaluate((img) => img.decode());
  await page.locator(".plan-toolbar").evaluate((element) => {
    window.scrollTo({
      top: element.getBoundingClientRect().top + scrollY - 24,
      behavior: "instant",
    });
  });
  await capture("02-itinerary");

  await page.getByRole("button", { name: "路线地图", exact: true }).click();
  await page.getByRole("button", { name: "全部路线", exact: true }).click();
  await page.locator(".map-image img").waitFor();
  await page.locator(".map-image img").evaluate((img) => img.decode());
  await top();
  await capture("03-route-map");

  await page.getByRole("button", { name: "预算与住宿", exact: true }).click();
  await page.getByRole("heading", { name: "把花费，安排得刚刚好。" }).waitFor();
  await top();
  await capture("04-budget");

  await page.getByRole("button", { name: "协作过程", exact: true }).click();
  await page.getByRole("heading", { name: "从讨论，到出发" }).waitFor();
  await page.locator(".reports summary").last().click();
  await page
    .locator(".event-feed")
    .evaluate((element) =>
      element.scrollTo({ top: element.scrollHeight, behavior: "instant" }),
    );
  await top();
  await capture("05-collaboration");

  const downloadPromise = page.waitForEvent("download", { timeout: 60000 });
  await page.getByRole("button", { name: "导出 HTML", exact: true }).click();
  const download = await downloadPromise;
  assert.ok(download.suggestedFilename().endsWith(".html"));
  const exportPath = path.resolve("output/html/readme-demo.html");
  await download.saveAs(exportPath);
  const guide = await browser.newPage({
    viewport: { width: 1440, height: 1120 },
  });
  guide.on("pageerror", (error) => errors.push(error.message));
  await guide.goto(pathToFileURL(exportPath).href, {
    waitUntil: "networkidle",
  });
  await guide.locator(".cover-photo img").evaluate((img) => img.decode());
  await guide
    .locator(".stop .photo img")
    .first()
    .evaluate((img) => img.decode());
  await top(guide);
  await capture("06-html-guide", guide);

  await page.locator(".toast").waitFor({ state: "hidden", timeout: 10000 });

  await page.getByRole("button", { name: "模型与工具", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "申请入口", exact: true })
    .click();
  await capture("07-settings", page, page.getByRole("dialog"));
  await page.getByRole("button", { name: "关闭设置", exact: true }).click();

  await page.getByRole("button", { name: "每日行程", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .locator(".day-detail")
    .evaluate((element) =>
      element.scrollIntoView({ block: "start", behavior: "instant" }),
    );
  await page
    .locator(".stop-photo img")
    .first()
    .evaluate((img) => img.decode());
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await capture("08-mobile");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        captured: files,
        source: "Local UI / built-in Nanjing demo",
        runtimeErrors: errors.length,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
