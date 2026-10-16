import { useState } from "react";
import { ImageOff, Image as ImageIcon, ExternalLink } from "lucide-react";
import type { Photo, Stop } from "../../shared/types";
import { photoImageUrl, photoLink, photoSource } from "../../shared/photos";

export function PhotoFigure({
  photo,
  name,
  cover = false,
}: {
  photo: Photo;
  name: string;
  cover?: boolean;
}) {
  return (
    <PhotoContent key={photo.url} photo={photo} name={name} cover={cover} />
  );
}
function PhotoContent({
  photo,
  name,
  cover,
}: {
  photo: Photo;
  name: string;
  cover: boolean;
}) {
  const [index, setIndex] = useState(0);
  const urls = [photo.url, ...(photo.fallbackUrls || [])]
    .map(photoImageUrl)
    .filter(Boolean);
  const source = photoSource(photo);
  return (
    <figure className={`stop-photo ${cover ? "plan-cover-photo" : ""}`}>
      <a
        className="stop-photo-link"
        href={photoLink(photo.photoUrl)}
        target="_blank"
        rel="noreferrer"
        aria-label={`查看${name}的${source}来源`}
      >
        {index >= urls.length ? (
          <div className="stop-photo-empty">
            <ImageOff size={20} />
            <span>图片暂时无法加载，点击查看来源</span>
          </div>
        ) : (
          <img
            src={urls[index]}
            alt={photo.alt}
            loading={cover ? "eager" : "lazy"}
            referrerPolicy="no-referrer"
            onError={() => setIndex((i) => i + 1)}
          />
        )}
        <span className="photo-source-badge">
          {source} <ExternalLink size={10} />
        </span>
      </a>
      <figcaption>
        <span>{photo.caption || `${source}相关配图`}</span>
        <small>
          {photo.source !== "amap-poi" && (
            <>
              摄影{" "}
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
          <a href={photoLink(photo.photoUrl)} target="_blank" rel="noreferrer">
            {source}
          </a>
        </small>
      </figcaption>
    </figure>
  );
}
export default function StopPhoto({ stop }: { stop: Stop }) {
  if (stop.photo) return <PhotoFigure photo={stop.photo} name={stop.name} />;
  return (
    <div className="stop-photo-empty">
      <ImageIcon size={18} />
      <span>
        {stop.photoStatus === "error"
          ? "图片搜索暂不可用，可点击上方补全图片重试"
          : stop.photoStatus === "not_found"
            ? "暂未找到匹配照片"
            : "暂无匹配照片，可配置高德或 Unsplash 后补全"}
      </span>
    </div>
  );
}
