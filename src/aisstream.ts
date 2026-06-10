import WebSocket from "ws";
import { haversineKm } from "./osm.js";

const WS_URL = "wss://stream.aisstream.io/v0/stream";

export interface AisSnapshotOptions {
  centerLat: number;
  centerLon: number;
  radiusKm: number;
  durationSec: number;
  key: string;
  filterMessageTypes?: string[];
  shipNameFilter?: string;
  mmsiFilter?: number[];
  maxVessels?: number;
}

export interface VesselReport {
  mmsi: number;
  name?: string;
  callSign?: string;
  shipType?: string;
  lat: number;
  lon: number;
  cog?: number;
  sog?: number;
  heading?: number;
  navStatus?: string;
  destination?: string;
  lastSeen: string;
  distKm: number;
}

interface PositionReport {
  UserID?: number;
  Latitude?: number;
  Longitude?: number;
  Cog?: number;
  Sog?: number;
  TrueHeading?: number;
  NavigationalStatus?: number;
  Timestamp?: number;
}

interface ShipStaticData {
  UserID?: number;
  Name?: string;
  CallSign?: string;
  Type?: number;
  Destination?: string;
}

interface AisMessage {
  MessageType?: string;
  MetaData?: { MMSI?: number; ShipName?: string; latitude?: number; longitude?: number; time_utc?: string };
  Message?: {
    PositionReport?: PositionReport;
    StandardClassBPositionReport?: PositionReport;
    ExtendedClassBPositionReport?: PositionReport;
    ShipStaticData?: ShipStaticData;
    StaticDataReport?: ShipStaticData;
  };
}

const NAV_STATUS: Record<number, string> = {
  0: "under way using engine",
  1: "at anchor",
  2: "not under command",
  3: "restricted manoeuvrability",
  4: "constrained by draught",
  5: "moored",
  6: "aground",
  7: "engaged in fishing",
  8: "under way sailing",
  15: "undefined",
};

const SHIP_TYPE: Record<number, string> = {
  30: "fishing",
  31: "tug",
  32: "tug",
  33: "dredger",
  34: "diving",
  35: "military",
  36: "sailing",
  37: "pleasure craft",
  40: "high-speed",
  50: "pilot",
  51: "SAR",
  52: "tug",
  53: "port tender",
  54: "anti-pollution",
  55: "law enforcement",
  60: "passenger",
  61: "passenger",
  62: "passenger",
  63: "passenger",
  64: "passenger",
  65: "passenger",
  66: "passenger",
  67: "passenger",
  68: "passenger",
  69: "passenger",
  70: "cargo",
  71: "cargo",
  72: "cargo",
  73: "cargo",
  74: "cargo",
  79: "cargo",
  80: "tanker",
  81: "tanker",
  82: "tanker",
  83: "tanker",
  84: "tanker (LNG)",
  89: "tanker",
};

