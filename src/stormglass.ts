const BASE = "https://api.stormglass.io/v2";

export type StormglassSource = "sg" | "meto" | "fmi" | "fcoo" | "noaa" | "meteo";

export interface StormglassWeatherResponse {
  hours: Array<Record<string, Record<string, number> | string>>;
  meta: {
    cost?: number;
    dailyQuota?: number;
    requestCount?: number;
    source?: string[];
    lat?: number;
    lng?: number;
    start?: string;
    end?: string;
    params?: string[];
  };
  errors?: Record<string, string>;
}

export interface CurrentsOptions {
  lat: number;
  lon: number;
  hours: number;
  key: string;
  source?: StormglassSource;
}

export async function fetchCurrents(opts: CurrentsOptions): Promise<StormglassWeatherResponse> {
  const now = Date.now();
  const start = Math.floor(now / 1000);
  const end = Math.floor((now + opts.hours * 3600_000) / 1000);

  const params = new URLSearchParams({
    lat: opts.lat.toString(),
    lng: opts.lon.toString(),
    params: "currentSpeed,currentDirection",
    start: start.toString(),
    end: end.toString(),
  });
  if (opts.source) params.set("source", opts.source);

  const res = await fetch(`${BASE}/weather/point?${params}`, {
    headers: { Authorization: opts.key },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let json: StormglassWeatherResponse;
  try {
    json = JSON.parse(text) as StormglassWeatherResponse;
  } catch {
    throw new Error(`Stormglass non-JSON: ${text.slice(0, 500)}`);
  }
  if (!res.ok || json.errors) {
    const e = json.errors ? JSON.stringify(json.errors) : text.slice(0, 500);
    throw new Error(`Stormglass ${res.status}: ${e}`);
  }
  return json;
}

export function formatCurrents(
  data: StormglassWeatherResponse,
  opts: CurrentsOptions,
): string {
  const hours = data.hours ?? [];
  const sourcesSeen = new Set<string>();
  for (const h of hours) {
    const speed = h.currentSpeed as Record<string, number> | undefined;
    if (speed) for (const k of Object.keys(speed)) sourcesSeen.add(k);
  }
  const sources = Array.from(sourcesSeen);

  const header = [
    `# Tidal / ocean currents — Stormglass`,
    `Coords: ${opts.lat}, ${opts.lon}`,
    `Horizon: ${opts.hours}h`,
    `Sources: ${sources.join(", ") || "(none)"}`,
    data.meta.cost != null
      ? `API cost: ${data.meta.cost} (daily quota ${data.meta.dailyQuota ?? "?"}, used ${data.meta.requestCount ?? "?"})`
      : "",
    `Note: speed converted to knots from m/s. Direction is the heading the current is flowing TOWARD (degrees true).`,
  ]
    .filter(Boolean)
    .join("\n");

  const cols = ["time_utc"];
  for (const s of sources) {
    cols.push(`${s}_kn`, `${s}_dir`);
  }
  const rows: string[] = [cols.join("\t")];

  const MS_TO_KN = 1.94384;
  for (const h of hours) {
    const t = h.time as string;
    const speed = (h.currentSpeed ?? {}) as Record<string, number>;
    const dir = (h.currentDirection ?? {}) as Record<string, number>;
    const cells: string[] = [new Date(t).toISOString()];
    for (const s of sources) {
      const v = speed[s];
      const d = dir[s];
      cells.push(
        v != null && Number.isFinite(v) ? round(v * MS_TO_KN, 2).toString() : "—",
        d != null && Number.isFinite(d) ? round(d, 0).toString() : "—",
      );
    }
    rows.push(cells.join("\t"));
  }

  return [header, "", rows.join("\n")].join("\n");
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
