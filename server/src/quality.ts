import { createHash, randomUUID } from "node:crypto";
import type { DayPlan, Plan, Stop } from "../../shared/types.js";
import type {
  DayCheck,
  Fact,
  LocalTravelMode,
  OpeningInfo,
  ScheduleIssue,
  TravelLeg,
} from "../../shared/quality.js";
import { effectiveFact, safeSourceUrl } from "../../shared/quality.js";
import type { Config } from "./config.js";
import { safeError } from "./config.js";
import { amap } from "./amap.js";
import { enrichLocations } from "./places.js";
import { hasTicketForLeg } from "./tickets.js";
import { ensureCosts } from "./costs.js";
import { checkJourney } from "./journey.js";

const HOUR = 3600000;
const expires = (at: string, hours: number) =>
  new Date(
    Number.isFinite(Date.parse(at)) ? Date.parse(at) + hours * HOUR : 0,
  ).toISOString();
const chinaDate = (date: string) =>
  new Date(date).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
export function ensurePlanIdentity(plan: Plan) {
  plan.revision ??= 1;
  plan.updatedAt ??= plan.createdAt;
  plan.lockedStopIds ??= [];
  const ids = new Set<string>();
  for (const day of plan.days)
    for (const stop of day.stops) {
      if (!stop.id || ids.has(stop.id)) stop.id = randomUUID();
      ids.add(stop.id);
    }
}
export function timeMinutes(value: string): number | null {
  const match = value
    .trim()
    .replace("：", ":")
    .match(/^(\d{1,2}):(\d{2})$/);
  if (!match || +match[1] > 23 || +match[2] > 59) return null;
  return +match[1] * 60 + +match[2];
}
export function durationMinutes(value: string): number | null {
  let text = value
    .trim()
    .replace(/^(?:约|大约|预计|停留)\s*/, "")
    .replace(/\s*[（(]([^()（）]*)[)）]\s*$/, (full, note: string) =>
      /[\d一二三四五六七八九十半].*(小时|分钟|分)/.test(note) ? full : "",
    )
    .replace(/\s/g, "");
  if (text === "半小时") return 30;
  if (/^\d+(?:\.\d+)?小时半$/.test(text))
    return Math.round(parseFloat(text) * 60 + 30);
  // A range is a planning estimate; reserve its upper bound.
  text = text.replace(
    /^\d+(?:\.\d+)?[–—~～至-](\d+(?:\.\d+)?)(小时|分钟|分)$/,
    "$1$2",
  );
  const match = text.match(/^(?:(\d+(?:\.\d+)?)小时)?(?:(\d+)分钟?)?$/);
  if (!match || (!match[1] && !match[2])) return null;
  const minutes = Math.round(+(match[1] || 0) * 60 + +(match[2] || 0));
  return minutes > 0 && minutes <= 1440 ? minutes : null;
}
const weekdayNumber: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  日: 7,
  天: 7,
};
function clauseDays(text: string): number[] {
  const days = new Set<number>();
  for (const m of text.matchAll(
    /周([一二三四五六日天])(?:\s*[至到\-–—~～]\s*(?:周)?([一二三四五六日天]))?/g,
  )) {
    const start = weekdayNumber[m[1]],
      end = weekdayNumber[m[2]] || start;
    for (let n = start, count = 0; count < 7; n = (n % 7) + 1, count++) {
      days.add(n);
      if (n === end) break;
    }
  }
  return [...days];
}
export function openingWindows(info: OpeningInfo, date: string) {
  const weekday = new Date(date + "T12:00:00Z").getUTCDay() || 7;
  const today = chinaDate(info.checkedAt) === date;
  const month = Number(date.slice(5, 7)),
    monthDay = Number(date.slice(5).replace("-", ""));
  const inRange = (n: number, a: number, b: number) =>
    a <= b ? n >= a && n <= b : n >= a || n <= b;
  const clauses = info.weekly
    .replace(/星期/g, "周")
    .split(/[；;]|[,，](?=\s*\d{1,2}\s*[-–—~～至]\s*\d{1,2}月)/)
    .filter((s) => {
      const dates = s.match(/(\d{2})\/(\d{2})\s*[-–—~～至]\s*(\d{2})\/(\d{2})/);
      if (
        dates &&
        !inRange(
          monthDay,
          +dates[1] * 100 + +dates[2],
          +dates[3] * 100 + +dates[4],
        )
      )
        return false;
      const months = s.match(/(\d{1,2})\s*[-–—~～至]\s*(\d{1,2})月/);
      return !!s && (!months || inRange(month, +months[1], +months[2]));
    });
  const matches = clauses.filter((s) => clauseDays(s).includes(weekday));
  const generic = clauses.filter(
    (s) =>
      !/周[一二三四五六日天]/.test(s) &&
      (/每天|每日|全年|全天|24小时|\d月|\d{2}\/\d{2}/.test(s) ||
        /^\s*\d{1,2}:\d{2}\s*[-–—~至]/.test(s)),
  );
  const weeklyText = (matches.length ? matches : generic).join("；");
  const text = today && info.today ? info.today : weeklyText;
  const conditional =
    !today && /节假日|季节|冬季|夏季|淡季|旺季|特殊|临时|\d月/.test(text);
  const closed =
    /闭馆|闭园|不开放|不营业|休息/.test(text) && !/\d{1,2}:\d{2}/.test(text);
  const windows: [number, number][] = [];
  for (const m of text.matchAll(
    /(\d{1,2}:\d{2})\s*[-–—~～至]\s*(\d{1,2}:\d{2})/g,
  )) {
    const start = timeMinutes(m[1]),
      end = m[2] === "24:00" ? 1440 : timeMinutes(m[2]);
    if (start !== null && end !== null)
      windows.push([start, end <= start ? end + 1440 : end]);
  }
  if (/24小时|全天开放/.test(text)) windows.push([0, 1440]);
  const lastEntryText =
    text + (today && !/节假日|临时/.test(weeklyText) ? weeklyText : "");
  const lastEntry =
    lastEntryText.match(/(\d{1,2}:\d{2})\s*停止(?:入园|入馆|入场|售票)/)?.[1] ||
    lastEntryText.match(
      /(?:最晚进入|最晚入场|停止入园|停止入馆)[：:\s]*(\d{1,2}:\d{2})/,
    )?.[1];
  return {
    windows,
    closed,
    conditional,
    lastEntry: lastEntry ? timeMinutes(lastEntry) : null,
    text,
  };
}
export function stopSourceUrl(stop: Stop) {
  return stop.location
    ? `https://uri.amap.com/marker?position=${stop.location.join(",")}&name=${encodeURIComponent(stop.name)}&coordinate=gaode&callnative=0`
    : "";
}
function unknown(detail: string, checkedAt?: string): Fact {
  return { status: "unknown", detail, ...(checkedAt ? { checkedAt } : {}) };
}

