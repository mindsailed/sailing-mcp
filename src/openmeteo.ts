const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const MARINE_URL = "https://marine-api.open-meteo.com/v1/marine";

export type OpenMeteoModel =
  | "best_match"
  | "ecmwf_ifs025"
  | "ecmwf_ifs04"
  | "gfs_seamless"
  | "gfs_global"
  | "gfs_hrrr"
  | "icon_seamless"
  | "icon_global"
  | "icon_eu"
  | "icon_d2"
  | "ukmo_seamless"
  | "ukmo_global_deterministic_10km"
  | "meteofrance_seamless"
  | "meteofrance_arpege_europe"
  | "meteofrance_arome_france_hd"
  | "jma_seamless";

interface ForecastResponse {
  hourly?: {
    time: string[];
    wind_speed_10m?: number[];
    wind_direction_10m?: number[];
    wind_gusts_10m?: number[];
    pressure_msl?: number[];
    temperature_2m?: number[];
    cloud_cover?: number[];
    precipitation?: number[];
  };
  hourly_units?: Record<string, string>;
  utc_offset_seconds?: number;
  reason?: string;
  error?: boolean;
}

interface MarineResponse {
  hourly?: {
    time: string[];
    wave_height?: number[];
    wave_direction?: number[];
    wave_period?: number[];
    wind_wave_height?: number[];
    wind_wave_direction?: number[];
    wind_wave_period?: number[];
    swell_wave_height?: number[];
    swell_wave_direction?: number[];
    swell_wave_period?: number[];
    sea_surface_temperature?: number[];
  };
  hourly_units?: Record<string, string>;
  reason?: string;
  error?: boolean;
}

export class OpenMeteoError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "OpenMeteoError";
  }
}

export interface SailingForecastOptions {
  lat: number;
  lon: number;
  hours: number;
  model: OpenMeteoModel;
  includeWaves: boolean;
  includeSst?: boolean;
}

export interface ConsensusOptions {
  lat: number;
  lon: number;
  hours: number;
  models: OpenMeteoModel[];
}

interface ConsensusResponse {
  hourly?: {
    time: string[];
    [key: string]: number[] | string[] | undefined;
  };
  hourly_units?: Record<string, string>;
  reason?: string;
  error?: boolean;
}

