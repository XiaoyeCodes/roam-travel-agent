import { createHash } from "node:crypto";
import type { Config } from "./config.js";
import type { Photo, Plan, Stop } from "../../shared/types.js";
import { PHOTO_VERSION } from "../../shared/types.js";
import { curatedPhoto, photoQuery } from "./photo-catalog.js";

const referral = { utm_source: "roam_travel", utm_medium: "referral" };
export function unsplashUrl(value: string, image = false): string {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.hostname !== (image ? "images.unsplash.com" : "unsplash.com")
    )
      return "";
    if (!image)
      Object.entries(referral).forEach(([k, v]) => url.searchParams.set(k, v));
    return url.href;
  } catch {
    return "";
  }
}

type SearchResult = {
  photos: Photo[];
  status: "ready" | "not_found" | "error";
};
const cache = new Map<string, { at: number; value: SearchResult }>();
export async function searchPhotos(
  config: Config,
  query: string,
  signal?: AbortSignal,
): Promise<SearchResult> {
  const cacheKey = createHash("sha256")
    .update(config.unsplashKey + query)
    .digest("hex");
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < 3600_000) return cached.value;
  try {
    const response = await fetch(
      `https://api.unsplash.com/search/photos?${new URLSearchParams({ query, per_page: "5", orientation: "landscape", content_filter: "high" })}`,
      {
        headers: {
          Authorization: `Client-ID ${config.unsplashKey}`,
          "Accept-Version": "v1",
        },
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
          : AbortSignal.timeout(8000),
        redirect: "error",
      },
    );
    if (!response.ok) throw new Error(`Unsplash ${response.status}`);
    const data = (await response.json()) as any;
    const photos: Photo[] = (Array.isArray(data.results) ? data.results : [])
      .filter(
        (p: any) =>
          !p.premium &&
          !p.plus &&
          p.urls?.regular &&
          p.user?.links?.html &&
          p.links?.html,
      )
      .map((p: any) => ({
        id: String(p.id),
        url: unsplashUrl(p.urls.regular, true),
        alt: String(p.alt_description || p.description || query),
        photographer: String(p.user.name || p.user.username),
        profileUrl: unsplashUrl(p.user.links.html),
        photoUrl: unsplashUrl(p.links.html),
        downloadLocation: p.links.download_location,
        source: "unsplash-search" as const,
        query,
        caption: "Unsplash 关键词搜索 · 相关图片，具体取景请查看原图说明",
      }))
      .filter((p: Photo) => p.url && p.photoUrl && p.profileUrl);
    const value: SearchResult = {
      photos,
      status: photos.length ? "ready" : "not_found",
    };
    if (cache.size >= 300) cache.delete(cache.keys().next().value!);
    cache.set(cacheKey, { value, at: Date.now() });
    return value;
  } catch (error) {
    signal?.throwIfAborted();
    return { photos: [], status: "error" };
  }
}

const pending = new WeakMap<Plan, Promise<void>>();
export async function enrichPhotos(
  plan: Plan,
  config: Config,
  options: { force?: boolean; signal?: AbortSignal } = {},
) {
  const mode = config.unsplashKey ? "search" : "curated";
  if (
    !options.force &&
    plan.photoVersion === PHOTO_VERSION &&
    plan.photoMode === mode
  )
    return;
  const inProgress = pending.get(plan);
  if (inProgress) {
    await inProgress;
    return;
  }
  const task = (async () => {
    // Work on copies so cancellation cannot persist a half-populated plan.
    const stops = plan.days
      .flatMap((d) => d.stops)
      .filter((s) => s.type === "attraction" || s.type === "food");
    const results = new Map<
      Stop,
      { photo?: Photo; status: Stop["photoStatus"] }
    >();
    const queries = new Map<string, Promise<SearchResult>>();
    const deadline = AbortSignal.timeout(35_000);
    const lookupSignal = options.signal
      ? AbortSignal.any([options.signal, deadline])
      : deadline;
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(3, stops.length) }, async () => {
        while (next < stops.length) {
          const stop = stops[next++];
          options.signal?.throwIfAborted();
          const fallback = curatedPhoto(plan.destination, stop);
          let selected: Photo | undefined;
          let status: Stop["photoStatus"] = "unconfigured";
          if (config.unsplashKey) {
            const query = photoQuery(plan.destination, stop);
            let lookup = queries.get(query);
            if (!lookup) {
              // A long trip must not exhaust a development application's hourly quota.
              lookup =
                queries.size < 24 && !deadline.aborted
                  ? searchPhotos(config, query, lookupSignal).catch(() => ({
                      photos: [],
                      status: "error" as const,
                    }))
                  : Promise.resolve({ photos: [], status: "error" as const });
              queries.set(query, lookup);
            }
            const result = await lookup;
            selected = result.photos[0];
            status = result.status;
          }
          const photo = selected || fallback;
          results.set(stop, { photo, status: photo ? "ready" : status });
        }
      }),
    );
    options.signal?.throwIfAborted();
    results.forEach((value, stop) => {
      stop.photo = value.photo;
      stop.photoStatus = value.status;
    });
    plan.images = [
      ...new Map(
        stops.filter((s) => s.photo).map((s) => [s.photo!.url, s.photo!]),
      ).values(),
    ];
    plan.photoVersion = PHOTO_VERSION;
    plan.photoMode = mode;
    plan.photoUpdatedAt = new Date().toISOString();
  })();
  pending.set(plan, task);
  try {
    await task;
  } finally {
    pending.delete(plan);
  }
}

// An HTML export is a use of a photo. Notify the official API download endpoint;
// keep image hotlinks in the file, never expose the access key or fetch arbitrary URLs.
export async function trackPhotoExport(
  plan: Plan,
  config: Config,
): Promise<number> {
  if (!config.unsplashKey) return 0;
  const urls = [
    ...new Set(
      plan.days
        .flatMap((d) => d.stops)
        .map((s) => s.photo?.downloadLocation)
        .filter((v): v is string => !!v),
    ),
  ];
  let failed = 0,
    next = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, urls.length) }, async () => {
      while (next < urls.length) {
        const value = urls[next++];
        try {
          const url = new URL(value);
          if (
            url.origin !== "https://api.unsplash.com" ||
            url.username ||
            url.password ||
            !/^\/photos\/[\w-]+\/download$/.test(url.pathname)
          )
            continue;
          const response = await fetch(url, {
            headers: { Authorization: `Client-ID ${config.unsplashKey}` },
            redirect: "error",
            signal: AbortSignal.timeout(3000),
          });
          if (!response.ok) failed++;
        } catch {
          failed++;
        }
      }
    }),
  );
  return failed;
}