export function refreshFacts(plan: Plan) {
  ensurePlanIdentity(plan);
  ensureCosts(plan);
  const now = new Date().toISOString();
  const demo = plan.mode === "demo";
  for (const day of plan.days) {
    for (const stop of day.stops) {
      if (stop.photo && !stop.photoCheckedAt)
        stop.photoCheckedAt =
          stop.facts?.photo.checkedAt || plan.photoUpdatedAt;
      const checkedAt = stop.placeCheckedAt;
      const placeFact: Fact =
        stop.verified && stop.location && checkedAt
          ? {
              status: "verified",
              detail: stop.locationNote || "已匹配高德地点与坐标",
              source: "高德 POI",
              url: stopSourceUrl(stop),
              checkedAt,
              expiresAt: expires(checkedAt, 24 * 30),
            }
          : unknown(
              stop.locationNote || "尚未取得匹配地点的工具坐标",
              checkedAt,
            );
      const opening = stop.openingInfo;
      const openingText = opening
        ? [opening.weekly, opening.today ? `查询当日：${opening.today}` : ""]
            .filter(Boolean)
            .join("；")
        : "";
      const openingFact: Fact =
        openingText && opening
          ? {
              status: "verified",
              detail: `${openingText}。以场馆当日公告为准`,
              source: opening.source,
              url: opening.url,
              checkedAt: opening.checkedAt,
              expiresAt: expires(opening.checkedAt, 24 * 7),
            }
          : unknown(
              "暂无可靠开放时间；请通过场馆官方渠道确认",
              opening?.checkedAt,
            );
      stop.facts = {
        location: effectiveFact(placeFact),
        price:
          stop.cost === null
            ? unknown("未取得该项费用，预算合计尚不完整")
            : {
                status: stop.userProvidedFields?.includes("cost")
                  ? "user"
                  : "estimate",
                detail: `全体旅客该项参考 ¥${stop.cost}，不代表实时票价或订单报价`,
                source: stop.userProvidedFields?.includes("cost")
                  ? "手动修改"
                  : "行程预算估算",
              },
        opening: effectiveFact(openingFact),
        reservation: unknown(
          stop.type === "attraction"
            ? "预约要求、余位与是否已预约需单独确认"
            : "营业、房态或可订情况需另行确认",
        ),
        photo: stop.photo
          ? {
              status:
                stop.photo.source === "amap-poi" &&
                stop.verified &&
                stop.location
                  ? "verified"
                  : "estimate",
              detail:
                stop.photo.caption ||
                (stop.photo.source === "amap-poi"
                  ? "匹配 POI 的地点照片，拍摄日期和实际取景仍以来源为准"
                  : "相关图库配图，不证明该地点的现场情况"),
              source:
                stop.photo.source === "amap-poi" ? "高德地点照片" : "Unsplash",
              url: safeSourceUrl(stop.photo.photoUrl),
              checkedAt: stop.photoCheckedAt,
            }
          : unknown("暂无可用配图"),
      };
      if (demo)
        for (const field of [
          "location",
          "price",
          "opening",
          "reservation",
        ] as const)
          stop.facts[field] = {
            status: "demo",
            detail: "固定示例，未作实时核验",
          };
    }
    const cityName = (s: unknown) =>
      String(s || "")
        .trim()
        .replace(/市$/, "")
        .toLowerCase();
    const forecast = [...plan.evidence]
      .reverse()
      .find(
        (e) =>
          e.status === "live" &&
          e.tool === "weather_forecast" &&
          cityName((e.data as any)?.location) === cityName(plan.destination) &&
          (e.data as any)?.days?.some(
            (d: any) => d.date === day.date && d.available,
          ),
      );
    day.weatherFact = demo
      ? { status: "demo", detail: "示例天气未查询" }
      : forecast
        ? effectiveFact({
            status: "verified",
            detail: "已取得对应日期预报，临行前需更新",
            source: forecast.source,
            url: "https://open-meteo.com/",
            checkedAt: forecast.queriedAt,
            expiresAt: expires(forecast.queriedAt, 6),
          })
        : unknown("未取得对应日期的有效天气预报");
    if (day.check) {
      day.check.legs.forEach((leg) => {
        leg.fact = effectiveFact(leg.fact);
      });
      day.check.queriedLegs = day.check.legs.filter(
        (l) => l.fact.status === "verified",
      ).length;
      if (
        day.check.status === "checked" &&
        (day.check.legs.some((l) => l.fact.status !== "verified") ||
          day.stops.some(
            (s) =>
              s.facts?.opening.status === "stale" ||
              s.facts?.location.status === "stale",
          ))
      )
        day.check.status = "partial";
    }
  }
  function transportFact(reverse: boolean): Fact {
    const { origin, destination, startDate, transport } = plan.request;
    const from = reverse ? destination : origin,
      to = reverse ? origin : destination;
    const date = reverse ? plan.days.at(-1)!.date : startDate;
    const e = [...plan.evidence]
      .reverse()
      .find((e) => hasTicketForLeg([e], from, to, date, transport));
    return demo
      ? { status: "demo", detail: "示例交通未实查" }
      : e
        ? effectiveFact({
            status: "verified",
            detail: "已返回该方向和日期的候选票务；未下单，价格与余票可能变化",
            source: e.source,
            checkedAt: e.queriedAt,
            expiresAt: expires(e.queriedAt, 0.25),
            url: safeSourceUrl((e.data as any)?.urls?.[0]),
          })
        : unknown(
            transport === "drive"
              ? "自驾建议，费用和出发时路况需核实"
              : "对应方向、日期的票务尚未核验",
          );
  }
  plan.quality = {
    version: 1,
    checkedAt: plan.quality?.checkedAt || now,
    hotel: demo
      ? { status: "demo", detail: "演示住宿" }
      : {
          status: plan.hotel.nightlyEstimate === null ? "unknown" : "estimate",
          detail:
            "酒店为推荐，房价为每间每晚参考；房态、早餐及退改规则尚未确认",
        },
    outbound: transportFact(false),
    inbound: transportFact(true),
  };
}

