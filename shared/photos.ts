import type { Photo, Plan } from "./types.js";
const amapHosts = new Set(["store.is.autonavi.com", "aos-comment.amap.com"]);
export function photoImageUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.port) return "";
    if (
      amapHosts.has(url.hostname) &&
      ["http:", "https:"].includes(url.protocol)
    ) {
      url.protocol = "https:";
      return url.href;
    }
    return url.protocol === "https:" && url.hostname === "images.unsplash.com"
      ? url.href
      : "";
  } catch {
    return "";
  }
}
export function photoLink(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      ["unsplash.com", "uri.amap.com"].includes(url.hostname)
      ? url.href
      : "";
  } catch {
    return "";
  }
}
export const photoSource = (photo: Photo) =>
  photo.source === "amap-poi" ? "高德地点照片" : "Unsplash";
export const photoMode = (amap: boolean, unsplash: boolean) =>
  amap ? (unsplash ? "mixed" : "amap") : unsplash ? "search" : "curated";
export function coverPhoto(plan: Plan): Photo | undefined {
  const photos = plan.days
    .flatMap((d) => d.stops)
    .filter(
      (s) => s.type === "attraction" && s.photo && photoImageUrl(s.photo.url),
    )
    .map((s) => s.photo!);
  return photos.find((p) => p.source === "amap-poi") || photos[0];
}
