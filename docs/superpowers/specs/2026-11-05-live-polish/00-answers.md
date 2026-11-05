# Live polish: brainstorm answers (2026-11-05)

| # | Question | Answer |
|---|---|---|
| P0 | Pit-loss line on the gap chart (N3) | Out of the polish run: it is 4.2's rejoin ghost lines (needs pit loss from 4.0/4.1). |
| P1 | CLOSING vs PACE Δ | Only PACE Δ (rolling 50 mini-sectors); CLOSING goes. |
| P2 | MARGIN label | AHEAD `PASS ±x.xx s/lap` (our edge − threshold), BEHIND `HOLD ±x.xx s/lap` (threshold − their edge); positive = good for us. |
| P3 | Gap chart window | Our cars plus every car within ±`windowMs` (gaps config, default 10 000, pitwall estimate) of one of ours at the current lap, drawn grey; others not drawn; y zooms to the drawn lines. Membership is decided by `gaps` (C43), not the display. |
| P4 | Per mini-sector lines | A point at every mini-sector crossing for the last 10 laps (500 per car), older laps one point per lap; `gaps.gapper` 1 Hz → 4 Hz. |
| P5 | Live sectors after the line | Each sector column shows the newest finished time of that sector; one from an older lap in `textFaint`; status colours as each sector comes in. |