async function enrichOpening(
  plan: Plan,
  config: Config,
  days: DayPlan[],
  force: boolean,
  signal?: AbortSignal,
) {
  if (plan.mode === "demo" || !config.amapKey) return;
  const stops = days
    .flatMap((d) => d.stops)
    .filter(
      (s) =>
        s.verified &&
        s.poiId &&
        (force ||
          !s.openingInfo ||
          Date.now() - Date.parse(s.openingInfo.checkedAt) > 24 * HOUR),
    );
  const ids = [...new Set(stops.map((s) => s.poiId!))];
  for (let i = 0; i < ids.length; i += 10) {
    signal?.throwIfAborted();
    try {
      const result = await amap(
        config,
        "v3/place/detail",
        { id: ids.slice(i, i + 10).join("|"), extensions: "all" },
        signal,
      );
      const at = new Date().toISOString();
      for (const stop of stops.filter((s) =>
        ids.slice(i, i + 10).includes(s.poiId!),
      )) {
        const p = result.pois?.find((p: any) => p.id === stop.poiId);
        const text = (v: unknown) =>
          typeof v === "string" ? v.slice(0, 2000) : "";
        stop.openingInfo = {
          today: text(p?.biz_ext?.open_time || p?.business?.opentime_today),
          weekly: text(p?.biz_ext?.opentime2 || p?.business?.opentime_week),
          checkedAt: at,
          source: "高德 POI 营业信息",
          url: stopSourceUrl(stop),
        };
      }
    } catch (e) {
      signal?.throwIfAborted();
      // Leave absent/stale facts visible; failed requests cannot create verified hours.
    }
  }
}

