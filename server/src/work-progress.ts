import { randomUUID } from "node:crypto";
import type { AgentId, Evidence, Job, WorkDetail } from "../../shared/types.js";
import { safeError } from "./config.js";
import { emit } from "./store.js";

const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
// Only allow public search fields into the event stream, not raw tool arguments.
const value = (v: unknown) =>
  typeof v === "string" || typeof v === "number"
    ? safeError(String(v))
        .replace(/Bearer\s+\S+/gi, "[已隐藏]")
        .slice(0, 500)
    : "";
const texts = (v: unknown) =>
  Array.isArray(v)
    ? v
        .filter((s): s is string => typeof s === "string")
        .map(value)
        .slice(0, 8)
    : [];

export const workTitles: Record<AgentId, string> = {
  attractions: "筛选符合偏好的景点，整理预约与开放提醒",
  transport: "比较往返交通，核对日期、班次与费用",
  weather: "检查出行日期的天气，准备雨天备选",
  hotel: "筛选方便出行的住宿片区与酒店",
  food: "寻找当地美食和可定位的餐馆",
  budget: "汇总全程费用，检查预算与未知金额",
  route: "安排每日动线，协调交通、休息与返程",
};

export function describeQuery(
  tool: string,
  args: unknown,
  source?: string,
): WorkDetail {
  const a = object(args);
  const parts = (...vs: unknown[]) => vs.map(value).filter(Boolean).join(" · ");
  const trip = [value(a.origin), value(a.destination)]
    .filter(Boolean)
    .join(" → ");
  let title: string;
  let query: string;
  switch (tool) {
    case "search_web":
      title =
        a.source === "xiaohongshu"
          ? "搜索小红书公开攻略"
          : a.source === "ctrip"
            ? "搜索携程公开攻略"
            : "搜索公开攻略与旅行信息";
      query = value(a.query);
      break;
    case "search_places":
      title =
        a.category === "hotel"
          ? "搜索住宿地点"
          : a.category === "food"
            ? "搜索当地餐馆"
            : "搜索景点与地点";
      query = parts(a.city, a.keywords);
      break;
    case "weather_forecast":
      title = "查询出行天气";
      query = parts(a.city, a.startDate, a.days ? `${value(a.days)} 天` : "");
      break;
    case "search_train_tickets":
    case "search_flights":
      title =
        tool === "search_flights" ? "查询航班与报价" : "查询高铁车次与余票";
      query = parts(
        trip,
        a.date,
        a.passengers ? `${value(a.passengers)} 人` : "",
      );
      break;
    case "driving_route":
      title = "查询道路路线与耗时";
      query = trip;
      break;
    case "ticket_sources":
      title = "检查票务查询服务";
      query = parts(trip, a.date, a.returnDate);
      break;
    case "calculate_budget":
      title = "核算全程预算";
      query = Array.isArray(a.items)
        ? a.items
            .map((i) => value(object(i).category))
            .filter(Boolean)
            .slice(0, 10)
            .join("、")
        : "费用项目汇总";
      break;
    default:
      title = /weather/i.test(tool)
        ? "查询天气信息"
        : /route|direction|distance|driv|walk|transit/i.test(tool)
          ? "查询交通路线"
          : /search|place|poi|geocod/i.test(tool)
            ? "检索地点与旅行信息"
            : "查询外部旅行服务";
      query =
        parts(
          a.city,
          a.keywords,
          a.query,
          a.address,
          a.origin,
          a.destination,
          a.date,
          a.startDate,
        ) || "外部工具未提供可展示的搜索条件";
  }
  const sources: Record<string, string> = {
    search_places: "高德地点搜索",
    search_web: "Tavily 网页搜索",
    weather_forecast: "Open-Meteo",
    search_train_tickets: "12306 / 本地查询",
    search_flights: "Google Flights / fast-flights",
    driving_route: "高德路线",
    calculate_budget: "预算计算器",
    ticket_sources: "本地票务服务",
  };
  return {
    id: randomUUID(),
    kind: "query",
    title,
    query,
    source: source ? value(source) : sources[tool],
  };
}

