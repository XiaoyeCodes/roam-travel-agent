import { createHash, randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import { safeError } from "./config.js";
import type { Plan, Stop } from "../../shared/types.js";
import { photoImageUrl } from "../../shared/photos.js";
import { amap } from "./amap.js";

export const normalizePlace = (name: string) =>
  name
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/[\s·•,，、/—\-]/g, "")
    .toLowerCase();
export function placeQueries(name: string): string[] {
  const plain = name.replace(/（/g, "(").replace(/）/g, ")");
  // An unspecified airport/station or generic food activity is not a concrete POI.
  if (/机场.*[\/或].*(?:火车站|车站)|咖啡馆慢逛|本地小吃|具体地点待研究与确认/.test(plain))
    return [];
  const base = plain
    .replace(/\([^)]*\)/g, "")
    .replace(/^前往/, "")
    .trim();
  const inner = plain.match(/\(([^)]+)\)/)?.[1];
  const branch = inner && /店$|路$/.test(inner) && !/[\/—]/.test(inner);
  const queries = [branch ? plain : base];
  if (inner && /[—–]/.test(inner))
    queries.unshift(inner.split(/[—–]/)[0].trim());
  if (inner && /(?:店|粑粑|饭庄)$/.test(inner)) queries.push(inner);
  if (base.includes("·")) queries.push(base.split("·")[0]);
  return [...new Set(queries.filter((q) => q.length >= 2))].slice(0, 3);
}
export function matchPlace(stop: Stop, pois: any[], regionPrefix = "") {
  const raw = stop.name.replace(/（/g, "(").replace(/）/g, ")");
  const base = normalizePlace(
    raw.replace(/\([^)]*\)/g, "").replace(/^前往/, ""),
  );
  const inner = raw.match(/\(([^)]+)\)/)?.[1];
  const branch =
    inner && /(?:路店|路|店)$/.test(inner) && !/[\/—]/.test(inner)
      ? inner
      : undefined;
  const branchKey = branch ? normalizePlace(branch).replace(/店$/, "") : "";
  const queryNames = placeQueries(stop.name).map(normalizePlace);
  const ranked = pois
    .flatMap((p) => {
      const coords = String(p.location || "")
        .split(",")
        .map(Number);
      if (
        coords.length !== 2 ||
        !coords.every(Number.isFinite) ||
        coords[0] < 73 ||
        coords[0] > 136 ||
        coords[1] < 3 ||
        coords[1] > 54
      )
        return [];
      if (
        regionPrefix &&
        p.adcode &&
        !String(p.adcode).startsWith(regionPrefix)
      )
        return [];
      const name = normalizePlace(String(p.name || ""));
      const pbase = name.replace(/\([^)]*\)/g, "");
      if (
        branchKey &&
        !normalizePlace(String(p.name) + String(p.address)).includes(branchKey)
      )
        return [];
      // Prevent a hotel sharing an attraction's name from becoming that attraction.
      if (
        stop.type === "attraction" &&
        /^(050|100|150)/.test(String(p.typecode))
      )
        return [];
      if (
        stop.type === "food" &&
        p.typecode &&
        !String(p.typecode).startsWith("050")
      )
        return [];
      let score =
        name === base
          ? 110
          : queryNames.includes(name)
            ? 105
            : pbase === base
              ? 95
              : name.endsWith(base) && base.length >= 3
                ? 90
                : name.includes(base) && base.length >= 3
                  ? 80
                  : 0;
      const pieces = raw
        .replace(/\([^)]*\)/g, "")
        .split("·")
        .map(normalizePlace)
        .filter((p) => p.length >= 3);
      if (!score && pieces.length > 1 && pieces.every((p) => name.includes(p)))
        score = 75;
      if (!score && queryNames.some((q) => q.length >= 4 && name.includes(q)))
        score = 65;
      if (score && stop.type === "attraction") {
        if (/^(110)/.test(String(p.typecode))) score += 10;
        if (
          /出站口|售票|停车|入口|服务站|上站|下站/.test(name) &&
          !/出站口|售票|停车|入口|服务站|上站|下站/.test(base)
        )
          score -= 35;
      }
      return score
        ? [{ poi: p, score, coords: coords as [number, number] }]
        : [];
    })
    .sort((a, b) => b.score - a.score);
  // Ambiguous equally named branches need human disambiguation, not the first search hit.
  if (
    ranked[1]?.score === ranked[0]?.score &&
    ranked[1]?.poi.id !== ranked[0]?.poi.id
  )
    return undefined;
  return ranked[0];
}