const routeCache = new Map<
  string,
  { at: string; minutes: number; meters: number; walkingMeters: number }
>();
function straightMeters(a: [number, number], b: [number, number]) {
  const rad = Math.PI / 180,
    x = (b[0] - a[0]) * rad * Math.cos(((a[1] + b[1]) / 2) * rad),
    y = (b[1] - a[1]) * rad;
  return Math.sqrt(x * x + y * y) * 6371000;
}
function validNumber(value: unknown) {
  return (typeof value === "number" ||
    (typeof value === "string" && value.trim() !== "")) &&
    Number.isFinite(Number(value)) &&
    Number(value) >= 0
    ? Number(value)
    : null;
}
async function queryLeg(
  plan: Plan,
  day: DayPlan,
  from: Stop,
  to: Stop,
  config: Config,
  force: boolean,
  signal?: AbortSignal,
): Promise<TravelLeg> {
  const mode =
    day.travelMode || (plan.request.transport === "drive" ? "driving" : "auto");
  const actualMode =
    mode === "auto"
      ? from.location &&
        to.location &&
        straightMeters(from.location, to.location) <= 1500
        ? "walking"
        : "driving"
      : mode;
  const leg: TravelLeg = {
    fromId: from.id!,
    toId: to.id!,
    fromName: from.name,
    toName: to.name,
    mode: actualMode,
    minutes: null,
    meters: null,
    walkingMeters: null,
    availableMinutes: null,
    slackMinutes: null,
    bufferMinutes:
      plan.journey?.departure?.stopId === to.id
        ? 10
        : to.type === "transport"
          ? /机场|航站楼/.test(to.name)
            ? 90
            : /火车|高铁|车站|站$/.test(to.name)
              ? 45
              : 10
          : 10,
    fact: unknown("站间交通尚未查询"),
  };
  if (plan.mode === "demo") {
    leg.fact = { status: "demo", detail: "示例地点未核验，未调用真实路线" };
    return leg;
  }
  if (!from.verified || !to.verified || !from.location || !to.location) {
    leg.fact = unknown("起点或终点坐标未核验，不能计算交通耗时");
    return leg;
  }
  leg.navigationUrl = `https://uri.amap.com/navigation?from=${from.location.join(",")},${encodeURIComponent(from.name)}&to=${to.location.join(",")},${encodeURIComponent(to.name)}&mode=${actualMode === "transit" ? "bus" : actualMode === "walking" ? "walk" : "car"}&coordinate=gaode&callnative=0`;
  if (!config.amapKey) {
    leg.fact = unknown("未配置高德 Web 服务 Key");
    return leg;
  }
  const start = timeMinutes(from.time),
    duration = durationMinutes(from.duration);
  const depart =
    start !== null && duration !== null && start + duration < 1440
      ? start + duration
      : null;
  const transitTime =
    actualMode === "transit" && depart !== null
      ? `${String(Math.floor(depart / 60)).padStart(2, "0")}:${String(depart % 60).padStart(2, "0")}`
      : undefined;
  const key = createHash("sha256")
    .update(
      JSON.stringify([
        config.amapKey,
        from.location,
        to.location,
        actualMode,
        day.date,
        plan.destination,
        plan.journey?.transferPreference || "balanced",
        transitTime,
      ]),
    )
    .digest("hex");
  const saved = routeCache.get(key);
  try {
    let value =
      !force && saved && Date.now() - Date.parse(saved.at) < 24 * HOUR
        ? saved
        : undefined;
    if (!value) {
      const params: Record<string, string> = {
        origin: from.location.map((n) => n.toFixed(6)).join(","),
        destination: to.location.map((n) => n.toFixed(6)).join(","),
        extensions: "base",
      };
      if (actualMode === "transit")
        Object.assign(params, {
          city: plan.destination,
          cityd: plan.destination,
          strategy: "0",
          date: day.date,
        });
      if (transitTime) params.time = transitTime;
      if (
        actualMode === "transit" &&
        plan.journey?.transferPreference === "less"
      )
        params.strategy = "2";
      const data = await amap(
        config,
        actualMode === "transit"
          ? "v3/direction/transit/integrated"
          : `v3/direction/${actualMode}`,
        params,
        signal,
      );
      const p =
        actualMode === "transit"
          ? data.route?.transits?.[0]
          : data.route?.paths?.[0];
      const duration = validNumber(p?.duration),
        distance = validNumber(p?.distance);
      if (duration === null || distance === null)
        throw new Error("未返回可用路线，需调整交通方式或核对地点入口");
      value = {
        at: new Date().toISOString(),
        minutes: Math.ceil(duration / 60),
        meters: Math.round(distance),
        walkingMeters:
          actualMode === "walking"
            ? Math.round(distance)
            : Math.round(validNumber(p?.walking_distance) || 0),
      };
      routeCache.set(key, value);
      if (routeCache.size > 1000)
        routeCache.delete(routeCache.keys().next().value!);
    }
    Object.assign(leg, {
      minutes: value.minutes,
      meters: value.meters,
      walkingMeters: value.walkingMeters,
    });
    leg.fact = {
      status: "verified",
      detail:
        "高德已返回路线；耗时为查询时参考，未来路况、等车及现场排队可能变化",
      source: "高德路径规划",
      url: leg.navigationUrl,
      checkedAt: value.at,
      expiresAt: expires(value.at, 24),
    };
  } catch (error) {
    signal?.throwIfAborted();
    leg.fact = unknown(
      `交通查询未完成：${safeError(error)}`,
      new Date().toISOString(),
    );
  }
  return leg;
}

