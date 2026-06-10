import { XMLParser } from "fast-xml-parser";
import { haversineKm } from "./osm.js";

const ENDPOINT = "https://www.vaarweginformatie.nl/fdd/nts";
const QNS = "http://www.ris.eu/nts.ms/1.0.3.0";
const NNS = "http://www.ris.eu/nts/3.0";

export type NtsMessageType = "FTM" | "WRM" | "ICEM" | "WERM";

export const MESSAGE_TYPE_LABEL: Record<NtsMessageType, string> = {
  FTM: "Fairway & Traffic",
  WRM: "Water-related",
  ICEM: "Ice",
  WERM: "Weather",
};

// Human labels for the most common RIS code values seen in NL FTM messages.
const SUBJECT_LABEL: Record<string, string> = {
  ANNOUN: "announcement",
  OBSTRU: "obstruction",
  NOSERV: "service unavailable",
  LIMITED: "limited service",
  SERVIC: "service",
  WORKS: "works",
  EVENT: "event",
  EXERCI: "exercise",
  VESDRA: "draught/clearance restriction",
  WAVWAS: "wave wash warning",
  DEPTH: "depth restriction",
};
const REASON_LABEL: Record<string, string> = {
  REPAIR: "repair",
  CONSTR: "construction",
  MAINTW: "maintenance works",
  WORK: "works",
  WORKS: "works",
  EVENT: "event",
  HIGHWA: "high water",
  LOWWAT: "low water",
  SHALLO: "shallows",
  INSPEC: "inspection",
  CALAM: "calamity",
  OTHER: "other",
};
const LIMITATION_LABEL: Record<string, string> = {
  CAUTIO: "caution",
  OBSTRU: "obstruction",
  NOSERVC: "no service",
  CLEAR: "reduced clearance",
  DEPTH: "reduced depth",
  WIDTH: "reduced width",
  SPEED: "speed limit",
  NOMOOR: "no mooring",
  PASSING: "no passing/overtaking",
  PROHIB: "prohibited",
  BLOCK: "blocked / closed",
  VESDRA: "draught/clearance restriction",
  WAVWAS: "wave wash / slow down",
};

export interface GeoObject {
  name?: string;
  ids: string[];
  coords: Array<{ lat: number; lon: number }>;
}

export interface NtsMessage {
  type: NtsMessageType;
  number: string;
  district?: string;
  originator?: string;
  dateIssue?: string;
  subjectCode?: string;
  reasonCode?: string;
  contents?: string;
  validityStart?: string;
  validityEnd?: string;
  limitationCodes: string[];
  geoObjects: GeoObject[];
  /** nearest coordinate distance to the query point (km), filled during geofilter */
  nearestKm?: number;
  nearestName?: string;
}

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

function arr<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Parse RIS DMS like "51 58.3625 N" / "005 57.3653 E" to signed decimal degrees. */
export function parseDms(s: string | undefined): number | null {
  if (!s) return null;
  const m = /^\s*(\d+)\s+([\d.]+)\s*([NSEW])\s*$/i.exec(s);
  if (!m) return null;
  const deg = parseInt(m[1], 10);
  const min = parseFloat(m[2]);
  let dec = deg + min / 60;
  const h = m[3].toUpperCase();
  if (h === "S" || h === "W") dec = -dec;
  return dec;
}

function collectGeoObjects(body: unknown): GeoObject[] {
  const out: GeoObject[] = [];
  const visit = (node: unknown): void => {
    if (node == null || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if ("geo_object" in obj) {
      for (const go of arr(obj.geo_object as unknown)) {
        const g = go as Record<string, unknown>;
        const ids = arr(g.id as string | string[]).map(String);
        const coords: Array<{ lat: number; lon: number }> = [];
        for (const c of arr(g.coordinate as unknown)) {
          const cc = c as Record<string, unknown>;
          const lat = parseDms(cc.lat as string);
          const lon = parseDms(cc.long as string);
          if (lat != null && lon != null) coords.push({ lat, lon });
        }
        out.push({ name: g.name as string | undefined, ids, coords });
      }
    }
    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) v.forEach(visit);
      else if (typeof v === "object") visit(v);
    }
  };
  visit(body);
  return out;
}

function collectLimitations(body: unknown): string[] {
  const codes: string[] = [];
  const visit = (node: unknown): void => {
    if (node == null || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    if (obj.limitation_code) codes.push(String(obj.limitation_code));
    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) v.forEach(visit);
      else if (typeof v === "object") visit(v);
    }
  };
  visit(body);
  return Array.from(new Set(codes));
}

// The NtS web service caps page size at 100 (larger requests return error e130).
const PAGE_SIZE = 100;

