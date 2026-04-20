# Bus Tracker

Personal live bus tracker for **Canberra (ACT)** and **Queanbeyan (NSW)** regions. Runs as a mobile-first PWA — add to iPhone home screen, works like a native app.

![Stack](https://img.shields.io/badge/Next.js-16-black)
![TS](https://img.shields.io/badge/TypeScript-5-blue)
![Tailwind](https://img.shields.io/badge/Tailwind-4-38bdf8)
![Leaflet](https://img.shields.io/badge/Leaflet-OSM-green)

## Features

- Live bus positions from **Transport Canberra** + **Transport NSW** (Qcity Transit)
- **List view** — scrollable cards sorted by route
- **Map view** — live dots on OpenStreetMap, auto-centers to fit
- **Filter** by route number, provider, or both
- **Auto-refresh** every 15 seconds
- **PWA** — installs to iPhone/iPad home screen, dark mode, safe-area aware
- **API-key safe** — keys live server-side in `.env.local` / Vercel env vars, never in the browser

## Architecture

```
Browser (React + Leaflet)
       ↕ /api/vehicles
Next.js API route (server)   ← API keys live here
       ↕ GTFS-RT protobuf
┌──────────────────┬──────────────────┐
│ Transport        │ Transport NSW    │
│ Canberra (ACT)   │ (Qcity / NSW)    │
└──────────────────┴──────────────────┘
```

Both endpoints return **GTFS-Realtime protobuf** — decoded server-side with `gtfs-realtime-bindings` and served to the client as clean JSON.

## Project structure

```
Bus-tracker/
├── app/
│   ├── layout.tsx                # PWA meta + dark mode shell
│   ├── page.tsx                  # Home: list view
│   ├── globals.css               # Tailwind + Leaflet styles
│   ├── map/page.tsx              # /map — live map
│   ├── setup/page.tsx            # /setup — key instructions
│   └── api/
│       ├── health/route.ts       # GET /api/health
│       └── vehicles/route.ts     # GET /api/vehicles?route=56&provider=nsw
├── components/
│   ├── BusCard.tsx
│   ├── BusMap.tsx                # dynamic (SSR disabled)
│   ├── FilterBar.tsx
│   └── StatusBar.tsx
├── lib/
│   ├── types.ts                  # Vehicle + response types
│   ├── gtfs.ts                   # protobuf decoder + haversine
│   ├── canberra.ts               # Transport Canberra client
│   └── nsw.ts                    # Transport NSW client
├── public/
│   ├── manifest.json             # PWA manifest
│   ├── icon.svg / 192 / 512
│   └── apple-icon.png
├── .env.local                    # YOUR KEYS GO HERE (gitignored)
└── .env.local.example
```

## Setup (one-time)

### 1. Install + run

```bash
cd /Users/varunyadav/Bus-tracker
npm install            # already done
npm run dev            # → http://localhost:3000
```

Open http://localhost:3000 — you'll see the empty list and two grey status dots (meaning "not configured yet").

### 2. Get API keys (free, ~5 min each)

#### Transport Canberra (ACT buses + light rail)

1. Visit https://www.transport.act.gov.au/contact-us/information-for-developers
2. Download the **MyWayPlus-GTFS-developer-access-guide** PDF
3. Follow the registration instructions in the guide
4. You'll receive an API key (header-based auth)

Add to `.env.local`:

```bash
CANBERRA_API_KEY=your_key_here
# Most Azure APIM gateways use this header name; if Canberra uses a different one,
# the PDF will say. Common alternatives: "x-api-key", "apikey"
CANBERRA_API_HEADER_NAME=Ocp-Apim-Subscription-Key
```

#### Transport NSW (Queanbeyan / Qcity Transit)

1. Visit https://opendata.transport.nsw.gov.au/
2. Register an account (free, 2 min)
3. Create an application
4. Subscribe to **"Public Transport - Realtime Vehicle Positions"**
5. Copy your API key from the dashboard

Add to `.env.local`:

```bash
NSW_API_KEY=your_key_here
```

### 3. Restart dev server

```bash
# Ctrl+C to stop
npm run dev
```

Status dots should turn **green**. Buses appear within 15 seconds.

## Usage

| URL | What |
|---|---|
| `/` | Home — list of live buses, filter by route/provider |
| `/map` | Full-screen map view |
| `/setup` | In-app instructions for getting keys |
| `/api/vehicles` | Raw JSON API (see below) |
| `/api/health` | Provider config status |

### API query parameters (on `/api/vehicles`)

```bash
# All providers, all routes
curl localhost:3000/api/vehicles

# Filter by route
curl "localhost:3000/api/vehicles?route=56"

# Filter by provider
curl "localhost:3000/api/vehicles?provider=canberra"
curl "localhost:3000/api/vehicles?provider=nsw"

# Near a point (Queanbeyan example, 2km radius)
curl "localhost:3000/api/vehicles?lat=-35.354&lon=149.232&radius=2000"
```

## Deploy to Vercel (free)

This app should be deployed as a normal **Next.js** project on Vercel. Do
**not** use static export: the app depends on dynamic route handlers like
`/api/vehicles`, `/api/health`, `/api/route`, and `/api/route/departures`.

### Recommended: GitHub import

```bash
# Push to GitHub first
cd /Users/varunyadav/Bus-tracker
git add .
git commit -m "initial commit"
gh repo create bus-tracker --private --source=. --push
```

Then on https://vercel.com:

1. Click **Add New Project**
2. Import the GitHub repository
3. Let Vercel detect **Next.js**
4. Keep the defaults:
   - Root Directory: project root
   - Install Command: `npm install`
   - Build Command: `npm run build`
   - Output: default Next.js output
5. Add these environment variables in **Settings → Environment Variables**:
   - `CANBERRA_CLIENT_ID`
   - `CANBERRA_CLIENT_SECRET`
   - `NSW_API_KEY`
6. Redeploy

Optional overrides if you ever need them:
- `CANBERRA_VEHICLE_POSITIONS_URL`
- `NSW_VEHICLE_POSITIONS_URL`
- `ANYTRIP_NSW_ENDPOINT`
- `ANYTRIP_USER_AGENT`

Vercel gives you a `bus-tracker-xxxxx.vercel.app` URL automatically. Add a
custom domain later if you want.

### Alternative: Vercel CLI

```bash
# Install Vercel CLI (one-time)
npm i -g vercel

# Deploy from project root
cd /Users/varunyadav/Bus-tracker
vercel
vercel --prod
```

### After deploy

Check these URLs on the deployed site:

- `/`
- `/map`
- `/setup`
- `/api/health`
- `/api/vehicles`
- `/api/route?number=830`
- `/api/route/departures?number=830`

Expected results:
- `canberra.configured` is `true` only when both Canberra vars are set
- `nsw.configured` is `true` when `NSW_API_KEY` is set
- AnyTrip-backed features work without a secret

## Install on iPhone

1. Open the Vercel URL in **Safari** (Chrome on iOS can't install PWAs properly)
2. Tap the **Share** button
3. Scroll down → **Add to Home Screen**
4. Name it "Bus Tracker", tap Add

The app now has:
- Its own icon on your home screen
- Full-screen mode (no Safari chrome)
- Dark status bar
- Auto-rotates / safe area aware

## Development commands

```bash
npm run dev      # dev server with hot reload
npm run build    # production build (also typechecks)
npm run start    # run production build locally
npm run lint     # eslint
```

## Customization ideas

- **Saved buses** — store favorite routes in localStorage, show only those on home screen
- **Notifications** — web push notifications when your bus is 5 min away (needs service worker)
- **Stop proximity** — filter by stops near your home/work (already have `lat/lon/radius` in API)
- **Light rail** — add a filter for R-series light rail in Canberra
- **History** — log which buses were late, build personal punctuality stats
- **Commute preset** — single-tap button for "buses I usually catch at 8am"
- **Menubar app** — feed `/api/vehicles?route=X` JSON to xbar / SwiftBar for macOS menubar

## Troubleshooting

### "No buses match your filter" with green dots

You're connected, but no buses matching your filter are currently live. Try:
- Clearing the filter
- Checking during service hours (~5am–12am)
- If route looks wrong, note Canberra uses both numeric (56, 300) and letter-prefixed (R3, R4, R5) route names

### Status dot stays red

Click the status dot tooltip (hover) — the error message tells you exactly what's wrong:
- `HTTP 401` — wrong API key
- `HTTP 403` — not subscribed to the dataset
- `HTTP 429` — rate limited (chill for a minute)

### Map doesn't load

Leaflet tiles come from OpenStreetMap. If blocked, check your browser's console or ad-blocker.

### `npm run build` fails

Make sure you're on Node 20+. This project was built with Node 21 but Vercel uses 20 by default (works fine).

## Tech stack

- **Next.js 16** — App Router, server components, API routes
- **TypeScript 5** — strict mode
- **Tailwind CSS 4** — styling
- **Leaflet + OpenStreetMap** — free map tiles (no API key, no billing)
- **react-leaflet 5** — React bindings
- **gtfs-realtime-bindings** — official Google protobuf decoder
- **lucide-react** — icons
- **Vercel** — hosting + serverless API routes

## License

Personal use. Respect the Transport NSW and Transport Canberra data terms of use.
