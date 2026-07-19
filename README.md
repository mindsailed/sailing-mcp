# sailing-mcp

A remote [MCP](https://modelcontextprotocol.io) server for marine / weather data — wind & wave forecasts, tides, tidal currents, marinas, bridge schedules and live AIS vessel traffic (strong focus on Dutch / North Sea waters). It speaks **Streamable HTTP** on `/mcp` and is **stateless** and multi-tenant: every request carries its own provider API keys, so one deployment serves many users without storing credentials. Tools that need a key only appear in the tool list when that key is present.

Public endpoint: **https://sailing-mcp.dutch-atlas.com/mcp**

> Package is `sailing-mcp` **v0.5.0**; the MCP server currently self-identifies as `windy-mcp` **v0.3.0** (legacy server name — being aligned).

## Quickstart

```bash
npm install
npm run dev                 # tsx watch, listens on :8787
# or
npm run build && npm start
```

Quick test:

```bash
curl -sS -X POST 'http://localhost:8787/mcp' \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Health check: `GET /healthz` → `{"ok":true}`. Landing page: `GET /`.

## API keys — via HTTP headers only

Provider keys are read from **request headers** (query-param keys are not used — they leak in plaintext logs):

| Provider | Header |
| --- | --- |
| Windy | `x-windy-key` (or `Authorization: Bearer <key>`) |
| WorldTides | `x-worldtides-key` |
| Stormglass | `x-stormglass-key` |
| AISStream | `x-aisstream-key` |

All key-free tools work with no headers at all. Keys are read per-request and never logged or persisted. All times returned are UTC.

This is provided as-is for sailing use. **Always verify against official charts, almanacs and notices before relying on it for navigation safety.**

## Docs

This README is a pointer. Canonical documentation lives in the **sailsaid** repo's `apps/docs` (Starlight):

- **systems/sailing-mcp** — tools, transport, and integration.
- **architecture/deployment** — how it's deployed and fronted with TLS.
- **operations/environments** — keys and environments.

Built by [@ai_kulikov](https://x.com/ai_kulikov).
