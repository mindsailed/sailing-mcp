const BASE = "https://aviationweather.gov/api/data";

export interface MetarReport {
  icaoId: string;
  name: string;
  lat: number;
  lon: number;
  reportTime: string;
  rawOb: string;
  temp?: number;
  dewp?: number;
  wdir?: number | string;
  wspd?: number;
  wgst?: number;
  visib?: number | string;
  altim?: number;
  cover?: string;
  clouds?: Array<{ cover: string; base?: number }>;
  fltCat?: string;
  metarType?: string;
}

export interface TafReport {
  icaoId: string;
  name: string;
  lat: number;
  lon: number;
  issueTime: string;
  validTimeFrom: number;
  validTimeTo: number;
  rawTAF: string;
}

const NL_AIRPORTS: Array<{ icao: string; name: string; lat: number; lon: number }> = [
  { icao: "EHKD", name: "Den Helder, De Kooy", lat: 52.927, lon: 4.781 },
  { icao: "EHAM", name: "Amsterdam Schiphol", lat: 52.308, lon: 4.764 },
  { icao: "EHRD", name: "Rotterdam The Hague", lat: 51.957, lon: 4.437 },
  { icao: "EHLW", name: "Leeuwarden", lat: 53.228, lon: 5.761 },
  { icao: "EHGG", name: "Groningen Eelde", lat: 53.12, lon: 6.583 },
  { icao: "EHBK", name: "Maastricht Aachen", lat: 50.917, lon: 5.77 },
  { icao: "EHEH", name: "Eindhoven", lat: 51.45, lon: 5.374 },
  { icao: "EBOS", name: "Oostende-Brugge (BE)", lat: 51.198, lon: 2.862 },
  { icao: "EBKT", name: "Kortrijk-Wevelgem (BE)", lat: 50.817, lon: 3.205 },
  { icao: "EDXW", name: "Westerland/Sylt (DE)", lat: 54.913, lon: 8.34 },
  { icao: "EDDH", name: "Hamburg (DE)", lat: 53.633, lon: 9.988 },
  { icao: "EDDB", name: "Berlin Brandenburg", lat: 52.367, lon: 13.503 },
  { icao: "EGSH", name: "Norwich (UK)", lat: 52.676, lon: 1.282 },
  { icao: "EGNT", name: "Newcastle (UK)", lat: 55.038, lon: -1.69 },
  { icao: "EGSS", name: "Stansted (UK)", lat: 51.885, lon: 0.235 },
  { icao: "EGGW", name: "Luton (UK)", lat: 51.875, lon: -0.368 },
  { icao: "EGMD", name: "Lydd (UK)", lat: 50.956, lon: 0.939 },
];

export function findNearestAirport(lat: number, lon: number): { icao: string; name: string; distKm: number } {
  let best = NL_AIRPORTS[0];
  let bestD = Infinity;
  for (const a of NL_AIRPORTS) {
    const d = haversineKm(lat, lon, a.lat, a.lon);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return { icao: best.icao, name: best.name, distKm: bestD };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export async function fetchMetar(icao: string, hours: number): Promise<MetarReport[]> {
  const url = `${BASE}/metar?ids=${encodeURIComponent(icao)}&format=json&hours=${hours}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`aviationweather METAR ${res.status}`);
  return (await res.json()) as MetarReport[];
}

export async function fetchTaf(icao: string): Promise<TafReport[]> {
  const url = `${BASE}/taf?ids=${encodeURIComponent(icao)}&format=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`aviationweather TAF ${res.status}`);
  return (await res.json()) as TafReport[];
}

export function formatMetarTaf(opts: {
  icao: string;
  airportName?: string;
  distKm?: number;
  metars: MetarReport[];
  tafs: TafReport[];
}): string {
  const lines: string[] = [];
  const a = opts.metars[0];
  lines.push(`# METAR / TAF — ${opts.icao}${a ? ` (${a.name})` : opts.airportName ? ` (${opts.airportName})` : ""}`);
  if (opts.distKm != null) lines.push(`Distance from requested point: ${opts.distKm.toFixed(1)} km`);
  lines.push("");

  if (opts.metars.length === 0) {
    lines.push("## METAR\n(no recent reports)");
  } else {
    lines.push("## METAR (most recent first)");
    lines.push("time_utc\twind\tvis\ttemp/dew\talt\tcat\traw");
    for (const m of opts.metars) {
      const wind = m.wdir != null ? `${m.wdir}@${m.wspd ?? "?"}${m.wgst ? "G" + m.wgst : ""}kt` : "—";
      const td = `${m.temp ?? "?"}/${m.dewp ?? "?"}`;
      lines.push(
        [
          m.reportTime,
          wind,
          m.visib ?? "—",
          td,
          m.altim ? `Q${m.altim}` : "—",
          m.fltCat ?? "—",
          m.rawOb,
        ].join("\t"),
      );
    }
  }

  lines.push("");
  if (opts.tafs.length === 0) {
    lines.push("## TAF\n(no current TAF)");
  } else {
    lines.push("## TAF");
    for (const t of opts.tafs) {
      lines.push(t.rawTAF);
    }
  }

  return lines.join("\n");
}
