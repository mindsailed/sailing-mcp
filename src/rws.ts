const BASE = "https://ddapi20-waterwebservices.rijkswaterstaat.nl";

export interface RwsStation {
  code: string;
  name: string;
  lat: number;
  lon: number;
}

export const STATIONS: RwsStation[] = [
  { code: "denhelder.veersteiger", name: "Den Helder (veersteiger)", lat: 52.963, lon: 4.778 },
  { code: "denhelder.marsdiep", name: "Den Helder (Marsdiep)", lat: 52.964, lon: 4.745 },
  { code: "texel.oudeschild", name: "Texel, Oudeschild", lat: 53.039, lon: 4.85 },
  { code: "harlingen.havenmond", name: "Harlingen (havenmond)", lat: 53.176, lon: 5.399 },
  { code: "denoever", name: "Den Oever", lat: 52.935, lon: 5.104 },
  { code: "vlieland.badstrandtbadhuis", name: "Vlieland (Badstrand 't Badhuis)", lat: 53.305, lon: 5.052 },
  { code: "kornwerderzand.buitenboei1", name: "Kornwerderzand (boei 1)", lat: 53.066, lon: 5.286 },
  { code: "lauwersoog.buitenhaven", name: "Lauwersoog (buitenhaven)", lat: 53.415, lon: 6.206 },
  { code: "huibertgat", name: "Huibertgat", lat: 53.574, lon: 6.398 },
  { code: "eemshaven.haven", name: "Eemshaven (haven)", lat: 53.449, lon: 6.828 },
  { code: "delfzijl", name: "Delfzijl", lat: 53.328, lon: 6.931 },
  { code: "ijmuiden", name: "IJmuiden", lat: 52.54, lon: 4.426 },
  { code: "scheveningen", name: "Scheveningen", lat: 52.099, lon: 4.264 },
  { code: "hoekvanholland", name: "Hoek van Holland", lat: 51.977, lon: 4.12 },
  { code: "europlatform", name: "Europlatform", lat: 51.998, lon: 3.275 },
  { code: "k13a", name: "K13a platform", lat: 53.217, lon: 3.219 },
  { code: "vlissingen", name: "Vlissingen", lat: 51.442, lon: 3.6 },
  { code: "stavenisse", name: "Stavenisse", lat: 51.598, lon: 4.004 },
  { code: "zierikzee", name: "Zierikzee", lat: 51.642, lon: 3.911 },
  { code: "stavoren", name: "Stavoren", lat: 52.88, lon: 5.359 },
];

