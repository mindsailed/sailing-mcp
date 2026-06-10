const BASE = "https://noos.matroos.rws.nl/direct/get_series.php";

export interface MatroosStation {
  code: string;
  name: string;
  lat: number;
  lon: number;
}

export const MATROOS_STATIONS: MatroosStation[] = [
  { code: "denhelder.marsdiep", name: "Den Helder (Marsdiep)", lat: 52.965, lon: 4.745 },
  { code: "denhelder", name: "Den Helder", lat: 52.964, lon: 4.745 },
  { code: "texelnoordzee", name: "Texel Noordzee", lat: 53.132, lon: 4.747 },
  { code: "harlingen", name: "Harlingen", lat: 53.176, lon: 5.41 },
  { code: "westterschelling", name: "West-Terschelling", lat: 53.36, lon: 5.22 },
  { code: "vlielandhaven", name: "Vlieland Haven", lat: 53.296, lon: 5.1 },
  { code: "denoever", name: "Den Oever", lat: 52.935, lon: 5.104 },
  { code: "kornwerderzand", name: "Kornwerderzand", lat: 53.066, lon: 5.286 },
  { code: "lauwersoog", name: "Lauwersoog", lat: 53.415, lon: 6.206 },
  { code: "huibertgat", name: "Huibertgat", lat: 53.574, lon: 6.398 },
  { code: "eemshaven", name: "Eemshaven", lat: 53.449, lon: 6.828 },
  { code: "delfzijl", name: "Delfzijl", lat: 53.328, lon: 6.931 },
  { code: "ijmuiden", name: "IJmuiden", lat: 52.54, lon: 4.426 },
  { code: "scheveningen", name: "Scheveningen", lat: 52.099, lon: 4.264 },
  { code: "hoekvanholland", name: "Hoek van Holland", lat: 51.977, lon: 4.12 },
  { code: "europlatform", name: "Europlatform", lat: 51.998, lon: 3.275 },
  { code: "k13a", name: "K13a platform", lat: 53.217, lon: 3.219 },
  { code: "vlissingen", name: "Vlissingen", lat: 51.442, lon: 3.6 },
];