function buildRequest(type: NtsMessageType, daysAhead: number, today: Date, offset: number): string {
  const start = today.toISOString().slice(0, 10);
  const end = new Date(today.getTime() + daysAhead * 86400_000).toISOString().slice(0, 10);
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<soap:Body>` +
    `<q:get_messages_query xmlns:q="${QNS}" xmlns:n="${NNS}">` +
    `<q:message_type>${type}</q:message_type>` +
    `<q:validity_period><n:date_start>${start}</n:date_start><n:date_end>${end}</n:date_end></q:validity_period>` +
    `<q:paging_request><q:offset>${offset}</q:offset><q:limit>${PAGE_SIZE}</q:limit><q:total_count>true</q:total_count></q:paging_request>` +
    `</q:get_messages_query>` +
    `</soap:Body></soap:Envelope>`
  );
}

async function fetchType(type: NtsMessageType, daysAhead: number, today: Date, maxFetch: number): Promise<NtsMessage[]> {
  const messages: NtsMessage[] = [];
  for (let offset = 0; offset < maxFetch; offset += PAGE_SIZE) {
    const page = await fetchPage(type, daysAhead, today, offset);
    messages.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return messages;
}

async function fetchPage(type: NtsMessageType, daysAhead: number, today: Date, offset: number): Promise<NtsMessage[]> {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "text/xml; charset=utf-8", soapaction: '""' },
    body: buildRequest(type, daysAhead, today, offset),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`NtS ${res.status} for ${type}`);
  const doc = parser.parse(text);
  const result = doc?.Envelope?.Body?.get_messages_result;
  if (!result) return [];
  const messages: NtsMessage[] = [];
  for (const rm of arr(result.result_message as unknown)) {
    const m = rm as Record<string, unknown>;
    const id = (m.identification ?? {}) as Record<string, unknown>;
    const bodyKey = type.toLowerCase(); // ftm | wrm | icem | werm
    const body = (m[bodyKey] ?? {}) as Record<string, unknown>;
    const validity = (body.validity_period ?? {}) as Record<string, unknown>;
    messages.push({
      type,
      number: `${body.year ?? ""}/${body.number ?? "?"}`,
      district: id.district as string | undefined,
      originator: id.originator as string | undefined,
      dateIssue: id.date_issue as string | undefined,
      subjectCode: body.subject_code as string | undefined,
      reasonCode: body.reason_code as string | undefined,
      contents: (body.contents as string | undefined)?.trim() || undefined,
      validityStart: validity.date_start as string | undefined,
      validityEnd: validity.date_end as string | undefined,
      limitationCodes: collectLimitations(body),
      geoObjects: collectGeoObjects(body),
    });
  }
  return messages;
}

export interface NtsQuery {
  lat: number;
  lon: number;
  radiusKm: number;
  types: NtsMessageType[];
  daysAhead: number;
  limit: number;
}

export async function queryNotices(q: NtsQuery, today: Date): Promise<{ matches: NtsMessage[]; scanned: number }> {
  const maxFetch = 1500;
  const all: NtsMessage[] = [];
  const results = await Promise.all(q.types.map((t) => fetchType(t, q.daysAhead, today, maxFetch)));
  for (const r of results) all.push(...r);

  const matches: NtsMessage[] = [];
  for (const m of all) {
    let best = Infinity;
    let bestName: string | undefined;
    for (const go of m.geoObjects) {
      for (const c of go.coords) {
        const d = haversineKm(q.lat, q.lon, c.lat, c.lon);
        if (d < best) {
          best = d;
          bestName = go.name;
        }
      }
    }
    if (best <= q.radiusKm) {
      m.nearestKm = best;
      m.nearestName = bestName;
      matches.push(m);
    }
  }
  matches.sort((a, b) => (a.nearestKm ?? 1e9) - (b.nearestKm ?? 1e9));
  return { matches: matches.slice(0, q.limit), scanned: all.length };
}

export function formatNotices(q: NtsQuery, res: { matches: NtsMessage[]; scanned: number }): string {
  const lines: string[] = [];
  lines.push(`# Notices to Skippers — Netherlands (RWS / EU NtS)`);
  lines.push(`Centre: ${q.lat}, ${q.lon}   Radius: ${q.radiusKm} km`);
  lines.push(`Types: ${q.types.map((t) => `${t} (${MESSAGE_TYPE_LABEL[t]})`).join(", ")}`);
  lines.push(`Validity window: next ${q.daysAhead} days. Scanned ${res.scanned} valid notices, ${res.matches.length} in range.`);
  lines.push(`Source: vaarweginformatie.nl NtS web service. Contents are in Dutch (original).`);
  lines.push("");

  if (res.matches.length === 0) {
    lines.push("(no notices in range for the selected types and window)");
    return lines.join("\n");
  }

  for (const m of res.matches) {
    const subj = m.subjectCode ? `${m.subjectCode}${SUBJECT_LABEL[m.subjectCode] ? ` (${SUBJECT_LABEL[m.subjectCode]})` : ""}` : "";
    const reason = m.reasonCode ? `${m.reasonCode}${REASON_LABEL[m.reasonCode] ? ` (${REASON_LABEL[m.reasonCode]})` : ""}` : "";
    const lims = m.limitationCodes
      .map((c) => `${c}${LIMITATION_LABEL[c] ? ` (${LIMITATION_LABEL[c]})` : ""}`)
      .join(", ");
    const validity = m.validityStart
      ? `${m.validityStart.slice(0, 10)}${m.validityEnd ? ` → ${m.validityEnd.slice(0, 10)}` : " → (open)"}`
      : "?";

    lines.push(
      `## ${m.type} ${m.number} — ${m.nearestName ?? "(area)"} — ${m.nearestKm?.toFixed(1)} km`,
    );
    if (subj || reason) lines.push(`subject: ${subj || "—"}   reason: ${reason || "—"}`);
    if (lims) lines.push(`limitations: ${lims}`);
    lines.push(`valid: ${validity}${m.district ? `   district: ${m.district}` : ""}`);
    if (m.contents) lines.push(`text (NL): ${m.contents}`);
    lines.push("");
  }
  return lines.join("\n");
}
