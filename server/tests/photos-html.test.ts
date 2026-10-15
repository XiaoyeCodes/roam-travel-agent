import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { demoPlan } from "../src/demo.js";
import { enrichPhotos, searchPhotos, trackPhotoExport } from "../src/photos.js";
import { buildTravelHtml, renderHtml } from "../src/html.js";
import type { Config } from "../src/config.js";
const config: Config = {
  baseUrl: "",
  model: "",
  apiKey: "",
  amapKey: "",
  unsplashKey: "",
  searchKey: "",
  mcpServers: [],
};

test("no-key enrichment fills Nanjing stops with credited real photos and does not assign them to unrelated cities", async () => {
  const plan = demoPlan("photos");
  await enrichPhotos(plan, config);
  assert.equal(plan.photoMode, "curated");
  assert.equal(
    plan.days.flatMap((d) => d.stops).filter((s) => s.photo).length,
    10,
  );
  assert.ok(plan.days[0].stops[2].photo?.caption?.includes("非推荐餐馆实拍"));
  assert.ok(plan.days[0].stops[1].photo?.caption?.includes("未核实为老门东"));
  assert.ok(
    plan.images.every(
      (p) =>
        p.photographer &&
        p.profileUrl.includes("utm_source=") &&
        p.photoUrl.startsWith("https://unsplash.com/photos/"),
    ),
  );
  plan.destination = "别的城市";
  await enrichPhotos(plan, config, { force: true });
  assert.equal(plan.images.length, 0);
});

test("per-stop search deduplicates queries, handles empty/error results and validates image and download hosts", async (t) => {
  const calls: { url: URL; init?: RequestInit }[] = [];
  t.mock.method(globalThis, "fetch", async (input: any, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.pathname.endsWith("/download"))
      return Response.json({ url: "unused" });
    const query = url.searchParams.get("query")!;
    if (query === "empty") return Response.json({ results: [] });
    if (query === "failure")
      return new Response("rate limited", { status: 429 });
    return Response.json({
      results: [
        {
          id: "unsafe",
          urls: { regular: "https://evil.example/image" },
          user: { name: "Bad", links: { html: "https://unsplash.com/@bad" } },
          links: { html: "https://unsplash.com/photos/unsafe" },
        },
        {
          id: "real-image",
          urls: {
            regular: "https://images.unsplash.com/photo-test?ixid=preserve-me",
          },
          alt_description: "museum exterior",
          user: {
            name: "Test Photographer",
            links: { html: "https://unsplash.com/@test" },
          },
          links: {
            html: "https://unsplash.com/photos/real-image",
            download_location:
              "https://api.unsplash.com/photos/real-image/download?ixid=preserve-me",
          },
        },
      ],
    });
  });
  const plan = demoPlan("search");
  plan.destination = "未知目的地";
  plan.days = plan.days.slice(0, 1);
  plan.days[0].stops.forEach((s) => (s.photoQuery = "specific museum test"));
  const live = { ...config, unsplashKey: "test-photo-key" };
  await enrichPhotos(plan, live);
  assert.equal(calls.length, 1);
  assert.equal(plan.images.length, 1);
  assert.ok(plan.days[0].stops.every((s) => s.photo?.id === "real-image"));
  assert.ok(plan.images[0].url.includes("ixid=preserve-me"));
  assert.equal(await trackPhotoExport(plan, live), 0);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url.hostname, "api.unsplash.com");
  plan.days[0].stops[0].photo!.downloadLocation =
    "https://evil.example/photos/x/download";
  await trackPhotoExport(plan, live);
  assert.equal(calls.length, 2);
  assert.equal((await searchPhotos(live, "empty")).status, "not_found");
  assert.equal((await searchPhotos(live, "failure")).status, "error");
  plan.days[0].stops.forEach((s) => (s.photoQuery = "empty"));
  await enrichPhotos(plan, live, { force: true });
  assert.ok(
    plan.days[0].stops.every((s) => !s.photo && s.photoStatus === "not_found"),
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    enrichPhotos(plan, live, { force: true, signal: controller.signal }),
  );
});

test("HTML export contains every daily map, credited photos and safe self-contained navigation", async () => {
  const plan = demoPlan("html");
  await enrichPhotos(plan, config);
  plan.title = "</title><script>window.PWNED=true</script>";
  plan.days[0].stops[0].description = '<img src=x onerror="window.PWNED=true">';
  plan.days[0].stops[0].photo!.url = "javascript:alert(1)";
  plan.days[0].stops[0].photo!.profileUrl = "javascript:alert(2)";
  const html = await renderHtml(plan, config);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("javascript:"));
  assert.ok(!html.includes("<script>window.PWNED"));
  assert.equal((html.match(/data-day-panel="/g) || []).length, 3);
  assert.equal((html.match(/data:image\/svg\+xml;base64/g) || []).length, 4);
  assert.ok(html.includes("¥3,060"));
  assert.ok(html.includes("摄影"));
  assert.ok(html.includes('data-section="food"'));
  assert.ok(!html.includes("<script src="));
  const script = html.match(/<script>([\s\S]+)<\/script>/)![1];
  assert.ok(
    html.includes(
      `sha256-${createHash("sha256").update(script).digest("base64")}`,
    ),
  );
  assert.ok(!html.includes(config.unsplashKey || "test-photo-key"));
});
