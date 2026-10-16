import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { demoPlan } from "../src/demo.js";
import { photoImageUrl, coverPhoto } from "../../shared/photos.js";
import type { Config } from "../src/config.js";
fs.mkdirSync("tmp", { recursive: true });
process.env.ROAM_DATA_DIR = fs.mkdtempSync(
  path.resolve("tmp", "map-assets-test-"),
);
const { getMap, schematic, imageDataUri } = await import("../src/maps.js");
const { buildTravelHtml } = await import("../src/html.js");
const { matchPlace, placeQueries, enrichLocations } =
  await import("../src/places.js");
const { amap } = await import("../src/amap.js");
const { enrichPhotos } = await import("../src/photos.js");
const config: Config = {
  baseUrl: "",
  model: "",
  apiKey: "",
  amapKey: "",
  unsplashKey: "",
  searchKey: "",
  mcpServers: [],
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZxkAAAAASUVORK5CYII=",
  "base64",
);

test("static maps normalize charset MIME, preserve original stop numbers and invalidate on repaired coordinates", async (t) => {
  const calls: URL[] = [];
  t.mock.method(globalThis, "fetch", async (input: any) => {
    calls.push(new URL(String(input)));
    return new Response(png, {
      headers: { "content-type": "image/png;charset=UTF-8" },
    });
  });
  const plan = demoPlan("mime-map");
  plan.days[0].stops[1].location = null;
  const live = { ...config, amapKey: "test-map-key" };
  const map = await getMap(plan, live, 1);
  assert.equal(map.kind, "amap");
  assert.ok(map.image.startsWith("data:image/png;base64,"));
  const markers = calls[0].searchParams.get("markers")!;
  assert.ok(markers.includes(",1:"));
  assert.ok(markers.includes(",3:"));
  assert.ok(!markers.includes(",2:"));
  assert.ok(schematic(plan, 1).includes(">1.3</text>"));
  const html = buildTravelHtml(plan, [map, map, map], map);
  assert.ok(!html.includes('src=""'));
  assert.equal((html.match(/data:image\/png;base64,/g) || []).length, 4);
  await getMap(plan, live, 1);
  assert.equal(calls.length, 1);
  plan.days[0].stops[1].location = [118.78, 32.04];
  await getMap(plan, live, 1);
  assert.equal(calls.length, 2);
  assert.throws(() => imageDataUri(Buffer.from("<html>bad</html>").buffer));
});

test("POI matching handles areas and aliases without picking parking, wrong branches or ambiguous names", () => {
  const stop = {
    ...demoPlan("match").days[0].stops[0],
    name: "大理古城（人民路/复兴路）",
  };
  assert.deepEqual(placeQueries(stop.name), ["大理古城"]);
  assert.equal(
    matchPlace(
      stop,
      [
        {
          id: "1",
          name: "大理古城",
          typecode: "110000",
          location: "100.164,25.69",
          adcode: "532901",
        },
      ],
      "5329",
    )?.poi.id,
    "1",
  );
  stop.name = "寂照庵";
  assert.equal(
    matchPlace(stop, [
      {
        id: "parking",
        name: "苍山景区-寂照庵停车点",
        typecode: "150904",
        location: "100.16,25.64",
      },
      {
        id: "temple",
        name: "苍山景区-寂照庵",
        typecode: "110205",
        location: "100.16,25.64",
      },
    ])?.poi.id,
    "temple",
  );
  stop.name = "苍山感通索道";
  assert.equal(
    matchPlace(stop, [
      {
        id: "exit",
        name: "苍山感通索道(出站口)",
        typecode: "070000",
        location: "100.16,25.64",
      },
      {
        id: "site",
        name: "苍山景区苍山感通索道",
        typecode: "110200",
        location: "100.16,25.64",
      },
    ])?.poi.id,
    "site",
  );
  const food = { ...stop, type: "food" as const, name: "红英小吃（平等路）" };
  assert.equal(
    matchPlace(food, [
      {
        id: "wrong",
        name: "红英小吃",
        location: "100,26",
        address: "另一条路",
        typecode: "050000",
      },
    ]),
    undefined,
  );
  const same = [
    {
      id: "a",
      name: "红英小吃(平等路)",
      location: "100,26",
      typecode: "050000",
    },
    {
      id: "b",
      name: "红英小吃(平等路)",
      location: "100.1,26",
      typecode: "050000",
    },
  ];
  assert.equal(matchPlace(food, same), undefined);
  assert.deepEqual(placeQueries("前往大理凤仪机场/火车站"), []);
  assert.equal(
    placeQueries("洱海生态廊道（龙龛码头—磻溪S湾段）")[0],
    "龙龛码头",
  );
});

