import { useState } from "react";
import { ImageOff, Image as ImageIcon, ExternalLink } from "lucide-react";
import type { Stop } from "../../shared/types";

export default function StopPhoto({ stop }: { stop: Stop }) {
  const [failedUrl, setFailedUrl] = useState("");
  const photo = stop.photo;
  if (!photo)
    return (
      <div className="stop-photo-empty">
        <ImageIcon size={18} />
        <span>
          {stop.photoStatus === "error"
            ? "图片搜索暂不可用，可点击上方补全图片重试"
            : stop.photoStatus === "not_found"
              ? "暂未找到匹配照片"
              : "暂无匹配照片，可配置 Unsplash 后补全"}
        </span>
      </div>
    );
  return (
    <figure className="stop-photo">
      <a
        className="stop-photo-link"
        href={photo.photoUrl}
        target="_blank"
        rel="noreferrer"
        aria-label={`查看${stop.name}的 Unsplash 图片来源`}
      >
        {failedUrl === photo.url ? (
          <div className="stop-photo-empty">
            <ImageOff size={20} />
            <span>图片暂时无法加载，点击查看来源</span>
          </div>
        ) : (
          <img
            src={photo.url}
            alt={photo.alt}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailedUrl(photo.url)}
          />
        )}
        <span className="photo-source-badge">
          UNSPLASH <ExternalLink size={10} />
        </span>
      </a>
      <figcaption>
        <span>{photo.caption || "Unsplash 搜索相关配图"}</span>
        <small>
          摄影{" "}
          <a href={photo.profileUrl} target="_blank" rel="noreferrer">
            {photo.photographer}
          </a>{" "}
          /{" "}
          <a href={photo.photoUrl} target="_blank" rel="noreferrer">
            Unsplash
          </a>
        </small>
      </figcaption>
    </figure>
  );
}
