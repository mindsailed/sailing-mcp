const WINDY_POINT_FORECAST_URL = "https://api.windy.com/api/point-forecast/v2";

export type WindyModel =
  | "gfs"
  | "gfsWave"
  | "ecmwf"
  | "ecmwfWaves"
  | "iconEu"
  | "iconEuWaves"
  | "namConus"
  | "namHawaii"
  | "namAlaska"
  | "arome"
  | "geos5";

export type WindyParameter =
  | "temp"
  | "dewpoint"
  | "precip"
  | "convPrecip"
  | "snowPrecip"
  | "wind"
  | "windGust"
  | "cape"
  | "ptype"
  | "lclouds"
  | "mclouds"
  | "hclouds"
  | "rh"
  | "gh"
  | "pressure"
  | "waves"
  | "windWaves"
  | "swell1"
  | "swell2";

export type WindyLevel =
  | "surface"
  | "1000h"
  | "950h"
  | "925h"
  | "900h"
  | "850h"
  | "800h"
  | "700h"
  | "600h"
  | "500h"
  | "400h"
  | "300h"
  | "250h"
  | "200h"
  | "150h";

export interface PointForecastRequest {
  lat: number;
  lon: number;
  model: WindyModel;
  parameters: WindyParameter[];
  levels?: WindyLevel[];
  key: string;
}

export interface PointForecastResponse {
  ts: number[];
  units: Record<string, string>;
  warning?: string;
  [param: string]: unknown;
}

export class WindyApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = "WindyApiError";
  }
}

export async function fetchPointForecast(
  req: PointForecastRequest,
): Promise<PointForecastResponse> {
  const body: Record<string, unknown> = {
    lat: req.lat,
    lon: req.lon,
    model: req.model,
    parameters: req.parameters,
    levels: req.levels && req.levels.length > 0 ? req.levels : ["surface"],
    key: req.key,
  };

  const res = await fetch(WINDY_POINT_FORECAST_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new WindyApiError(
      `Windy API error ${res.status}`,
      res.status,
      text.slice(0, 2000),
    );
  }

  try {
    return JSON.parse(text) as PointForecastResponse;
  } catch {
    throw new WindyApiError(
      "Windy API returned non-JSON response",
      res.status,
      text.slice(0, 2000),
    );
  }
}

export function formatForecastForSailing(
  data: PointForecastResponse,
  opts: { lat: number; lon: number; model: WindyModel; maxRows?: number },
): string {
  const maxRows = opts.maxRows ?? 48;
  const ts = data.ts ?? [];
  if (ts.length === 0) {
    return `No forecast data returned by ${opts.model} for (${opts.lat}, ${opts.lon}).`;
  }

  const keys = Object.keys(data).filter(
    (k) => k !== "ts" && k !== "units" && k !== "warning",
  );

  const header = [
    `# Windy Point Forecast`,
    `Coords: ${opts.lat}, ${opts.lon}`,
    `Model:  ${opts.model}`,
    `Steps:  ${Math.min(ts.length, maxRows)} of ${ts.length}`,
    data.warning ? `Warning: ${data.warning}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const unitsLine = `Units: ${JSON.stringify(data.units ?? {})}`;

  const cols = ["time", ...keys];
  const rows: string[] = [cols.join("\t")];

  for (let i = 0; i < Math.min(ts.length, maxRows); i++) {
    const iso = new Date(ts[i]).toISOString();
    const cells = [iso];
    for (const k of keys) {
      const v = (data[k] as number[] | undefined)?.[i];
      cells.push(typeof v === "number" ? round(v, 3).toString() : "—");
    }
    rows.push(cells.join("\t"));
  }

  return [header, "", unitsLine, "", rows.join("\n")].join("\n");
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function deriveWindKnots(
  data: PointForecastResponse,
): { knots: number[]; gustKnots: number[]; dirDeg: number[] } | null {
  const keys = Object.keys(data);
  const surfaceU = keys.find((k) => k.startsWith("wind_u-surface"));
  const surfaceV = keys.find((k) => k.startsWith("wind_v-surface"));
  const gust = keys.find((k) => k.startsWith("gust-surface"));
  if (!surfaceU || !surfaceV) return null;

  const u = data[surfaceU] as number[];
  const v = data[surfaceV] as number[];
  const g = (gust ? (data[gust] as number[]) : []) ?? [];

  const knots: number[] = [];
  const gustKnots: number[] = [];
  const dirDeg: number[] = [];
  const MS_TO_KNOTS = 1.94384;

  for (let i = 0; i < u.length; i++) {
    const speed = Math.hypot(u[i], v[i]) * MS_TO_KNOTS;
    knots.push(round(speed, 1));
    const gustSpeed = g[i] != null ? g[i] * MS_TO_KNOTS : NaN;
    gustKnots.push(Number.isFinite(gustSpeed) ? round(gustSpeed, 1) : NaN);
    const dir = (Math.atan2(-u[i], -v[i]) * 180) / Math.PI;
    dirDeg.push(round((dir + 360) % 360, 0));
  }

  return { knots, gustKnots, dirDeg };
}
