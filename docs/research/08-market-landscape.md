# Market landscape: other race-engineer tools

What other F1 25 tools, sim-racing engineer platforms (iRacing, LMU, ACC) and real-F1 timing apps do. What pitwall can take from them, and where it is ahead or behind.

Research done on 2026-10-30 while the replay-speed run was going. Real F1 teams' tools are covered in [01](01-race-engineering-practice.md) and [02](02-atlas-interaction-model.md); this file is about the hobby and commercial tools around the games.

**How far each source was read:** 🟢 page read · 🟡 search summary only. Most sources are vendor pages or vendor comparisons (Coach Dave Academy compares itself with rivals), so features are claims and prices may be stale. Pitwall's own conclusions are marked 🔵.

## 1. Summary

- **One direct rival:** [PITWALL ONE](https://store.steampowered.com/app/5055450/) (PixelDrift, Steam Early Access, exit planned for about February 2027). It is an F1 25 + LMU + AC/ACC "AI race engineer" with voice radio, live strategy, corner coaching, a "Mission Control" desktop with timing, track map and telemetry, a phone second screen and local data. It is built for the **solo driver** who talks to a voice bot, not for a human engineer.
- **The F1 25 field is otherwise thin:** loggers (F1Laps, Sim Racing Telemetry), dashboards (Race Dash, RaceLab, SimHub), phone pit walls (Pacedex), coaches (Track Titan, trophi.ai) and one open-source live tool (Pits n' Giggles). Strategy, where any exists, is a fuel calculator, a regression wear line or a black-box voice call.
- **Real team pit walls exist in the multi-sim world**, not in F1: Simulator Controller's *Team Center*, Cosworth Pi Toolbox with live remote telemetry (iRacing), Pitwall.live (now SimGrid), SimEndurance (LMU). They are built for endurance driver swaps: stint plans, fuel and tyre-pressure handovers.
- 🔵 **Where pitwall is ahead:** a human engineer's multi-monitor workbench, a strategy model from the literature rather than a fuel calculator, replayable recordings with a deterministic engine, honest "unknown" values, and realism mode. No other tool does all of these.
- 🔵 **Where pitwall is behind:** one game in one UDP format (**the 2026 Season Pack is not supported**, see §6), no driver-facing view (overlay, phone, voice), no coaching yet, no multi-user plan sharing, and a heavier setup.
- 🔵 **The name "Pitwall" is crowded:** PITWALL ONE, Pitwall.live (SimGrid), PitWall Pro and others. This only matters if pitwall is ever published.

## 2. The landscape

### 2.1 F1 25 tools

| Tool | Kind | What it does | Strategy depth | Price | Read |
|---|---|---|---|---|---|
| [PITWALL ONE](https://store.steampowered.com/app/5055450/) | AI engineer + desktop | push-to-talk radio with local speech; pit windows, tyre choice, undercut/overcut calls, traffic, SC, rain forecast, fuel targets; corner-by-corner coaching against the driver's best lap; pre-race brief, watchlists, setup hints; automatic recording and debrief; "Mission Control" desktop (timing, track map, telemetry); QR-code phone/tablet second screen; no account, data stays local | calls, model not documented | not listed | 🟢 |
| [Pits n' Giggles](https://github.com/ashwin-nat/pits-n-giggles) | open-source live tool (MIT) | browser timing table with driver comparison, stint history, tyre wear with **regression prediction**, fuel model, damage and ERS history; player and **spectator** modes; always-on-top HUD overlays (OBS-ready); client/server so an engineer can watch remotely; JSON autosave; forwards data to other apps; supports F1 23, 24, 25 and the 2026 Season Pack | linear wear fit | free | 🟢 |
| [Pacedex](https://chrome-stats.com/d/com.pacedex.app) | phone pit wall + voice | console sends UDP straight to the phone, no PC; "homework" (corners where time is lost); pit-stop "what-if"; supports the 2026 Season Pack (active aero, overtake boost) | what-if | app | 🟡 |
| [F1Laps](https://www.f1laps.com/faqs/f1-25-udp-telemetry-settings/) | logger + website | records sessions, syncs to f1laps.com for review (laps, tyre wear, fuel, setups) | none live | free app | 🟡 |
| [Sim Racing Telemetry](https://store.steampowered.com/app/845210/) | analysis | post-session telemetry charts, tyre wear, temperatures, pressures; no dashboard | none | about $10 per game | 🟡 |
| [Race Dash](https://apps.apple.com/gb/app/race-dash-for-sim-games/id1174914156), [Racing View](https://apps.apple.com/app/id6503355035) | phone dashboards | car dashes; Racing View adds a strategy calculator (race time, fuel) | calculator | about $6 per game | 🟡 |
| [RaceLab](https://racelab.app/formula1) | overlays | 23 overlays for F1: relative, standings, lap-time spread, delta, head-to-head, lap log and graph, track map, fuel calculator, flags; **driver tags with notes**; **smart layouts that switch by session**; race briefing; teammate fuel sharing; VR; Stream Deck; OBS | fuel calculator | free; Pro €4.90/month | 🟢 |
| [SimHub](https://www.hackernoon.com/how-to-set-up-simhub-with-f1-25-for-the-playstation-5) | dashboards, wheel LEDs | generic dash designer | none | free / licence | 🟡 |
| [Track Titan](https://tracktitan.io), [trophi.ai](https://www.trophi.ai/sim-racing-coaching) | AI coaching | time-loss root cause per corner, step-by-step "coaching flows" (Track Titan, $5M seed in Dec 2025); live input overlays and a voice coach (trophi, by Driver61) | none | from about $8/month | 🟡 |
| [AI Race Engineer](https://apps.apple.com/app/id6768048614) | phone voice assistant | answers "tyre strategy?", "where am I losing time?" from F1 20–25 and GT7 data | Q&A | app | 🟡 |
| in-game engineer and MFD | built in | pit window (ideal/latest lap), strategy MFD, engineer calls | the bar to beat (user goal) | – | – |

### 2.2 Team and engineer platforms in other sims

| Tool | Sims | Engineer-facing features | Read |
|---|---|---|---|
| [Simulator Controller: Team Center](https://github-wiki-see.page/m/SeriousOldMan/Simulator-Controller/wiki/Team-Center) | ACC, iRacing, LMU, rF2, AMS2, … | a "pitwall application" for anyone in the team: standings and telemetry reports, live track map (learnt after a few laps), stint and lap details, driver ratings (pace, consistency, car control, race craft); **Monte Carlo "Analyze Traffic"** ranks next-stop laps by places gained, traffic after the stop and total stops; stint plan with driver rotation; prepares the next stop and sends it to the active driver's AI engineer, which enters it into the pit MFD; **"Lite UI" for drivers**; one owner "releases" strategy and plan to all clients; data refresh every 10 s, the UI locks while it refreshes | 🟢 |
| [Cosworth Pi Toolbox](https://www.iracing.com/cosworth-pi-toolbox-plus-free-trial-returns-updated-features-for-iracing-spa-24/) | iRacing | the professional analysis tool; Lite free; Plus (about £5/month) adds **live remote telemetry** so engineers and coaches elsewhere see the car in real time; ships iRacing workbooks | 🟡 |
| [Pitwall.live](https://coachdaveacademy.com/announcements/pitwall-live-collaboration) (bought by SimGrid) | ACC, iRacing | browser live timing for teams and fans; stint comparison (stint times, laps per stint, pit-stop durations); stream links; replaced Coach Dave's Race Sync | 🟡 |
| SimEndurance | LMU | team platform: strategy, stints, setups and live data in one place "instead of spreadsheets, notes and Discord"; SimBridge companion app | 🟡 |
| [LMU Pit Wall](https://github.com/NikMusy/le-mans-ultimate-telemetry) | LMU | open source (MIT): Python reads shared memory, WebSocket, one-file HTML dashboard via ngrok; timing tower, tyres, fuel, rolling fuel per lap, flag strip, a strategist cheat sheet, demo mode | 🟢 |
| [iRacePlan](https://iraceplan.com/) | iRacing | endurance stint planner shared live with the team | 🟡 |
| Crew Chief | many (F1 support lags) | free voice spotter and engineer: fuel per lap, when to pit, how much to add, pit-box countdown | 🟡 |
| [Garage 61](https://coachdaveacademy.com/tutorials/coach-dave-delta-vs-garage-61-which-is-best-for-you/), [Coach Dave Delta](https://coachdaveacademy.com/tutorials/coach-dave-delta-vs-vrs-which-one-is-best-for-you/), VRS | iRacing (+ ACC, LMU) | lap and telemetry sharing, reference laps from others, AI coaching against a reference, setups; $6.50–13/month | 🟡 |

### 2.3 Real-F1 timing apps (UI references)

| Tool | What is worth looking at | Read |
|---|---|---|
| [undercut-f1](https://github.com/JustAman62/undercut-f1) | **cursor driver**: select a car and every gap becomes relative to it; **compare mode** pins two drivers; tyre stint page with offsets; "timing by lap" (tower snapshot per lap, position changes); delta-to-average-lap chart that cancels field-wide slowdowns; hiding a driver hides it in every view | 🟢 |
| [MultiViewer](https://multiviewer.app/docs/usage/race-trace) | race trace (delta to the field average); track map with marshal-sector status; it warns not to make strategy calls off it | 🟡 |
| [f1-dash](https://github.com/slowlydev/f1-dash) | mini sectors, delay-to-stream | 🟡 |
| [F1 Manager 2024](https://shacknews.com/article/140757/f1-manager-2024-review-we-think-it-might-be-plan-a) | a game whose UI *is* a pit wall: stints, weather and incidents in view; players say its strategy estimates ignore traffic | 🟡 |

## 3. What pitwall can take

Ordered by value for the league use case; each points at the sub-project it fits. 🔵 throughout.

| # | Idea | From | Fits |
|---|---|---|---|
| 1 | **Rank pit laps by outcome, not only by race time**: places gained, traffic on rejoin, number of stops; Monte Carlo over a pit-lap range | Team Center "Analyze Traffic" | 4a pit-lap sweep; 4b MC |
| 2 | **Cursor car**: one selection that every widget shares (gaps relative to it, highlight on map and charts, hidden in all views when hidden) | undercut-f1, MultiViewer | supervisor-owned shell/emphasis; before 4a ghosts |
| 3 | **Workbook switches by session type** (practice → `car`, quali → `quali`, race → `race`), with manual override | RaceLab smart layouts | UI shell, small |
| 4 | **Driver tags and notes** on rivals ("defends hard", "slow out of T3", "on a 1-stop") that show in the tower and battle cards | RaceLab | 4a or SP5; the note store needs weekend lifetime |
| 5 | **Pre-race brief and post-race debrief** as generated pages: weather, tyre allocation, deg from practice, planned stops; afterwards stints, stops, incidents, what changed the result | PITWALL ONE, RaceLab, Team Center race summary | 4b brief; SP5 debrief |
| 6 | ~~**Driver-facing lite view** on a phone via QR code~~ (rejected by the user: pitwall is for the human engineer, not the driver) | Team Center Lite UI, PITWALL ONE second screen, Pacedex | – |
| 7 | **Stint comparison table** for the whole field: stint lengths, average pace per stint, deg per stint, pit-lane times | Pitwall.live, undercut-f1 | 4a (deg fit gives the numbers) |
| 8 | **Timing by lap**: scrub the tower back to any lap and see position changes and gap shifts | undercut-f1 | uses stored laps; SP5 or a tower mode |
| 9 | **Mini sectors** computed from lap distance (the game sends only S1/S2) | f1-dash | SP5, together with the per-turn deltas (V26) |
| 10 | **Plan ownership**: one engineer "releases" the plan, the other clients see it and a diff of what changed | Team Center | second car / second engineer (SP5) |
| 11 | **OBS / spectator view** for league streams | Pits n' Giggles, Pitwall.live | later; low priority |
| 12 | **Teammate reference laps**: the two friends' best laps as each other's reference | Garage 61, Delta | SP5 performance |

Not worth taking:

- **Voice radio and an AI engineer.** The engineer is a human on Discord, and radio is secondary (user decision, see [README](README.md)). Every rival now sells voice; it is a crowded way to compete.
- Wheel LEDs, VR overlays, setup marketplaces.
- Team Center's 10 s refresh that locks the UI (pitwall streams per topic).

## 4. Where pitwall is ahead

🔵 Based on the features listed in §2; none of these tools was installed and tried.

- **Built for a human engineer at a desk.** Docking workbooks, pop-out windows and two monitors, like ATLAS. The F1 tools aim at the driver (overlays, phone, voice). Only Team Center and Pi Toolbox aim at the engineer, and neither supports F1.
- **The strategy model.** A lap model and race forecast after TUM, with state-space degradation and dirty-air terms from the literature ([03](03-strategy-models.md), [07](07-strategy-literature.md)). The rivals' strategy is a fuel calculator, a linear wear fit (Pits n' Giggles) or calls without a stated model (PITWALL ONE). The bar is to beat the game's own strategist by a wide margin.
- **Decision-first displays.** Each display answers a decision from [06](06-engineer-decisions.md) (undercut card, SC card, ghosts). The rivals mostly show raw channels.
- **Recordings and a deterministic engine.** Any race can be replayed and re-analysed (`reprocess`), and analyses are tested on real segments. The rivals record for review but don't re-run their logic.
- **Honest data.** `Known`/`unknown` instead of zeros for data hidden online; a feed-status widget.
- **Realism mode** hides rival data a real team wouldn't have. No rival offers it.
- **Linux and remote first.** The bridge and browser UI work across Tailscale. Most rivals are Windows apps.
- **Free, local, open to change.** No account and no subscription.

## 5. Where pitwall is behind

- **One game, one UDP format.** Only F1 25 in the 2025 format. Rivals cover several sims, and Pits n' Giggles and Pacedex already support the 2026 Season Pack. Other sims are a far-future goal outside the MVP (§8).
- **Nothing for the driver.** No overlay, phone view or voice. By design: the driver gets the human engineer's voice on Discord (§8).
- **No track map, weather crossover or strategy yet.** These are planned for SP4, but PITWALL ONE ships them today.
- **No coaching or reference laps.** Track Titan, trophi and Delta are deep here. This is SP5 for pitwall.
- **One engineer, one car.** Team Center, RaceLab team sync and SimEndurance share plans between several people.
- **Setup effort.** A bridge, a forwarder and Tailscale, against a single installer with a QR code. Fine for three friends, a barrier for anyone else.
- **No crowd data.** Garage 61, Delta and Track Titan learn from many users. Pitwall's defaults (pit loss, deg) come from one league; the planned community defaults are the counterweight.

## 6. Risks found

- **The F1 25 2026 Season Pack** (out 3 June 2026, $29.99) adds 2026 cars and rules: active aero and overtake boost. Its telemetry needs the in-game **UDP format "2026"**. In the 2025 format, sessions may come through as "F1 Generic" without boost and ERS data ([F1Laps](https://www.f1laps.com/faqs/f1-26-udp-telemetry-settings/)). EA published a separate spec ([EA forum thread](https://forums.ea.com/discussions/f1-25-general-discussion-en/discussion-f1%C2%AE25-2026-season-pack-udp-specification/13424444), not readable here; there is a new "Car Telemetry 2" packet). Pitwall rejects every format except 2025, and none of the repo docs mention the pack. **If the league races 2026 cars, pitwall decodes nothing.** Pits n' Giggles (MIT) already parses the 2026 format and could serve as a reference. *Resolved: the league uses the 2025 format (§8).*
- **Name collision.** PITWALL ONE (same game, same buyer), Pitwall.live/SimGrid, PitWall Pro and an MCP "Pitwall" for F1 data. This only matters for a public release.
- **The voice-engineer market is saturated.** If pitwall is ever published, it should compete on the engineer workbench and the strategy model, not on radio.

## 7. Market notes

- Market size: estimates disagree and come from weak sources (sim racing about $680M in 2026 per a blog citing Circana; racing simulators $1.3–1.8B depending on the definition). iRacing claims 250–350k members. No F1 25 sales figures were found. 🟡
- Price norms: overlay and coaching subscriptions are €5–13 a month; phone apps charge about $6–10 per game; open-source tools are free (Pits n' Giggles, LMU Pit Wall, Simulator Controller, Crew Chief).
- Money in the sector goes to AI coaching (Track Titan's seed round) and to platforms buying tools (SimGrid bought Pitwall.live; Coach Dave folded Race Sync into it).
- 🔵 For a personal league tool none of this changes the plan. For a public release, the gap is a **human-engineer workbench for F1 leagues**, which nobody serves.

## 8. User answers (2026-10-30)

1. **UDP format:** the league uses the 2025 format, so the Season Pack risk does not apply. Support for other simulators' outputs is a far-future goal outside the MVP.
2. **Audience:** pitwall is for the human race engineer. No driver-facing views (idea 6 rejected).
3. **Public release:** not a goal so far, so the name collision does not matter.
4. **Coaching, track map and strategy** are already planned in SP4 and SP5; the ideas in §3 feed those specs.

## 9. Sources

- PITWALL ONE: [Steam](https://store.steampowered.com/app/5055450/)
- Pits n' Giggles: [GitHub](https://github.com/ashwin-nat/pits-n-giggles)
- Pacedex: [Play listing mirror](https://chrome-stats.com/d/com.pacedex.app)
- F1Laps: [F1 25 settings](https://www.f1laps.com/faqs/f1-25-udp-telemetry-settings/), [F1 26 settings](https://www.f1laps.com/faqs/f1-26-udp-telemetry-settings/)
- Sim Racing Telemetry: [Steam](https://store.steampowered.com/app/845210/)
- Race Dash: [App Store](https://apps.apple.com/gb/app/race-dash-for-sim-games/id1174914156); Racing View: [App Store](https://apps.apple.com/app/id6503355035); AI Race Engineer: [App Store](https://apps.apple.com/app/id6768048614)
- RaceLab: [F1 page](https://racelab.app/formula1), [home and pricing](https://racelab.app/)
- Track Titan: [site](https://tracktitan.io), [funding](https://tech.eu/2025/12/04/track-titan-raises-5m-for-ai-powered-strava-for-motorsport/); trophi.ai: [coaching](https://www.trophi.ai/sim-racing-coaching)
- Simulator Controller: [Team Center wiki](https://github-wiki-see.page/m/SeriousOldMan/Simulator-Controller/wiki/Team-Center), [Team Server wiki](https://github-wiki-see.page/m/SeriousOldMan/Simulator-Controller/wiki/Team-Server), [GitHub](https://github.com/SeriousOldMan/Simulator-Controller)
- Cosworth Pi Toolbox: [iRacing trial](https://www.iracing.com/cosworth-pi-toolbox-plus-free-trial-returns-updated-features-for-iracing-spa-24/), [Cosworth](https://cosworth.com/news/cosworth-and-iracing-unite-to-redefine-data-analysis-in-sim-racing/)
- Pitwall.live: [SimGrid announcement](https://pits.thesimgrid.com/announcements/pitwall-live-joins-the-simgrid-family/), [Coach Dave](https://coachdaveacademy.com/announcements/pitwall-live-collaboration)
- LMU Pit Wall: [GitHub](https://github.com/NikMusy/le-mans-ultimate-telemetry); iRacePlan: [site](https://iraceplan.com/)
- Crew Chief: [setup guide](https://simracingcockpit.gg/crew-chief-setup)
- Coaching comparisons (vendor-written): [Delta vs Garage 61](https://coachdaveacademy.com/tutorials/coach-dave-delta-vs-garage-61-which-is-best-for-you/), [Delta vs VRS](https://coachdaveacademy.com/tutorials/coach-dave-delta-vs-vrs-which-one-is-best-for-you/)
- undercut-f1: [GitHub](https://github.com/JustAman62/undercut-f1); MultiViewer: [race trace](https://multiviewer.app/docs/usage/race-trace); f1-dash: [GitHub](https://github.com/slowlydev/f1-dash)
- F1 Manager 2024: [Shacknews review](https://shacknews.com/article/140757/f1-manager-2024-review-we-think-it-might-be-plan-a)
- 2026 Season Pack: [EA announcement](https://www.ea.com/games/f1/news/f1-25-2026-season-pack-etyntk), [EA UDP spec thread](https://forums.ea.com/discussions/f1-25-general-discussion-en/discussion-f1%C2%AE25-2026-season-pack-udp-specification/13424444)
- Market: [sim racing statistics (weak source)](https://voxbooster.com/blog/sim-racing-statistics-2026), [MarketsandMarkets](https://www.marketsandmarkets.com/PressReleases/racing-simulator.asp)
