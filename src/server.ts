import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  deriveWindKnots,
  fetchPointForecast,
  formatForecastForSailing,
  WindyApiError,
  type WindyLevel,
  type WindyModel,
  type WindyParameter,
} from "./windy.js";
import {
  fetchSailingForecast as fetchOpenMeteo,
  fetchWindConsensus,
  formatSailingForecast as formatOpenMeteo,
  formatWindConsensus,
  OpenMeteoError,
  type OpenMeteoModel,
} from "./openmeteo.js";
import { fetchMetar, fetchTaf, findNearestAirport, formatMetarTaf } from "./aviationweather.js";
import { formatSunMoon } from "./sunmoon.js";
import {
  MATROOS_STATIONS,
  fetchNlTides,
  findNearestMatroosStation,
  formatNlTides,
  type MatroosStation,
} from "./matroos.js";
import { fetchOsmPois, formatPois, type OsmPoiKind } from "./osm.js";
import { formatBridgeReport, queryBridges } from "./ndw.js";
import { collectVessels, formatVessels } from "./aisstream.js";
import { formatNotices, queryNotices, type NtsMessageType } from "./nts.js";
import { formatFairway, queryFairway, type FairwayCategory } from "./fairway.js";
import {
  STATIONS as RWS_STATIONS,
  fetchRwsWaterLevel,
  findNearestStation,
  formatTides as formatRwsTides,
  type RwsStation,
} from "./rws.js";
import { fetchWorldTides, formatWorldTides } from "./worldtides.js";
import { fetchCurrents, formatCurrents } from "./stormglass.js";
import { type RequestKeys } from "./keys.js";

const ModelEnum = z.enum([
  "gfs",
  "gfsWave",
  "ecmwf",
  "ecmwfWaves",
  "iconEu",
  "iconEuWaves",
  "namConus",
  "namHawaii",
  "namAlaska",
  "arome",
  "geos5",
]);

const ParameterEnum = z.enum([
  "temp",
  "dewpoint",
  "precip",
  "convPrecip",
  "snowPrecip",
  "wind",
  "windGust",
  "cape",
  "ptype",
  "lclouds",
  "mclouds",
  "hclouds",
  "rh",
  "gh",
  "pressure",
  "waves",
  "windWaves",
  "swell1",
  "swell2",
]);

const LevelEnum = z.enum([
  "surface",
  "1000h",
  "950h",
  "925h",
  "900h",
  "850h",
  "800h",
  "700h",
  "600h",
  "500h",
  "400h",
  "300h",
  "250h",
  "200h",
  "150h",
]);

export function createMcpServer(keys: RequestKeys = {}): McpServer {
  const server = new McpServer(
    { name: "windy-mcp", version: "0.3.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "Sailing navigation. Wind/wave forecasts via Open-Meteo (free) and optionally Windy. Tides via RWS (NL observed) and optionally WorldTides (global predictions). Currents via Stormglass when key is provided. Tools that require a key only appear when that key is set on the MCP URL. All times UTC.",
    },
  );

  if (keys.windy) registerWindyTools(server, keys.windy);
  registerOpenMeteoTool(server);
  registerWindConsensusTool(server);
  registerMetarTafTool(server);
  registerSunMoonTool(server);
  registerRwsTool(server);
  registerMatroosTool(server);
  registerOsmTool(server);
  registerBridgesNlTool(server);
  registerNoticesNlTool(server);
  registerFairwayNlTool(server);
  if (keys.worldtides) registerWorldTidesTool(server, keys.worldtides);
  if (keys.stormglass) registerStormglassTool(server, keys.stormglass);
  if (keys.aisstream) registerAisTool(server, keys.aisstream);
  registerListModelsTool(server);
  return server;
}

