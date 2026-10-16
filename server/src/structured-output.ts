import type { z } from "zod";
import type { Config } from "./config.js";
import { completion, ModelOutputError, type Message } from "./llm.js";

export const object = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
export const line = (value: unknown, max: number, fallback = ""): string =>
  typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : fallback;
export const strings = (value: unknown, count: number, max: number): string[] =>
  (Array.isArray(value) ? value : typeof value === "string" ? [value] : [])
    .map((item) => line(item, max))
    .filter(Boolean)
    .slice(0, count);

// Do not evaluate model text or guess how to close truncated JSON.
export function readModelJson(content: string | null): unknown {
  const text = content?.trim() || "";
  try {
    return JSON.parse(text);
  } catch {
    /* Try a wrapped JSON object. */
  }
  const start = text.indexOf("{"),
    end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
  throw new Error("回答需要是完整 JSON 对象，不能是空值或说明文字。");
}

function feedback(error: unknown) {
  if (error && typeof error === "object" && "issues" in error) {
    return (error as z.ZodError).issues
      .slice(0, 12)
      .map((issue) => `${issue.path.join(".") || "根对象"}: ${issue.message}`)
      .join("；");
  }
  return error instanceof SyntaxError
    ? "JSON 语法不完整，请重新输出完整对象。"
    : error instanceof Error
      ? error.message
      : "请按给定结构补齐字段。";
}

// Local normalization first, then up to two targeted repairs. Provider errors
// and user cancellation must propagate; only answer-shape problems use fallback.
export async function structuredOutput<T>(options: {
  config: Config;
  messages: Message[];
  schema: z.ZodType<T, z.ZodTypeDef, any>;
  normalize: (value: unknown) => unknown;
  check?: (value: T) => void;
  maxTokens: number;
  signal: AbortSignal;
  progress: (message: string) => void;
  unavailable?: (error: unknown) => void;
}): Promise<T | undefined> {
  const messages = [...options.messages];
  for (let attempt = 0; attempt < 3; attempt++) {
    options.signal.throwIfAborted();
    let response: Message | undefined;
    try {
      response = await completion(options.config, messages, {
        json: true,
        maxTokens: Math.min(24000, options.maxTokens + attempt * 2000),
        signal: options.signal,
      });
    } catch (error) {
      options.signal.throwIfAborted();
      if (!(error instanceof ModelOutputError)) {
        if (!options.unavailable) throw error;
        options.unavailable(error);
        return undefined;
      }
      messages.push({
        role: "user",
        content:
          error.reason === "length"
            ? "上一条回答被截断。请压缩描述，每天仅保留核心安排，输出完整 JSON；不得减少要求的天数。"
            : "上一条回答为空，请按系统要求输出完整 JSON 对象。",
      });
    }
    if (response) {
      try {
        const parsed = options.schema.parse(
          options.normalize(readModelJson(response.content)),
        );
        options.check?.(parsed);
        options.signal.throwIfAborted();
        return parsed;
      } catch (error) {
        options.signal.throwIfAborted();
        // Retain only the latest answer and its concrete correction, avoiding
        // several large invalid answers crowding out the original requirements.
        messages.splice(options.messages.length);
        if (typeof response.content === "string" && response.content.trim())
          messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "user",
          content: `请修正这些具体问题：${feedback(error)}。保持用户需求和已有依据，完整重写 JSON，不要只返回修改字段。控制篇幅，不增加未核实的事实。`,
        });
      }
    }
    if (attempt < 2)
      options.progress(
        `正在自动整理规划内容（${attempt + 1}/2），已查询的资料会保留`,
      );
  }
  options.signal.throwIfAborted();
  return undefined;
}