export function checkSchedule(
  day: DayPlan,
  legs: TravelLeg[],
  pace: Plan["request"]["pace"],
): DayCheck {
  const issues: ScheduleIssue[] = [];
  let visitMinutes = 0,
    unknownDurations = 0;
  for (const [index, stop] of day.stops.entries()) {
    const start = timeMinutes(stop.time),
      duration = durationMinutes(stop.duration);
    if (duration === null) {
      unknownDurations++;
      issues.push({
        severity: "warning",
        code: "duration_unknown",
        stopId: stop.id,
        message: `${stop.name}的停留时长无法计算，请填写明确时长`,
      });
    } else visitMinutes += duration;
    if (start === null)
      issues.push({
        severity: "warning",
        code: "time_unknown",
        stopId: stop.id,
        message: `${stop.name}的开始时间不明确，请使用 HH:mm`,
      });
    if (!stop.verified || !stop.location)
      issues.push({
        severity: "warning",
        code: "location_unknown",
        stopId: stop.id,
        message: `${stop.name}的地点仍待核验`,
      });
    if (start !== null && duration !== null && start + duration > 1440)
      issues.push({
        severity: "warning",
        code: "overnight",
        stopId: stop.id,
        message: `${stop.name}结束时间跨日，请确认次日安排`,
      });
    const opening = stop.openingInfo;
    if (
      opening &&
      effectiveFact(stop.facts?.opening || unknown("")).status === "verified" &&
      start !== null &&
      duration !== null
    ) {
      const rule = openingWindows(opening, day.date);
      const inside = rule.windows.some(
        ([a, b]) =>
          (start >= a && start + duration <= b) ||
          (start + 1440 >= a && start + 1440 + duration <= b),
      );
      if (
        rule.closed ||
        (rule.windows.length && !inside) ||
        (rule.lastEntry !== null && start >= rule.lastEntry)
      )
        issues.push({
          severity: rule.conditional ? "warning" : "conflict",
          code: "opening_conflict",
          stopId: stop.id,
          message: `${stop.name}的安排可能与开放/入场时间冲突：${rule.text}${rule.conditional ? "；包含节假日等例外，需向场馆确认" : ""}`,
        });
      else if (!rule.windows.length && !rule.closed)
        issues.push({
          severity: "info",
          code: "opening_unparsed",
          stopId: stop.id,
          message: `${stop.name}有开放时间说明，但无法自动匹配出行日期，请查看来源`,
        });
    } else if (["attraction", "food"].includes(stop.type))
      issues.push({
        severity: "info",
        code: "opening_unknown",
        stopId: stop.id,
        message: `${stop.name}开放时间尚未核验`,
      });
    if (index === 0) continue;
    const previous = day.stops[index - 1],
      leg = legs[index - 1];
    const previousStart = timeMinutes(previous.time),
      previousDuration = durationMinutes(previous.duration);
    if (!leg) continue;
    if (start !== null && previousStart !== null && previousDuration !== null) {
      leg.availableMinutes = start - previousStart - previousDuration;
      if (leg.minutes !== null)
        leg.slackMinutes =
          leg.availableMinutes - leg.minutes - leg.bufferMinutes;
      if (leg.availableMinutes < 0)
        issues.push({
          severity: "conflict",
          code: "overlap",
          stopId: stop.id,
          message: `${previous.name}与${stop.name}的安排重叠 ${Math.abs(leg.availableMinutes)} 分钟`,
        });
      else if (leg.slackMinutes !== null && leg.slackMinutes < 0)
        issues.push({
          severity: "conflict",
          code: "transfer_short",
          stopId: stop.id,
          message: `${previous.name} → ${stop.name}预计需 ${leg.minutes} 分钟，另预留 ${leg.bufferMinutes} 分钟；当前少 ${Math.abs(leg.slackMinutes)} 分钟`,
        });
    }
    if (leg.minutes === null || effectiveFact(leg.fact).status !== "verified")
      issues.push({
        severity: "warning",
        code: "route_unknown",
        stopId: stop.id,
        message: `${previous.name} → ${stop.name}的交通未完成核验`,
      });
  }
  const travelMinutes = legs.reduce((n, l) => n + (l.minutes || 0), 0),
    walkingMeters = legs.reduce((n, l) => n + (l.walkingMeters || 0), 0);
  if (visitMinutes + travelMinutes > (pace === "relaxed" ? 480 : 600))
    issues.push({
      severity: "warning",
      code: "long_day",
      message: `已知游览与交通共 ${visitMinutes + travelMinutes} 分钟，尚未包含全部休息和排队，建议减少安排`,
    });
  if (walkingMeters > (pace === "relaxed" ? 6000 : 10000))
    issues.push({
      severity: "warning",
      code: "long_walk",
      message: `已查路线含步行 ${(walkingMeters / 1000).toFixed(1)} 公里，景区内部步行尚未计入`,
    });
  return {
    checkedAt: new Date().toISOString(),
    status: issues.some((i) => i.severity === "conflict")
      ? "conflict"
      : issues.length
        ? "partial"
        : "checked",
    mode: day.travelMode || "auto",
    visitMinutes,
    unknownDurations,
    travelMinutes,
    walkingMeters,
    queriedLegs: legs.filter((l) => l.fact.status === "verified").length,
    totalLegs: legs.length,
    legs,
    issues,
  };
}