function registerWindyTools(server: McpServer, key: string): void {
  server.registerTool(
    "point_forecast",
    {
      title: "Windy Point Forecast (raw)",
      description:
        "Raw Windy Point Forecast API call. Returns the JSON payload pretty-printed as a table. Use sailing_forecast for a sailing-friendly preset.",
      inputSchema: {
        lat: z.number().min(-90).max(90).describe("Latitude in decimal degrees"),
        lon: z.number().min(-180).max(180).describe("Longitude in decimal degrees"),
        model: ModelEnum.default("gfs").describe(
          "Forecast model. gfs = global (free). ecmwf is Premium. gfsWave / iconEuWaves for waves.",
        ),
        parameters: z
          .array(ParameterEnum)
          .min(1)
          .describe("Parameters to fetch, e.g. ['wind','windGust','pressure']"),
        levels: z
          .array(LevelEnum)
          .optional()
          .describe("Pressure levels. Default surface only."),
        maxRows: z
          .number()
          .int()
          .min(1)
          .max(384)
          .optional()
          .describe("How many timesteps to include in output (default 48)."),
      },
    },
    async (args) => {
      try {
        const data = await fetchPointForecast({
          lat: args.lat,
          lon: args.lon,
          model: args.model as WindyModel,
          parameters: args.parameters as WindyParameter[],
          levels: args.levels as WindyLevel[] | undefined,
          key,
        });
        const text = formatForecastForSailing(data, {
          lat: args.lat,
          lon: args.lon,
          model: args.model as WindyModel,
          maxRows: args.maxRows,
        });
        return { content: [{ type: "text", text }] };
      } catch (err) {
        return windyError(err);
      }
    },
  );

  server.registerTool(
    "sailing_forecast",
    {
      title: "Sailing forecast (wind in knots + waves)",
      description:
        "Sailing-friendly preset. Fetches surface wind, gust, pressure and waves; converts wind to knots and degrees true. Use this for general sailing navigation queries.",
      inputSchema: {
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        model: ModelEnum.default("gfs").describe(
          "Use gfs for global free model. For wave-aware sailing in Europe try iconEuWaves; offshore try gfsWave.",
        ),
        includeWaves: z.boolean().default(true).describe(
          "Include wave parameters (set false if your model doesn't support waves)",
        ),
        hours: z
          .number()
          .int()
          .min(1)
          .max(240)
          .default(48)
          .describe("Forecast horizon in hours (3-hour steps; <= 240h)"),
      },
    },
    async (args) => {
      try {
        const parameters: WindyParameter[] = ["wind", "windGust", "pressure", "temp"];
        if (args.includeWaves) parameters.push("waves");
        const data = await fetchPointForecast({
          lat: args.lat,
          lon: args.lon,
          model: args.model as WindyModel,
          parameters,
          key,
        });

        const wind = deriveWindKnots(data);
        const rows: string[] = [];
        const ts = data.ts ?? [];
        const maxRows = Math.min(ts.length, Math.ceil(args.hours / 3));

        const cols = ["time_utc", "wind_kn", "gust_kn", "dir_deg", "pressure_pa", "temp_c"];
        if (args.includeWaves) cols.push("wave_height_m", "wave_dir_deg", "wave_period_s");
        rows.push(cols.join("\t"));

        const pressureKey = Object.keys(data).find((k) => k.startsWith("pressure-surface"));
        const tempKey = Object.keys(data).find((k) => k.startsWith("temp-surface"));
        const waveHKey = Object.keys(data).find((k) => k.startsWith("waves_height-surface"));
        const waveDKey = Object.keys(data).find((k) => k.startsWith("waves_direction-surface"));
        const wavePKey = Object.keys(data).find((k) => k.startsWith("waves_period-surface"));

        for (let i = 0; i < maxRows; i++) {
          const iso = new Date(ts[i]).toISOString();
          const cells = [
            iso,
            wind ? wind.knots[i]?.toString() ?? "—" : "—",
            wind ? (Number.isFinite(wind.gustKnots[i]) ? wind.gustKnots[i].toString() : "—") : "—",
            wind ? wind.dirDeg[i]?.toString() ?? "—" : "—",
            pressureKey ? formatNum((data[pressureKey] as number[])[i], 0) : "—",
            tempKey ? formatNum((data[tempKey] as number[])[i] - 273.15, 1) : "—",
          ];
          if (args.includeWaves) {
            cells.push(
              waveHKey ? formatNum((data[waveHKey] as number[])[i], 2) : "—",
              waveDKey ? formatNum((data[waveDKey] as number[])[i], 0) : "—",
              wavePKey ? formatNum((data[wavePKey] as number[])[i], 1) : "—",
            );
          }
          rows.push(cells.join("\t"));
        }

        const header = [
          `# Sailing forecast`,
          `Coords: ${args.lat}, ${args.lon}`,
          `Model:  ${args.model}`,
          `Horizon: ${maxRows * 3}h (${maxRows} steps)`,
          data.warning ? `Warning: ${data.warning}` : "",
        ]
          .filter(Boolean)
          .join("\n");

        return {
          content: [
            {
              type: "text",
              text: [header, "", rows.join("\n")].join("\n"),
            },
          ],
        };
      } catch (err) {
        return windyError(err);
      }
    },
  );
}