export function queryOutcome(work: WorkDetail, result: Evidence): WorkDetail {
  const next = {
    ...work,
    source: result.source === result.tool ? work.source : value(result.source),
  };
  const d = object(result.data);
  if (result.status === "unconfigured")
    return {
      ...next,
      outcome: "unconfigured",
      summary: "服务未配置，本次没有取得查询依据",
      warnings: ["需连接相应服务后重新查询；相关信息仍待确认。"],
    };
  if (result.status === "error")
    return {
      ...next,
      outcome: "error",
      summary: "查询未成功，相关信息仍待确认",
      warnings: [value(d.message) || "可稍后重试或通过官方渠道确认。"],
    };
  if (result.status === "demo")
    return { ...next, outcome: "demo", summary: "演示结果，未发起实时查询" };
  const rows = Array.isArray(result.data)
    ? result.data
    : Array.isArray(d.results)
      ? d.results
      : undefined;
  if (result.tool === "ticket_sources")
    return {
      ...next,
      outcome: "success",
      summary: "已检查票务服务状态，接下来仍需查询具体班次",
      warnings: ["服务可连接不代表已查到车票或机票。"],
    };
  if (result.tool === "weather_forecast" && Array.isArray(d.days)) {
    const available = d.days.filter((x) => object(x).available === true).length;
    return {
      ...next,
      outcome:
        available === d.days.length && available > 0
          ? "success"
          : available
            ? "partial"
            : "empty",
      summary: `取得 ${available}/${d.days.length} 天的天气预报`,
      warnings:
        available < d.days.length
          ? ["部分出行日期没有预报，需临近出发再查询。"]
          : [],
    };
  }
  if (
    result.tool === "calculate_budget" &&
    typeof d.totalKnown === "number" &&
    Number.isFinite(d.totalKnown)
  ) {
    const unknown = texts(d.unknownItems);
    return {
      ...next,
      outcome: unknown.length ? "partial" : "success",
      summary: `已知费用合计 ¥${d.totalKnown.toLocaleString("zh-CN")}；${unknown.length} 项金额未知`,
      warnings: [
        ...unknown.map((s) => `${s}金额待确认`),
        "计算结果只核对算术，输入价格仍需核实。",
      ],
    };
  }
  // MCP arrays may be transport content blocks, not search results.
  if (
    rows &&
    [
      "search_places",
      "search_web",
      "search_train_tickets",
      "search_flights",
    ].includes(result.tool)
  ) {
    const unit =
      result.tool === "search_places"
        ? "个候选地点"
        : result.tool === "search_web"
          ? "条网页结果"
          : /search_train_tickets|search_flights/.test(result.tool)
            ? "个班次"
            : "条查询结果";
    const findings = rows
      .slice(0, 3)
      .map((x) => value(object(x).title || object(x).name))
      .filter(Boolean);
    return {
      ...next,
      outcome: rows.length ? "success" : "empty",
      summary: rows.length
        ? `找到 ${rows.length} ${unit}`
        : "没有查到符合条件的结果",
      findings,
      warnings: [
        ...texts(d.warnings),
        ...(!rows.length
          ? ["无结果不代表地点不存在或所有班次售罄，仍需进一步确认。"]
          : result.tool === "search_places"
            ? ["地点匹配不代表价格、开放时间或预约已确认。"]
            : []),
      ],
    };
  }
  return {
    ...next,
    outcome: "partial",
    summary: "外部服务已返回内容，正在交由专家整理",
    warnings: ["返回内容尚未形成可直接采用的结论。"],
  };
}

export function startQuery(
  job: Job,
  agent: AgentId | "planner",
  tool: string,
  args: unknown,
  source?: string,
) {
  const work = describeQuery(tool, args, source);
  emit(job, {
    type: "tool",
    agent,
    state: "running",
    message: `${work.title}${work.query ? `：${work.query}` : ""}`,
    work,
  });
  return work;
}
export function finishQuery(
  job: Job,
  agent: AgentId | "planner",
  work: WorkDetail,
  result: Evidence,
) {
  const finished = queryOutcome(work, result);
  emit(job, {
    type: "tool",
    agent,
    state: result.status === "error" ? "error" : "done",
    message: `${finished.title} · ${finished.summary}`,
    work: finished,
    data: { evidenceId: result.id, status: result.status },
  });
}
