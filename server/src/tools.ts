import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Config } from "./config.js";
import { safeError } from "./config.js";
import type { ToolDef } from "./llm.js";
import type { Evidence } from "../../shared/types.js";
import { dateAt } from "./schema.js";
import { amap } from "./amap.js";
import { queryTickets } from "./tickets.js";
import { ticketServiceStatus } from "./ticket-runtime.js";
export { amap } from "./amap.js";
type ToolResult = { source: string; status: Evidence["status"]; data: unknown };
export type BuiltinTool = {
  definition: ToolDef;
  run: (args: unknown, signal?: AbortSignal) => Promise<ToolResult>;
};
const str = { type: "string" };
const def = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
): ToolDef => ({
  type: "function",
  function: {
    name,
    description,
    parameters: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
  },
});
export async function fetchJson(
  url: string,
  init: RequestInit = {},
  signal?: AbortSignal,
): Promise<any> {
  const response = await fetch(url, {
    ...init,
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(25000)])
      : AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`外部服务返回 HTTP ${response.status}`);
  return response.json();
}
export function makeTools(config: Config): BuiltinTool[] {
  return [
    ...(["rail", "flight"] as const).map((kind): BuiltinTool => ({
      definition: def(
        kind === "rail" ? "search_train_tickets" : "search_flights",
        kind === "rail"
          ? "免费查询12306高铁/动车车次、时刻、席别余票和票价，无需Key。origin/destination为中文城市或车站名；仅支持含今天的15天预售期。价格为每位成人单程价。往返需分别查询。"
          : "免费通过fast-flights查询Google Flights航班及人民币报价，无需Key。支持常见中文城市名或准确IATA三字机场码。默认仅直飞，可用maxStops=1查询一次中转。passengers为成人人数，返回该人数经济舱单程总价；无余位数量。往返需分别查询。失败/空结果不得编造价格。",
        {
          origin: str,
          destination: str,
          date: { type: "string", description: "YYYY-MM-DD" },
          passengers: { type: "integer", minimum: 1, maximum: 9 },
          limit: { type: "integer", minimum: 1, maximum: 10 },
          ...(kind === "flight"
            ? { maxStops: { type: "integer", minimum: 0, maximum: 1 } }
            : {}),
        },
        ["origin", "destination", "date"],
      ),
      run: async (raw, signal) => ({
        source:
          kind === "rail"
            ? "12306 / 本地免费查询"
            : "Google Flights / fast-flights",
        status: "live",
        data: await queryTickets(kind, raw, signal),
      }),
    })),
    {
      definition: def(
        "search_places",
        "高德 POI 搜索。按城市、用户偏好搜索景点/酒店/餐馆，返回 POI id、准确名称、地址、GCJ-02 坐标和地点照片。请把选定地点的 id 与名称传给路线专家和总规划师，供地图、照片共同使用。酒店 POI 不等于实时房价。",
        {
          city: str,
          keywords: str,
          category: { type: "string", enum: ["attraction", "hotel", "food"] },
        },
        ["city", "keywords", "category"],
      ),
      run: async (raw, signal) => {
        const args = z
          .object({
            city: z.string().max(60),
            keywords: z.string().max(100),
            category: z.enum(["attraction", "hotel", "food"]),
          })
          .parse(raw);
        if (!config.amapKey)
          return {
            source: "高德 POI",
            status: "unconfigured",
            data: {
              message: "尚未配置高德 Key，无法核验地点、坐标、营业时间及价格。",
            },
          };
        const data = await amap(
          config,
          "v3/place/text",
          {
            city: args.city,
            keywords: args.keywords,
            types: { attraction: "110000", hotel: "100000", food: "050000" }[
              args.category
            ],
            citylimit: "true",
            offset: "12",
            extensions: "all",
          },
          signal,
        );
        return {
          source: "高德 POI",
          status: "live",
          data: data.pois.map((p: any) => ({
            id: p.id,
            name: p.name,
            address: p.address,
            location: p.location,
            type: p.type,
            typecode: p.typecode,
            cityname: p.cityname,
            adname: p.adname,
            adcode: p.adcode,
            photos: Array.isArray(p.photos) ? p.photos.slice(0, 3) : [],
            tel: p.tel,
            rating: p.biz_ext?.rating,
            averageCost: p.biz_ext?.cost,
          })),
        };
      },
    },
    {
      definition: def(
        "weather_forecast",
        "查询目的地实际天气预报。Open-Meteo 仅覆盖未来约 16 天；远期日期必须标注无法预报，不能生成虚假天气。可用英文城市名提高地理编码命中率。",
        {
          city: str,
          startDate: str,
          days: { type: "integer", minimum: 1, maximum: 14 },
        },
        ["city", "startDate", "days"],
      ),
      run: async (raw, signal) => {
        const args = z
          .object({
            city: z.string().max(60),
            startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            days: z.number().int().min(1).max(14),
          })
          .parse(raw);
        const geo = await fetchJson(
          `https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: args.city.replace(/市$/, ""), count: "3", language: "zh" })}`,
          {},
          signal,
        );
        const place =
          geo.results?.find((p: any) => p.country_code === "CN") ||
          geo.results?.[0];
        if (!place)
          return {
            source: "Open-Meteo",
            status: "error",
            data: { message: "未找到匹配城市，可尝试英文名称。" },
          };
        const weather = await fetchJson(
          `https://api.open-meteo.com/v1/forecast?${new URLSearchParams({ latitude: String(place.latitude), longitude: String(place.longitude), daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max", timezone: "Asia/Shanghai", forecast_days: "16" })}`,
          {},
          signal,
        );
        const requested = Array.from({ length: args.days }, (_, i) =>
          dateAt(args.startDate, i),
        );
        const days = requested.map((date) => {
          const i = weather.daily.time.indexOf(date);
          return i < 0
            ? { date, available: false, message: "超出预报窗口，请临行前查询" }
            : {
                date,
                available: true,
                code: weather.daily.weather_code[i],
                high: weather.daily.temperature_2m_max[i],
                low: weather.daily.temperature_2m_min[i],
                rainProbability: weather.daily.precipitation_probability_max[i],
              };
        });
        return {
          source: "Open-Meteo",
          status: "live",
          data: {
            location: place.name,
            country: place.country,
            days,
            url: "https://open-meteo.com/",
          },
        };
      },
    },
    {
      definition: def(
        "search_web",
        "搜索可索引的旅行攻略、门票、营业时间、地方菜与交通信息。source 可限定小红书或携程；搜索摘要不是实时订单报价。",
        {
          query: str,
          source: { type: "string", enum: ["all", "xiaohongshu", "ctrip"] },
        },
        ["query", "source"],
      ),
      run: async (raw, signal) => {
        const args = z
          .object({
            query: z.string().max(500),
            source: z.enum(["all", "xiaohongshu", "ctrip"]),
          })
          .parse(raw);
        if (!config.searchKey)
          return {
            source: "Tavily Web Search",
            status: "unconfigured",
            data: {
              message: "尚未配置 Tavily 或搜索 MCP；攻略与价格需自行核验。",
            },
          };
        const data = await fetchJson(
          "https://api.tavily.com/search",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${config.searchKey}`,
            },
            body: JSON.stringify({
              query: args.query,
              max_results: 5,
              search_depth: "basic",
              ...(args.source === "all"
                ? {}
                : {
                    include_domains: [
                      args.source === "ctrip" ? "ctrip.com" : "xiaohongshu.com",
                    ],
                  }),
            }),
          },
          signal,
        );
        return {
          source: "Tavily Web Search",
          status: "live",
          data:
            data.results?.map((r: any) => ({
              title: r.title,
              url: r.url,
              content: String(r.content).slice(0, 1600),
            })) || [],
        };
      },
    },
    {
      definition: def(
        "driving_route",
        "高德自驾路线，需出发城市和目的地；返回真实里程、预计时长和通行费，不含油费/停车费。",
        { origin: str, destination: str },
        ["origin", "destination"],
      ),
      run: async (raw, signal) => {
        const args = z
          .object({
            origin: z.string().max(100),
            destination: z.string().max(100),
          })
          .parse(raw);
        if (!config.amapKey)
          return {
            source: "高德路线",
            status: "unconfigured",
            data: { message: "高德 Key 尚未配置，无法获取真实驾驶路线。" },
          };
        const geos = await Promise.all(
          [args.origin, args.destination].map((address) =>
            amap(config, "v3/geocode/geo", { address }, signal),
          ),
        );
        if (geos.some((g) => !g.geocodes?.[0]))
          throw new Error("无法定位出发地或目的地");
        const data = await amap(
          config,
          "v3/direction/driving",
          {
            origin: geos[0].geocodes[0].location,
            destination: geos[1].geocodes[0].location,
            extensions: "base",
          },
          signal,
        );
        return {
          source: "高德路线",
          status: "live",
          data: data.route.paths?.map((p: any) => ({
            distanceMeters: p.distance,
            durationSeconds: p.duration,
            tolls: p.tolls,
            trafficLights: p.traffic_lights,
          })),
        };
      },
    },
    {
      definition: def(
        "ticket_sources",
        "检查内置免费铁路/机票服务状态。查票需继续调用search_train_tickets或search_flights；此工具不提供价格，不可当作查票成功。",
        { origin: str, destination: str, date: str, returnDate: str },
        ["origin", "destination", "date", "returnDate"],
      ),
      run: async (raw) => {
        const args = z
          .object({
            origin: z.string(),
            destination: z.string(),
            date: z.string(),
            returnDate: z.string(),
          })
          .parse(raw);
        return {
          source: "票务服务状态",
          status: "live",
          data: {
            ...args,
            services: ticketServiceStatus(),
            message:
              "免费票务已内置，无需配置Key。调用search_train_tickets查询高铁、search_flights查询航班；去程与返程分别查询。服务就绪不代表已查到票，失败或空结果保留未知。",
            railUrl: "https://www.12306.cn/",
            flightUrl: "https://flights.ctrip.com/",
          },
        };
      },
    },
    {
      definition: def(
        "calculate_budget",
        "对人民币费用项目进行确定性加总。amount 为全体旅客整个行程的小计；不把未知金额当成零。",
        {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                category: str,
                amount: { type: ["number", "null"] },
              },
              required: ["category", "amount"],
            },
          },
        },
        ["items"],
      ),
      run: async (raw) => {
        const args = z
          .object({
            items: z
              .array(
                z.object({
                  category: z.string(),
                  amount: z.number().min(0).nullable(),
                }),
              )
              .max(30),
          })
          .parse(raw);
        return {
          source: "预算计算器",
          status: "live",
          data: {
            ...args,
            totalKnown: args.items.reduce((s, i) => s + (i.amount ?? 0), 0),
            unknownItems: args.items
              .filter((i) => i.amount === null)
              .map((i) => i.category),
            note: "仅执行算术，输入价格真实性仍以对应来源为准",
          },
        };
      },
    },
  ];
}
export async function executeTool(
  tool: BuiltinTool,
  args: unknown,
  signal?: AbortSignal,
): Promise<Evidence> {
  const base = {
    id: randomUUID(),
    tool: tool.definition.function.name,
    queriedAt: new Date().toISOString(),
  };
  try {
    return { ...base, ...(await tool.run(args, signal)) };
  } catch (e) {
    signal?.throwIfAborted();
    return {
      ...base,
      status: "error",
      source: tool.definition.function.name,
      data: { message: safeError(e) },
    };
  }
}