export async function collectVessels(opts: AisSnapshotOptions): Promise<VesselReport[]> {
  const dLat = opts.radiusKm / 111;
  const dLon = opts.radiusKm / (111 * Math.cos((opts.centerLat * Math.PI) / 180));
  const bbox: [[number, number], [number, number]] = [
    [opts.centerLat - dLat, opts.centerLon - dLon],
    [opts.centerLat + dLat, opts.centerLon + dLon],
  ];

  const vessels = new Map<number, VesselReport>();
  const staticData = new Map<number, { name?: string; callSign?: string; shipType?: string; destination?: string }>();

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let timer: NodeJS.Timeout | null = null;
    let done = false;

    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // ignore
      }
      if (err) reject(err);
      else resolve();
    };

    ws.on("open", () => {
      const sub: Record<string, unknown> = {
        APIKey: opts.key,
        BoundingBoxes: [bbox],
        FilterMessageTypes: opts.filterMessageTypes ?? [
          "PositionReport",
          "StandardClassBPositionReport",
          "ExtendedClassBPositionReport",
          "ShipStaticData",
          "StaticDataReport",
        ],
      };
      if (opts.mmsiFilter && opts.mmsiFilter.length > 0) {
        sub.FiltersShipMMSI = opts.mmsiFilter.map(String);
      }
      try {
        ws.send(JSON.stringify(sub));
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      timer = setTimeout(finish, Math.max(1, Math.min(15, opts.durationSec)) * 1000);
    });

    ws.on("message", (raw) => {
      let msg: AisMessage;
      try {
        msg = JSON.parse(raw.toString()) as AisMessage;
      } catch {
        return;
      }
      if ((msg as unknown as { error?: string }).error) {
        finish(new Error(`AISStream error: ${(msg as unknown as { error?: string }).error}`));
        return;
      }
      const mmsi = msg.MetaData?.MMSI;
      if (!mmsi) return;

      const pr =
        msg.Message?.PositionReport ??
        msg.Message?.StandardClassBPositionReport ??
        msg.Message?.ExtendedClassBPositionReport;
      if (pr) {
        const lat = pr.Latitude ?? msg.MetaData?.latitude;
        const lon = pr.Longitude ?? msg.MetaData?.longitude;
        if (lat == null || lon == null) return;
        const dist = haversineKm(opts.centerLat, opts.centerLon, lat, lon);
        if (dist > opts.radiusKm) return;
        const meta = staticData.get(mmsi) ?? {};
        const navStatus = pr.NavigationalStatus != null ? NAV_STATUS[pr.NavigationalStatus] : undefined;
        vessels.set(mmsi, {
          mmsi,
          name: meta.name ?? msg.MetaData?.ShipName?.trim(),
          callSign: meta.callSign,
          shipType: meta.shipType,
          destination: meta.destination,
          lat,
          lon,
          cog: pr.Cog,
          sog: pr.Sog,
          heading: pr.TrueHeading,
          navStatus,
          lastSeen: msg.MetaData?.time_utc ?? new Date().toISOString(),
          distKm: dist,
        });
        return;
      }

      const sd = msg.Message?.ShipStaticData ?? msg.Message?.StaticDataReport;
      if (sd) {
        const prev = staticData.get(mmsi) ?? {};
        staticData.set(mmsi, {
          name: sd.Name?.trim() || prev.name,
          callSign: sd.CallSign?.trim() || prev.callSign,
          shipType: sd.Type != null ? SHIP_TYPE[sd.Type] ?? `code ${sd.Type}` : prev.shipType,
          destination: sd.Destination?.trim() || prev.destination,
        });
        // back-fill any vessel we've seen
        const v = vessels.get(mmsi);
        if (v) {
          v.name = v.name ?? staticData.get(mmsi)?.name;
          v.callSign = v.callSign ?? staticData.get(mmsi)?.callSign;
          v.shipType = v.shipType ?? staticData.get(mmsi)?.shipType;
          v.destination = v.destination ?? staticData.get(mmsi)?.destination;
        }
      }
    });

    ws.on("error", (err) => finish(err));
    ws.on("close", () => finish());
  });

  let arr = Array.from(vessels.values());
  if (opts.shipNameFilter) {
    const needle = opts.shipNameFilter.toLowerCase();
    arr = arr.filter((v) => (v.name ?? "").toLowerCase().includes(needle));
  }
  arr.sort((a, b) => a.distKm - b.distKm);
  if (opts.maxVessels) arr = arr.slice(0, opts.maxVessels);
  return arr;
}

export function formatVessels(opts: AisSnapshotOptions, vessels: VesselReport[]): string {
  const lines: string[] = [];
  lines.push(`# AIS snapshot — AISStream`);
  lines.push(`Centre: ${opts.centerLat}, ${opts.centerLon}   Radius: ${opts.radiusKm} km`);
  lines.push(`Listening: ${opts.durationSec}s   Vessels in snapshot: ${vessels.length}`);
  lines.push(`Sources: PositionReport / StandardClassBPositionReport / ExtendedClassBPositionReport, with static name from ShipStaticData.`);
  lines.push(`Note: AISStream is community-fed and not guaranteed complete — coastal & high-traffic areas have good coverage, open ocean less so.`);
  lines.push("");

  if (vessels.length === 0) {
    lines.push("(no AIS targets observed in this window)");
    return lines.join("\n");
  }

  lines.push("mmsi\tname\ttype\tdist_km\tlat\tlon\tcog\tsog_kn\tnav_status\tdestination\tlast_seen_utc");
  for (const v of vessels) {
    lines.push(
      [
        v.mmsi,
        v.name ?? "(unknown)",
        v.shipType ?? "—",
        v.distKm.toFixed(1),
        v.lat.toFixed(5),
        v.lon.toFixed(5),
        v.cog != null ? Math.round(v.cog).toString() : "—",
        v.sog != null ? v.sog.toFixed(1) : "—",
        v.navStatus ?? "—",
        v.destination ?? "—",
        v.lastSeen,
      ].join("\t"),
    );
  }
  return lines.join("\n");
}
