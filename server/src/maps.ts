import type { Plan } from "../../shared/types.js";
import { DAY_COLORS } from "../../shared/types.js";
import type { Config } from "./config.js";
import { safeError } from "./config.js";
import { createHash } from "node:crypto";
export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export type MapResult = {
  kind: "amap" | "schematic" | "unavailable";
  image: string;
  caption: string;
  missing: string[];
};
export function schematic(plan: Plan, day?: number): string {
  const days = plan.days.filter((d) => !day || d.day === day);
  const points = days.flatMap((d) =>
    d.stops
      .filter((s) => s.location)
      .map((s, i) => ({
        ...s,
        day: d.day,
        index: i + 1,
        color: DAY_COLORS[(d.day - 1) % DAY_COLORS.length],
      })),
  );
  if (!points.length)
    return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="380" viewBox="0 0 960 380"><rect width="960" height="380" fill="#f1f3ed"/><text x="480" y="170" text-anchor="middle" font-family="Microsoft YaHei,sans-serif" font-size="24" fill="#526650">地图等待地点核验</text><text x="480" y="215" text-anchor="middle" font-family="Microsoft YaHei,sans-serif" font-size="16" fill="#818b7c">配置高德 Key 并重新规划后，显示景点分布与每日线路</text></svg>`;
  // An ordered diagram is intentionally separate from a real geographic map.
  // Spacing by visit order avoids hiding adjacent restaurants and attractions.
  const visibleDays = days.slice(0, 4);
  const rows = visibleDays.flatMap((d) => {
    const pts = points.filter((p) => p.day === d.day);
    return Array.from({ length: Math.ceil(pts.length / 4) }, (_, r) => ({
      day: d.day,
      points: pts.slice(r * 4, r * 4 + 4),
    }));
  });
  const height = Math.max(380, rows.length * 102 + 110);
  const content = rows
    .map((row, r) => {
      const y = rows.length === 1 ? 160 : 85 + r * 102;
      const positions = row.points.map((p, i) => ({
        p,
        x: 130 + i * (700 / Math.max(1, row.points.length - 1)),
      }));
      const line =
        positions.length > 1
          ? `<path d="M ${positions[0].x} ${y} H ${positions.at(-1)!.x}" stroke="${row.points[0].color}" stroke-width="3" stroke-dasharray="6 6" opacity=".5"/>`
          : "";
      const nodes = positions
        .map(
          ({ p, x }) =>
            `<g><circle cx="${x}" cy="${y}" r="21" fill="${p.color}" stroke="white" stroke-width="4"/><text x="${x}" y="${y + 5}" text-anchor="middle" font-family="Arial" fill="white" font-size="14">${p.day}.${p.index}</text><text x="${x}" y="${y + 49}" text-anchor="middle" font-family="Microsoft YaHei,sans-serif" font-size="17" fill="#52684a">${escapeHtml(p.name.slice(0, 12))}</text></g>`,
        )
        .join("");
      return line + nodes;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="${height}" viewBox="0 0 960 ${height}"><defs><pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#d9dfd1"/></pattern></defs><rect width="960" height="${height}" fill="#eef1e7"/><rect width="960" height="${height}" fill="url(#grid)"/><text x="30" y="35" font-family="Microsoft YaHei,sans-serif" font-size="14" fill="#6d7b62">${escapeHtml(plan.destination)} · ${plan.mode === "demo" ? "演示行程" : "游览顺序"}示意</text><text x="30" y="${height - 25}" font-family="Microsoft YaHei,sans-serif" font-size="12" fill="#87907d">非高德底图 · 示意顺序，无地理比例${days.length > 4 ? " · 总览显示前4天，完整路线请逐日查看" : ""}</text>${content}</svg>`;
}
const cache = new Map<string, MapResult>();
export async function getMap(
  plan: Plan,
  config: Config,
  day?: number,
): Promise<MapResult> {
  const selected = plan.days.filter((d) => !day || d.day === day);
  const missing = selected.flatMap((d) =>
    d.stops.filter((s) => !s.location).map((s) => s.name),
  );
  const points = selected.flatMap((d) =>
    d.stops
      .filter((s) => s.location)
      .map((s, i) => ({ location: s.location!, day: d.day, index: i + 1 })),
  );
  const fallback = (caption: string): MapResult => ({
    kind: points.length ? "schematic" : "unavailable",
    image: `data:image/svg+xml;base64,${Buffer.from(schematic(plan, day)).toString("base64")}`,
    caption,
    missing,
  });
  if (!config.amapKey)
    return fallback(
      "高德 Key 尚未配置。示意连线仅表示游览顺序，不作为实际道路或导航依据。",
    );
  if (!points.length)
    return fallback(
      "未取得已核验的地点坐标，无法生成高德地图。请检查高德连接后重新生成行程。",
    );
  const cacheKey = `${plan.id}:${day || 0}:${createHash("sha256").update(config.amapKey).digest("hex").slice(0, 10)}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;
  // Amap static maps accept at most 10 markers and 4 paths; each daily map has <= 8 stops.
  const visible = points.slice(0, 10);
  const markers = visible
    .map(
      (p) =>
        `mid,0x${DAY_COLORS[(p.day - 1) % DAY_COLORS.length].slice(1)},${p.index}:${p.location.join(",")}`,
    )
    .join("|");
  const paths = selected
    .slice(0, 4)
    .map((d) => {
      const route = visible.filter((p) => p.day === d.day);
      return route.length > 1
        ? `4,0x${DAY_COLORS[(d.day - 1) % DAY_COLORS.length].slice(1)},0.8,,:${route.map((p) => p.location.join(",")).join(";")}`
        : "";
    })
    .filter(Boolean)
    .join("|");
  try {
    const response = await fetch(
      `https://restapi.amap.com/v3/staticmap?${new URLSearchParams({ key: config.amapKey, size: "960*380", scale: "2", markers, ...(paths ? { paths } : {}) })}`,
      { signal: AbortSignal.timeout(25000) },
    );
    if (
      !response.ok ||
      !response.headers.get("content-type")?.startsWith("image/")
    )
      throw new Error("高德静态地图返回无效结果，请检查 Web 服务 Key 权限");
    const data = await response.arrayBuffer();
    if (data.byteLength > 12000000) throw new Error("地图数据过大");
    const result: MapResult = {
      kind: "amap",
      image: `data:${response.headers.get("content-type")};base64,${Buffer.from(data).toString("base64")}`,
      caption: `高德地图 · 连线表示游览顺序，并非导航路线。${points.length > 10 ? "总览仅展示前 10 个地点，完整标记请查看每天的地图。" : ""}${missing.length ? `另有 ${missing.length} 个地点未能核验坐标。` : ""}`,
      missing,
    };
    if (cache.size > 150) cache.clear();
    cache.set(cacheKey, result);
    return result;
  } catch (e) {
    return fallback(`高德地图加载失败：${safeError(e)}。当前展示为位置示意。`);
  }
}
