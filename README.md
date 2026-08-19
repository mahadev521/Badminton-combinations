# Badminton Rotation

A mobile-first web app that builds balanced badminton rotations and scores them live on court.
Installable as a home-screen app, works offline, no build step and no dependencies.

## Features

- **You pick the number of games** — ask for 9 or 40 and you get exactly that, split as evenly
  as the arithmetic allows. The line-up card shows the split live ("8 each", "6–7 each").
- **Balanced scheduling** — games per player are evened out, rests are spread so nobody sits
  twice in a row while others play, and partnerships stay fresh for as long as possible.
- **Live scorer** — official doubles service rules, with the court drawn from your chosen
  viewpoint and the server/receiver highlighted on every point.
- **Back view or sideline** court orientation.
- **Auto-advance** — finish a game and the next one opens automatically.
- **Light and dark themes**, following the system setting until you pick one.
- **Installable PWA** — add to home screen, launches full screen, and keeps working with no signal.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | App shell |
| `style.css` | Design system and layout |
| `app.js` | Scheduling engine, scoring rules, and UI |
| `manifest.webmanifest` | PWA metadata |
| `sw.js` | Service worker (offline support) |
| `icon.svg`, `icon-180.png`, `icon-192.png`, `icon-512.png` | App icons |
| `badminton.py` | Original command-line version |

## Run locally

From this folder:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000

A real HTTP server is required — opening `index.html` directly from disk disables the
service worker and the web app manifest.

## Deploy on GitHub Pages

1. Push this folder to your GitHub repository.
2. Open the repository **Settings** → **Pages**.
3. Under **Build and deployment** set:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/ (root)`
4. Save and wait for the deployment, then open the URL shown on the Pages settings page.

## Install on your phone

- **iOS (Safari):** Share → *Add to Home Screen*
- **Android (Chrome):** menu → *Install app* / *Add to Home screen*

## How to use

1. Enter player names in the **Line-up** tab, one per line — at least four.
   Names you have used before appear as chips; tap to add or remove them.
2. Set **Games to generate** with the − / + steppers. The badge shows how many games
   each player gets.
3. Pick a court view: **Back view** (looking down the court) or **Sideline**.
4. Tap **Start Session**.
5. In the **Play** tab, tap a game to open the scorer, choose 11 or 21 points,
   then tap a team to award each point. **Undo** reverses the last point.
6. **Finish Game** locks the result and opens the next game.
7. **Regenerate** builds a fresh set of match-ups — change the game count first if you want
   more or fewer. **Clear Scores** keeps the match-ups and wipes the results.

Session state is saved on the device and restored for two hours, so a locked screen or an
accidental refresh will not lose your scores.

## Notes

- Games per player is as even as the numbers allow. With 6 players and 12 games everyone
  plays 8; with 6 players and 10 games four play 7 and two play 6 — the closest possible split.
- Player names are treated as unique regardless of capitalisation, so `Alex` and `alex`
  are rejected as a duplicate.
- Scheduling is a randomised search bounded by a work budget, so a build stays well under a
  second for any realistic group and game count. The app shows a "Building…" state while it runs.