function registerOpenMeteoTool(server: McpServer): void {
  const OpenMeteoModelEnum = z.enum([
    "best_match",
    "ecmwf_ifs025",
    "ecmwf_ifs04",
    "gfs_seamless",
    "gfs_global",
    "gfs_hrrr",
    "icon_seamless",
    "icon_global",
    "icon_eu",
    "icon_d2",
    "ukmo_seamless",
    "ukmo_global_deterministic_10km",
    "meteofrance_seamless",
    "meteofrance_arpege_europe",
    "meteofrance_arome_france_hd",
    "jma_seamless",
  ]);

  server.registerTool(
    "sailing_forecast_openmeteo",
    {
      title: "Sailing forecast via Open-Meteo (free)",
      description:
        "Free alternative to Windy. Uses Open-Meteo Forecast + Marine API. No key required. Returns wind in knots, gust, direction, pressure, temperature, clouds, precipitation, and (optionally) wave height/direction/period and swell. ECMWF, GFS, ICON, UKMO, Météo-France and JMA available. Hourly steps. Default: a horizon of `hours` from now (max 384h). For a FUTURE trip, pass startDate+endDate (ISO yyyy-mm-dd) to fetch exactly those days (up to ~16 days ahead) instead.",
      inputSchema: {
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        model: OpenMeteoModelEnum.default("best_match").describe(
          "Forecast model. best_match auto-picks the best regional model. ecmwf_ifs025 = ECMWF 0.25°. gfs_seamless = NOAA GFS. icon_eu = DWD ICON-EU for Europe. meteofrance_arome_france_hd for France high-res.",
        ),
        hours: z
          .number()
          .int()
          .min(1)
          .max(384)
          .default(48)
          .describe("Forecast horizon in hours (hourly steps; max 384 = 16 days)."),
        includeWaves: z
          .boolean()
          .default(true)
          .describe(
            "Add wave height/direction/period + swell from Open-Meteo Marine API. Marine data is global but coastal/inland points may return null.",
          ),
        includeSst: z
          .boolean()
          .default(false)
          .describe("Add sea-surface temperature (°C) from Marine API. Useful for sea-breeze and comfort estimates."),
        startDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe(
            "ISO yyyy-mm-dd. With endDate, fetch this DATE WINDOW (e.g. the days of a future trip) instead of a horizon from now — Open-Meteo covers up to ~16 days ahead. Overrides `hours`.",
          ),
        endDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("ISO yyyy-mm-dd. End of the date window (inclusive). Use together with startDate."),
      },
    },
    async (args) => {
      try {
        const data = await fetchOpenMeteo({
          lat: args.lat,
          lon: args.lon,
          hours: args.hours,
          model: args.model as OpenMeteoModel,
          includeWaves: args.includeWaves,
          includeSst: args.includeSst,
          startDate: args.startDate,
          endDate: args.endDate,
        });
        const text = formatOpenMeteo(data, {
          lat: args.lat,
          lon: args.lon,
          hours: args.hours,
          model: args.model as OpenMeteoModel,
          includeWaves: args.includeWaves,
          includeSst: args.includeSst,
        });
        return { content: [{ type: "text", text }] };
      } catch (err) {
        if (err instanceof OpenMeteoError) {
          return {
            isError: true,
            content: [{ type: "text", text: err.message }],
          };
        }
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: `Error: ${msg}` }] };
      }
    },
  );
}

function registerWindConsensusTool(server: McpServer): void {
  const ModelEnum = z.enum([
    "best_match",
    "ecmwf_ifs025",
    "ecmwf_ifs04",
    "gfs_seamless",
    "gfs_global",
    "gfs_hrrr",
    "icon_seamless",
    "icon_global",
    "icon_eu",
    "icon_d2",
    "ukmo_seamless",
    "ukmo_global_deterministic_10km",
    "meteofrance_seamless",
    "meteofrance_arpege_europe",
    "meteofrance_arome_france_hd",
    "jma_seamless",
  ]);
  server.registerTool(
    "wind_consensus",
    {
      title: "Wind consensus across forecast models",
      description:
        "Single Open-Meteo call returning wind speed (knots), gust, direction for multiple models side-by-side, plus the min/max/spread across models. Use to quantify forecast uncertainty: a tight spread means the models agree; a wide spread is a warning.",
      inputSchema: {
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        hours: z.number().int().min(1).max(384).default(48),
        models: z
          .array(ModelEnum)
          .min(2)
          .max(8)
          .default(["ecmwf_ifs025", "gfs_seamless", "icon_eu", "ukmo_seamless", "meteofrance_arpege_europe"])
          .describe("Models to compare. Defaults to ECMWF + GFS + ICON-EU + UKMO + Météo-France ARPEGE."),
        startDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("ISO yyyy-mm-dd. With endDate, compare models over this DATE WINDOW (a future trip) instead of a horizon from now. Overrides `hours`."),
        endDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("ISO yyyy-mm-dd. End of the date window (inclusive). Use together with startDate."),
      },
    },
    async (args) => {
      try {
        const data = await fetchWindConsensus({
          lat: args.lat,
          lon: args.lon,
          hours: args.hours,
          models: args.models as OpenMeteoModel[],
          startDate: args.startDate,
          endDate: args.endDate,
        });
        const text = formatWindConsensus(data, {
          lat: args.lat,
          lon: args.lon,
          hours: args.hours,
          models: args.models as OpenMeteoModel[],
        });
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: msg }] };
      }
    },
  );
}

