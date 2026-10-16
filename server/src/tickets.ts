import path from "node:path";
import { z } from "zod";
import { ROOT, safeError } from "./config.js";
import {
  ensureRail,
  ensureFlightPython,
  recordTicketQuery,
} from "./ticket-runtime.js";
import { runTicketProcess, waitForTicket } from "./ticket-process.js";
import type { TicketData, TicketOption } from "../../shared/tickets.js";
import type { Evidence } from "../../shared/types.js";

export const ticketQuerySchema = z.object({
  origin: z.string().trim().min(1).max(60),
  destination: z.string().trim().min(1).max(60),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(
      (d) =>
        Number.isFinite(Date.parse(d)) &&
        new Date(d).toISOString().slice(0, 10) === d,
      "日期无效",
    ),
  passengers: z.number().int().min(1).max(9).default(1),
  limit: z.number().int().min(1).max(10).default(5),
  maxStops: z.number().int().min(0).max(1).default(0),
});
export function chinaToday(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}
export function validateTicketDate(
  date: string,
  kind: "rail" | "flight",
  today = chinaToday(),
) {
  const days = (Date.parse(date) - Date.parse(today)) / 86400000;
  if (days < 0) throw new Error("请选择今天或之后的出发日期");
  if (kind === "rail" && days > 14)
    throw new Error(
      "该日期尚未进入铁路 15 天预售期，请临近出发时查询；不能据此判断无车或无票",
    );
  if (kind === "flight" && days > 330)
    throw new Error("机票查询仅支持未来 330 天，请临近出发时再查");
}
// Explicit city coverage; unknown cities never silently map to another airport.
const airports: Record<string, string[]> = {
  北京: ["PEK", "PKX"],
  上海: ["SHA", "PVG"],
  广州: ["CAN"],
  深圳: ["SZX"],
  成都: ["TFU", "CTU"],
  重庆: ["CKG"],
  杭州: ["HGH"],
  南京: ["NKG"],
  西安: ["XIY"],
  武汉: ["WUH"],
  长沙: ["CSX"],
  郑州: ["CGO"],
  天津: ["TSN"],
  青岛: ["TAO"],
  济南: ["TNA"],
  大连: ["DLC"],
  沈阳: ["SHE"],
  哈尔滨: ["HRB"],
  长春: ["CGQ"],
  厦门: ["XMN"],
  福州: ["FOC"],
  昆明: ["KMG"],
  贵阳: ["KWE"],
  南宁: ["NNG"],
  桂林: ["KWL"],
  海口: ["HAK"],
  三亚: ["SYX"],
  丽江: ["LJG"],
  大理: ["DLU"],
  拉萨: ["LXA"],
  乌鲁木齐: ["URC"],
  兰州: ["LHW"],
  西宁: ["XNN"],
  银川: ["INC"],
  呼和浩特: ["HET"],
  太原: ["TYN"],
  石家庄: ["SJW"],
  合肥: ["HFE"],
  南昌: ["KHN"],
  宁波: ["NGB"],
  温州: ["WNZ"],
  无锡: ["WUX"],
  珠海: ["ZUH"],
  香港: ["HKG"],
  澳门: ["MFM"],
  台北: ["TPE", "TSA"],
  东京: ["HND", "NRT"],
  大阪: ["KIX", "ITM"],
  首尔: ["ICN", "GMP"],
  新加坡: ["SIN"],
  曼谷: ["BKK", "DMK"],
  吉隆坡: ["KUL"],
  悉尼: ["SYD"],
  墨尔本: ["MEL"],
  伦敦: ["LHR", "LGW"],
  巴黎: ["CDG", "ORY"],
  纽约: ["JFK", "EWR"],
  洛杉矶: ["LAX"],
  旧金山: ["SFO"],
};
export function resolveAirports(value: string) {
  const name = value.trim().replace(/市$/, "");
  if (/^[a-z]{3}$/i.test(name)) return [name.toUpperCase()];
  if (airports[name]) return airports[name];
  throw new Error(
    `暂未收录「${value}」的机场，请使用准确的三字机场代码（如 SHA、PEK）；不会自动替换为邻近城市`,
  );
}
export function parseRailResult(raw: any, date: string): TicketOption[] {
  const text =
    raw.content
      ?.filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n") || "";
  if (raw.isError || /^\s*Error:/i.test(text))
    throw new Error(`12306 查询失败：${text.slice(0, 220)}`);
  let rows: unknown;
  try {
    rows = JSON.parse(text);
  } catch {
    throw new Error("12306 返回格式异常，无法核验车次");
  }
  const parsed = z
    .array(
      z.object({
        start_train_code: z.string().min(1),
        start_date: z.string(),
        arrive_date: z.string(),
        start_time: z.string().regex(/^\d{2}:\d{2}$/),
        arrive_time: z.string().regex(/^\d{2}:\d{2}$/),
        from_station: z.string().min(1),
        to_station: z.string().min(1),
        lishi: z.string(),
        prices: z.array(
          z.object({
            seat_name: z.string(),
            num: z.string(),
            price: z.number().nonnegative().nullable().optional(),
          }),
        ),
      }),
    )
    .safeParse(rows);
  if (!parsed.success || parsed.data.some((r) => r.start_date !== date))
    throw new Error("12306 车次数据与查询日期不匹配或结构已变化");
  return parsed.data.map((r) => {
    const seat = r.prices.find((s) => s.seat_name === "二等座");
    return {
      name: r.start_train_code,
      from: r.from_station,
      to: r.to_station,
      departure: `${r.start_date}T${r.start_time}`,
      arrival: `${r.arrive_date}T${r.arrive_time}`,
      duration: r.lishi,
      price: seat?.price ?? null,
      currency: "CNY",
      priceBasis: "per_person",
      availability: seat ? `二等座：${seat.num}` : "详见席别",
      seats: r.prices,
    };
  });
}

