import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";
import type { AgentId, PublicConfig } from "../../shared/types.js";
export const ROOT = path.resolve(
  process.cwd().endsWith(`${path.sep}server`) ? ".." : ".",
);
dotenv.config({ path: path.join(ROOT, ".env") });
export const DATA_DIR = process.env.ROAM_DATA_DIR || path.join(ROOT, ".data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const safeUrl = z
  .string()
  .url()
  .max(2000)
  .refine((value) => {
    const u = new URL(value);
    return (
      !u.username &&
      !u.password &&
      (u.protocol === "https:" ||
        (u.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)))
    );
  }, "请使用 HTTPS 地址，或本地 HTTP 服务");
const roles = z.enum([
  "attractions",
  "transport",
  "weather",
  "hotel",
  "food",
  "budget",
  "route",
]);
export const mcpSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/),
  name: z.string().min(1).max(60),
  url: safeUrl,
  transport: z.enum(["http", "sse"]).default("http"),
  roles: z.array(roles).min(1),
  token: z.string().max(4000).optional(),
  allowedTools: z.array(z.string().max(100)).max(50).optional(),
});
export type McpConfig = z.infer<typeof mcpSchema>;
export type Config = {
  baseUrl: string;
  model: string;
  apiKey: string;
  amapKey: string;
  amapJsKey?: string;
  amapJsSecurityCode?: string;
  unsplashKey: string;
  searchKey: string;
  mcpServers: McpConfig[];
};
export const configPatchSchema = z
  .object({
    baseUrl: safeUrl.optional(),
    model: z.string().trim().min(1).max(100).optional(),
    apiKey: z.string().max(4000).optional(),
    amapKey: z.string().max(4000).optional(),
    amapJsKey: z.string().trim().max(200).optional(),
    amapJsSecurityCode: z.string().trim().max(200).optional(),
    unsplashKey: z.string().max(4000).optional(),
    searchKey: z.string().max(4000).optional(),
    mcpServer: mcpSchema.optional(),
    removeMcpId: z.string().max(40).optional(),
    clearKeys: z
      .array(
        z.enum([
          "apiKey",
          "amapKey",
          "amapJsKey",
          "amapJsSecurityCode",
          "unsplashKey",
          "searchKey",
        ]),
      )
      .optional(),
  })
  .strict();
const configPath = path.join(DATA_DIR, "config.json");
function initial(): Config {
  let saved: Partial<Config> = {};
  if (fs.existsSync(configPath))
    saved = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const envMcp = process.env.MCP_SERVERS
    ? z.array(mcpSchema).parse(JSON.parse(process.env.MCP_SERVERS))
    : [];
  return {
    baseUrl: process.env.LLM_BASE_URL || "https://api.deepseek.com",
    model: process.env.LLM_MODEL || "deepseek-flash",
    apiKey: process.env.LLM_API_KEY || "",
    amapKey: process.env.AMAP_KEY || "",
    amapJsKey: process.env.AMAP_JS_KEY || "",
    amapJsSecurityCode: process.env.AMAP_JS_SECURITY_CODE || "",
    unsplashKey: process.env.UNSPLASH_ACCESS_KEY || "",
    searchKey: process.env.TAVILY_API_KEY || "",
    mcpServers: envMcp,
    ...saved,
  };
}
let config = initial();
export function getConfig(): Config {
  return structuredClone(config);
}
export function publicConfig(): PublicConfig {
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    hasLlmKey: !!config.apiKey,
    hasAmapKey: !!config.amapKey,
    hasAmapJsKey: !!config.amapJsKey,
    hasAmapJsSecurityCode: !!config.amapJsSecurityCode,
    hasUnsplashKey: !!config.unsplashKey,
    hasSearchKey: !!config.searchKey,
    mcpServers: config.mcpServers.map((s) => ({
      id: s.id,
      name: s.name,
      transport: s.transport,
      roles: s.roles as AgentId[],
      configured: true,
    })),
  };
}
export function updateConfig(input: unknown) {
  const patch = configPatchSchema.parse(input);
  for (const key of [
    "baseUrl",
    "model",
    "apiKey",
    "amapKey",
    "amapJsKey",
    "amapJsSecurityCode",
    "unsplashKey",
    "searchKey",
  ] as const)
    if (patch[key]) config[key] = patch[key]!;
  for (const key of patch.clearKeys || []) config[key] = "";
  if (patch.removeMcpId)
    config.mcpServers = config.mcpServers.filter(
      (s) => s.id !== patch.removeMcpId,
    );
  if (patch.mcpServer) {
    config.mcpServers = config.mcpServers.filter(
      (s) => s.id !== patch.mcpServer!.id,
    );
    config.mcpServers.push(patch.mcpServer);
  }
  fs.writeFileSync(`${configPath}.tmp`, JSON.stringify(config, null, 2), {
    mode: 0o600,
  });
  fs.renameSync(`${configPath}.tmp`, configPath);
  return publicConfig();
}
export function safeError(error: unknown) {
  let value = error instanceof Error ? error.message : String(error);
  for (const secret of [
    config.apiKey,
    config.amapKey,
    config.amapJsKey || "",
    config.amapJsSecurityCode || "",
    config.unsplashKey,
    config.searchKey,
    ...config.mcpServers.flatMap((s) => [s.token || "", s.url]),
  ])
    if (secret.length > 3) value = value.replaceAll(secret, "[已隐藏]");
  return value
    .replace(/sk-[\w-]+/g, "[已隐藏]")
    .replace(
      /([?&](?:key|token|api_key|access_key)=)[^\s&"<>]+/gi,
      "$1[已隐藏]",
    )
    .slice(0, 500);
}