function registerMetarTafTool(server: McpServer): void {
  server.registerTool(
    "metar_taf",
    {
      title: "Actual airport weather — METAR + TAF",
      description:
        "Current METAR observations and TAF forecast for an airport. Use to cross-check forecasts against ground truth — coastal aerodromes (EHKD De Kooy, EHAM, EGSH, etc.) report actual wind, gusts, visibility, pressure, cloud base every 30 min. Source: aviationweather.gov (no key).",
      inputSchema: {
        icao: z
          .string()
          .optional()
          .describe("4-letter ICAO code (e.g. EHKD = Den Helder, EHAM = Schiphol, EGSH = Norwich). If omitted, the nearest airport from a built-in list is used."),
        lat: z.number().min(-90).max(90).optional(),
        lon: z.number().min(-180).max(180).optional(),
        hours: z.number().int().min(1).max(48).default(3).describe("How many hours of METAR history to fetch."),
      },
    },
    async (args) => {
      try {
        let icao = args.icao?.toUpperCase();
        let near: { icao: string; name: string; distKm: number } | undefined;
        if (!icao) {
          if (args.lat == null || args.lon == null) {
            return {
              isError: true,
              content: [{ type: "text", text: "Provide either 'icao' or 'lat'+'lon'." }],
            };
          }
          near = findNearestAirport(args.lat, args.lon);
          icao = near.icao;
        }
        const [metars, tafs] = await Promise.all([fetchMetar(icao, args.hours), fetchTaf(icao)]);
        const text = formatMetarTaf({
          icao,
          airportName: near?.name,
          distKm: near?.distKm,
          metars,
          tafs,
        });
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: msg }] };
      }
    },
  );
}

function registerSunMoonTool(server: McpServer): void {
  server.registerTool(
    "sun_moon",
    {
      title: "Sun & moon — sunrise / sunset / twilights / moon phase",
      description:
        "Astronomical events for planning: civil/nautical/astronomical twilight, sunrise, sunset, solar noon, moonrise/moonset, moon phase and illumination. Pure calculation (SunCalc), no API.",
      inputSchema: {
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        date: z
          .string()
          .optional()
          .describe("Start date YYYY-MM-DD (UTC). Defaults to today."),
        days: z.number().int().min(1).max(14).default(3),
      },
    },
    async (args) => {
      try {
        const date = args.date ? new Date(args.date + "T00:00:00Z") : new Date();
        if (Number.isNaN(date.getTime())) {
          return { isError: true, content: [{ type: "text", text: `Invalid date '${args.date}'.` }] };
        }
        const text = formatSunMoon({ lat: args.lat, lon: args.lon, date, days: args.days });
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: msg }] };
      }
    },
  );
}

function registerMatroosTool(server: McpServer): void {
  server.registerTool(
    "tides_nl",
    {
      title: "Tides NL — astronomical, forecast, surge, observed (Matroos / RWS)",
      description:
        "Authoritative Dutch tide data from RWS Matroos: HW/LW times from official harmonic constants, astronomical level series, observed (real measurements), RWS operational forecast (with surge), and surge component itself. PREFERRED tides source for NL waters — more accurate than tides_worldtides at Den Helder, Texel, IJmuiden, Hoek van Holland, etc. Free, no key.",
      inputSchema: {
        station: z
          .string()
          .optional()
          .describe(
            "Matroos station code, e.g. denhelder.marsdiep, texelnoordzee, harlingen, ijmuiden, hoekvanholland, vlissingen. Use list_models for the full list.",
          ),
        lat: z.number().min(-90).max(90).optional(),
        lon: z.number().min(-180).max(180).optional(),
        hoursBack: z.number().int().min(0).max(168).default(12),
        hoursForward: z.number().int().min(1).max(168).default(48),
        includeAstro: z.boolean().default(true).describe("Astronomical (tide) water level series from RWS harmonic constants."),
        includeObserved: z.boolean().default(true).describe("Observed water level (only meaningful for hoursBack > 0)."),
        includeForecast: z.boolean().default(true).describe("RWS operational forecast (DCSM, astro + surge)."),
        includeSurge: z.boolean().default(true).describe("Surge component (forecast − astronomical)."),
        includeSst: z.boolean().default(false).describe("Observed water temperature (°C) if available at this station."),
        downsample: z
          .number()
          .int()
          .min(1)
          .max(36)
          .default(6)
          .describe("Take every N-th 10-min sample of the level series. 6 = hourly."),
      },
    },
    async (args) => {
      try {
        let station: MatroosStation | undefined;
        if (args.station) {
          const w = args.station.toLowerCase();
          station = MATROOS_STATIONS.find((s) => s.code.toLowerCase() === w);
          if (!station) {
            return {
              isError: true,
              content: [{ type: "text", text: `Unknown Matroos station '${args.station}'. Try list_models.` }],
            };
          }
        } else if (args.lat != null && args.lon != null) {
          station = findNearestMatroosStation(args.lat, args.lon);
        } else {
          return {
            isError: true,
            content: [{ type: "text", text: "Provide either 'station' or 'lat'+'lon'." }],
          };
        }
        const now = Date.now();
        const start = new Date(now - args.hoursBack * 3600_000);
        const end = new Date(now + args.hoursForward * 3600_000);
        const report = await fetchNlTides({
          station,
          start,
          end,
          includeAstro: args.includeAstro,
          includeObserved: args.includeObserved,
          includeForecast: args.includeForecast,
          includeSurge: args.includeSurge,
          includeSst: args.includeSst,
        });
        const text = formatNlTides(report, { start, end, downsample: args.downsample });
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: msg }] };
      }
    },
  );
}