export function findNearestMatroosStation(lat: number, lon: number): MatroosStation {
  let best = MATROOS_STATIONS[0];
  let bestD = Infinity;
  for (const s of MATROOS_STATIONS) {
    const dx = s.lon - lon;
    const dy = s.lat - lat;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

export interface SeriesPoint {
  time: Date;
  value: number;
}

export async function fetchSeries(opts: {
  loc: string;
  source: string;
  unit: string;
  start: Date;
  end: Date;
}): Promise<SeriesPoint[]> {
  const params = new URLSearchParams({
    loc: opts.loc,
    source: opts.source,
    unit: opts.unit,
    format: "text",
    tstart: formatYYYYMMDDHHMM(opts.start),
    tstop: formatYYYYMMDDHHMM(opts.end),
  });
  const res = await fetch(`${BASE}?${params}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Matroos ${res.status} for ${opts.source}/${opts.unit} at ${opts.loc}`);
  const text = await res.text();
  if (text.includes("no data found")) return [];
  const out: SeriesPoint[] = [];
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const parts = line.trim().split(/\s+/);
    if (parts.length < 2) continue;
    const t = parseMatroosTime(parts[0]);
    const v = parseFloat(parts[1]);
    if (Number.isFinite(v) && t) out.push({ time: t, value: v });
  }
  return out;
}

function formatYYYYMMDDHHMM(d: Date): string {
  const y = d.getUTCFullYear();
  const m = pad(d.getUTCMonth() + 1);
  const day = pad(d.getUTCDate());
  const h = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  return `${y}${m}${day}${h}${mi}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

function parseMatroosTime(s: string): Date | null {
  if (s.length !== 12) return null;
  const y = +s.slice(0, 4);
  const m = +s.slice(4, 6);
  const d = +s.slice(6, 8);
  const h = +s.slice(8, 10);
  const mi = +s.slice(10, 12);
  if (![y, m, d, h, mi].every(Number.isFinite)) return null;
  return new Date(Date.UTC(y, m - 1, d, h, mi));
}

export interface NlTideReport {
  station: MatroosStation;
  hwlw: SeriesPoint[];
  astronomical: SeriesPoint[];
  forecast: SeriesPoint[];
  observed: SeriesPoint[];
  surge: SeriesPoint[];
  sst: SeriesPoint[];
}

export async function fetchNlTides(opts: {
  station: MatroosStation;
  start: Date;
  end: Date;
  includeAstro: boolean;
  includeObserved: boolean;
  includeForecast: boolean;
  includeSurge: boolean;
  includeSst: boolean;
}): Promise<NlTideReport> {
  const calls: Array<Promise<SeriesPoint[]>> = [
    fetchSeries({ loc: opts.station.code, source: "observed", unit: "waterlevel_astro_hwlw", start: opts.start, end: opts.end }),
  ];
  const slots: Array<keyof NlTideReport> = ["hwlw"];

  if (opts.includeAstro) {
    calls.push(fetchSeries({ loc: opts.station.code, source: "observed", unit: "waterlevel_astro", start: opts.start, end: opts.end }));
    slots.push("astronomical");
  }
  if (opts.includeObserved) {
    calls.push(fetchSeries({ loc: opts.station.code, source: "observed", unit: "waterlevel", start: opts.start, end: opts.end }));
    slots.push("observed");
  }
  if (opts.includeForecast) {
    calls.push(fetchSeries({ loc: opts.station.code, source: "rws_prediction", unit: "waterlevel", start: opts.start, end: opts.end }));
    slots.push("forecast");
  }
  if (opts.includeSurge) {
    calls.push(fetchSeries({ loc: opts.station.code, source: "rws_prediction", unit: "waterlevel_surge", start: opts.start, end: opts.end }));
    slots.push("surge");
  }
  if (opts.includeSst) {
    calls.push(fetchSeries({ loc: opts.station.code, source: "observed", unit: "water_temperature", start: opts.start, end: opts.end }));
    slots.push("sst");
  }

  const results = await Promise.all(calls);
  const out: NlTideReport = {
    station: opts.station,
    hwlw: [],
    astronomical: [],
    forecast: [],
    observed: [],
    surge: [],
    sst: [],
  };
  for (let i = 0; i < slots.length; i++) {
    (out[slots[i]] as SeriesPoint[]) = results[i];
  }
  return out;
}

export function formatNlTides(report: NlTideReport, opts: { start: Date; end: Date; downsample: number }): string {
  const lines: string[] = [];
  lines.push(`# Tides — ${report.station.name} (${report.station.code})`);
  lines.push(`Source: Matroos / RWS (observed astronomical & HW/LW from harmonic constants; forecast from RWS operational DCSM).`);
  lines.push(`Coords: ${report.station.lat}, ${report.station.lon}`);
  lines.push(`Period: ${report.station.code === "" ? "" : ""}${opts.start.toISOString()} → ${opts.end.toISOString()}`);
  lines.push(`Datum:  NAP. Values in metres.`);

  if (report.hwlw.length > 0) {
    lines.push("");
    lines.push("## High / Low water (astronomical, RWS harmonic)");
    lines.push("time_utc\ttype\theight_m");
    const ext = classifyHwlw(report.hwlw);
    for (const p of ext) lines.push(`${p.time.toISOString()}\t${p.type}\t${p.value.toFixed(2)}`);
  }

  if (report.observed.length > 0 || report.astronomical.length > 0 || report.forecast.length > 0 || report.surge.length > 0) {
    lines.push("");
    lines.push("## Water level time series (m, NAP)");
    const allTimes = collectTimes(report);
    const cols = ["time_utc"];
    if (report.observed.length > 0) cols.push("observed");
    if (report.astronomical.length > 0) cols.push("astro");
    if (report.forecast.length > 0) cols.push("forecast");
    if (report.surge.length > 0) cols.push("surge");
    lines.push(cols.join("\t"));

    const mObs = toMap(report.observed);
    const mAst = toMap(report.astronomical);
    const mFc = toMap(report.forecast);
    const mSrg = toMap(report.surge);

    const step = Math.max(1, opts.downsample);
    for (let i = 0; i < allTimes.length; i += step) {
      const t = allTimes[i];
      const cells = [t.toISOString()];
      if (report.observed.length > 0) cells.push(fmtNum(mObs.get(t.getTime())));
      if (report.astronomical.length > 0) cells.push(fmtNum(mAst.get(t.getTime())));
      if (report.forecast.length > 0) cells.push(fmtNum(mFc.get(t.getTime())));
      if (report.surge.length > 0) cells.push(fmtNum(mSrg.get(t.getTime())));
      lines.push(cells.join("\t"));
    }
    if (step > 1) lines.push(`(every ${step} of ${allTimes.length} timestamps; native interval is 10 min)`);
  }

  if (report.sst.length > 0) {
    lines.push("");
    lines.push("## Water temperature (°C, observed)");
    const last = report.sst[report.sst.length - 1];
    const avg = report.sst.reduce((s, p) => s + p.value, 0) / report.sst.length;
    lines.push(`current: ${last.value.toFixed(1)}°C @ ${last.time.toISOString()}`);
    lines.push(`avg over period: ${avg.toFixed(1)}°C  (${report.sst.length} samples)`);
  }

  if (
    report.hwlw.length === 0 &&
    report.observed.length === 0 &&
    report.astronomical.length === 0 &&
    report.forecast.length === 0 &&
    report.surge.length === 0
  ) {
    lines.push("");
    lines.push(`Note: no data for ${report.station.code} in this period. Some sources are only published for select stations.`);
  }

  return lines.join("\n");
}

function classifyHwlw(points: SeriesPoint[]): Array<SeriesPoint & { type: "HW" | "LW" }> {
  const out: Array<SeriesPoint & { type: "HW" | "LW" }> = [];
  for (let i = 0; i < points.length; i++) {
    let type: "HW" | "LW";
    const prev = points[i - 1];
    const next = points[i + 1];
    if (prev) type = points[i].value > prev.value ? "HW" : "LW";
    else if (next) type = points[i].value > next.value ? "HW" : "LW";
    else type = points[i].value > 0 ? "HW" : "LW";
    out.push({ ...points[i], type });
  }
  return out;
}

function collectTimes(r: NlTideReport): Date[] {
  const set = new Map<number, Date>();
  for (const arr of [r.observed, r.astronomical, r.forecast, r.surge]) {
    for (const p of arr) set.set(p.time.getTime(), p.time);
  }
  return Array.from(set.values()).sort((a, b) => a.getTime() - b.getTime());
}

function toMap(arr: SeriesPoint[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const p of arr) m.set(p.time.getTime(), p.value);
  return m;
}

function fmtNum(v: number | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(2);
}
