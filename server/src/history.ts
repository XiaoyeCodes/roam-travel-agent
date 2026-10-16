import type { Job, Photo, TripSummary } from "../../shared/types.js";
import { photoImageUrl } from "../../shared/photos.js";
import { destinationPhotos } from "./photo-catalog.js";

const cityKey = (city: string) => city.trim().replace(/市$/, "").toLowerCase();
function planPhotos(job: Job): Photo[] {
  return (
    job.plan?.days
      .flatMap((d) => d.stops)
      .filter(
        (s) => s.type === "attraction" && s.photo && photoImageUrl(s.photo.url),
      )
      .map((s) => s.photo!) || []
  );
}
// Reuse photos already collected by planning. Listing history never triggers
// provider calls or modifies an itinerary, including an in-progress job.
export function tripSummaries(jobs: Job[]): TripSummary[] {
  const byCity = new Map<string, Photo[]>();
  for (const job of jobs) {
    const key = cityKey(job.request.destination);
    byCity.set(key, [...(byCity.get(key) || []), ...planPhotos(job)]);
  }
  return jobs.map((job) => {
    const own = planPhotos(job),
      sameCity = byCity.get(cityKey(job.request.destination)) || [];
    const candidates = [
      ...own.filter((p) => p.source === "amap-poi"),
      ...destinationPhotos(job.request.destination),
      ...own,
      ...sameCity,
    ];
    const seen = new Set<string>();
    const coverPhotos = candidates
      .filter((p) => {
        const url = photoImageUrl(p.url);
        if (!url || seen.has(url)) return false;
        seen.add(url);
        return true;
      })
      .slice(0, 3);
    return {
      id: job.id,
      destination: job.request.destination,
      days: job.request.days,
      travelers: job.request.travelers,
      startDate: job.request.startDate,
      title: job.plan?.title,
      status: job.status,
      mode: job.request.mode,
      createdAt: job.createdAt,
      coverPhotos,
    };
  });
}