function registerRwsTool(server: McpServer): void {
  server.registerTool(
    "tides_rws",
    {
      title: "Water level — Rijkswaterstaat (Netherlands, observed)",
      description:
        "OBSERVED water level (WATHTE) at Dutch RWS stations (Den Helder, Texel, Harlingen, IJmuiden, Hoek van Holland, Vlissingen, Eemshaven, etc). Free, no key. Returns 10-minute series + detected high/low water times in cm relative to NAP. IMPORTANT: this is past/realtime measurement only — the new RWS API no longer exposes astronomical predictions. For FUTURE tide forecasts use tides_worldtides.",
      inputSchema: {
        station: z
          .string()
          .optional()
          .describe(
            "RWS station code, e.g. denhelder.veersteiger, texel.oudeschild, harlingen.havenmond, hoekvanholland, vlissingen. Use list_models for the full list.",
          ),
        lat: z.number().min(-90).max(90).optional().describe("Latitude (used if station omitted — picks nearest)"),
        lon: z.number().min(-180).max(180).optional().describe("Longitude (used if station omitted — picks nearest)"),
        hoursBack: z.number().int().min(1).max(168).default(36).describe("How many hours into the past to fetch."),
        seriesEvery: z
          .number()
          .int()
          .min(1)
          .max(12)
          .default(6)
          .describe("Downsample series: take every N-th point (raw is 10 min). 6 = hourly."),
      },
    },
    async (args) => {
      try {
        let station: RwsStation | undefined;
        if (args.station) {
          const wanted = args.station.toLowerCase();
          station = RWS_STATIONS.find((s) => s.code.toLowerCase() === wanted);
          if (!station) {
            return {
              isError: true,
              content: [
                {
                  type: "text",
                  text: `Unknown RWS station code '${args.station}'. Try list_models for available codes.`,
                },
              ],
            };
          }
        } else if (args.lat != null && args.lon != null) {
          station = findNearestStation(args.lat, args.lon);
        } else {
          return {
            isError: true,
            content: [
              { type: "text", text: "Provide either 'station' code or 'lat'+'lon'." },
            ],
          };
        }
        const now = Date.now();
        const start = new Date(now - args.hoursBack * 3600_000);
        const end = new Date(now);
        const data = await fetchRwsWaterLevel({ station, start, end });
        const text = formatRwsTides({
          station,
          start,
          end,
          data,
          showSeriesEvery: args.seriesEvery,
        });
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: msg }] };
      }
    },
  );
}

function registerWorldTidesTool(server: McpServer, key: string): void {
  server.registerTool(
    "tides_worldtides",
    {
      title: "Tides — WorldTides (global)",
      description:
        "Global tide predictions from worldtides.info. Returns high/low water times and optional 30-min height series anywhere on Earth. Requires a WorldTides API key (pass as ?worldtidesKey=... or ?wtKey=... on the MCP URL). Defaults to the next `days` from now; pass startDate (ISO yyyy-mm-dd) to get a FUTURE trip's tides.",
      inputSchema: {
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        days: z.number().int().min(1).max(7).default(3).describe("Forecast length in days (max 7)."),
        includeHeights: z.boolean().default(false).describe("Include the full height series (uses extra credits)."),
        includeExtremes: z.boolean().default(true).describe("Include high/low water times."),
        datum: z
          .string()
          .optional()
          .describe("Tidal datum, e.g. CD, LAT, MLLW, MSL. Defaults to provider default."),
        startDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("ISO yyyy-mm-dd. Start the prediction window on this date (for a FUTURE trip) instead of now. Covers [startDate, startDate + days]."),
      },
    },
    async (args) => {
      if (!args.includeHeights && !args.includeExtremes) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "At least one of includeHeights or includeExtremes must be true.",
            },
          ],
        };
      }
      // ISO date → Unix seconds at 00:00 UTC (WorldTides `start`).
      const start = args.startDate
        ? Math.floor(Date.parse(`${args.startDate}T00:00:00Z`) / 1000)
        : undefined;
      try {
        const data = await fetchWorldTides({
          lat: args.lat,
          lon: args.lon,
          days: args.days,
          includeHeights: args.includeHeights,
          includeExtremes: args.includeExtremes,
          datum: args.datum,
          key,
          start,
        });
        const text = formatWorldTides(data, {
          lat: args.lat,
          lon: args.lon,
          days: args.days,
          includeHeights: args.includeHeights,
          includeExtremes: args.includeExtremes,
          datum: args.datum,
          key,
        });
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: msg }] };
      }
    },
  );
}

