export const LANDING_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>windy-mcp — sailing forecasts as an MCP server</title>
<style>
  :root {
    color-scheme: light dark;
    --fg: #1a1a1a;
    --muted: #6b7280;
    --bg: #fafaf7;
    --card: #ffffff;
    --border: #e5e5e0;
    --accent: #1d4ed8;
    --code-bg: #f4f4ee;
    --tag: #eef2ff;
    --tag-fg: #3730a3;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --fg: #e7e5e0;
      --muted: #9aa0a6;
      --bg: #111111;
      --card: #1a1a1a;
      --border: #2a2a2a;
      --accent: #93c5fd;
      --code-bg: #0e0e0e;
      --tag: #1e1b4b;
      --tag-fg: #c7d2fe;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: var(--fg);
    background: var(--bg);
    -webkit-font-smoothing: antialiased;
  }
  main { max-width: 780px; margin: 0 auto; padding: 48px 24px 96px; }
  h1 { font-size: 28px; letter-spacing: -0.01em; margin: 0 0 4px; }
  h2 { font-size: 18px; margin: 32px 0 8px; letter-spacing: -0.005em; }
  h3 { font-size: 14px; margin: 16px 0 4px; color: var(--muted); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
  p, li { color: var(--fg); }
  .sub { color: var(--muted); margin: 0 0 24px; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }

  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 20px;
    margin: 16px 0;
  }

  code, pre {
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 13px;
  }
  code { background: var(--code-bg); padding: 1px 5px; border-radius: 4px; }
  pre {
    background: var(--code-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px 14px;
    overflow-x: auto;
    margin: 8px 0;
  }
  pre code { background: none; padding: 0; }

  table { border-collapse: collapse; width: 100%; margin: 8px 0 16px; font-size: 14px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { font-weight: 600; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
  td.tool { font-family: ui-monospace, monospace; white-space: nowrap; }
  td.req span {
    display: inline-block;
    padding: 2px 8px;
    background: var(--tag);
    color: var(--tag-fg);
    border-radius: 999px;
    font-size: 12px;
    font-weight: 500;
  }
  td.req .free { background: #ecfdf5; color: #047857; }
  @media (prefers-color-scheme: dark) {
    td.req .free { background: #064e3b; color: #a7f3d0; }
  }

  form.builder { display: grid; gap: 10px; margin: 0 0 12px; }
  form.builder label { display: grid; grid-template-columns: 130px 1fr; gap: 10px; align-items: center; font-size: 14px; }
  form.builder input {
    font: inherit;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--card);
    color: var(--fg);
    width: 100%;
  }
  form.builder input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }

  .url-out {
    display: flex;
    gap: 8px;
    align-items: stretch;
    margin-top: 12px;
  }
  .url-out pre {
    flex: 1;
    margin: 0;
    word-break: break-all;
    white-space: pre-wrap;
  }
  button {
    font: inherit;
    border: 1px solid var(--border);
    background: var(--card);
    color: var(--fg);
    padding: 8px 14px;
    border-radius: 8px;
    cursor: pointer;
  }
  button:hover { border-color: var(--accent); color: var(--accent); }
  button.copied { color: #047857; border-color: #047857; }

  footer { color: var(--muted); font-size: 13px; margin-top: 48px; border-top: 1px solid var(--border); padding-top: 16px; }
</style>
</head>
<body>
<main>

<h1>sailing-mcp</h1>
<p class="sub">Remote MCP server for sailing navigation — forecasts, tides, currents, marinas, bridges and live AIS. Connect once, use across Claude.ai, Claude Desktop and Claude Code.</p>

<div class="card">
  <h3>Endpoint</h3>
  <pre>POST https://sailing-mcp.dutch-atlas.com/mcp</pre>
  <p style="margin:8px 0 0;color:var(--muted);font-size:13px">Transport: Streamable HTTP (MCP spec). Stateless — no sessions, no state on the server.</p>
</div>

<h2>Tools</h2>
<table>
  <thead><tr><th>Tool</th><th>Provider</th><th>Key</th></tr></thead>
  <tbody>
    <tr>
      <td class="tool">sailing_forecast_openmeteo</td>
      <td>Open-Meteo (ECMWF, GFS, ICON, UKMO, Météo-France, JMA) + Marine API for waves + optional SST.</td>
      <td class="req"><span class="free">free</span></td>
    </tr>
    <tr>
      <td class="tool">wind_consensus</td>
      <td>Multiple models side-by-side with min/max/spread. Shows forecast uncertainty at a glance.</td>
      <td class="req"><span class="free">free</span></td>
    </tr>
    <tr>
      <td class="tool">metar_taf</td>
      <td>Real airport observations (METAR) + terminal forecast (TAF). Cross-check forecast vs. ground truth at EHKD, EHAM, EGSH, …</td>
      <td class="req"><span class="free">free</span></td>
    </tr>
    <tr>
      <td class="tool">sun_moon</td>
      <td>Sunrise/sunset, civil/nautical/astronomical twilights, moonrise/moonset, phase, illumination.</td>
      <td class="req"><span class="free">free</span></td>
    </tr>
    <tr>
      <td class="tool">tides_nl</td>
      <td><strong>Preferred for Dutch waters.</strong> Matroos / RWS — HW/LW, astronomical, observed, RWS forecast, surge component, water temperature.</td>
      <td class="req"><span class="free">free</span></td>
    </tr>
    <tr>
      <td class="tool">tides_rws</td>
      <td>RWS Waterinfo — observed only (alternative source if Matroos is down).</td>
      <td class="req"><span class="free">free</span></td>
    </tr>
    <tr>
      <td class="tool">marinas_osm</td>
      <td>Marinas, harbours, yacht clubs, anchorages, slipways and fuel within a radius — OpenStreetMap via Overpass.</td>
      <td class="req"><span class="free">free</span></td>
    </tr>
    <tr>
      <td class="tool">bridges_nl</td>
      <td>Scheduled bridge openings on Dutch waterways, with bridge names resolved from OpenStreetMap. Source: NDW DATEX II feed (refreshed every 5 min).</td>
      <td class="req"><span class="free">free</span></td>
    </tr>
    <tr>
      <td class="tool">notices_nl</td>
      <td>Official Notices to Skippers (RWS / EU NtS) — obstructions, works, closures, water/ice/weather notices, geo-filtered to a radius. Dutch text.</td>
      <td class="req"><span class="free">free</span></td>
    </tr>
    <tr>
      <td class="tool">fairway_nl</td>
      <td>Fairway depths, bridge passage heights (air draft) and locks from the RWS Fairway Information Service WFS. "Will my keel/mast fit?"</td>
      <td class="req"><span class="free">free</span></td>
    </tr>
    <tr>
      <td class="tool">ais_traffic</td>
      <td>Live vessel snapshot via AISStream.io — MMSI, name, type, position, course, speed, destination within a radius.</td>
      <td class="req"><span>aisstream key</span></td>
    </tr>
    <tr>
      <td class="tool">sailing_forecast / point_forecast</td>
      <td>Windy Point Forecast API. The free Windy tier returns shuffled data — get a paid key from <a href="https://api.windy.com/keys">api.windy.com</a> for real numbers.</td>
      <td class="req"><span>windy key</span></td>
    </tr>
    <tr>
      <td class="tool">tides_worldtides</td>
      <td>Global tide predictions (high/low water times, 30-min height series) from <a href="https://www.worldtides.info/">worldtides.info</a>.</td>
      <td class="req"><span>worldtides key</span></td>
    </tr>
    <tr>
      <td class="tool">currents_stormglass</td>
      <td>Tidal / ocean currents from <a href="https://stormglass.io/">stormglass.io</a>, multi-source (sg, meto, fmi, fcoo, noaa). Free tier: 10 req/day.</td>
      <td class="req"><span>stormglass key</span></td>
    </tr>
    <tr>
      <td class="tool">list_models</td>
      <td>Reference card: available models, parameters, levels, station codes.</td>
      <td class="req"><span class="free">free</span></td>
    </tr>
  </tbody>
</table>
<p style="color:var(--muted);font-size:13px;margin-top:-8px">
Tools that require a key only appear in <code>tools/list</code> when that key is present in the URL.
</p>

<h2>Build your URL</h2>
<div class="card">
  <form class="builder" id="b">
    <label>Windy key <input id="k_windy" placeholder="optional — paid Windy Point Forecast key" autocomplete="off"></label>
    <label>WorldTides <input id="k_wt" placeholder="optional — worldtides.info key" autocomplete="off"></label>
    <label>Stormglass <input id="k_sg" placeholder="optional — stormglass.io key" autocomplete="off"></label>
    <label>AISStream <input id="k_ais" placeholder="optional — aisstream.io key" autocomplete="off"></label>
  </form>
  <div class="url-out">
    <pre id="out">https://sailing-mcp.dutch-atlas.com/mcp</pre>
    <button id="copy" type="button">Copy</button>
  </div>
  <p style="color:var(--muted);font-size:13px;margin-top:8px">Leave a field empty to skip that provider. Keys never leave your browser — this page is static.</p>
</div>

<h2>Connect from a client</h2>

<h3>Claude Code</h3>
<pre><code>claude mcp add --transport http sailing "<span id="cli">https://sailing-mcp.dutch-atlas.com/mcp</span>"</code></pre>

<h3>Claude.ai (Pro / Max / Team / Enterprise)</h3>
<p style="margin-top:4px">Settings → <strong>Connectors</strong> → <strong>Add custom connector</strong>. Set <em>Remote MCP server URL</em> to the URL above. No OAuth required.</p>

<h3>Claude Desktop (any plan, via mcp-remote)</h3>
<p style="margin-top:4px">Edit <code>~/Library/Application Support/Claude/claude_desktop_config.json</code>:</p>
<pre><code>{
  "mcpServers": {
    "sailing": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "<span id="desk">https://sailing-mcp.dutch-atlas.com/mcp</span>", "--transport", "http-only"]
    }
  }
}</code></pre>

<h3>ChatGPT (Plus / Pro / Business)</h3>
<p style="margin-top:4px">In the browser at <a href="https://chatgpt.com" target="_blank" rel="noopener">chatgpt.com</a>, signed in:</p>
<ol style="margin-top:4px">
  <li>Avatar menu → <strong>Settings</strong> → <strong>Apps</strong>.</li>
  <li>Open <strong>Advanced settings</strong> and turn on <strong>Developer mode</strong> (it's flagged "elevated risk" — this is what lets you add a custom MCP server).</li>
  <li>Back in <strong>Apps</strong>, click <strong>Create app</strong> (next to Advanced settings).</li>
  <li>In the <strong>New App</strong> dialog:
    <ul>
      <li><strong>Name:</strong> <code>Sailing MCP</code></li>
      <li><strong>Connection:</strong> <code>Server URL</code></li>
      <li><strong>URL:</strong> <code id="gpt">https://sailing-mcp.dutch-atlas.com/mcp</code> (paste the key-builder URL above if you have provider keys)</li>
      <li><strong>Authentication:</strong> <code>No Auth</code></li>
      <li>Tick <em>"I understand and want to continue"</em>, then <strong>Create</strong>.</li>
    </ul>
  </li>
  <li>The app shows up under <strong>Enabled apps</strong>. In a chat, open the <strong>+ / Apps</strong> menu and enable <strong>Sailing MCP</strong> to let it use the tools.</li>
</ol>

<h2>Where to get keys</h2>
<ul>
  <li><a href="https://api.windy.com/keys">api.windy.com/keys</a> — Windy Point Forecast (free tier is shuffled; production tier is paid).</li>
  <li><a href="https://www.worldtides.info/developer">worldtides.info/developer</a> — WorldTides API (free 100 credits/day).</li>
  <li><a href="https://dashboard.stormglass.io/">dashboard.stormglass.io</a> — Stormglass (free 10 req/day).</li>
  <li><a href="https://aisstream.io/apikeys">aisstream.io/apikeys</a> — AISStream (free, GitHub login).</li>
</ul>

<h2>What to ask the agent</h2>
<div class="card">
  <h3>Pre-passage briefing</h3>
  <ul>
    <li>“Tomorrow morning Den Helder → Texel, give me the full passage plan: wind, gusts, waves, HW/LW at Marsdiep, when to leave and why.”</li>
    <li>“Wind consensus across ECMWF / GFS / ICON-EU / UKMO for Saturday at Marsdiep — show where models disagree.”</li>
    <li>“Sunrise, sunset and civil twilight at Vlieland for the next 3 days — when must I arrive to dock in daylight?”</li>
  </ul>
  <h3>Right-now situational awareness</h3>
  <ul>
    <li>“Current METAR at EHKD — is the forecast holding?”</li>
    <li>“What ships are within 5 km of Marsdiep right now? Any TESO ferry inbound?”</li>
    <li>“Water level at Den Helder, observed vs. astronomical — is there a storm surge?”</li>
  </ul>
  <h3>Planning a route</h3>
  <ul>
    <li>“Find marinas with fuel within 20 km of IJmuiden.”</li>
    <li>“List the next bridge openings on the Amsterdam-Rhine canal in the next 6 hours.”</li>
    <li>“Anchorages and yacht clubs near Vlieland — anything with a website I can call?”</li>
  </ul>
  <h3>Cross-checking conditions</h3>
  <ul>
    <li>“Compare RWS forecast surge to ECMWF MSLP — does the low explain the surge?”</li>
    <li>“Currents in Marsdiep for tonight per Stormglass — and is the wind with or against?”</li>
    <li>“Sea-surface temperature off Texel — strong enough for a sea breeze tomorrow?”</li>
  </ul>
</div>

<h2>Health</h2>
<pre><code>GET https://sailing-mcp.dutch-atlas.com/healthz  →  {"ok":true}</code></pre>

<footer>
  Built by <a href="https://x.com/ai_kulikov" target="_blank" rel="noopener">@ai_kulikov</a> on X.
  Source on <a href="https://github.com/4kulia/sailing-mcp" target="_blank" rel="noopener">GitHub</a>.
  All times returned by tools are UTC. This server is provided as-is for sailing use; always verify against official charts, almanacs and notices before relying on it for navigation safety.
</footer>

<script>
  const out = document.getElementById('out');
  const cli = document.getElementById('cli');
  const desk = document.getElementById('desk');
  const gpt = document.getElementById('gpt');
  const inputs = {
    key: document.getElementById('k_windy'),
    worldtidesKey: document.getElementById('k_wt'),
    stormglassKey: document.getElementById('k_sg'),
    aisstreamKey: document.getElementById('k_ais'),
  };
  const base = 'https://sailing-mcp.dutch-atlas.com/mcp';
  function rebuild() {
    const qs = Object.entries(inputs)
      .map(([k, el]) => [k, el.value.trim()])
      .filter(([, v]) => v.length > 0)
      .map(([k, v]) => k + '=' + encodeURIComponent(v))
      .join('&');
    const url = qs ? base + '?' + qs : base;
    out.textContent = url;
    cli.textContent = url;
    desk.textContent = url;
    if (gpt) gpt.textContent = url;
  }
  for (const el of Object.values(inputs)) el.addEventListener('input', rebuild);
  document.getElementById('copy').addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText(out.textContent);
      e.target.classList.add('copied');
      e.target.textContent = 'Copied';
      setTimeout(() => {
        e.target.classList.remove('copied');
        e.target.textContent = 'Copy';
      }, 1200);
    } catch {}
  });
</script>

</main>
</body>
</html>
`;
