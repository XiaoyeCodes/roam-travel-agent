import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { connectMcp } from "../src/mcp.js";
test("HTTP MCP adapter discovers query tools, filters writes and calls original tool schema", async () => {
  const app = express();
  app.use(express.json());
  app.post("/mcp", async (req, res) => {
    const server = new McpServer({ name: "test-rail", version: "1.0.0" });
    server.registerTool(
      "query_tickets",
      {
        description: "Test railway search",
        inputSchema: { from: z.string(), to: z.string() },
      },
      async ({ from, to }) => ({
        content: [
          { type: "text", text: JSON.stringify({ from, to, trains: [] }) },
        ],
      }),
    );
    server.registerTool(
      "purchase_ticket",
      { description: "Must not be exposed", inputSchema: {} },
      async () => ({ content: [{ type: "text", text: "not allowed" }] }),
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await transport.handleRequest(req, res, req.body);
  });
  app.get("/mcp", (_req, res) => res.status(405).end());
  app.delete("/mcp", (_req, res) => res.status(405).end());
  const listener = app.listen(0, "127.0.0.1");
  await once(listener, "listening");
  try {
    const connected = await connectMcp({
      id: "rail",
      name: "测试铁路",
      url: `http://127.0.0.1:${(listener.address() as AddressInfo).port}/mcp`,
      transport: "http",
      roles: ["transport"],
    });
    try {
      assert.equal(connected.tools.length, 1);
      assert.equal(
        connected.originalNames.get(connected.tools[0].function.name),
        "query_tickets",
      );
      const result = await connected.client.callTool({
        name: "query_tickets",
        arguments: { from: "上海", to: "南京" },
      });
      assert.ok(JSON.stringify(result).includes("南京"));
    } finally {
      await connected.client.close();
    }
  } finally {
    listener.closeAllConnections();
    listener.close();
  }
});
