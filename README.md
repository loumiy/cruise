# Cruise Line Manager

A ship-design and route-planning game. Build cruise ships deck by deck in the **Drydock**, plan cruises that fit what each ship can do in the **Chartroom**, and grow a small coastal line into a fleet.

This build covers **Phases 1–4** of the design doc's production plan:
- the vertical slice: Drydock and Chartroom joined, save/load
- Chapter 1, Northeast & Canada, ending with the graduation crossing to Miami
- Chapter 2, the Caribbean, with the Mega hull, ending with the graduation through the Panama Canal
- Chapter 3, Alaska & the Pacific Northwest, with the Expedition hull

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
- **Chapter 1 graduation.** After *Fleet capital*, pick ships to sail 1,050–1,250 nm south past Cape Hatteras with no guests aboard. Each ship is checked for range (15% fuel reserve) and stability (roll in a Hatteras swell). Harbor Light can make it from New York but not Boston. The chartered Puffin stays behind. Tech, design points and blueprints carry over. You keep 25% of your cash plus a grant, and reputation is pulled halfway back to 3.0.
- **Chapter 2: Caribbean.** 19 ports plus Coral Cay, with Havana shown but closed. Eight rival ships call at set ports on set weekdays and fill the piers: a full port means tendering (if it allows it) or no call, so departure day matters. Rival crowds cost appeal and put off premium guests, and a big crowd is a log event. A mass market shops against the rivals' fare. Hurricane season (Aug–Oct) spawns named storms: the planner shows each forecast cone and warns about stops inside it, while the real track drifts on a seed and can close a port. Air conditioning adds 35% to hotel fuel. Grand Cayman is tender-only. Colón charges a partial Panama Canal toll and turns away ships wider than the old locks. Coral Cay leases for $1.5M: no head tax, no rivals, +$70 spending per guest. Six chapter milestones, including *Mega market*, which unlocks the Mega hull (315 × 41 m, 9 decks) and an example design.
- **Chapter 2 graduation: through the Panama Canal.** After *Mega market*, take ships from Miami, San Juan or Barbados to Seattle. They must fit the new locks (51.25 m beam, 366 m long) and the Bridge of the Americas (61.3 m air draft), so the Mega stays behind. The longest leg without fuel has to fit the tank. Ships arriving out of season wait for May.
- **Chapter 3: Alaska & Pacific Northwest.** Seattle to Seward, with 16 ports and scenic stops. Home ports are Seattle, Vancouver and Seward. The PVSA makes Vancouver → Seward the classic one-way.
  - **Emissions control area:** buy low-sulfur fuel, risk a fine with ordinary fuel, or fit a scrubber or LNG engine (new tech parts) to burn without either.
  - **Glacier Bay:** each season, one sealed bid per weekly permit against a seeded rival bid. You pay only if you win, and a losing bid ends that season's bidding.
  - **Seymour Narrows:** opens only near slack tide. The planner waits for the window, or takes the outside route west of Vancouver Island when that's faster, and says so.
  - **Short season:** May to September.
  - **Scenic stops:** Glacier Bay, Hubbard Glacier and Tracy Arm are short daylight visits with no landing.
  - **Misty Fjords:** a zodiac landing that needs a zodiac garage.
  - **Hubbard Glacier:** ships without an ice belt stay back from the face. The ice belt is built into the Expedition hull and is a tech option for others.
  - **Market:** premium-heavy, and premium guests everywhere now avoid big ships, so a Mega is the wrong tool in Alaska.
  - **Milestones:** five, from *First glacier* to *Northern light*.
- **One-time prompts.** Each new mechanic gets one sentence the first time it matters (fuel stops, late returns, the crossing, air conditioning, full piers, crowds, storms, the island), then never again.
- **Onboarding.** The guided first 15 minutes from the doc, one sentence and one action per step, skippable.
- **Saves.** Autosave after every voyage and build change, three manual slots, export/import to a file, versioned with a migration hook.
- **Accessibility.** Every state has an icon as well as a colour. Text size 90–150%. Light/dark themes. Reduced motion. Voyage speed and an instant-result option. Sound effects and an ambience bed, both made in code, with volume sliders.

## Layout

```
data/                 Content. Add regions, ports and parts here without new code.
  rivals.json         Rival lines and their ships' weekly schedules
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

`npm run balance` prints the reference cruises. In the Northeast, the Puffin (120 guests) makes about $60k on a 4-night cruise, Harbor Light (~300 guests) about $185k, and a 7-night Maritimes cruise about $330k. In the Caribbean, the Liner makes $270k–$420k and the Mega up to about $500k. The Mega is shut out of Key West and Colón.

In Alaska the Expedition ship (240 guests) makes $450k–$620k a cruise at about $545 a night, the Liner about $1M, and a Mega $120k–$950k.

Three bots play the campaign. The first follows the tutorial, then picks the best route each time, and unlocks the Liner after 5 cruises, which matches the Phase 1 "done when". The second graduates, builds Liners in the Caribbean, and unlocks the Mega after about 8 cruises without a losing cruise. The third crosses to Alaska, builds Expedition ships, bids for permits, and earns all five Alaska milestones in two seasons.

The Liner's lease went from $45k to $60k a night so the Mega earns more per cruise. The doc only fixes the endpoints ($9k coastal, $175k mega).

## Not in this slice

Chapter 4 (Europe), the transatlantic graduation, and fleet mode are later phases in the doc. Known issue: money gets easy by Chapter 3. Cruise margins run about 50–60%, so cash outgrows what there is to spend it on, and costs need a pass before Chapter 4. Rivals keep fixed schedules, as in the prototype; reacting rival AI belongs to fleet mode. Some simplifications to revisit:

- Tech parts apply to every ship at once instead of being fitted per ship.
- The season is set by the calendar. The departure-day picker chooses a day in the next week.
- Port names and tags live in the port data files, not the strings file.
- Sandbox can switch regions freely from the Company screen.