const cache = new Map<string, { at: number; data: TicketData }>();
let railQueue = Promise.resolve();
async function railQuery(
  args: z.infer<typeof ticketQuerySchema>,
  signal?: AbortSignal,
): Promise<TicketData> {
  const client = await waitForTicket(ensureRail(), signal);
  signal?.throwIfAborted();
  const previous = railQueue;
  let release!: () => void;
  railQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await waitForTicket(previous, signal);
    signal?.throwIfAborted();
    const raw = await client.callTool(
      {
        name: "get-tickets",
        arguments: {
          date: args.date,
          fromStation: args.origin.replace(/市$/, ""),
          toStation: args.destination.replace(/市$/, ""),
          trainFilterFlags: "GD",
          sortFlag: "startTime",
          limitedNum: args.limit,
          format: "json",
        },
      },
      undefined,
      { timeout: 45000, signal },
    );
    const results = parseRailResult(raw, args.date);
    return {
      ...args,
      results,
      count: results.length,
      queriedAt: new Date().toISOString(),
      urls: ["https://www.12306.cn/index/"],
      note: "12306 查询结果；显示高铁/动车，二等座价格为每位成人单程价。余票随时变化，最终以 12306 为准。",
    };
  } finally {
    void previous.then(release);
  }
}
let flightQueue = Promise.resolve();
async function flightQuery(
  args: z.infer<typeof ticketQuerySchema>,
  signal?: AbortSignal,
): Promise<TicketData> {
  const origins = resolveAirports(args.origin),
    destinations = resolveAirports(args.destination);
  const python = await waitForTicket(ensureFlightPython(), signal);
  signal?.throwIfAborted();
  // One flight request at a time; each request checks at most four airport pairs.
  const previous = flightQueue;
  let release!: () => void;
  flightQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  try {
    await waitForTicket(previous, signal);
    signal?.throwIfAborted();
    const results: TicketOption[] = [],
      urls: string[] = [],
      warnings: string[] = [];
    let successes = 0;
    for (const fromAirport of origins)
      for (const toAirport of destinations) {
        signal?.throwIfAborted();
        try {
          const output = await runTicketProcess(
            python,
            ["-X", "utf8", path.join(ROOT, "server", "python", "flights.py")],
            {
              cwd: ROOT,
              input: { ...args, fromAirport, toAirport },
              timeout: 35000,
              signal,
            },
          );
          const data = JSON.parse(output);
          if (!data.ok || !Array.isArray(data.results))
            throw new Error("机票查询返回格式异常");
          results.push(...data.results);
          urls.push(data.url);
          successes++;
          if (data.skipped)
            warnings.push(
              `${fromAirport} → ${toAirport} 有 ${data.skipped} 条结果无法解析，已排除`,
            );
        } catch (error) {
          signal?.throwIfAborted();
          warnings.push(`${fromAirport} → ${toAirport}：${safeError(error)}`);
        }
      }
    if (!successes) throw new Error(warnings.join("；"));
    results.sort(
      (a, b) =>
        (a.price ?? Infinity) - (b.price ?? Infinity) ||
        a.departure.localeCompare(b.departure),
    );
    const limited = results.slice(0, args.limit);
    return {
      ...args,
      results: limited,
      count: limited.length,
      queriedAt: new Date().toISOString(),
      urls,
      warnings,
      note: `Google Flights 页面报价，由 fast-flights 获取；${args.passengers} 位成人、经济舱、单程总价（人民币），时间为各机场当地时间。查询机场 ${origins.join("/")} → ${destinations.join("/")}；${args.maxStops ? "最多一次中转" : "仅查直飞"}。缺失票价保留为空，不提供实时余位数量；未覆盖的机场和供应商需另查。`,
    };
  } finally {
    void previous.then(release);
  }
}
export async function queryTickets(
  kind: "rail" | "flight",
  raw: unknown,
  signal?: AbortSignal,
) {
  const args = ticketQuerySchema.parse(raw);
  validateTicketDate(args.date, kind);
  if (process.env.ROAM_TICKETS_DISABLED === "1")
    throw new Error("内置票务查询已关闭");
  signal?.throwIfAborted();
  const key = `${kind}:${JSON.stringify(args)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 120000) return structuredClone(hit.data);
  try {
    const data = await (kind === "rail"
      ? railQuery(args, signal)
      : flightQuery(args, signal));
    recordTicketQuery(kind, data.count);
    if (cache.size >= 80) cache.delete(cache.keys().next().value!);
    cache.set(key, { at: Date.now(), data });
    return structuredClone(data);
  } catch (error) {
    recordTicketQuery(kind, 0, safeError(error));
    throw error;
  }
}

export function hasTicketForLeg(
  evidence: Evidence[],
  origin: string,
  destination: string,
  date: string,
  mode: string,
) {
  return evidence.some((e) => {
    if (
      e.status !== "live" ||
      !["search_train_tickets", "search_flights"].includes(e.tool)
    )
      return false;
    if (mode === "train" && e.tool !== "search_train_tickets") return false;
    if (mode === "flight" && e.tool !== "search_flights") return false;
    const data = e.data as Partial<TicketData>;
    return (
      data.origin === origin &&
      data.destination === destination &&
      data.date === date &&
      !!data.results?.length
    );
  });
}
