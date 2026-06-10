const BASE = "https://www.worldtides.info/api/v3";

export interface WorldTidesResponse {
  status: number;
  error?: string;
  callCount?: number;
  copyright?: string;
  requestLat?: number;
  requestLon?: number;
  responseLat?: number;
  responseLon?: number;
  atlas?: string;
  station?: string;
  timezone?: string;
  datum?: string;
  datums?: Array<{ name: string; height: number }>;
  heights?: Array<{ dt: number; date: string; height: number }>;
  extremes?: Array<{ dt: number; date: string; height: number; type: "High" | "Low" }>;
}

export interface WorldTidesOptions {
  lat: number;
  lon: number;
  days: number;
  includeHeights: boolean;
  includeExtremes: boolean;
  key: string;
  datum?: string;
}

export async function fetchWorldTides(
  opts: WorldTidesOptions,
): Promise<WorldTidesResponse> {
  const params = new URLSearchParams({
    lat: opts.lat.toString(),
    lon: opts.lon.toString(),
    days: opts.days.toString(),
    key: opts.key,
  });
  if (opts.includeHeights) params.append("heights", "");
  if (opts.includeExtremes) params.append("extremes", "");
  if (opts.datum) params.set("datum", opts.datum);

  const res = await fetch(`${BASE}?${params.toString()}`, { signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  let json: WorldTidesResponse;
  try {
    json = JSON.parse(text) as WorldTidesResponse;
  } catch {
    throw new Error(`WorldTides non-JSON response: ${text.slice(0, 500)}`);
  }
  if (!res.ok || json.status >= 400 || json.error) {
    throw new Error(
      `WorldTides ${json.status ?? res.status}: ${json.error ?? text.slice(0, 500)}`,
    );
  }
  return json;
}

export function formatWorldTides(
  data: WorldTidesResponse,
  opts: WorldTidesOptions,
): string {
  const header = [
    `# Tides — WorldTides`,
    `Coords requested: ${opts.lat}, ${opts.lon}`,
    data.responseLat != null
      ? `Coords resolved:  ${data.responseLat}, ${data.responseLon}`
      : "",
    data.station ? `Station: ${data.station}` : `Source: ${data.atlas ?? "harmonic"}`,
    `Datum: ${data.datum ?? "?"}`,
    `Days:  ${opts.days}`,
    data.callCount != null ? `Credits used this call: ${data.callCount}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const blocks: string[] = [header];

  if (data.extremes && data.extremes.length > 0) {
    const lines = ["## High / Low water", "time_utc\ttype\theight_m"];
    for (const e of data.extremes) {
      lines.push(`${new Date(e.dt * 1000).toISOString()}\t${e.type === "High" ? "HW" : "LW"}\t${round(e.height, 3)}`);
    }
    blocks.push(lines.join("\n"));
  }

  if (data.heights && data.heights.length > 0) {
    const step = Math.max(1, Math.ceil(data.heights.length / 96));
    const lines = ["## Water level series", "time_utc\theight_m"];
    for (let i = 0; i < data.heights.length; i += step) {
      const h = data.heights[i];
      lines.push(`${new Date(h.dt * 1000).toISOString()}\t${round(h.height, 3)}`);
    }
    if (step > 1) lines.push(`(downsampled: every ${step} points of ${data.heights.length})`);
    blocks.push(lines.join("\n"));
  }

  return blocks.join("\n\n");
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
