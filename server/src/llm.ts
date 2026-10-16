import type { Config } from "./config.js";
export type Message = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
};
type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};
// Callers that produce structured results can repair these without treating
// an incomplete model answer as a connection or credentials failure.
export class ModelOutputError extends Error {
  constructor(public reason: "length" | "empty") {
    super(
      reason === "length" ? "模型回答尚未完整生成。" : "模型没有返回有效内容。",
    );
  }
}
export type ToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};
export async function completion(
  config: Config,
  messages: Message[],
  opts: {
    tools?: ToolDef[];
    json?: boolean;
    maxTokens?: number;
    signal?: AbortSignal;
  } = {},
) {
  if (!config.apiKey)
    throw new Error("请先在模型与工具设置中填写模型 API Key。");
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  let last: Error = new Error("模型请求失败");
  for (let attempt = 0; attempt < 2; attempt++) {
    opts.signal?.throwIfAborted();
    try {
      const signal = opts.signal
        ? AbortSignal.any([opts.signal, AbortSignal.timeout(180000)])
        : AbortSignal.timeout(180000);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          temperature: 0.6,
          max_tokens: opts.maxTokens || 2400,
          ...(opts.json ? { response_format: { type: "json_object" } } : {}),
          ...(opts.tools?.length
            ? { tools: opts.tools, tool_choice: "auto" }
            : {}),
          ...(new URL(config.baseUrl).hostname === "api.deepseek.com"
            ? { thinking: { type: "disabled" } }
            : {}),
        }),
        signal,
      });
      if (!response.ok) {
        const detail =
          response.status === 401
            ? "API Key 无效"
            : response.status === 402
              ? "账户余额不足"
              : response.status === 429
                ? "请求频率超限"
                : response.status === 404
                  ? "模型或服务地址不存在"
                  : `HTTP ${response.status}`;
        if (
          (response.status === 429 || response.status >= 500) &&
          attempt === 0
        ) {
          await new Promise((r) => setTimeout(r, 1200));
          continue;
        }
        throw new Error(`模型服务请求失败：${detail}。`);
      }
      const data = (await response.json()) as {
        choices?: { message: Message; finish_reason?: string }[];
        usage?: unknown;
      };
      if (!data.choices?.[0]?.message) throw new ModelOutputError("empty");
      if (data.choices[0].finish_reason === "length")
        throw new ModelOutputError("length");
      if (
        opts.json &&
        (typeof data.choices[0].message.content !== "string" ||
          !data.choices[0].message.content?.trim())
      )
        throw new ModelOutputError("empty");
      return data.choices[0].message;
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      last = e instanceof Error ? e : new Error("模型连接失败");
      if (attempt === 1 || !/fetch|timeout|network/i.test(last.message))
        throw last;
    }
  }
  throw last;
}
export function parseJson(content: string | null) {
  if (!content) throw new Error("模型返回为空");
  return JSON.parse(
    content.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, ""),
  );
}