const regions = new Map<string, Promise<{ city: string; prefix: string }>>();
async function regionFor(
  config: Config,
  destination: string,
  signal?: AbortSignal,
) {
  const key = createHash("sha256")
    .update(config.amapKey + destination)
    .digest("hex");
  if (!regions.has(key)) {
    const task = (async () => {
      const data = await amap(
        config,
        "v3/geocode/geo",
        { address: destination },
        signal,
      );
      const first = data.geocodes?.[0];
      const city =
        typeof first?.city === "string" && first.city
          ? first.city
          : destination;
      const adcode = String(first?.adcode || "");
      const prefix = /^\d{6}$/.test(adcode)
        ? adcode.slice(0, adcode.endsWith("0000") ? 2 : 4)
        : "";
      return { city, prefix };
    })();
    regions.set(key, task);
    task.then(
      (region) => {
        if (!region.prefix) regions.delete(key);
      },
      () => {},
    );
    task.catch(() => regions.delete(key));
  }
  return regions.get(key)!;
}
const pending = new WeakMap<Stop, Promise<void>>();
export async function enrichLocations(
  plan: Plan,
  config: Config,
  options: { day?: number; force?: boolean; signal?: AbortSignal } = {},
) {
  if (!config.amapKey || plan.mode === "demo") return;
  const stops = plan.days
    .filter((d) => !options.day || d.day === options.day)
    .flatMap((d) => d.stops);
  const needsLookup = (stop: Stop) =>
    options.force ||
    !(
      (stop.place && stop.verified && stop.location) ||
      ((stop.placeAttemptedAt || stop.placeCheckedAt) &&
        Date.now() - Date.parse(stop.placeAttemptedAt || stop.placeCheckedAt!) <
          300_000)
    );
  if (!stops.some(needsLookup)) return;
  let region: { city: string; prefix: string };
  try {
    region = await regionFor(config, plan.destination, options.signal);
  } catch (error) {
    options.signal?.throwIfAborted();
    return;
  }
  // No usable administrative area: never turn this into dozens of global POI
  // lookups or blame every stop name for the provider's coverage gap.
  if (!region.prefix) {
    for (const stop of stops.filter(needsLookup)) {
      if (stop.verified && stop.location) continue;
      stop.locationNote = `当前地点服务未识别“${plan.destination}”的有效行政区，暂不能核验当地地点与交通。`;
      stop.placeAttemptedAt = new Date().toISOString();
    }
    return;
  }
  for (const stop of stops) {
    options.signal?.throwIfAborted();
    if (!needsLookup(stop)) continue;
    const existing = pending.get(stop);
    if (existing) {
      await existing;
      continue;
    }
    const task = (async () => {
      try {
        let match: ReturnType<typeof matchPlace>;
        // Reuse tool evidence from the specialists; never trust model-supplied coordinates or URLs.
        const candidates = [
          ...new Map(
            plan.evidence
              .filter(
                (e) =>
                  e.status === "live" &&
                  e.tool === "search_places" &&
                  e.source === "高德 POI" &&
                  Array.isArray(e.data),
              )
              .flatMap((e) =>
                (e.data as any[])
                  .filter((p) => p?.id && p?.name && p?.location)
                  .map((p) => [String(p.id), p] as const),
              ),
          ).values(),
        ];
        if (!options.force && stop.poiId)
          match = matchPlace(
            stop,
            candidates.filter((p) => p.id === stop.poiId),
            region.prefix,
          );
        if (!options.force && !match)
          match = matchPlace(stop, candidates, region.prefix);
        for (const keywords of match ? [] : placeQueries(stop.name)) {
          const result = await amap(
            config,
            "v3/place/text",
            {
              city: region.city,
              citylimit: "true",
              keywords,
              offset: "10",
              extensions: "all",
            },
            options.signal,
          );
          match = matchPlace(stop, result.pois || [], region.prefix);
          if (match) break;
        }
        if (!match) {
          if (options.force) {
            stop.verified = false;
            stop.location = null;
            delete stop.place;
          }
          stop.locationNote =
            "名称较宽泛或存在多个匹配地点，暂不标注以免定位错误";
          return;
        }
        const p = match.poi;
        stop.poiId = String(p.id);
        stop.location = match.coords;
        stop.verified = true;
        stop.placeCheckedAt = new Date().toISOString();
        const openingText = (value: unknown) =>
          typeof value === "string" ? value.slice(0, 2000) : "";
        const today = openingText(
          p.biz_ext?.open_time || p.business?.opentime_today,
        );
        const weekly = openingText(
          p.biz_ext?.opentime2 || p.business?.opentime_week,
        );
        if (today || weekly)
          stop.openingInfo = {
            today,
            weekly,
            checkedAt: stop.placeCheckedAt,
            source: "高德 POI 营业信息",
            url: `https://uri.amap.com/marker?position=${stop.location.join(",")}&name=${encodeURIComponent(String(p.name))}&coordinate=gaode&callnative=0`,
          };
        stop.place = {
          id: String(p.id),
          name: String(p.name),
          address: `${p.cityname || ""}${p.adname || ""}${typeof p.address === "string" ? p.address : ""}`,
          photos: (Array.isArray(p.photos) ? p.photos : [])
            .map((v: any) => photoImageUrl(String(v.url || "")))
            .filter(Boolean)
            .slice(0, 3),
        };
        stop.locationNote = `${stop.name === p.name ? "" : `定位到 ${p.name} · `}高德 POI 已核验${/片区|生态廊道|—/.test(stop.name) ? "，标记为该区域的代表位置" : ""}`;
        const id = randomUUID();
        plan.evidence.push({
          id,
          source: "高德 POI 坐标核验",
          tool: "place_verify",
          status: "live",
          queriedAt: new Date().toISOString(),
          data: {
            name: p.name,
            location: p.location,
            poiId: p.id,
            requestedName: stop.name,
          },
        });
        stop.sourceIds.push(id);
      } catch (error) {
        options.signal?.throwIfAborted();
        stop.locationNote = `地点查询暂不可用：${safeError(error)}`;
      } finally {
        stop.placeAttemptedAt = new Date().toISOString();
      }
    })();
    pending.set(stop, task);
    try {
      await task;
    } finally {
      pending.delete(stop);
    }
  }
}