test("repair uses the prefecture for county sights and shares POI photos with cover and HTML safely", async (t) => {
  const plan = demoPlan("repair");
  plan.mode = "live";
  plan.destination = "大理";
  plan.days = plan.days.slice(0, 1);
  plan.days[0].stops = plan.days[0].stops.slice(0, 1);
  const stop = plan.days[0].stops[0];
  stop.name = "巍山古城";
  stop.location = null;
  stop.verified = false;
  let searches = 0;
  t.mock.method(globalThis, "fetch", async (input: any) => {
    const url = new URL(String(input));
    if (url.pathname.includes("geocode"))
      return Response.json({
        status: "1",
        geocodes: [{ city: "大理白族自治州", adcode: "532901" }],
      });
    assert.equal(url.searchParams.get("city"), "大理白族自治州");
    searches++;
    return Response.json({
      status: "1",
      pois: [
        {
          id: "weishan",
          name: "巍山古城",
          location: "100.309,25.227",
          adcode: "532927",
          typecode: "110000",
          business: { opentime_week: "每天09:00-17:00" },
          photos: [
            { url: "http://store.is.autonavi.com/showpic/real" },
            { url: "https://evil.example/p.jpg" },
          ],
        },
      ],
    });
  });
  const live = { ...config, amapKey: "test-repair-key" };
  await Promise.all([enrichLocations(plan, live), enrichLocations(plan, live)]);
  assert.equal(searches, 1);
  assert.equal(stop.verified, true);
  assert.equal(stop.place?.id, "weishan");
  await enrichPhotos(plan, live);
  assert.equal(
    stop.openingInfo?.weekly,
    "每天09:00-17:00",
    "reuse actual POI opening evidence rather than discarding it",
  );
  assert.equal(stop.photo?.source, "amap-poi");
  assert.equal(plan.photoMode, "amap");
  assert.equal(coverPhoto(plan)?.id, "weishan");
  assert.equal(stop.place?.photos.length, 1);
  assert.ok(stop.photo?.url.startsWith("https://store.is.autonavi.com/"));
  const map = {
    kind: "schematic" as const,
    image: "",
    caption: "test",
    missing: [],
  };
  const html = buildTravelHtml(plan, [map], map);
  assert.ok(
    html.includes(
      "img-src data: https://images.unsplash.com https://store.is.autonavi.com",
    ),
  );
  assert.ok(html.includes("高德地点照片"));
  assert.ok(!html.includes("evil.example"));
  assert.equal(
    photoImageUrl("https://store.is.autonavi.com.evil.example/a"),
    "",
  );
  assert.equal(photoImageUrl("https://user@store.is.autonavi.com/a"), "");
});

test("an unrecognized destination stops repeated POI queries and reports the provider coverage gap", async (t) => {
  const plan = demoPlan("unsupported-region");
  plan.mode = "live";
  plan.destination = "东京";
  const stops = plan.days.flatMap((day) => day.stops);
  stops.forEach((stop) => {
    stop.location = null;
    stop.verified = false;
    delete stop.place;
    delete stop.placeCheckedAt;
    delete stop.placeAttemptedAt;
  });
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: any) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    assert.ok(
      url.pathname.includes("geocode"),
      "must not issue unscoped POI searches",
    );
    return Response.json({ status: "1", geocodes: [] });
  });
  const live = { ...config, amapKey: "coverage-fixture" };
  await enrichLocations(plan, live);
  await enrichLocations(plan, live);
  assert.equal(calls.length, 1);
  assert.ok(
    stops.every(
      (stop) =>
        !stop.verified &&
        !stop.location &&
        stop.locationNote?.includes("当前地点服务未识别"),
    ),
  );
  await enrichLocations(plan, live, { force: true });
  assert.equal(
    calls.length,
    2,
    "explicit retry can recheck destination coverage",
  );
});

test("AMap retries a QPS rejection without returning it as a missing place", async (t) => {
  let count = 0;
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      ++count === 1
        ? { status: "0", infocode: "10021" }
        : { status: "1", pois: [] },
    ),
  );
  const data = await amap(
    { ...config, amapKey: "test-rate-key" },
    "v3/place/text",
    {},
  );
  assert.equal(count, 2);
  assert.equal(data.status, "1");
});

test("generated daily maps survive a backend restart without new map requests", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(png, {
        headers: { "content-type": "image/png;charset=UTF-8" },
      }),
  );
  const plan = demoPlan("persisted-map");
  const live = { ...config, amapKey: "persisted-test-key" };
  const map = await getMap(plan, live, 1);
  assert.equal(map.kind, "amap");
  const filename = path.join(process.env.ROAM_DATA_DIR!, "map-fixture.json");
  fs.writeFileSync(filename, JSON.stringify({ plan, config: live }));
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `
    import fs from 'node:fs';
    import {getMap} from './server/src/maps.ts';
    const {plan,config}=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
    let network=0; globalThis.fetch=async()=>{network++;throw new Error('offline');};
    const result=await getMap(plan,config,1,{resolveLocations:false});
    console.log(JSON.stringify({kind:result.kind,network}));
  `,
      filename,
    ],
    { windowsHide: true, timeout: 20000, env: process.env },
  );
  assert.deepEqual(JSON.parse(stdout.trim()), { kind: "amap", network: 0 });
});

test("repeated visits to the same POI keep both itinerary numbers on the generated map", async (t) => {
  let requested: URL | undefined;
  t.mock.method(globalThis, "fetch", async (input: any) => {
    requested = new URL(String(input));
    return new Response(png, { headers: { "content-type": "image/png" } });
  });
  const plan = demoPlan("repeat-visit");
  plan.days[0].stops[3].location = plan.days[0].stops[0].location;
  await getMap(plan, { ...config, amapKey: "repeat-test-key" }, 1);
  assert.ok(requested?.searchParams.get("labels")?.startsWith("1/4,"));
  assert.equal(requested?.searchParams.get("markers")?.split("|").length, 3);
});
