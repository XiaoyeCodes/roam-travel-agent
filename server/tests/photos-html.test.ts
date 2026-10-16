import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { demoPlan } from "../src/demo.js";
import { enrichPhotos, searchPhotos, trackPhotoExport } from "../src/photos.js";
import { buildTravelHtml, renderHtml } from "../src/html.js";
import type { Config } from "../src/config.js";
import { browserMapData, browserMapConfig } from "../src/browser-map.js";
import { itineraryMapPoints } from "../../shared/interactive-map.js";
import { Script } from "node:vm";
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
    plan.days[0].stops
      .filter((s) => s.type === "attraction")
      .every((s) => !s.photo && s.photoStatus === "not_found"),
  );
  assert.ok(
    plan.days[0].stops
      .find((s) => s.type === "food")
      ?.photo?.caption?.includes("非推荐餐馆"),
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

test("interactive maps preserve daily indices, repeated visits and only verified coordinates", () => {
  const plan = demoPlan("interactive-points");
  plan.days[0].stops.forEach((s) => {
    s.verified = true;
  });
  plan.days[0].stops[1].verified = false;
  plan.days[0].stops[3].location = plan.days[0].stops[0].location;
  const points = itineraryMapPoints(plan, 1);
  assert.deepEqual(
    points.map((p) => p.index),
    [1, 3, 4],
  );
  assert.equal(
    points.every((p) => p.day === 1),
    true,
  );
  assert.deepEqual(points[0].location, points[2].location);
  assert.equal(itineraryMapPoints(plan, 2).length, 0);
  plan.days[0].stops[0].location = [181, 31];
  assert.deepEqual(
    itineraryMapPoints(plan, 1).map((p) => p.index),
    [3, 4],
  );
  const live = {
    ...config,
    amapKey: "server-web-secret",
    apiKey: "llm-secret",
    amapJsKey: "browser-js-key",
    amapJsSecurityCode: "browser-security-code",
  };
  const data = browserMapData(plan, live, 1);
  assert.equal(data.key, "browser-js-key");
  assert.equal(data.securityCode, "browser-security-code");
  assert.equal(JSON.stringify(data).includes("server-web-secret"), false);
  assert.equal(JSON.stringify(data).includes("llm-secret"), false);
});

test("interactive HTML embeds all days safely, never exports the Web Service Key, and hashes the actual script", async () => {
  const plan = demoPlan("interactive-html");
  plan.days[2].stops.push({
    ...plan.days[2].stops[0],
    name: "第十一处地点",
    location: [118.7, 32.1],
  });
  plan.days.forEach((d) =>
    d.stops.forEach((s) => {
      s.verified = true;
    }),
  );
  plan.days[0].stops[0].name = '</script><img src=x onerror="window.PWNED=1">';
  const live = {
    ...config,
    amapKey: "server-web-secret",
    amapJsKey: "browser-js-key",
    amapJsSecurityCode: "browser-security-code",
  };
  const map = {
    kind: "schematic" as const,
    image: "data:image/svg+xml;base64,PHN2Zy8+",
    caption: "fallback",
    missing: [],
  };
  const html = buildTravelHtml(
    plan,
    plan.days.map(() => map),
    map,
    0,
    browserMapConfig(live),
  );
  assert.equal(
    (html.match(/data-interactive-map="/g) || []).length,
    plan.days.length + 1,
  );
  assert.equal((html.match(/<script>/g) || []).length, 1);
  assert.equal((html.match(/<\/script>/g) || []).length, 1);
  const script = html.match(/<script>([\s\S]+)<\/script>/)![1];
  assert.doesNotThrow(() => new Script(script));
  assert.ok(script.includes("\\u003c/script\\u003e"));
  assert.ok(html.includes("browser-js-key"));
  assert.ok(!html.includes("server-web-secret"));
  assert.ok(
    html.includes(
      `sha256-${createHash("sha256").update(script).digest("base64")}`,
    ),
  );
  assert.ok(html.includes("https://*.amap.com"));
  assert.equal(
    (html.match(/class="map-fallback"/g) || []).length,
    plan.days.length + 1,
  );
  assert.ok(itineraryMapPoints(plan).length > 10);
});