export async function verifyPlan(
  plan: Plan,
  config: Config,
  options: {
    day?: number;
    mode?: LocalTravelMode;
    force?: boolean;
    signal?: AbortSignal;
    progress?: (message: string) => void;
  } = {},
) {
  ensurePlanIdentity(plan);
  const days = plan.days.filter((d) => !options.day || d.day === options.day);
  options.signal?.throwIfAborted();
  await enrichLocations(plan, config, {
    day: options.day,
    force: options.force,
    signal: options.signal,
  });
  await enrichOpening(plan, config, days, !!options.force, options.signal);
  refreshFacts(plan);
  for (const day of days) {
    day.travelMode =
      options.mode ||
      day.travelMode ||
      (plan.request.transport === "drive" ? "driving" : "auto");
    options.progress?.(`正在核验第 ${day.day} 天的站间交通与时间安排`);
    const legs: TravelLeg[] = [];
    for (let i = 1; i < day.stops.length; i++) {
      options.signal?.throwIfAborted();
      legs.push(
        await queryLeg(
          plan,
          day,
          day.stops[i - 1],
          day.stops[i],
          config,
          !!options.force,
          options.signal,
        ),
      );
    }
    day.check = checkSchedule(day, legs, plan.request.pace);
    checkJourney(plan, day, day.check);
  }
  plan.quality!.checkedAt = new Date().toISOString();
  refreshFacts(plan);
}
