import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ROOT, DATA_DIR, safeError } from "./config.js";
import {
  runTicketProcess,
  ticketEnvironment,
  stopTicketProcesses,
} from "./ticket-process.js";
import type { TicketServiceStatus } from "../../shared/tickets.js";

const require = createRequire(import.meta.url);
const disabled = () => process.env.ROAM_TICKETS_DISABLED === "1";
const state: Record<"rail" | "flight", TicketServiceStatus> = {
  rail: {
    name: "12306 高铁",
    state: "starting",
    message: "随应用自动启动，无需 Key",
  },
  flight: {
    name: "fast-flights 机票",
    state: "starting",
    message: "自动准备查询环境，无需 Key",
  },
};
let rail: Client | undefined, railStart: Promise<Client> | undefined;
let startingRail: Client | undefined;
let railTransport: StdioClientTransport | undefined;
process.once("exit", () => {
  if (railTransport?.pid) {
    try {
      process.kill(railTransport.pid);
    } catch {
      /* Already exited. */
    }
  }
});
let flightStart: Promise<string> | undefined;
let stopping = false;
const setupController = new AbortController();
let flightFailureAt = 0,
  railFailureAt = 0;
const pythonPath = path.join(
  DATA_DIR,
  "travel-venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const flightProbe =
  "import fast_flights; from importlib.metadata import version; assert version('fast-flights') == '3.1.0'; print('ready')";
function run(command: string, args: string[], timeout = 180000) {
  return runTicketProcess(command, args, {
    cwd: ROOT,
    timeout,
    signal: setupController.signal,
  });
}
export function ticketServiceStatus() {
  return structuredClone(
    disabled()
      ? {
          rail: {
            ...state.rail,
            state: "disabled",
            message: "内置票务查询已关闭",
          },
          flight: {
            ...state.flight,
            state: "disabled",
            message: "内置票务查询已关闭",
          },
        }
      : state,
  );
}
export function recordTicketQuery(
  kind: "rail" | "flight",
  count: number,
  error?: string,
) {
  state[kind].lastQuery = {
    at: new Date().toISOString(),
    count,
    ok: !error,
    ...(error ? { error } : {}),
  };
}
export async function ensureRail(): Promise<Client> {
  if (disabled() || stopping) throw new Error("内置铁路服务已关闭");
  if (rail) return rail;
  if (railStart) return railStart;
  if (Date.now() - railFailureAt < 30000) throw new Error(state.rail.message);
  state.rail = {
    ...state.rail,
    state: "starting",
    message: "正在启动 12306 查询服务",
  };
  railStart = (async () => {
    const client = new Client({ name: "roam-rail", version: "1.0.0" });
    startingRail = client;
    try {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [require.resolve("12306-mcp")],
        cwd: ROOT,
        env: ticketEnvironment(),
        stderr: "pipe",
      });
      railTransport = transport;
      // Drain provider diagnostics without exposing upstream cookies/response bodies.
      transport.stderr?.on("data", () => {});
      client.onclose = () => {
        if (rail !== client) return;
        rail = undefined;
        state.rail = {
          ...state.rail,
          state: "error",
          message: "服务已断开，下次查询自动重连",
        };
      };
      await client.connect(transport, { timeout: 60000 });
      const tools = await client.listTools({}, { timeout: 15000 });
      if (!tools.tools.some((t) => t.name === "get-tickets"))
        throw new Error("12306 服务缺少查票工具");
      if (stopping) throw new Error("应用正在关闭");
      rail = client;
      state.rail = {
        ...state.rail,
        state: "ready",
        message: "已自动启动，查询时获取实时铁路数据",
      };
      return client;
    } catch (error) {
      await client.close().catch(() => {});
      railFailureAt = Date.now();
      state.rail = {
        ...state.rail,
        state: "error",
        message: `铁路服务启动失败：${safeError(error)}`,
      };
      throw new Error(state.rail.message);
    } finally {
      railStart = undefined;
      startingRail = undefined;
    }
  })();
  return railStart;
}
export async function ensureFlightPython(): Promise<string> {
  if (disabled() || stopping) throw new Error("内置机票服务已关闭");
  if (flightStart) return flightStart;
  if (Date.now() - flightFailureAt < 30000)
    throw new Error(state.flight.message);
  state.flight = {
    ...state.flight,
    state: "starting",
    message: "正在检查机票查询环境",
  };
  flightStart = (async () => {
    try {
      try {
        await run(pythonPath, ["-X", "utf8", "-c", flightProbe], 10000);
      } catch {
        state.flight.message = "首次启动正在安装免费机票查询组件";
        let uv = false;
        try {
          await run("uv", ["--version"], 10000);
          uv = true;
        } catch {
          /* Try system Python. */
        }
        if (!fs.existsSync(pythonPath)) {
          if (uv)
            await run("uv", [
              "venv",
              "--python",
              "3.12",
              path.dirname(path.dirname(pythonPath)),
            ]);
          else {
            let created = false;
            for (const [command, ...prefix] of process.platform === "win32"
              ? [["py", "-3"], ["python"]]
              : [["python3"], ["python"]]) {
              try {
                await run(
                  command,
                  [
                    ...prefix,
                    "-c",
                    "import sys; assert sys.version_info >= (3,10)",
                  ],
                  10000,
                );
                await run(command, [
                  ...prefix,
                  "-m",
                  "venv",
                  path.dirname(path.dirname(pythonPath)),
                ]);
                created = true;
                break;
              } catch {
                setupController.signal.throwIfAborted();
              }
            }
            if (!created)
              throw new Error(
                "需要 Python 3.10+ 或 uv；安装后重启应用即可自动接入",
              );
          }
        }
        const requirements = path.join(
          ROOT,
          "server",
          "python",
          "requirements.txt",
        );
        if (uv)
          await run("uv", [
            "pip",
            "install",
            "--python",
            pythonPath,
            "-r",
            requirements,
          ]);
        else
          await run(pythonPath, [
            "-m",
            "pip",
            "install",
            "--disable-pip-version-check",
            "-r",
            requirements,
          ]);
        await run(pythonPath, ["-X", "utf8", "-c", flightProbe], 15000);
      }
      state.flight = {
        ...state.flight,
        state: "ready",
        message: "免费查询组件已就绪，查询时连接 Google Flights",
      };
      return pythonPath;
    } catch (error) {
      flightFailureAt = Date.now();
      state.flight = {
        ...state.flight,
        state: "error",
        message: `机票环境准备失败：${safeError(error)}`,
      };
      flightStart = undefined;
      throw new Error(state.flight.message);
    }
  })();
  return flightStart;
}
export function startTicketServices() {
  if (disabled()) return;
  void Promise.allSettled([ensureRail(), ensureFlightPython()]);
}
export async function stopTicketServices() {
  stopping = true;
  setupController.abort();
  stopTicketProcesses();
  await startingRail?.close().catch(() => {});
  await rail?.close().catch(() => {});
  rail = undefined;
}
