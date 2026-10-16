import { useEffect, useRef, useState } from "react";
import {
  MapPin,
  LoaderCircle,
  ArrowUpRight,
  RefreshCw,
  Info,
} from "lucide-react";
import type { Job, Plan } from "../../shared/types";
import { DAY_COLORS } from "../../shared/types";
import { api } from "./api";
import {
  installMapRuntime,
  type InteractiveMapData,
} from "../../shared/interactive-map";
export default function MapView({
  plan,
  day = 0,
  compact = false,
  onUpdated,
}: {
  plan: Plan;
  day?: number;
  compact?: boolean;
  onUpdated?: (job: Job) => void;
}) {
  const mapHost = useRef<HTMLDivElement>(null);
  const [interactiveState, setInteractiveState] = useState({
    state: "loading",
    message: "",
  });
  const [mapAttempt, setMapAttempt] = useState(0);
  const [map, setMap] = useState<{
      kind: string;
      image: string;
      caption: string;
      missing: string[];
      interactive?: InteractiveMapData;
      stops?: {
        day: number;
        index: number;
        name: string;
        location: [number, number] | null;
        note?: string;
      }[];
    } | null>(null),
    [error, setError] = useState(""),
    [repairing, setRepairing] = useState(false),
    [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setMap(null);
    setError("");
    api(`/trips/${plan.id}/map${day ? `?day=${day}` : ""}`)
      .then((r) => {
        if (active) setMap(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [plan.id, day, version, plan.photoUpdatedAt, plan.revision]);
  useEffect(() => {
    if (!map || !mapHost.current) return;
    const controller = installMapRuntime().create(
      mapHost.current,
      map.interactive || { key: "", points: [], day },
      (state, message) => setInteractiveState({ state, message }),
    );
    return () => controller.destroy();
  }, [map, mapAttempt, day]);
  async function repair() {
    setRepairing(true);
    try {
      await api(`/trips/${plan.id}/locations`, {
        method: "POST",
        body: JSON.stringify(day ? { day } : {}),
      });
      if (onUpdated) onUpdated(await api<Job>(`/trips/${plan.id}`));
      setVersion((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRepairing(false);
    }
  }
  const days = plan.days.filter((d) => !day || d.day === day);
  return (
    <div className={`map-panel ${compact ? "compact" : ""}`}>
      <div className="section-heading">
        <div className="inline">
          <MapPin size={18} />
          <h3>{day ? `第 ${day} 天 · 景点分布` : "把风景，连成旅程"}</h3>
        </div>
        <span className="pill">
          {interactiveState.state === "ready"
            ? "高德交互地图"
            : map?.kind === "amap"
              ? "高德地图"
              : plan.mode === "demo"
                ? "演示示意"
                : "地图预览"}
        </span>
      </div>
      <div
        className={`map-image roam-map-frame ${interactiveState.state === "ready" && map ? "has-live-map" : ""}`}
      >
        {!map && !error ? (
          <div className="map-loading">
            <LoaderCircle className="spin" size={24} />
            <span>正在准备地图</span>
          </div>
        ) : error ? (
          <div className="map-loading">
            <Info size={24} />
            <p>{error}</p>
            <button
              className="text-btn"
              onClick={() => setVersion(version + 1)}
            >
              <RefreshCw size={14} />
              重试
            </button>
          </div>
        ) : (
          <>
            <img
              className="map-fallback"
              src={map!.image}
              alt={
                day ? `第 ${day} 天景点位置与游览顺序` : "整个行程的景点分布"
              }
            />
            <div ref={mapHost} />
          </>
        )}
      </div>
      {map && (
        <div className="roam-map-status" role="status">
          {interactiveState.message}
          {interactiveState.state === "error" && (
            <button
              className="text-btn"
              onClick={() => setMapAttempt((v) => v + 1)}
            >
              重试交互地图
            </button>
          )}
        </div>
      )}
      <div className="map-legend">
        {days.map((d) => (
          <span key={d.day}>
            <i
              style={{
                background: DAY_COLORS[(d.day - 1) % DAY_COLORS.length],
              }}
            />
            DAY {d.day}
          </span>
        ))}
      </div>
      {map && (
        <p className="map-caption">
          <Info size={13} />
          {interactiveState.state === "ready"
            ? "编号对应当天行程，连线仅表示游览顺序；未核验的地点不在地图上标注。"
            : map.caption}
        </p>
      )}
      {map && (
        <div className="map-repair">
          <span>
            {map.missing.length
              ? `${map.missing.length} 个地点尚无坐标，暂未标注`
              : "编号对应当天行程"}
          </span>
          <button className="text-btn" disabled={repairing} onClick={repair}>
            <RefreshCw size={13} className={repairing ? "spin" : ""} />
            {repairing ? "正在核验" : "重新核验"}
          </button>
        </div>
      )}
      {map && compact && (
        <ol className="compact-map-stops">
          {map.stops?.map((s) => (
            <li key={`${s.day}-${s.index}`} title={s.note}>
              <b
                style={{
                  background: DAY_COLORS[(s.day - 1) % DAY_COLORS.length],
                }}
              >
                {s.index}
              </b>
              {s.location ? (
                <a
                  href={`https://uri.amap.com/marker?position=${s.location.join(",")}&name=${encodeURIComponent(s.name)}&coordinate=gaode&callnative=0`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {s.name} ↗
                </a>
              ) : (
                <span>{s.name}</span>
              )}
            </li>
          ))}
        </ol>
      )}
      {!compact && (
        <div className="map-stops">
          {days.map((d) => (
            <div key={d.day}>
              <h4
                style={{ color: DAY_COLORS[(d.day - 1) % DAY_COLORS.length] }}
              >
                DAY {d.day} <span>{d.title}</span>
              </h4>
              {d.stops.map((original, i) => {
                const updated = map?.stops?.find(
                  (s) => s.day === d.day && s.index === i + 1,
                );
                const s = updated
                  ? {
                      ...original,
                      location: updated.location,
                      verified: !!updated.location,
                    }
                  : original;
                return (
                  <div className="map-stop" key={`${i}-${s.name}`}>
                    <span
                      className="map-index"
                      style={{
                        background: DAY_COLORS[(d.day - 1) % DAY_COLORS.length],
                      }}
                    >
                      {i + 1}
                    </span>
                    <span>{s.name}</span>
                    {s.verified && s.location ? (
                      <a
                        href={`https://uri.amap.com/marker?position=${s.location.join(",")}&name=${encodeURIComponent(s.name)}&coordinate=gaode&callnative=0`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        高德打开 <ArrowUpRight size={13} />
                      </a>
                    ) : (
                      <small>
                        {plan.mode === "demo" ? "演示地点" : "坐标待核验"}
                      </small>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
