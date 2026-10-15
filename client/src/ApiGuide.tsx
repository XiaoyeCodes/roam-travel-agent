import { ArrowRight, ArrowUpRight, Check } from "lucide-react";
import type { PublicConfig } from "../../shared/types";

export const KEY_GUIDES = {
  apiKey: {
    name: "DeepSeek 大模型",
    apply: "https://platform.deepseek.com/api_keys",
    docs: "https://api-docs.deepseek.com/zh-cn/",
    action: "申请 DeepSeek API Key",
    field: "大模型 → API Key",
    instructions:
      "登录 DeepSeek 开放平台，在 API keys 中创建密钥，复制到 API Key。使用其他兼容模型时，请到对应服务商的控制台申请。",
    tab: "model",
    configured: "hasLlmKey",
  },
  amapKey: {
    name: "高德地图",
    apply: "https://console.amap.com/dev/key/app",
    docs: "https://lbs.amap.com/api/mcp-server/create-project-and-key",
    action: "申请高德 Key",
    field: "外部工具 → 高德 Web 服务 Key",
    instructions:
      "登录控制台，进入「应用管理 → 我的应用」，创建应用并添加 Key，服务平台选择「Web 服务」。复制生成的 Key 填入这里。",
    tab: "tools",
    configured: "hasAmapKey",
  },
  unsplashKey: {
    name: "Unsplash 图片",
    apply: "https://unsplash.com/oauth/applications",
    docs: "https://unsplash.com/documentation#creating-a-developer-account",
    action: "申请 Unsplash Access Key",
    field: "外部工具 → Access Key",
    instructions:
      "项目维护者登录开发者平台，创建应用（New Application），在应用的 Keys 中复制 Access Key。此处填写 Access Key，Secret Key 不用于图片搜索。",
    tab: "tools",
    configured: "hasUnsplashKey",
  },
  searchKey: {
    name: "Tavily 网页搜索",
    apply: "https://app.tavily.com/",
    docs: "https://docs.tavily.com/documentation/quickstart",
    action: "申请 Tavily API Key",
    field: "外部工具 → Tavily API Key",
    instructions:
      "登录 Tavily 控制台，在 API Keys 中复制或创建密钥，填入 Tavily API Key，用于搜索公开旅行攻略。",
    tab: "tools",
    configured: "hasSearchKey",
  },
} as const;

export function KeyApplicationLinks({
  service,
}: {
  service: keyof typeof KEY_GUIDES;
}) {
  const guide = KEY_GUIDES[service];
  return (
    <div className="key-application-help">
      <div className="key-application-links">
        <a href={guide.apply} target="_blank" rel="noopener noreferrer">
          {guide.action}
          <ArrowUpRight size={13} />
        </a>
        <a href={guide.docs} target="_blank" rel="noopener noreferrer">
          官方指南
          <ArrowUpRight size={12} />
        </a>
      </div>
      <p>{guide.instructions}</p>
    </div>
  );
}

export default function ApiGuide({
  config,
  onConfigure,
}: {
  config: PublicConfig;
  onConfigure: (tab: "model" | "tools" | "mcp") => void;
}) {
  return (
    <div className="api-guide">
      <div className="api-guide-intro">
        <h3>API Key 申请与接入</h3>
        <p>申请链接在新标签页打开。取得密钥后，回到对应字段填写并保存。</p>
      </div>
      {Object.entries(KEY_GUIDES).map(([key, guide]) => (
        <article className="api-guide-card" key={key}>
          <div className="api-guide-heading">
            <h3>{guide.name}</h3>
            <span className={`pill ${config[guide.configured] ? "green" : ""}`}>
              {config[guide.configured] ? (
                <>
                  <Check size={11} /> 已配置
                </>
              ) : (
                "待配置"
              )}
            </span>
          </div>
          <KeyApplicationLinks service={key as keyof typeof KEY_GUIDES} />
          <button
            className="api-guide-configure"
            onClick={() => onConfigure(guide.tab)}
          >
            {guide.field}
            <ArrowRight size={13} />
          </button>
        </article>
      ))}
      <article className="api-guide-card">
        <div className="api-guide-heading">
          <h3>Open-Meteo 天气</h3>
          <span className="pill green">已内置</span>
        </div>
        <p>
          当前天气服务无需填写 Key，可直接查询预报。超出预报范围时会显示待查询。
        </p>
        <a
          className="api-guide-link"
          href="https://open-meteo.com/en/docs"
          target="_blank"
          rel="noopener noreferrer"
        >
          Open-Meteo 官方文档
          <ArrowUpRight size={13} />
        </a>
      </article>
      <article className="api-guide-card">
        <div className="api-guide-heading">
          <h3>铁路与机票 MCP</h3>
          <span className="pill">服务接入</span>
        </div>
        <p>
          铁路可参考下方社区项目部署，再填入服务启动后提供的 HTTP / SSE
          地址。机票需要单独接入服务商提供的 MCP 地址；Bearer Token
          按该服务的要求填写。
        </p>
        <a
          className="api-guide-link"
          href="https://github.com/Joooook/12306-mcp"
          target="_blank"
          rel="noopener noreferrer"
        >
          12306 MCP 社区项目与部署说明
          <ArrowUpRight size={13} />
        </a>
        <button
          className="api-guide-configure"
          onClick={() => onConfigure("mcp")}
        >
          MCP 服务 → 添加服务
          <ArrowRight size={13} />
        </button>
      </article>
    </div>
  );
}
