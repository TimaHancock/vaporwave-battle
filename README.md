# Vaporwave Battle — Phase 0

A turn-based JRPG boss battle. HD-2D: 3D primitive environment, 2D sprite
characters, DOM interface, one locked camera.

**Phase 0 is not the game.** It is the machine the game gets built inside:
a project that type-checks, tests, screenshots itself, and deploys. Nothing
here is gameplay, and that is deliberate — building this loop first is what
makes everything after it fast.

---

## What runs today

- A three.js scene: grid horizon, gradient sun, chrome platform and
  columns, seven drifting polyhedra. All generated in code, zero art assets.
- A minimal DOM HUD: boss health bar, command menu, action log.
- A damage formula and a seeded RNG, with 16 passing unit tests.
- A screenshot harness producing PNGs plus machine-readable state dumps.
- End-to-end DOM tests.
- A deployment pipeline with verification gates.

---

## Setup

Requires **Node.js 22+**. Check with `node --version`.

```bash
npm install
npx playwright install chromium   # one time, ~150 MB
npm run dev                       # http://localhost:5173
```

Leave `npm run dev` running while you work.

---

## Commands

| Command | What it does | Speed |
|---|---|---|
| `npm run dev` | Dev server with hot reload | — |
| `npm run test` | Vitest — battle logic | <1s |
| `npm run e2e` | Playwright — DOM assertions | ~5s |
| `npm run shots` | Screenshots + state dumps into `shots/` | ~10s |
| `npm run typecheck` | `tsc --noEmit` | ~2s |
| `npm run build` | Typecheck + production build to `dist/` | ~3s |
| `npm run verify` | All gates, same as CI | ~10s |

### URL parameters

| Parameter | Effect |
|---|---|
| `?seed=1337` | Sets the RNG seed. Default `1337`. |
| `?time=4.0` | Renders one frame at exactly 4.0s of game time, then stops. |

`?time=` is what makes screenshots reproducible. Combined with a locked
camera and a seeded RNG, the same URL produces the same composition every
run, forever.

---

## The three verification channels

Each has exactly one job. Do not ask one to do another's work.

**Vitest — logic.** Damage formulas, turn order, status durations, chain
multipliers. Pure functions over numbers, no browser. This is where most of
your bugs will live and it is the cheapest place to catch them.

**Playwright — interface.** Reads the DOM directly and gets exact truth:
`aria-valuenow="588321"`, not "the bar looks about half full." Roughly 80%
of this game is interface, so this channel carries most of the load.

**Screenshots — appearance.** `npm run shots` writes a PNG *and* a JSON
state dump per shot. The pairing is the point: if the PNG is black but the
JSON reports 22 draw calls and 7 geometries, the problem is lighting or
camera, not asset loading. That inference is only possible because both
channels exist.

---

## Deploying to Azure

One-time setup:

1. Push this repository to GitHub.
2. In the Azure portal, create a **Static Web App**. Choose **Other** as
   the deployment source (this repo already has its own workflow — letting
   Azure generate one will overwrite the gates).
3. Copy the deployment token from **Settings → Manage deployment token**.
4. In GitHub: **Settings → Secrets and variables → Actions → New secret**,
   named `AZURE_STATIC_WEB_APPS_API_TOKEN`.

After that, every push to `main` runs typecheck → unit tests → e2e →
build → deploy. Pull requests get their own temporary preview URL, useful
for checking the scene on a phone or a different GPU before merging.

### Free tier limits worth knowing

| Limit | Free plan |
|---|---|
| Storage per environment | 250 MB |
| Bandwidth | 100 GB/month, no overage — the site stops serving |
| Preview environments | 3 concurrent |
| Custom domains | 2 |

Code is not the constraint (the current build is ~134 kB gzipped). Art is.
Use KTX2 compressed textures and keep an eye on `dist/` size.

---

## Build order from here

| Phase | Work | Verified by |
|---|---|---|
| **1** | Battle logic, no UI at all. Actors, turn order, `takeAction()`. A full battle simulable in a test. | Vitest |
| **2** | Ugly UI. Unstyled HTML wired to Phase 1. Playable and hideous. | Playwright DOM |
| **3** | The sequencer. Timing, narration, input lockout. | Playwright DOM |
| **4a** | Scene composition. Camera, grid, sun, columns. No characters. | Screenshots |
| **4b** | Bloom and post-processing. Tune before adding characters. | Screenshots |
| **4c** | Sprite billboards with contact shadows. | Screenshots |
| **5** | Effects and juice. Particles, damage pops, screen shake, audio. | Screenshots |

The order is deliberate: everything expensive to verify comes last, and the
hardest logic comes first where feedback is measured in milliseconds.

---

## Open decisions

Two things to settle before Phase 1, both cheap now and expensive later:

**Turn order model.** A discrete queue (everyone acts once per round in
speed order) or an ATB gauge (each actor fills a bar at a rate set by
speed). The reference art shows a turn-order preview bar, which implies
ATB — and ATB is meaningfully more complex, because HASTE applied mid-battle
reorders the upcoming queue.

**UI rendering approach.** Vanilla DOM is fine at this scale, but five
party cards each reacting to HP, MP and status changes gets tedious by
hand. Preact (~4 kB) or Solid gives you automatic updates for almost no
bundle cost. Decide deliberately rather than discovering the need at
file 900.
