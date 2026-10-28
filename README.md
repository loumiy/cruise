# Cruise Line Manager

A ship-design and route-planning game. Build cruise ships deck by deck in the **Drydock**, plan cruises that fit what each ship can do in the **Chartroom**, and grow a small coastal line into a fleet.

This build is **Phase 1, the vertical slice**, from the design doc: Drydock and Chartroom joined, the Northeast & Canada map, the Coastal and Liner hulls, and save/load.

## Run it

```bash
npm install
```

```bash
npm run dev
```

Open the printed URL (default http://localhost:5173). Other scripts:

| Script | What it does |
| --- | --- |
| `npm run build` | Typecheck and build a static site into `dist/` (relative paths, so it can go on itch.io as-is) |
| `npm test` | All tests: rules, planner, saves, lane checker, plain-language checks, balance |
| `npm run balance` | The headless reference-cruise script on its own, with a results table |
| `UPDATE_BALANCE=1 npm run balance` | Accept new balance numbers into `tests/reference-cruises.json` |

## What's in the slice

- **Drydock.** Fixed hulls with deck masks and fixed cells (engine room, funnel, bridge). Drag-and-drop blocks with mouse, touch or keyboard (arrows, Enter, R, Delete). Live readouts: GM with G/M markers on the side profile, list, power, lifeboat seats, crew berths, endurance, satisfaction forecast, projected profit. Red rules block the trial; amber rules don't. Clickable inspection list. Sea trial animation (capsizes past 32°). Blueprints: new, copy, rename, delete, share codes. Commission a design as a ship, or refit a built ship (30% of changed blocks, 4 days).
- **Chartroom.** Nautical chart drawn in SVG. Click ports to build an itinerary. The planner works out arrival and departure times, slowest legal speed per leg, fuel with refuel stops, the PVSA rule, port draft/length limits, tenders, canals (the Cape Cod Canal's 41 m bridges turn the Liner away), turnarounds, the season window and departure day. Fare slider with a profit curve, the rivals' fare and a mass/premium guest mix bar. Voyages animate on the map with events in the log, then a report.
- **Economy and progression.** Two markets, appeal on a curve, reputation, seeded events (same plan, same result). Firsts earn design points for a 12-part tech tree (tiers 1 and 2). Chapter 1 milestones, ending with *Fleet capital*, which unlocks the Liner hull and an example liner design.
- **Onboarding.** The guided first 15 minutes from the doc, one sentence and one action per step, skippable.
- **Saves.** Autosave after every voyage and build change, three manual slots, export/import to a file, versioned with a migration hook.
- **Accessibility.** Every state has an icon as well as a colour. Text size 90–150%. Light/dark themes. Reduced motion. Voyage speed and an instant-result option. Sound effects and an ambience bed, both made in code, with volume sliders.

## Layout

```
data/                 Content. Add regions, ports and parts here without new code.
  regions/*.json      Chart bounds, land outlines, lane waypoints, seasons, market
  ports/*.json        Position, appeal, tags, berth limits, fees, fuel
  lanes/*.json        Lane edges, canals, tolls, size limits
  hulls.json          Hull classes: deck masks, fixed cells, dimensions, stability
  blocks.json         Block sizes, stats and deck roles
  tech.json           Tech tree
  events.json         Voyage events
  milestones.json     Chapter milestones
  firsts.json         Design points per first
  starters.json       Starter ships and the liner template
  strings.en.json     All player-facing text
src/sim/              Pure simulation: ship analysis, trial, routes, planner, economy, events, saves
src/ui/               Screens: chartroom, drydock, company, tutorial, app shell
tests/                Vitest suites, including the balance script
```

The planner and economy are pure functions. The UI only reads their results and applies them through `src/sim/game.ts`.

## The plain-language pass

All text lives in `data/strings.en.json`. `tests/strings.test.ts` automates the parts of the doc's checklist a machine can check: every key the code uses exists, no sentence over 20 words, no semicolons or dashes joining thoughts, every warning has two sentences (what's wrong, then the fix), log events are one sentence of 20 words or fewer, tooltips are 12 words or fewer, tutorial steps are one sentence, milestone goals are 6 words or fewer. Reading it aloud is still a human job.

## Balance notes

`npm run balance` prints the reference cruises. Current numbers: the Puffin (120 guests) makes about $60k on a 4-night cruise, Harbor Light (~300 guests) about $185k, and a 7-night Maritimes cruise about $330k. A simple bot that follows the tutorial and then picks the best route each time unlocks the Liner after 5 cruises, which matches the Phase 1 "done when".

## Not in this slice

Chapters 2–4, fleet mode, rivals and the graduation voyage are later phases in the doc. The title screen shows Fleet mode as locked, and the milestone list shows the graduation as "Chapter 2 build". Some simplifications to revisit:

- Tech parts apply to every ship at once instead of being fitted per ship.
- The season is set by the calendar. The departure-day picker chooses a day in the next week.
- Port names and tags live in the port data files, not the strings file.
