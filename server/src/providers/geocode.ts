import { cached, cell, DAY } from "../lib/cache.ts";
import { getJson } from "../lib/http.ts";

export function search(q: string) {
  return cached(`geo:q:${q.toLowerCase().trim()}`, 30 * DAY, async () => {
    const j = await getJson<any[]>(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`, { source: "Nominatim" });
    return j.map((r) => ({ name: r.display_name as string, lat: Number(r.lat), lon: Number(r.lon) }));
  });
}

export function reverse(lat: number, lon: number) {
  return cached(`geo:r:${cell(lat, lon, 2)}`, 90 * DAY, async () => {
    try {
      const j = await getJson(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&lat=${lat}&lon=${lon}`, { source: "Nominatim", retries: 0, timeoutMs: 8000 });
      const a = j.address ?? {};
      return {
        place: a.village || a.town || a.city || a.municipality || a.county || a.state_district || "",
        region: a.state || a.region || "",
        country: a.country || "",
        countryCode: (a.country_code || "").toUpperCase(),
      };
    } catch {
      return { place: "", region: "", country: "", countryCode: "" };
    }
  });
}
