import { useEffect, useRef, useState } from "react";
import { LoaderCircle, TrainFront, Plane } from "lucide-react";
import type { Evidence } from "../../shared/types";
import type { TicketData, TicketServiceStatus } from "../../shared/tickets";
import { api } from "./api";

export default function TicketServices() {
  const [services, setServices] =
    useState<Record<"rail" | "flight", TicketServiceStatus>>();
  const [origin, setOrigin] = useState("上海"),
    [destination, setDestination] = useState("北京");
  const [date, setDate] = useState(() =>
    new Date(Date.now() + 7 * 86400000 + 8 * 3600000)
      .toISOString()
      .slice(0, 10),
  );
  const [busy, setBusy] = useState(""),
    [error, setError] = useState("");
  const [result, setResult] = useState<Evidence & { data: TicketData }>();
  const request = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = () =>
      api("/tickets/status", { signal: controller.signal })
        .then(setServices)
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        });
    void refresh();
    const timer = setInterval(refresh, 4000);
    return () => {
      clearInterval(timer);
      controller.abort();
      request.current?.abort();
    };
  }, []);
  async function query(kind: "rail" | "flight") {
    const controller = new AbortController();
    request.current = controller;
    setBusy(kind);
    setError("");
    setResult(undefined);
    try {
      const evidence = await api<Evidence>(`/tickets/${kind}/query`, {
        method: "POST",
        body: JSON.stringify({
          origin,
          destination,
          date,
          passengers: 1,
          limit: 5,
        }),
        signal: controller.signal,
      });
      if (evidence.status !== "live")
        throw new Error(
          (evidence.data as { message?: string }).message || "查询失败",
        );
      setResult(evidence as Evidence & { data: TicketData });
      setServices(await api("/tickets/status", { signal: controller.signal }));
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      if (!controller.signal.aborted) setBusy("");
    }
  }
  return (
    <section className="ticket-services" aria-label="免费高铁与机票查询">
      <h3>免费高铁与机票</h3>
      <p className="muted">
        随应用自动准备，无需填写 Key 或服务地址。首次启动可能需要下载查询组件。
      </p>
      <div className="ticket-service-states">
        {(["rail", "flight"] as const).map((kind) => {
          const service = services?.[kind];
          return (
            <div className="ticket-service-state" key={kind}>
              <strong>
                {kind === "rail" ? "12306 高铁" : "fast-flights 机票"}
              </strong>
              <span
                className={`pill ${service?.state === "ready" ? "green" : ""}`}
              >
                {service?.state === "ready"
                  ? "已就绪"
                  : service?.state === "error"
                    ? "需重试"
                    : service?.state === "disabled"
                      ? "已关闭"
                      : "准备中"}
              </span>
              <p>{service?.message || "正在读取服务状态"}</p>
              {service?.lastQuery && (
                <small>
                  {service.lastQuery.ok
                    ? `最近查询返回 ${service.lastQuery.count} 条结果`
                    : "最近查询失败，可稍后重试"}{" "}
                  ·{" "}
                  {new Date(service.lastQuery.at).toLocaleTimeString("zh-CN", {
                    timeZone: "Asia/Shanghai",
                  })}
                </small>
              )}
            </div>
          );
        })}
      </div>
      <div className="form-grid two">
        <label className="field">
          <span>出发地</span>
          <input value={origin} onChange={(e) => setOrigin(e.target.value)} />
        </label>
        <label className="field">
          <span>到达地</span>
          <input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
          />
        </label>
      </div>
      <label className="field">
        <span>出发日期</span>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </label>
      <p className="fineprint">
        试查按 1 位成人、单程查询。高铁覆盖未来 15 天；机票默认直飞，也可填写
        SHA、PEK 等机场代码。
      </p>
      <div className="ticket-query-actions">
        <button
          className="button secondary small"
          disabled={!!busy || !origin || !destination || !date}
          onClick={() => query("rail")}
        >
          {busy === "rail" ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <TrainFront size={16} />
          )}
          实查高铁
        </button>
        <button
          className="button secondary small"
          disabled={!!busy || !origin || !destination || !date}
          onClick={() => query("flight")}
        >
          {busy === "flight" ? (
            <LoaderCircle size={16} className="spin" />
          ) : (
            <Plane size={16} />
          )}
          实查机票
        </button>
      </div>
      {busy && <p role="status">正在联网查询，多个机场可能需要稍等片刻…</p>}
      {error && (
        <div role="alert" className="error-banner">
          {error}
        </div>
      )}
      {result && (
        <div className="ticket-query-result" aria-live="polite">
          <strong>
            {result.data.origin} → {result.data.destination} ·{" "}
            {result.data.date}
          </strong>
          <p className="fineprint">
            {result.source} · 查询于{" "}
            {new Date(result.data.queriedAt).toLocaleString("zh-CN", {
              timeZone: "Asia/Shanghai",
            })}
            （北京时间，结果最多缓存 2 分钟）
          </p>
          {!result.data.count && (
            <p>本次未返回匹配结果，可调整日期、车站或机场后重试。</p>
          )}
          {result.data.results.map((ticket, i) => (
            <article className="ticket-option" key={`${ticket.name}-${i}`}>
              <div>
                <strong>{ticket.name}</strong>
                <span>
                  {ticket.from} → {ticket.to}
                </span>
                <span>
                  {ticket.departure.replace("T", " ")} →{" "}
                  {ticket.arrival.replace("T", " ")}
                </span>
              </div>
              <div>
                <strong>
                  {ticket.price === null
                    ? "票价待确认"
                    : `¥${ticket.price.toLocaleString("zh-CN")}`}
                </strong>
                <small>
                  {ticket.priceBasis === "per_person"
                    ? "二等座 / 人"
                    : "所选人数总价"}
                </small>
                <small>{ticket.availability}</small>
              </div>
            </article>
          ))}
          <p className="fineprint">{result.data.note}</p>
          {result.data.warnings?.map((warning) => (
            <p className="fineprint" key={warning}>
              {warning}
            </p>
          ))}
          <div className="ticket-query-actions">
            {result.data.urls.map((url, index) => (
              <a key={url} href={url} target="_blank" rel="noreferrer">
                查看来源{result.data.urls.length > 1 ? ` ${index + 1}` : ""} ↗
              </a>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
