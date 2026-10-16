import { useEffect, useRef, useState } from "react";
import {
  X,
  Check,
  ArrowUpRight,
  LoaderCircle,
  Plug,
  Cpu,
  KeyRound,
  Trash2,
  Plus,
  Eye,
  EyeOff,
  Globe2,
} from "lucide-react";
import { AGENTS, type PublicConfig, type AgentId } from "../../shared/types";
import { api } from "./api";
import ApiGuide, { KeyApplicationLinks } from "./ApiGuide";
import TicketServices from "./TicketServices";
type Props = {
  config: PublicConfig;
  onClose: () => void;
  onSaved: (config: PublicConfig) => void;
  notify: (message: string) => void;
};
export default function Settings({ config, onClose, onSaved, notify }: Props) {
  const [tab, setTab] = useState<"model" | "tools" | "mcp" | "resources">(
    "model",
  );
  const [values, setValues] = useState({
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: "",
    amapKey: "",
    amapJsKey: "",
    amapJsSecurityCode: "",
    unsplashKey: "",
    searchKey: "",
  });
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [visible, setVisible] = useState(false);
  const [mcp, setMcp] = useState({
    id: "",
    name: "",
    url: "",
    token: "",
    transport: "http" as "http" | "sse",
    roles: ["transport"] as AgentId[],
  });
  const dialog = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useEffect(() => {
    content.current?.scrollTo({ top: 0 });
  }, [tab]);
  useEffect(() => {
    const before = document.activeElement as HTMLElement;
    dialog.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const list = dialog.current?.querySelectorAll<HTMLElement>(
          "button:not([disabled]),input,select,a[href]",
        );
        if (!list?.length) return;
        const first = list[0],
          last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
      before?.focus();
    };
  }, [onClose]);
  async function save() {
    setBusy("save");
    setError("");
    try {
      const c = await api<PublicConfig>("/config", {
        method: "PATCH",
        body: JSON.stringify(values),
      });
      onSaved(c);
      setValues((v) => ({
        ...v,
        apiKey: "",
        amapKey: "",
        amapJsKey: "",
        amapJsSecurityCode: "",
        unsplashKey: "",
        searchKey: "",
      }));
      notify("设置已保存，下一次规划将使用新配置");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function test() {
    setBusy("test");
    setError("");
    try {
      const c = await api<PublicConfig>("/config", {
        method: "PATCH",
        body: JSON.stringify(values),
      });
      onSaved(c);
      const r = await api("/config/test", { method: "POST", body: "{}" });
      notify(`${r.model} 连接成功 · ${(r.latencyMs / 1000).toFixed(1)} 秒`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function addMcp() {
    setBusy("mcp");
    setError("");
    try {
      const c = await api<PublicConfig>("/config", {
        method: "PATCH",
        body: JSON.stringify({ mcpServer: mcp }),
      });
      onSaved(c);
      notify("MCP 服务已添加");
      setMcp({
        id: "",
        name: "",
        url: "",
        token: "",
        transport: "http",
        roles: ["transport"],
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function remove(id: string) {
    try {
      onSaved(
        await api("/config", {
          method: "PATCH",
          body: JSON.stringify({ removeMcpId: id }),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function testMcp(id: string) {
    setBusy(id);
    setError("");
    try {
      const r = await api(`/mcp/${id}/test`, { method: "POST", body: "{}" });
      notify(`连接成功 · ${r.tools.length} 个只读查询工具`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  const secretField = (
    key:
      | "apiKey"
      | "amapKey"
      | "amapJsKey"
      | "amapJsSecurityCode"
      | "unsplashKey"
      | "searchKey",
    label: string,
    exists: boolean,
  ) => (
    <label className="field">
      <span>
        {label}
        {exists && (
          <em>
            <Check size={12} />
            已配置
          </em>
        )}
      </span>
      <div className="secret">
        <input
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          value={values[key]}
          placeholder={exists ? "已安全保存，留空保留原值" : "填写你的 Key"}
          onChange={(e) => setValues({ ...values, [key]: e.target.value })}
        />
        <button
          type="button"
          className="icon-btn"
          aria-label={visible ? "隐藏密钥" : "显示密钥"}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </label>
  );
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="settings-modal"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
      >
        <div className="modal-head">
          <div>
            <div className="eyebrow">MAKE IT YOURS</div>
            <h2 id="settings-title">模型与工具</h2>
            <p>为你的随行团队，连接更大的世界。</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭设置">
            <X size={21} />
          </button>
        </div>
        <div className="settings-tabs">
          {(
            [
              { id: "model", label: "大模型", icon: Cpu },
              { id: "tools", label: "外部工具", icon: KeyRound },
              { id: "mcp", label: "MCP 服务", icon: Plug },
              { id: "resources", label: "申请入口", icon: Globe2 },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? "active" : ""}
              onClick={() => setTab(t.id)}
            >
              <t.icon size={16} />
              {t.label}
            </button>
          ))}
        </div>
        <div className="settings-content" ref={content}>
          {tab === "resources" && (
            <ApiGuide config={config} onConfigure={setTab} />
          )}
          {tab === "model" && (
            <>
              <div className="provider-banner">
                <div className="provider-icon">D</div>
                <div>
                  <strong>OpenAI 兼容接口</strong>
                  <p>DeepSeek 及其他兼容模型，随时切换。</p>
                </div>
                <span className={`pill ${config.hasLlmKey ? "green" : ""}`}>
                  {config.hasLlmKey ? "已配置" : "待连接"}
                </span>
              </div>
              <label className="field">
                <span>服务地址 · Base URL</span>
                <input
                  value={values.baseUrl}
                  onChange={(e) =>
                    setValues({ ...values, baseUrl: e.target.value })
                  }
                  placeholder="https://api.deepseek.com"
                />
              </label>
              <label className="field">
                <span>模型名称</span>
                <input
                  value={values.model}
                  onChange={(e) =>
                    setValues({ ...values, model: e.target.value })
                  }
                  placeholder="deepseek-flash"
                />
              </label>
              {secretField("apiKey", "API Key", config.hasLlmKey)}
              <KeyApplicationLinks service="apiKey" />
              <div className="gentle-note">
                <KeyRound size={16} />
                <span>
                  密钥只保存在本机后端，不会传回浏览器。规划请求将发送给你配置的模型服务。
                </span>
              </div>
            </>
          )}
          {tab === "tools" && (
            <div className="tool-settings">
              <div>
                <h3>高德地图</h3>
                <p>
                  POI、地点实景照片、酒店、餐馆、自驾路线和 HTML 每日地图。填入
                  Web 服务 Key 后自动启用高德 MCP。
                </p>
                {secretField("amapKey", "高德 Web 服务 Key", config.hasAmapKey)}
                <KeyApplicationLinks service="amapKey" />
                {secretField(
                  "amapJsKey",
                  "网页端 JS API Key · 交互地图",
                  !!config.hasAmapJsKey,
                )}
                {secretField(
                  "amapJsSecurityCode",
                  "JS API 安全密钥 · 新申请的 Key 需填写",
                  !!config.hasAmapJsSecurityCode,
                )}
                <div className="key-application-help">
                  <div className="key-application-links">
                    <a
                      href="https://console.amap.com/dev/key/app"
                      target="_blank"
                      rel="noreferrer"
                    >
                      申请 Web 端（JS API）Key ↗
                    </a>
                    <a
                      href="https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode"
                      target="_blank"
                      rel="noreferrer"
                    >
                      安全密钥与域名配置说明 ↗
                    </a>
                  </div>
                  <p>
                    网页端 Key 用于拖动、缩放和点击地图；上方 Web 服务 Key
                    用于智能体检索地点。JS
                    配置会随交互地图提供给浏览器，并写入导出的
                    HTML；请使用专用网页端
                    Key，按需设置域名白名单。修改后刷新页面生效。
                  </p>
                </div>
              </div>
              <div>
                <h3>Unsplash 图片</h3>
                <p>
                  优先使用高德匹配地点的照片，Unsplash
                  补充风景与菜品配图并保留署名。已有行程可点击「补全图片」更新；南京示例另有精选照片。
                </p>
                {secretField(
                  "unsplashKey",
                  "Access Key",
                  config.hasUnsplashKey,
                )}
                <KeyApplicationLinks service="unsplashKey" />
                <div className="key-application-help">
                  <div className="key-application-links">
                    <a
                      href="https://ssyer.com/home"
                      target="_blank"
                      rel="noreferrer"
                    >
                      沙沙野 · 国内免费素材 ↗
                    </a>
                    <a
                      href="https://pixabay.com/zh/service/about/api/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Pixabay · 免费 API 备选 ↗
                    </a>
                  </div>
                  <p>
                    沙沙野适合手动挑选并核对单张授权，未接入自动搜索；Pixabay
                    为海外图库。高德地点照片已自动接入，接口额度以控制台为准，图片本身不代表
                    CC0 授权。
                  </p>
                </div>
              </div>
              <div>
                <h3>Web Search</h3>
                <p>查询可被搜索引擎索引的小红书、携程与公开攻略。</p>
                {secretField(
                  "searchKey",
                  "Tavily API Key",
                  config.hasSearchKey,
                )}
                <KeyApplicationLinks service="searchKey" />
              </div>
              <div className="gentle-note">
                <Check size={17} />
                <span>
                  天气已内置 Open-Meteo，无需
                  Key。超出预报窗口的日期会保留待查询状态。
                </span>
              </div>
            </div>
          )}
          {tab === "mcp" && (
            <>
              <TicketServices />
              <p className="muted">
                可选：添加其他查询服务。支持 Streamable HTTP 与
                SSE；每个服务只分配给指定专家。
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
              {config.mcpServers.map((s) => (
                <div className="mcp-row" key={s.id}>
                  <Plug size={20} />
                  <div>
                    <strong>{s.name}</strong>
                    <p>
                      {s.transport.toUpperCase()} ·{" "}
                      {s.roles
                        .map((r) => AGENTS.find((a) => a.id === r)?.short)
                        .join(" / ")}
                    </p>
                  </div>
                  <button
                    className="text-btn"
                    disabled={!!busy}
                    onClick={() => testMcp(s.id)}
                  >
                    {busy === s.id ? "测试中" : "测试"}
                  </button>
                  <button
                    className="icon-btn"
                    onClick={() => remove(s.id)}
                    aria-label={`移除 ${s.name}`}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
              <div className="mcp-form">
                <h3>
                  <Plus size={16} />
                  添加服务
                </h3>
                <div className="form-grid two">
                  <label className="field">
                    <span>服务标识</span>
                    <input
                      value={mcp.id}
                      placeholder="rail"
                      onChange={(e) => setMcp({ ...mcp, id: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>显示名称</span>
                    <input
                      value={mcp.name}
                      placeholder="12306 铁路"
                      onChange={(e) => setMcp({ ...mcp, name: e.target.value })}
                    />
                  </label>
                </div>
                <label className="field">
                  <span>服务地址</span>
                  <input
                    value={mcp.url}
                    placeholder="http://127.0.0.1:8000/mcp"
                    onChange={(e) => setMcp({ ...mcp, url: e.target.value })}
                  />
                </label>
                <div className="form-grid two">
                  <label className="field">
                    <span>传输协议</span>
                    <select
                      value={mcp.transport}
                      onChange={(e) =>
                        setMcp({
                          ...mcp,
                          transport: e.target.value as "http" | "sse",
                        })
                      }
                    >
                      <option value="http">Streamable HTTP</option>
                      <option value="sse">SSE</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Bearer Token · 可选</span>
                    <input
                      type="password"
                      value={mcp.token}
                      onChange={(e) =>
                        setMcp({ ...mcp, token: e.target.value })
                      }
                    />
                  </label>
                </div>
                <span className="label-text">分配专家</span>
                <div className="chips">
                  {AGENTS.map((a) => (
                    <button
                      className={
                        mcp.roles.includes(a.id) ? "chip selected" : "chip"
                      }
                      key={a.id}
                      onClick={() =>
                        setMcp({
                          ...mcp,
                          roles: mcp.roles.includes(a.id)
                            ? mcp.roles.filter((r) => r !== a.id)
                            : [...mcp.roles, a.id],
                        })
                      }
                    >
                      {a.short}
                    </button>
                  ))}
                </div>
                <button
                  className="button primary small"
                  disabled={!!busy || !mcp.id || !mcp.url || !mcp.roles.length}
                  onClick={addMcp}
                >
                  <Plus size={15} />
                  添加 MCP
                </button>
              </div>
              <p className="fineprint">
                内置 12306 与 fast-flights
                分别查询高铁和机票；上方外部服务为可选扩展。仅开放查询，不自动下单。
              </p>
            </>
          )}
          {error && (
            <div role="alert" className="error-banner">
              {error}
            </div>
          )}
        </div>
        {(tab === "model" || tab === "tools") && (
          <div className="modal-footer">
            <button
              className="button secondary"
              disabled={!!busy}
              onClick={test}
            >
              {busy === "test" ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Plug size={16} />
              )}
              测试模型连接
            </button>
            <button className="button primary" disabled={!!busy} onClick={save}>
              {busy === "save" ? (
                <LoaderCircle size={16} className="spin" />
              ) : (
                <Check size={16} />
              )}
              保存设置
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
