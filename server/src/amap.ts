import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Config } from "./config.js";

const slots = new Map<string, number>();
// Share a conservative per-key pace across every agent and map request.
export async function amapFetch(
  config: Config,
  endpoint: string,
  params: Record<string, string>,
  signal?: AbortSignal,
) {
  if (!config.amapKey) throw new Error("高德 Key 尚未配置");
  const key = createHash("sha256").update(config.amapKey).digest("hex");
  for (let attempt = 0; attempt < 3; attempt++) {
    signal?.throwIfAborted();
    const now = Date.now();
    const slot = Math.max(now, slots.get(key) || 0);
    slots.set(key, slot + 380);
    if (slot > now) await delay(slot - now, undefined, { signal });
    const response = await fetch(
      `https://restapi.amap.com/${endpoint}?${new URLSearchParams({ ...params, key: config.amapKey })}`,
      {
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(12000)])
          : AbortSignal.timeout(12000),
      },
    );
    if (!response.ok) throw new Error(`高德服务返回 HTTP ${response.status}`);
    const type = response.headers.get("content-type") || "";
    if (type.startsWith("image/")) return response;
    const data = await response.clone().json();
    if (data.status === "1") return response;
    if (
      ["10020", "10021", "10022", "10023"].includes(String(data.infocode)) &&
      attempt < 2
    ) {
      await delay(800 * (attempt + 1), undefined, { signal });
      continue;
    }
    throw new Error(
      `高德服务调用失败（${String(data.infocode || "unknown")}）`,
    );
  }
  throw new Error("高德服务繁忙，请稍后重试");
}
export async function amap(
  config: Config,
  endpoint: string,
  params: Record<string, string>,
  signal?: AbortSignal,
) {
  return (await amapFetch(config, endpoint, params, signal)).json();
}
