import { spawn } from "node:child_process";
import { getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ChildProcess } from "node:child_process";

const children = new Set<ChildProcess>();
export function stopTicketProcesses() {
  for (const child of children) child.kill();
}
process.once("exit", stopTicketProcesses);

export function ticketEnvironment() {
  const env = getDefaultEnvironment();
  for (const key of [
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "NO_PROXY",
    "https_proxy",
    "http_proxy",
    "no_proxy",
    "SSL_CERT_FILE",
    "REQUESTS_CA_BUNDLE",
  ])
    if (process.env[key]) env[key] = process.env[key]!;
  return { ...env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };
}

export function waitForTicket<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error("查询已取消"));
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

export function runTicketProcess(
  command: string,
  args: string[],
  options: {
    cwd: string;
    input?: unknown;
    timeout?: number;
    signal?: AbortSignal;
  },
): Promise<string> {
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: ticketEnvironment(),
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
    });
    children.add(child);
    let output = "",
      errorOutput = "",
      failure: Error | undefined;
    const stop = (error: Error) => {
      failure = error;
      child.kill();
    };
    const abort = () => stop(new Error("查询已取消"));
    const timer = setTimeout(
      () => stop(new Error("查询或安装超时，请稍后重试")),
      options.timeout || 45000,
    );
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (data: string) => {
      output += data;
      if (output.length > 2_000_000) stop(new Error("查询返回数据过大"));
    });
    child.stderr.on("data", (data: string) => {
      errorOutput = (errorOutput + data).slice(-2000);
    });
    child.stdin.on("error", () => {});
    child.on("error", (error) => {
      failure = error;
    });
    child.on("close", (code) => {
      children.delete(child);
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (failure) return reject(failure);
      if (code !== 0) {
        try {
          const parsed = JSON.parse(output);
          if (parsed.error) return reject(new Error(parsed.error));
        } catch {
          /* Installer output is not JSON. */
        }
        return reject(
          new Error(`查询进程退出（${code}）：${errorOutput.slice(-600)}`),
        );
      }
      resolve(output.trim());
    });
    child.stdin.end(
      options.input === undefined ? "" : JSON.stringify(options.input),
    );
  });
}
