import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { McpConfig } from "./config.js";
import type { ToolDef } from "./llm.js";
export type ConnectedMcp = {
  config: McpConfig;
  client: Client;
  tools: ToolDef[];
  originalNames: Map<string, string>;
};
export function allowedTool(name: string, explicit?: string[]) {
  if (
    /book|purchase|pay|delete|remove|create|update|cancel|submit|send|write|execute|shell/i.test(
      name,
    )
  )
    return false;
  return explicit
    ? explicit.includes(name)
    : /search|query|get|list|map|weather|route|direction|geocod|ticket|station|driv|walk|bicycl|transit|distance/i.test(
        name,
      );
}
export async function connectMcp(config: McpConfig): Promise<ConnectedMcp> {
  const client = new Client({ name: "roam-travel", version: "1.0.0" });
  const headers = config.token
    ? { Authorization: `Bearer ${config.token}` }
    : undefined;
  const transport =
    config.transport === "sse"
      ? new SSEClientTransport(new URL(config.url), {
          requestInit: { headers },
        })
      : new StreamableHTTPClientTransport(new URL(config.url), {
          requestInit: { headers },
        });
  try {
    await client.connect(transport, { timeout: 20000 });
    const all: Awaited<ReturnType<Client["listTools"]>>["tools"] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools({ cursor }, { timeout: 15000 });
      all.push(...page.tools);
      cursor = page.nextCursor;
    } while (cursor && all.length < 150);
    const names = new Map<string, string>();
    const definitions = all
      .filter((t) => allowedTool(t.name, config.allowedTools))
      .slice(0, 35)
      .map((t, index) => {
        const name = `mcp_${config.id}_${index}`;
        names.set(name, t.name);
        return {
          type: "function" as const,
          function: {
            name,
            description:
              `${config.name} / ${t.name}: ${t.description || ""}`.slice(
                0,
                1800,
              ),
            parameters: t.inputSchema as Record<string, unknown>,
          },
        };
      });
    return { config, client, tools: definitions, originalNames: names };
  } catch (e) {
    await client.close().catch(() => {});
    throw e;
  }
}
