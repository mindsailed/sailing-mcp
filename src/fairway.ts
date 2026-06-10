import { haversineKm } from "./osm.js";

const WFS = "https://www.vaarweginformatie.nl/wfswms/services";
const UA = "sailing-mcp/0.6";

export type FairwayCategory = "depth" | "clearance" | "lock";

interface RawFeature {
  fields: Record<string, string>;
  lat: number;
  lon: number;
}

async function fetchFeatures(typeName: string, bbox: string): Promise<RawFeature[]> {
  const url =
    `${WFS}?service=WFS&version=1.1.0&request=GetFeature` +
    `&typeName=${encodeURIComponent(typeName)}&maxFeatures=200&bbox=${bbox}`;
  const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`FIS WFS ${res.status} for ${typeName}`);
  const xml = await res.text();
  return parseFeatures(xml, typeName);
}

function parseFeatures(xml: string, typeName: string): RawFeature[] {
  const local = typeName.replace("app:", "");
  const re = new RegExp(`<app:${local}\\b[^>]*>([\\s\\S]*?)</app:${local}>`, "g");
  const out: RawFeature[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    // Drop the bounding-box envelope so we read the real geometry, not the bbox corners.
    const body = block.replace(/<gml:boundedBy>[\s\S]*?<\/gml:boundedBy>/g, "");
    const fields: Record<string, string> = {};
    const fre = /<app:([A-Za-z]+)>([^<]+)<\/app:\1>/g;
    let fm: RegExpExecArray | null;
    while ((fm = fre.exec(body)) !== null) fields[fm[1]] = decode(fm[2].trim());
    const coord = firstLonLat(body);
    if (!coord) continue;
    out.push({ fields, lat: coord.lat, lon: coord.lon });
  }
  return out;
}

function firstLonLat(body: string): { lat: number; lon: number } | null {
  const pos = /<gml:pos>([\d.\-]+)\s+([\d.\-]+)<\/gml:pos>/.exec(body);
  if (pos) return { lon: parseFloat(pos[1]), lat: parseFloat(pos[2]) };
  const pl = /<gml:posList[^>]*>([\d.\-]+)\s+([\d.\-]+)/.exec(body);
  if (pl) return { lon: parseFloat(pl[1]), lat: parseFloat(pl[2]) };
  return null;
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#13;/g, " ")
    .replace(/&quot;/g, '"');
}

function num(v: string | undefined): number | undefined {
  if (v == null) return undefined;
  const n = parseFloat(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
}

export interface FairwayQuery {
  lat: number;
  lon: number;
  radiusKm: number;
  categories: FairwayCategory[];
  limit: number;
}

export interface FairwayItem {
  category: FairwayCategory;
  name: string;
  lat: number;
  lon: number;
  distKm: number;
  detail: string;
}

export async function queryFairway(q: FairwayQuery): Promise<FairwayItem[]> {
  const dLat = q.radiusKm / 111;
  const dLon = q.radiusKm / (111 * Math.cos((q.lat * Math.PI) / 180));
  const bbox = `${q.lon - dLon},${q.lat - dLat},${q.lon + dLon},${q.lat + dLat}`;

  const tasks: Array<Promise<FairwayItem[]>> = [];
  if (q.categories.includes("depth")) {
    tasks.push(
      fetchFeatures("app:FairwayDepth", bbox).then((fs) =>
        fs.map((f) => toItem("depth", f, depthDetail(f.fields))),
      ),
    );
    tasks.push(
      fetchFeatures("app:MaximumDimensions", bbox).then((fs) =>
        fs
          .filter((f) => f.fields.GeneralDepth)
          .map((f) => toItem("depth", f, `max fairway depth ${num(f.fields.GeneralDepth)} m`)),
      ),
    );
  }
  if (q.categories.includes("clearance")) {
    tasks.push(
      fetchFeatures("app:Opening", bbox).then((fs) =>
        fs.map((f) => toItem("clearance", f, clearanceDetail(f.fields))),
      ),
    );
  }
  if (q.categories.includes("lock")) {
    tasks.push(
      fetchFeatures("app:Lock", bbox).then((fs) =>
        fs.map((f) => toItem("lock", f, lockDetail(f.fields))),
      ),
    );
  }

  const results = (await Promise.all(tasks)).flat();
  const inRange = results
    .map((it) => ({ ...it, distKm: haversineKm(q.lat, q.lon, it.lat, it.lon) }))
    .filter((it) => it.distKm <= q.radiusKm)
    .sort((a, b) => a.distKm - b.distKm);
  return inRange.slice(0, q.limit);
}

function toItem(category: FairwayCategory, f: RawFeature, detail: string): FairwayItem {
  return {
    category,
    name: f.fields.Name ?? f.fields.City ?? "(unnamed)",
    lat: f.lat,
    lon: f.lon,
    distKm: 0,
    detail,
  };
}

function depthDetail(f: Record<string, string>): string {
  const up = num(f.MinimalDepthUpperLimit);
  const lo = num(f.MinimalDepthLowerLimit);
  const ref = f.ReferenceLevel ?? "?";
  const km = f.RouteKmBegin ? `km ${f.RouteKmBegin}–${f.RouteKmEnd ?? "?"}` : "";
  return `min depth ${lo ?? "?"}…${up ?? "?"} m (ref ${ref}) ${km}`.trim();
}

function clearanceDetail(f: Record<string, string>): string {
  const hc = num(f.PassageHeightClosed) ?? num(f.HeightClosed);
  const ho = num(f.PassageHeightOpened) ?? num(f.HeightOpened);
  const w = num(f.Width);
  const t = f.Type ? `type ${f.Type}` : "";
  const parts = [
    hc != null ? `clearance closed ${hc} m` : "",
    ho != null ? `opened ${ho} m` : "",
    w != null ? `width ${w} m` : "",
    t,
  ].filter(Boolean);
  return parts.join(", ") || "bridge opening";
}

function lockDetail(f: Record<string, string>): string {
  const ch = f.NumberOfChambers ? `${f.NumberOfChambers} chamber(s)` : "";
  const remote = f.IsRemoteControlled === "true" ? "remote-controlled" : "";
  const phone = f.PhoneNumber ? `tel ${f.PhoneNumber}` : "";
  const city = f.City ?? "";
  return [ch, remote, phone, city].filter(Boolean).join(", ") || "lock";
}

export function formatFairway(q: FairwayQuery, items: FairwayItem[]): string {
  const lines: string[] = [];
  lines.push(`# Fairway info — Netherlands (RWS FIS WFS)`);
  lines.push(`Centre: ${q.lat}, ${q.lon}   Radius: ${q.radiusKm} km`);
  lines.push(`Categories: ${q.categories.join(", ")}`);
  lines.push(`Found: ${items.length}`);
  lines.push(`Source: vaarweginformatie.nl FIS WFS. Depths/levels are relative to the stated reference (NAP, KP=canal level, etc).`);
  lines.push("");

  if (items.length === 0) {
    lines.push("(no fairway features in range for the selected categories)");
    return lines.join("\n");
  }

  lines.push("category\tname\tdist_km\tdetail\tlat\tlon");
  for (const it of items) {
    lines.push(
      [it.category, it.name, it.distKm.toFixed(1), it.detail, it.lat.toFixed(5), it.lon.toFixed(5)].join("\t"),
    );
  }
  return lines.join("\n");
}