function registerStormglassTool(server: McpServer, key: string): void {
  server.registerTool(
    "currents_stormglass",
    {
      title: "Tidal / ocean currents — Stormglass",
      description:
        "Current speed (knots) and direction (degrees true) at a coordinate, with multi-source comparison (sg ensemble, meto, fmi, fcoo, noaa). Use for offshore drift and tide-stream estimation. WARNING: in narrow channels (e.g. Marsdiep, Texelstroom) even Stormglass can under-estimate peaks — for Dutch waters cross-check with RWS stroomatlas. Requires Stormglass API key (?stormglassKey=... or ?sgKey=...). Free tier: 10 requests/day.",
      inputSchema: {
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        hours: z
          .number()
          .int()
          .min(1)
          .max(240)
          .default(24)
          .describe("Forecast horizon in hours (hourly steps). Stormglass free tier supports up to 10 days."),
        source: z
          .enum(["sg", "meto", "fmi", "fcoo", "noaa", "meteo"])
          .optional()
          .describe(
            "Restrict to one source. Omit to get all available sources side-by-side (one column per source). 'sg' is Stormglass's blended ensemble.",
          ),
      },
    },
    async (args) => {
      try {
        const data = await fetchCurrents({
          lat: args.lat,
          lon: args.lon,
          hours: args.hours,
          source: args.source,
          key,
        });
        const text = formatCurrents(data, {
          lat: args.lat,
          lon: args.lon,
          hours: args.hours,
          source: args.source,
          key,
        });
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: msg }] };
      }
    },
  );
}

function registerOsmTool(server: McpServer): void {
  const KindEnum = z.enum([
    "marina",
    "yacht_club",
    "harbour",
    "anchorage",
    "slipway",
    "fuel",
    "drinking_water",
    "pump_out",
  ]);
  server.registerTool(
    "marinas_osm",
    {
      title: "Marinas, harbours & anchorages (OpenStreetMap)",
      description:
        "Find marinas, yacht clubs, anchorages, slipways and fuel stations near a coordinate using OpenStreetMap (Overpass). Returns name, distance, phone, opening hours, website. Free, no key. Coverage: Northern Europe excellent, Mediterranean good, rest of world variable.",
      inputSchema: {
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        radiusKm: z.number().min(0.1).max(50).default(10),
        kinds: z
          .array(KindEnum)
          .min(1)
          .default(["marina", "yacht_club", "harbour", "anchorage"])
          .describe("Which POI types to look for."),
      },
    },
    async (args) => {
      try {
        const pois = await fetchOsmPois({
          lat: args.lat,
          lon: args.lon,
          radiusKm: args.radiusKm,
          kinds: args.kinds as OsmPoiKind[],
        });
        const text = formatPois({
          lat: args.lat,
          lon: args.lon,
          radiusKm: args.radiusKm,
          kinds: args.kinds as OsmPoiKind[],
          pois,
        });
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: msg }] };
      }
    },
  );
}

function registerBridgesNlTool(server: McpServer): void {
  server.registerTool(
    "bridges_nl",
    {
      title: "Bridge opening schedule — Netherlands (NDW)",
      description:
        "Scheduled bridge openings for Dutch waterways from NDW's planningsfeed_brugopeningen (DATEX II). Returns each bridge in range with its upcoming opening windows (start/end UTC, duration). Bridge names are enriched from OpenStreetMap (NDW itself carries only RIS-index codes + coordinates). Free, no key. Feed refreshed every 5 minutes.",
      inputSchema: {
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        radiusKm: z.number().min(0.1).max(50).default(5),
        hoursForward: z.number().int().min(1).max(168).default(24),
        hoursBack: z.number().int().min(0).max(72).default(0),
        limitPerBridge: z.number().int().min(1).max(50).default(8),
        resolveNames: z
          .boolean()
          .default(true)
          .describe("Look up bridge names from OpenStreetMap (one extra Overpass call). Disable for a faster, codes-only response."),
      },
    },
    async (args) => {
      try {
        const report = await queryBridges({
          lat: args.lat,
          lon: args.lon,
          radiusKm: args.radiusKm,
          hoursForward: args.hoursForward,
          hoursBack: args.hoursBack,
          limitPerBridge: args.limitPerBridge,
          resolveNames: args.resolveNames,
        });
        const text = formatBridgeReport(report, {
          lat: args.lat,
          lon: args.lon,
          radiusKm: args.radiusKm,
          hoursForward: args.hoursForward,
          hoursBack: args.hoursBack,
          limitPerBridge: args.limitPerBridge,
          resolveNames: args.resolveNames,
        });
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: msg }] };
      }
    },
  );
}

function registerAisTool(server: McpServer, key: string): void {
  server.registerTool(
    "ais_traffic",
    {
      title: "AIS — live vessel traffic snapshot (AISStream)",
      description:
        "Listens to live AIS via AISStream.io for a short window (default 5 s) and returns a snapshot of vessels within radius of a coordinate. Includes MMSI, name, type, position, course, speed, navigational status, destination. Use for situational awareness (incoming ferry, anchored fleet, friend's vessel). Note: AISStream is community-fed — coverage is best in coastal Europe and Americas, less reliable mid-ocean.",
      inputSchema: {
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        radiusKm: z.number().min(0.5).max(200).default(10),
        durationSec: z
          .number()
          .int()
          .min(1)
          .max(15)
          .default(5)
          .describe("Listen window in seconds. Longer = more vessels, slower response."),
        mmsi: z
          .array(z.number().int())
          .optional()
          .describe("Limit to specific MMSIs (e.g. tracking a known vessel)."),
        nameContains: z
          .string()
          .optional()
          .describe("Case-insensitive filter on vessel name (applied after collection)."),
        maxVessels: z.number().int().min(1).max(200).default(50),
      },
    },
    async (args) => {
      try {
        const vessels = await collectVessels({
          centerLat: args.lat,
          centerLon: args.lon,
          radiusKm: args.radiusKm,
          durationSec: args.durationSec,
          key,
          mmsiFilter: args.mmsi,
          shipNameFilter: args.nameContains,
          maxVessels: args.maxVessels,
        });
        const text = formatVessels(
          {
            centerLat: args.lat,
            centerLon: args.lon,
            radiusKm: args.radiusKm,
            durationSec: args.durationSec,
            key,
            mmsiFilter: args.mmsi,
            shipNameFilter: args.nameContains,
            maxVessels: args.maxVessels,
          },
          vessels,
        );
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: msg }] };
      }
    },
  );
}

