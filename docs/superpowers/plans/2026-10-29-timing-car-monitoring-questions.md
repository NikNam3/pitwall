# Timing + car monitoring (sub-project 3): questions for the user

Open decisions from the run. The code does the option marked *(built)* in each case, so nothing is blocked; pick a letter (or write your own) under **Answer**, and a later session applies every answer that differs from what was built.

---

## Q1. Which tyre pressure band should `car-bands` use?

The spec's default band was 21.5–25.0 psi (spec 14, item 2). The game's telemetry sends the live pressure, which is above the cold setup value. Community F1 25 setups mostly run the setup maximum, 29.5 psi front and 26.5 psi rear, some go down to about 20.2 psi rear, and the time trial reads a fixed 30.16 psi. With 21.5–25.0 almost every car would be out of band from lap 1. The value is calibrated in sub-project 5 either way.

- **A.** One band for all four tyres, 20.0–31.0 psi: no false alarms, but it only catches gross errors. *(built)*
- **B.** One band per axle, e.g. front 22.5–31.0 and rear 20.0–28.0 psi: closer to the setup ranges; needs four config keys instead of two.
- **C.** Keep 21.5–25.0 psi as the spec had it.

Recommendation: A until the practice recording shows real live pressures, then B with values from it.

**Answer:**
