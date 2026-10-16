import { useState } from "react";
import { ArrowUpRight, Mountain } from "lucide-react";
import type { TripSummary } from "../../shared/types";
import { photoImageUrl, photoLink, photoSource } from "../../shared/photos";

export default function HistoryCard({
  trip,
  index,
  onOpen,
}: {
  trip: TripSummary;
  index: number;
  onOpen: () => void;
}) {
  const photos = (trip.coverPhotos || [])
    .flatMap((photo) =>
      [photo.url, ...(photo.fallbackUrls || [])].map((url) => ({
        ...photo,
        url: photoImageUrl(url),
      })),
    )
    .filter((p) => p.url);
  return (
    <HistoryCardContent
      key={photos.map((p) => p.url).join("|")}
      trip={trip}
      index={index}
      onOpen={onOpen}
      photos={photos}
    />
  );
}
function HistoryCardContent({
  trip,
  index,
  onOpen,
  photos,
}: {
  trip: TripSummary;
  index: number;
  onOpen: () => void;
  photos: TripSummary["coverPhotos"];
}) {
  const [position, setPosition] = useState(0),
    [loaded, setLoaded] = useState(false),
    photo = photos[position];
  const status =
    trip.mode === "demo"
      ? "演示方案"
      : {
          complete: "已完成",
          running: "规划中",
          awaiting_confirmation: "待你确认",
          error: "未完成",
          cancelled: "已取消",
        }[trip.status];
  let url = photo?.url;
  if (url?.startsWith("https://images.unsplash.com/")) {
    const sized = new URL(url);
    sized.searchParams.set("w", "900");
    sized.searchParams.set("q", "80");
    url = sized.href;
  }
  return (
    <article className="history-card">
      <button
        className="history-open"
        onClick={onOpen}
        aria-label={`打开${trip.destination}旅程：${trip.title || `${trip.destination}旅行计划`}`}
      >
        <div
          className={`history-art tone-${index % 3}${loaded && photo ? " has-photo" : ""}`}
        >
          {photo && (
            <img
              key={photo.url}
              src={url}
              alt={photo.alt}
              loading={index < 6 ? "eager" : "lazy"}
              decoding="async"
              referrerPolicy="no-referrer"
              onLoad={() => setLoaded(true)}
              onError={() => {
                setLoaded(false);
                setPosition((p) => p + 1);
              }}
            />
          )}
          <span>{trip.destination}</span>
          {!loaded && (
            <Mountain size={100} strokeWidth={0.6} aria-hidden="true" />
          )}
          <i>{status}</i>
          {!photo && (
            <small className="history-no-photo">
              {photos.length ? "照片暂不可用" : "目的地照片待补充"}
            </small>
          )}
        </div>
        <div className="history-body">
          <h3>{trip.title || `${trip.destination}旅行计划`}</h3>
          <p>
            {trip.startDate} · {trip.days} 天 · {trip.travelers} 人
          </p>
          <span>
            打开旅程
            <ArrowUpRight size={17} />
          </span>
        </div>
      </button>
      {photo && (
        <div className="history-photo-credit">
          <span title={photo.caption}>
            {photo.source === "amap-poi"
              ? "行程地点照片"
              : photo.caption?.includes("目的地实景")
                ? "目的地实景"
                : "目的地相关配图"}
          </span>
          <span>
            {photo.source !== "amap-poi" && (
              <>
                <a
                  href={photoLink(photo.profileUrl)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {photo.photographer}
                </a>{" "}
                /{" "}
              </>
            )}
            <a
              href={photoLink(photo.photoUrl)}
              target="_blank"
              rel="noreferrer"
              aria-label={`查看${trip.destination}封面图片来源`}
            >
              {photoSource(photo)} ↗
            </a>
          </span>
        </div>
      )}
    </article>
  );
}