function registerNoticesNlTool(server: McpServer): void {
  const TypeEnum = z.enum(["FTM", "WRM", "ICEM", "WERM"]);
  server.registerTool(
    "notices_nl",
    {
      title: "Notices to Skippers — Netherlands (official NtS)",
      description:
        "Official Notices to Skippers from Rijkswaterstaat / EU NtS web service: fairway & traffic obstructions, works, closures, water-related, ice and weather notices. Filtered to those currently/soon valid AND within a radius of your coordinate. Free, no key. Contents are in Dutch (translate as needed). Use before a passage to check for closures, dredging, obstructions, lock/bridge outages.",
      inputSchema: {
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        radiusKm: z.number().min(0.5).max(100).default(25),
        types: z
          .array(TypeEnum)
          .min(1)
          .default(["FTM", "WRM"])
          .describe("Message types: FTM=fairway/traffic, WRM=water-related, ICEM=ice, WERM=weather."),
        daysAhead: z
          .number()
          .int()
          .min(1)
          .max(60)
          .default(7)
          .describe("Validity window: include notices valid within the next N days."),
        limit: z.number().int().min(1).max(60).default(25),
      },
    },
    async (args) => {
      try {
        const res = await queryNotices(
          {
            lat: args.lat,
            lon: args.lon,
            radiusKm: args.radiusKm,
            types: args.types as NtsMessageType[],
            daysAhead: args.daysAhead,
            limit: args.limit,
          },
          new Date(),
        );
        const text = formatNotices(
          {
            lat: args.lat,
            lon: args.lon,
            radiusKm: args.radiusKm,
            types: args.types as NtsMessageType[],
            daysAhead: args.daysAhead,
            limit: args.limit,
          },
          res,
        );
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: msg }] };
      }
    },
  );
}

function registerFairwayNlTool(server: McpServer): void {
  const CatEnum = z.enum(["depth", "clearance", "lock"]);
  server.registerTool(
    "fairway_nl",
    {
      title: "Fairway depths, bridge clearance & locks — Netherlands (FIS)",
      description:
        "Official Dutch fairway reference data from the RWS Fairway Information Service WFS: fairway depths (keel clearance), bridge passage heights (air draft — clearance when closed/opened + width), and locks (chambers, remote control, contact). Free, no key. Use to check 'will my keel/mast fit' and to find locks on a route. Depths are relative to the stated reference level (NAP, KP=canal level).",
      inputSchema: {
        lat: z.number().min(-90).max(90),
        lon: z.number().min(-180).max(180),
        radiusKm: z.number().min(0.2).max(30).default(5),
        categories: z
          .array(CatEnum)
          .min(1)
          .default(["depth", "clearance", "lock"])
          .describe("depth=fairway depths, clearance=bridge passage heights, lock=locks."),
        limit: z.number().int().min(1).max(100).default(40),
      },
    },
    async (args) => {
      try {
        const items = await queryFairway({
          lat: args.lat,
          lon: args.lon,
          radiusKm: args.radiusKm,
          categories: args.categories as FairwayCategory[],
          limit: args.limit,
        });
        const text = formatFairway(
          {
            lat: args.lat,
            lon: args.lon,
            radiusKm: args.radiusKm,
            categories: args.categories as FairwayCategory[],
            limit: args.limit,
          },
          items,
        );
        return { content: [{ type: "text", text }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { isError: true, content: [{ type: "text", text: msg }] };
      }
    },
  );
}

function registerListModelsTool(server: McpServer): void {
  server.registerTool(
    "list_models",
    {
      title: "List Windy models",
      description:
        "Returns the supported Windy forecast models with regions, resolution and which require a Premium plan.",
      inputSchema: {},
    },
    async () => ({
      content: [
        {
          type: "text",
          text: MODEL_REFERENCE,
        },
      ],
    }),
  );
}

function formatNum(n: number | undefined, digits: number): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const f = 10 ** digits;
  return (Math.round(n * f) / f).toString();
}

function windyError(err: unknown) {
  if (err instanceof WindyApiError) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `Windy API ${err.status}: ${err.body}`,
        },
      ],
    };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return {
    isError: true,
    content: [{ type: "text" as const, text: `Error: ${msg}` }],
  };
}