export function findNearestStation(lat: number, lon: number): RwsStation {
  let best = STATIONS[0];
  let bestD = Infinity;
  for (const s of STATIONS) {
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

interface RwsResponse {
  Succesvol: boolean;
  Foutmelding?: string;
  WaarnemingenLijst?: Array<{
    Locatie: { Code: string; Naam: string };
    AquoMetadata: {
      Grootheid: { Code: string; Omschrijving: string };
      Eenheid: { Code: string; Omschrijving: string };
    };
    MetingenLijst: Array<{
      Tijdstip: string;
      Meetwaarde: { Waarde_Numeriek?: number };
    }>;
  }>;
}

export interface TideSeriesPoint {
  time: string;
  value: number;
}

export interface TideExtreme {
  time: string;
  value: number;
  type: "high" | "low";
}

export async function fetchRwsWaterLevel(opts: {
  station: RwsStation;
  start: Date;
  end: Date;
}): Promise<{ unit: string; series: TideSeriesPoint[] }> {
  const body = {
    Locatie: { Code: opts.station.code },
    AquoPlusWaarnemingMetadata: {
      AquoMetadata: {
        Compartiment: { Code: "OW" },
        Grootheid: { Code: "WATHTE" },
      },
    },
    Periode: {
      Begindatumtijd: opts.start.toISOString().replace("Z", "+00:00"),
      Einddatumtijd: opts.end.toISOString().replace("Z", "+00:00"),
    },
  };

  const res = await fetch(
    `${BASE}/ONLINEWAARNEMINGENSERVICES/OphalenWaarnemingen`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (res.status === 204) {
    return { unit: "cm", series: [] };
  }
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`RWS ${res.status}: ${text.slice(0, 500)}`);
  }
  const json = JSON.parse(text) as RwsResponse;
  if (!json.Succesvol) {
    throw new Error(`RWS: ${json.Foutmelding ?? "unknown error"}`);
  }
  const first = json.WaarnemingenLijst?.[0];
  if (!first) {
    return { unit: "cm", series: [] };
  }
  const unit = first.AquoMetadata.Eenheid.Code;
  const series: TideSeriesPoint[] = [];
  for (const m of first.MetingenLijst) {
    const v = m.Meetwaarde.Waarde_Numeriek;
    if (v == null || v === 999999999) continue;
    series.push({ time: m.Tijdstip, value: v });
  }
  return { unit, series };
}

export function findExtremes(series: TideSeriesPoint[]): TideExtreme[] {
  const out: TideExtreme[] = [];
  if (series.length < 3) return out;
  const win = 6;
  for (let i = win; i < series.length - win; i++) {
    const v = series[i].value;
    let isMax = true;
    let isMin = true;
    for (let k = 1; k <= win; k++) {
      if (series[i - k].value >= v) isMax = false;
      if (series[i + k].value > v) isMax = false;
      if (series[i - k].value <= v) isMin = false;
      if (series[i + k].value < v) isMin = false;
      if (!isMax && !isMin) break;
    }
    if (isMax) out.push({ time: series[i].time, value: v, type: "high" });
    else if (isMin) out.push({ time: series[i].time, value: v, type: "low" });
  }
  return out;
}

export function formatTides(opts: {
  station: RwsStation;
  start: Date;
  end: Date;
  data: { unit: string; series: TideSeriesPoint[] };
  showSeriesEvery: number;
}): string {
  const { station, data } = opts;
  const extremes = findExtremes(data.series);

  const header = [
    `# Water level — ${station.name} (${station.code})`,
    `Source: Rijkswaterstaat Waterinfo, WATHTE (observed)`,
    `Coords: ${station.lat}, ${station.lon}`,
    `Period: ${opts.start.toISOString()} → ${opts.end.toISOString()}`,
    `Datum:  NAP (Normaal Amsterdams Peil), units: ${data.unit}`,
    `Points: ${data.series.length}`,
    data.series.length === 0
      ? `Note: no data — RWS only returns observed measurements (past). For future tide predictions use tides_worldtides.`
      : `Note: WATHTE is OBSERVED water level (not astronomical prediction). The new RWS API removed the astronomical-prediction endpoint — use tides_worldtides for future predictions.`,
  ]
    .filter(Boolean)
    .join("\n");

  const blocks = [header];

  if (extremes.length > 0) {
    const lines = ["## High / Low water (observed)", "time_utc\ttype\tvalue_cm_NAP"];
    for (const e of extremes) {
      lines.push(`${toUtcIso(e.time)}\t${e.type === "high" ? "HW" : "LW"}\t${e.value}`);
    }
    blocks.push(lines.join("\n"));
  }

  if (data.series.length > 0) {
    const step = Math.max(1, opts.showSeriesEvery);
    const lines = ["## Water level series", "time_utc\tvalue_cm_NAP"];
    for (let i = 0; i < data.series.length; i += step) {
      const p = data.series[i];
      lines.push(`${toUtcIso(p.time)}\t${p.value}`);
    }
    if (step > 1) lines.push(`(every ${step} points of ${data.series.length}; raw is 10-min interval)`);
    blocks.push(lines.join("\n"));
  }

  return blocks.join("\n\n");
}

function toUtcIso(rwsTime: string): string {
  return new Date(rwsTime).toISOString();
}
