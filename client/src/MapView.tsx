import { useEffect, useState } from "react";
import {
  MapPin,
  LoaderCircle,
  ArrowUpRight,
  RefreshCw,
  Info,
} from "lucide-react";
import type { Plan } from "../../shared/types";
import { DAY_COLORS } from "../../shared/types";
import { api } from "./api";
export default function MapView({
  plan,
  day = 0,
  compact = false,
}: {
  plan: Plan;
  day?: number;
  compact?: boolean;
}) {
  const [map, setMap] = useState<{
      kind: string;
      image: string;
      caption: string;
      missing: string[];
    } | null>(null),
    [error, setError] = useState(""),
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
  }, [plan.id, day, version]);
  const days = plan.days.filter((d) => !day || d.day === day);
  return (
    <div className={`map-panel ${compact ? "compact" : ""}`}>
      <div className="section-heading">
        <div className="inline">
          <MapPin size={18} />
          <h3>{day ? `第 ${day} 天 · 景点分布` : "把风景，连成旅程"}</h3>
        </div>
        <span className="pill">
          {map?.kind === "amap"
            ? "高德地图"
            : plan.mode === "demo"
              ? "演示示意"
              : "地图预览"}
        </span>
      </div>
      <div className="map-image">
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
          <img
            src={map!.image}
            alt={day ? `第 ${day} 天景点位置与游览顺序` : "整个行程的景点分布"}
          />
        )}
      </div>
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
          {map.caption}
        </p>
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
              {d.stops.map((s, i) => (
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
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