export async function fetchWindConsensus(opts: ConsensusOptions): Promise<{
  time: string[];
  byModel: Record<string, { speed: number[]; gust: number[]; dir: number[] }>;
}> {
  const params = new URLSearchParams({
    latitude: opts.lat.toString(),
    longitude: opts.lon.toString(),
    hourly: "wind_speed_10m,wind_gusts_10m,wind_direction_10m",
    wind_speed_unit: "kn",
    timezone: "UTC",
    forecast_hours: Math.min(opts.hours, 384).toString(),
    models: opts.models.join(","),
  });
  const url = `${FORECAST_URL}?${params}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  if (!res.ok) throw new OpenMeteoError(`Open-Meteo ${res.status}: ${text.slice(0, 500)}`, res.status);
  const data = JSON.parse(text) as ConsensusResponse;
  const h = data.hourly;
  if (!h || !h.time) return { time: [], byModel: {} };

  const byModel: Record<string, { speed: number[]; gust: number[]; dir: number[] }> = {};
  for (const m of opts.models) {
    byModel[m] = {
      speed: (h[`wind_speed_10m_${m}`] as number[]) ?? [],
      gust: (h[`wind_gusts_10m_${m}`] as number[]) ?? [],
      dir: (h[`wind_direction_10m_${m}`] as number[]) ?? [],
    };
  }
  return { time: h.time, byModel };
}

export function formatWindConsensus(
  data: { time: string[]; byModel: Record<string, { speed: number[]; gust: number[]; dir: number[] }> },
  opts: ConsensusOptions,
): string {
  const lines: string[] = [];
  lines.push(`# Wind consensus — multiple models`);
  lines.push(`Coords: ${opts.lat}, ${opts.lon}`);
  lines.push(`Horizon: ${data.time.length}h`);
  lines.push(`Models: ${opts.models.join(", ")}`);
  lines.push(`Units: speed/gust in knots, direction in deg true (where wind FROM).`);
  lines.push("");

  const cols = ["time_utc"];
  for (const m of opts.models) cols.push(`${m}_kn`, `${m}_g`, `${m}_dir`);
  cols.push("min_kn", "max_kn", "spread_kn");
  lines.push(cols.join("\t"));

  for (let i = 0; i < data.time.length; i++) {
    const speeds: number[] = [];
    const cells = [`${data.time[i]}Z`];
    for (const m of opts.models) {
      const s = data.byModel[m].speed[i];
      const g = data.byModel[m].gust[i];
      const d = data.byModel[m].dir[i];
      if (s != null && Number.isFinite(s)) speeds.push(s);
      cells.push(fmt(s, 1), fmt(g, 1), fmt(d, 0));
    }
    if (speeds.length > 0) {
      const mn = Math.min(...speeds);
      const mx = Math.max(...speeds);
      cells.push(round(mn, 1).toString(), round(mx, 1).toString(), round(mx - mn, 1).toString());
    } else {
      cells.push("—", "—", "—");
    }
    lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}

function fmt(n: number | undefined, digits: number): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const f = 10 ** digits;
  return (Math.round(n * f) / f).toString();
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export async function fetchSailingForecast(
  opts: SailingForecastOptions,
): Promise<{
  forecast: ForecastResponse;
  marine: MarineResponse | null;
}> {
  const forecastParams = new URLSearchParams({
    latitude: opts.lat.toString(),
    longitude: opts.lon.toString(),
    hourly:
      "wind_speed_10m,wind_direction_10m,wind_gusts_10m,pressure_msl,temperature_2m,cloud_cover,precipitation",
    wind_speed_unit: "kn",
    timezone: "UTC",
    forecast_hours: Math.min(opts.hours, 384).toString(),
    models: opts.model,
  });

  const fPromise = fetchJson<ForecastResponse>(`${FORECAST_URL}?${forecastParams}`);

  let mPromise: Promise<MarineResponse> | null = null;
  if (opts.includeWaves) {
    const marineParams = new URLSearchParams({
      latitude: opts.lat.toString(),
      longitude: opts.lon.toString(),
      hourly: [
        "wave_height,wave_direction,wave_period",
        "wind_wave_height,wind_wave_direction,wind_wave_period",
        "swell_wave_height,swell_wave_direction,swell_wave_period",
        opts.includeSst ? "sea_surface_temperature" : "",
      ]
        .filter(Boolean)
        .join(","),
      timezone: "UTC",
      forecast_hours: Math.min(opts.hours, 384).toString(),
    });
    mPromise = fetchJson<MarineResponse>(`${MARINE_URL}?${marineParams}`);
  }

  const [forecast, marine] = await Promise.all([
    fPromise,
    mPromise ?? Promise.resolve(null),
  ]);

  return { forecast, marine };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  if (!res.ok) {
    throw new OpenMeteoError(
      `Open-Meteo ${res.status}: ${text.slice(0, 500)}`,
      res.status,
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new OpenMeteoError(`Open-Meteo non-JSON response: ${text.slice(0, 500)}`, res.status);
  }
}

export function formatSailingForecast(
  data: { forecast: ForecastResponse; marine: MarineResponse | null },
  opts: SailingForecastOptions,
): string {
  const h = data.forecast.hourly;
  if (!h || !h.time || h.time.length === 0) {
    return `Open-Meteo returned no hourly data for (${opts.lat}, ${opts.lon}) with model ${opts.model}.`;
  }
  const mh = data.marine?.hourly;

  const rows: string[] = [];
  const cols = ["time_utc", "wind_kn", "gust_kn", "dir_deg", "pressure_hpa", "temp_c", "cloud_pct", "precip_mm"];
  if (opts.includeWaves && mh) {
    cols.push("wave_m", "wave_dir", "wave_period_s", "swell_m", "swell_dir", "swell_period_s");
    if (opts.includeSst) cols.push("sst_c");
  }
  rows.push(cols.join("\t"));

  const marineByTime = new Map<string, number>();
  if (mh?.time) {
    for (let i = 0; i < mh.time.length; i++) marineByTime.set(mh.time[i], i);
  }

  for (let i = 0; i < h.time.length; i++) {
    const t = h.time[i];
    const cells: string[] = [
      `${t}Z`,
      fmt(h.wind_speed_10m?.[i], 1),
      fmt(h.wind_gusts_10m?.[i], 1),
      fmt(h.wind_direction_10m?.[i], 0),
      fmt(h.pressure_msl?.[i], 0),
      fmt(h.temperature_2m?.[i], 1),
      fmt(h.cloud_cover?.[i], 0),
      fmt(h.precipitation?.[i], 2),
    ];
    if (opts.includeWaves && mh) {
      const mi = marineByTime.get(t);
      if (mi != null) {
        cells.push(
          fmt(mh.wave_height?.[mi], 2),
          fmt(mh.wave_direction?.[mi], 0),
          fmt(mh.wave_period?.[mi], 1),
          fmt(mh.swell_wave_height?.[mi], 2),
          fmt(mh.swell_wave_direction?.[mi], 0),
          fmt(mh.swell_wave_period?.[mi], 1),
        );
        if (opts.includeSst) cells.push(fmt(mh.sea_surface_temperature?.[mi], 1));
      } else {
        cells.push("—", "—", "—", "—", "—", "—");
        if (opts.includeSst) cells.push("—");
      }
    }
    rows.push(cells.join("\t"));
  }

  const header = [
    `# Sailing forecast (Open-Meteo)`,
    `Coords: ${opts.lat}, ${opts.lon}`,
    `Model:  ${opts.model}`,
    `Horizon: ${h.time.length}h`,
    opts.includeWaves && !data.marine ? `Note: marine model unavailable for this location.` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const units = [
    "Units: wind kn, dir deg true, pressure hPa, temp °C, cloud %, precip mm/h,",
    "       wave height m, wave dir deg, wave period s.",
  ].join("\n");

  return [header, "", units, "", rows.join("\n")].join("\n");
}
