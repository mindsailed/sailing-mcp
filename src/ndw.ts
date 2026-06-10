import { XMLParser } from "fast-xml-parser";
import { gunzipSync } from "node:zlib";
import { fetchNamedBridges, haversineKm, matchBridgeName } from "./osm.js";

const FEED_URL = "https://opendata.ndw.nu/planningsfeed_brugopeningen.xml.gz";
const TTL_MS = 5 * 60_000;
const UA = "windy-mcp/0.5";

interface CachedFeed {
  fetchedAt: number;
  events: BridgeEvent[];
}

let cache: CachedFeed | null = null;

export interface BridgeEvent {
  id: string;
  locationCode: string;
  lat: number;
  lon: number;
  startUtc: Date;
  endUtc: Date;
  durationMin: number;
}

async function loadFeed(): Promise<BridgeEvent[]> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache.events;
  const res = await fetch(FEED_URL, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`NDW ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const xml = gunzipSync(buf).toString("utf8");

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    removeNSPrefix: true,
    parseTagValue: true,
  });
  const doc = parser.parse(xml);
  const payload = doc?.messageContainer?.payload;
  const situations = ensureArray(payload?.situation);

  const events: BridgeEvent[] = [];
  for (const s of situations) {
    const rec = s.situationRecord;
    if (!rec) continue;
    const recs = ensureArray(rec);
    for (const r of recs) {
      const spec = r.validity?.validityTimeSpecification;
      const start = spec?.overallStartTime;
      const end = spec?.overallEndTime;
      const locRef = r.locationReference;
      const coords = locRef?.pointByCoordinates?.pointCoordinates;
      const extCode = locRef?.externalReferencing?.externalLocationCode;
      const lat = coords?.latitude != null ? Number(coords.latitude) : NaN;
      const lon = coords?.longitude != null ? Number(coords.longitude) : NaN;
      if (!start || !end || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const startUtc = new Date(start);
      const endUtc = new Date(end);
      if (Number.isNaN(startUtc.getTime()) || Number.isNaN(endUtc.getTime())) continue;
      events.push({
        id: r["@_id"] ?? s["@_id"] ?? String(events.length),
        locationCode: String(extCode ?? ""),
        lat,
        lon,
        startUtc,
        endUtc,
        durationMin: Math.round((endUtc.getTime() - startUtc.getTime()) / 60000),
      });
    }
  }
  events.sort((a, b) => a.startUtc.getTime() - b.startUtc.getTime());
  cache = { fetchedAt: Date.now(), events };
  return events;
}

function ensureArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

export interface BridgeQuery {
  lat: number;
  lon: number;
  radiusKm: number;
  hoursForward: number;
  hoursBack: number;
  limitPerBridge: number;
  resolveNames: boolean;
}

export interface BridgeReport {
  bridges: Array<{
    locationCode: string;
    name?: string;
    lat: number;
    lon: number;
    distKm: number;
    events: BridgeEvent[];
  }>;
  totalEvents: number;
  totalBridges: number;
  feedAgeSec: number;
  namesResolved: boolean;
}

export async function queryBridges(q: BridgeQuery): Promise<BridgeReport> {
  const events = await loadFeed();
  const now = Date.now();
  const tMin = now - q.hoursBack * 3600_000;
  const tMax = now + q.hoursForward * 3600_000;

  const byLoc = new Map<string, { lat: number; lon: number; events: BridgeEvent[] }>();
  for (const e of events) {
    const t = e.startUtc.getTime();
    if (t < tMin || t > tMax) continue;
    const d = haversineKm(q.lat, q.lon, e.lat, e.lon);
    if (d > q.radiusKm) continue;
    const key = e.locationCode || `${e.lat.toFixed(4)},${e.lon.toFixed(4)}`;
    const slot = byLoc.get(key);
    if (slot) slot.events.push(e);
    else byLoc.set(key, { lat: e.lat, lon: e.lon, events: [e] });
  }

  const bridges = Array.from(byLoc.entries()).map(([locationCode, v]) => ({
    locationCode,
    name: undefined as string | undefined,
    lat: v.lat,
    lon: v.lon,
    distKm: haversineKm(q.lat, q.lon, v.lat, v.lon),
    events: v.events.slice(0, q.limitPerBridge),
  }));
  bridges.sort((a, b) => a.distKm - b.distKm);

  let namesResolved = false;
  if (q.resolveNames && bridges.length > 0) {
    try {
      const dLat = q.radiusKm / 111;
      const dLon = q.radiusKm / (111 * Math.cos((q.lat * Math.PI) / 180));
      const osmBridges = await fetchNamedBridges({
        south: q.lat - dLat,
        west: q.lon - dLon,
        north: q.lat + dLat,
        east: q.lon + dLon,
      });
      for (const b of bridges) {
        b.name = matchBridgeName(b.lat, b.lon, osmBridges, 80);
      }
      namesResolved = true;
    } catch {
      // OSM enrichment is best-effort; keep RIS codes if it fails.
      namesResolved = false;
    }
  }

  return {
    bridges,
    totalEvents: bridges.reduce((s, b) => s + b.events.length, 0),
    totalBridges: bridges.length,
    feedAgeSec: cache ? Math.round((Date.now() - cache.fetchedAt) / 1000) : 0,
    namesResolved,
  };
}

export function formatBridgeReport(report: BridgeReport, q: BridgeQuery): string {
  const lines: string[] = [];
  lines.push(`# Bridge openings — NDW DATEX II (Netherlands)`);
  lines.push(`Centre: ${q.lat}, ${q.lon}`);
  lines.push(`Radius: ${q.radiusKm} km`);
  lines.push(`Window: now − ${q.hoursBack}h … now + ${q.hoursForward}h`);
  lines.push(`Bridges with scheduled openings: ${report.totalBridges} (total ${report.totalEvents} events)`);
  lines.push(`Feed age: ${report.feedAgeSec}s (TTL ${TTL_MS / 1000}s)`);
  lines.push(`Source: opendata.ndw.nu/planningsfeed_brugopeningen.xml.gz`);
  if (report.namesResolved) {
    lines.push(`Bridge names resolved from OpenStreetMap (nearest movable bridge ≤ 80 m). "(name unknown)" = no OSM match — RIS code still valid.`);
  } else {
    lines.push(`Note: bridge names not resolved (NDW carries RIS codes only). Cross-reference coordinates with a chart for the name.`);
  }
  lines.push("");

  if (report.bridges.length === 0) {
    lines.push("(no bridges with openings in this window)");
    return lines.join("\n");
  }

  for (const b of report.bridges) {
    const label = b.name ?? (report.namesResolved ? "(name unknown)" : b.locationCode || "(unknown)");
    lines.push(`## ${label} — ${b.locationCode || "(unknown)"} @ ${b.lat.toFixed(5)},${b.lon.toFixed(5)}  (${b.distKm.toFixed(1)} km)`);
    lines.push("start_utc\tend_utc\tdur_min");
    for (const e of b.events) {
      lines.push(`${e.startUtc.toISOString()}\t${e.endUtc.toISOString()}\t${e.durationMin}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