const MODEL_REFERENCE = `=== Windy Point Forecast models (v2 API) ===

Global / atmospheric:
  gfs        — NOAA GFS, global, ~13km, 3h steps, free
  ecmwf      — ECMWF IFS, global, ~9km, 3h steps, PREMIUM only
  geos5      — NASA GEOS-5, global, 3h, free

Wave models:
  gfsWave    — global wave model, free
  ecmwfWaves — global wave model, PREMIUM
  iconEuWaves — Europe wave model

Regional:
  iconEu     — DWD ICON-EU, Europe, ~7km
  arome      — Météo-France AROME, France/W. Europe, ~1.3km
  namConus   — NAM CONUS, continental US, ~5km
  namHawaii  — NAM Hawaii
  namAlaska  — NAM Alaska

Parameters: temp, dewpoint, precip, convPrecip, snowPrecip, wind, windGust,
            cape, ptype, lclouds, mclouds, hclouds, rh, gh, pressure,
            waves, windWaves, swell1, swell2

Levels: surface, 1000h, 950h, 925h, 900h, 850h, 800h, 700h, 600h,
        500h, 400h, 300h, 250h, 200h, 150h

=== Open-Meteo models (free, no key) ===

best_match        — auto-pick best regional model
ecmwf_ifs025      — ECMWF IFS, global, 0.25°  (this is real ECMWF — free)
ecmwf_ifs04       — ECMWF IFS, global, 0.4°
gfs_seamless      — NOAA GFS seamless
gfs_global        — NOAA GFS global
gfs_hrrr          — HRRR (CONUS, ~3km, short-range)
icon_seamless     — DWD ICON seamless
icon_global       — DWD ICON global
icon_eu           — DWD ICON-EU (Europe ~7km)
icon_d2           — DWD ICON-D2 (Central Europe ~2km)
ukmo_seamless     — UK Met Office seamless
ukmo_global_deterministic_10km
meteofrance_seamless
meteofrance_arpege_europe
meteofrance_arome_france_hd  — AROME 1.3km, France/W. Europe
jma_seamless      — Japan Meteorological Agency

Marine API (for sailing_forecast_openmeteo includeWaves=true) provides
wave height/direction/period and swell separately.

=== Rijkswaterstaat water-level stations (NL) ===

Note: new RWS API (ddapi20) only returns OBSERVED water level (WATHTE),
no future astronomical prediction. For tide forecasts use tides_worldtides.

Wadden / North:
  denhelder.veersteiger   Den Helder (veersteiger)
  denhelder.marsdiep      Den Helder (Marsdiep)
  texel.oudeschild        Texel, Oudeschild
  harlingen.havenmond     Harlingen
  denoever                Den Oever
  vlieland.badstrandtbadhuis  Vlieland
  kornwerderzand.buitenboei1  Kornwerderzand
  lauwersoog.buitenhaven  Lauwersoog
  huibertgat              Huibertgat
  eemshaven.haven         Eemshaven
  delfzijl                Delfzijl
  stavoren                Stavoren (IJsselmeer)

North Sea coast:
  ijmuiden          IJmuiden
  scheveningen      Scheveningen
  hoekvanholland    Hoek van Holland
  europlatform      Europlatform (offshore)
  k13a              K13a platform (offshore)

Delta / Zeeland:
  vlissingen   Vlissingen
  stavenisse   Stavenisse
  zierikzee    Zierikzee

=== WorldTides ===

Global coverage, harmonic prediction (FES2014/EOT) and tide stations.
Free tier ~100 credits/day; each call uses 1 credit per day requested
(plus extra if heights+extremes both requested).
Datums: CD (chart), LAT, MLLW, MSL — provider default is usually LAT.

=== Matroos / tides_nl stations (NL, preferred for Dutch waters) ===

  denhelder.marsdiep   Den Helder (Marsdiep)
  denhelder            Den Helder
  texelnoordzee        Texel Noordzee
  harlingen            Harlingen
  westterschelling     West-Terschelling
  vlielandhaven        Vlieland Haven
  denoever             Den Oever
  kornwerderzand       Kornwerderzand
  lauwersoog           Lauwersoog
  huibertgat           Huibertgat
  eemshaven            Eemshaven
  delfzijl             Delfzijl
  ijmuiden             IJmuiden
  scheveningen         Scheveningen
  hoekvanholland       Hoek van Holland
  europlatform         Europlatform (offshore)
  k13a                 K13a platform (offshore)
  vlissingen           Vlissingen

Sources: observed (incl. astronomical harmonic), rws_prediction (DCSM forecast).
Units: waterlevel, waterlevel_astro, waterlevel_surge, waterlevel_astro_hwlw, water_temperature.

=== Airports for metar_taf ===

NL coast: EHKD (Den Helder), EHAM (Schiphol), EHRD (Rotterdam),
          EHLW (Leeuwarden), EHGG (Groningen)
UK SE/E:  EGSH (Norwich), EGSS (Stansted), EGGW (Luton), EGMD (Lydd)
BE:       EBOS (Oostende), EBKT (Kortrijk)
DE:       EDXW (Sylt), EDDH (Hamburg)

Pass any 4-letter ICAO code or lat/lon (nearest from this list is used).
`;
