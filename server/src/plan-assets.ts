import type { Plan } from "../../shared/types.js";
import { safeError, type Config } from "./config.js";
import { enrichLocations } from "./places.js";
import { enrichPhotos } from "./photos.js";
import { getMap } from "./maps.js";
import { verifyPlan, refreshFacts } from "./quality.js";

// A new itinerary is not complete until its locations, photos and every daily map
// have been prepared. UI refresh and HTML export consume these same assets.
export async function preparePlanAssets(
  plan: Plan,
  config: Config,
  options: {
    signal?: AbortSignal;
    progress?: (message: string) => void;
    day?: number;
  } = {},
) {
  const { signal, progress = () => {} } = options;
  async function optionalStep<T>(
    label: string,
    action: () => Promise<T>,
  ): Promise<T | undefined> {
    signal?.throwIfAborted();
    try {
      return await action();
    } catch (error) {
      signal?.throwIfAborted();
      const warning = `${label}暂未完成：${safeError(error)}；行程已保留，可稍后补充。`;
      plan.warnings.push(warning);
      progress(warning);
      return undefined;
    }
  }
  plan.warnings = plan.warnings.filter(
    (w) =>
      !/^(生成时未能核验地点：|生成时未找到可用配图：|部分每日高德地图未能生成)/.test(
        w,
      ),
  );
  signal?.throwIfAborted();
  progress("正在使用专家检索的 POI 核验地点、门店和每日标记");
  await optionalStep("地点信息补充", () =>
    enrichLocations(plan, config, { signal, day: options.day }),
  );
  await optionalStep("路线与费用核对", () =>
    verifyPlan(plan, config, { signal, day: options.day, progress }),
  );
  signal?.throwIfAborted();
  progress("正在匹配景点封面与餐馆照片，高德地点照片优先");
  await optionalStep("照片补充", () =>
    enrichPhotos(plan, config, { signal, day: options.day }),
  );
  signal?.throwIfAborted();
  const maps: NonNullable<Plan["assets"]>["maps"] = [];
  for (const day of [...plan.days.map((d) => d.day), 0]) {
    signal?.throwIfAborted();
    progress(
      day
        ? `正在生成第 ${day} / ${plan.days.length} 天的高德地图与编号`
        : "正在生成全程路线总览",
    );
    const map = await optionalStep(day ? `第 ${day} 天地图` : "全程地图", () =>
      getMap(plan, config, day || undefined, {
        signal,
        resolveLocations: false,
      }),
    );
    maps.push(
      map
        ? { day, kind: map.kind, missing: map.missing }
        : {
            day,
            kind: "unavailable",
            missing: plan.days
              .filter((d) => !day || d.day === day)
              .flatMap((d) => d.stops)
              .map((s) => s.name),
          },
    );
  }
  signal?.throwIfAborted();
  const stops = plan.days.flatMap((d) => d.stops);
  const illustrated = stops.filter((s) =>
    ["attraction", "food"].includes(s.type),
  );
  const locations = {
    ready: stops.filter((s) => s.verified && s.location).length,
    total: stops.length,
  };
  const photos = {
    ready: illustrated.filter((s) => s.photo).length,
    total: illustrated.length,
  };
  const ready =
    locations.ready === locations.total &&
    photos.ready === photos.total &&
    maps.every((m) => m.kind === "amap");
  plan.assets = {
    generatedAt: new Date().toISOString(),
    status: ready ? "ready" : "partial",
    locations,
    photos,
    maps,
  };
  const missingPlaces = stops.filter((s) => !s.location).map((s) => s.name);
  const missingPhotos = illustrated.filter((s) => !s.photo).map((s) => s.name);
  if (missingPlaces.length)
    plan.warnings.push(
      `生成时未能核验地点：${missingPlaces.join("、")}。这些安排没有地图标记，请确认具体地点后重试。`,
    );
  if (missingPhotos.length)
    plan.warnings.push(
      `生成时未找到可用配图：${missingPhotos.join("、")}。可在行程页补全图片。`,
    );
  if (
    config.amapKey &&
    plan.mode === "live" &&
    maps.some((m) => m.day && m.kind !== "amap")
  )
    plan.warnings.push(
      `部分每日高德地图未能生成，已保留示意或待核验状态，可在地图区域重试。`,
    );
  plan.warnings = [...new Set(plan.warnings)];
  refreshFacts(plan);
  progress(
    `生成检查完成：${locations.ready}/${locations.total} 个地点已核验，${photos.ready}/${photos.total} 个停留点已配图，${maps.filter((m) => m.day && m.kind === "amap").length}/${plan.days.length} 张每日高德地图已生成`,
  );
}
