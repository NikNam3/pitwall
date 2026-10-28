# What can be changed in the game from outside

The question: can a tool trigger a pit stop, change compounds or brake balance, or change anything else about the car or the game?

## Officially: nothing
- **UDP is output only.** The spec describes no input channel, and the game accepts no commands over the network.
- **Pacedex** is a telemetry viewer for phone or tablet (PS5/Xbox/PC over Wi-Fi, F1 24/25) ([listing](https://chrome-stats.com/d/com.pacedex.app)). No evidence was found that it controls the game. Its `/eng off` most likely switches off Pacedex's own AI engineer voice, not anything in the game.

## Unofficial routes

| Route | How | Assessment |
|---|---|---|
| **1. Virtual input on the driver's PC** | A helper program on the driver's PC simulates key presses (`SendInput`) or a virtual controller (ViGEm/vJoy): brake bias ±, differential, ERS mode, and navigating the MFD for the pit strategy | **Plausible:** the game has key bindings for this, and Stream Deck profiles do it locally ([Elgato F1 25 profile](https://marketplace.elgato.com/product/f1-25-cg-845787c9-e49e-455a-9d50-cf2f63f994c3)). **But:** MFD macros are fragile (they need a known starting point in the menu; older F1 versions ignored AutoHotkey because of DirectInput, [Overtake thread](https://www.overtake.gg/threads/possible-hotkey-solution.126204/)). **EA Javelin anti-cheat** is a real risk: virtual-input drivers like reWASD have triggered "EA security violation" ([reWASD forum](https://forum.rewasd.com/forum/rewasd/technical-questions-aa/246126-ea-security-violation?p=246145)). Plain `SendInput` is probably less suspicious than a virtual controller driver; only a test will tell. |
| **2. The game's voice commands** | F1 25 has radio voice commands ("box this lap", tyre choice, an extra stop; the phrases are in `speech_recognition.xml`) ([review](https://mezha.ua/en/reviews/oglyad-simulyatora-peregoniv-f1-25-302836/amp/), [EA forum](https://forums.ea.com/idea/f1-25-bug-reports-en/f1-25-spanish-voice-commands-bug-%E2%80%93-xml-fix-found/13795032)) | The driver can use them **themselves** after the engineer's call. Injecting audio into their microphone remotely would be very hacky. |
| **3. Writing to game memory** | changing values in RAM directly | **Ruled out:** anti-cheat, ban risk in an online league, and it is cheating. |

## Decision (user, 2026-10-28)

- **Nothing that changes the car.** That would be cheating.
- **The box call and tyre choice from outside are wanted.** That matches real F1: the *team* decides when to pit and which tyres the mechanics fit, not the driver.
- **The MVP is read-only.** The engineer gives calls by voice; the driver sets them through voice command or the MFD. Pitwall checks that the call was carried out.
- **Sub-project 6, the pit actuator**, comes after the MVP, in the forwarder/recorder repo.

## Read-only closes the loop

In real F1, teams may not change anything on the car remotely: telemetry only flows from car to pit wall, and the driver does what the engineer says. Pitwall can **check** that a call was carried out: brake bias, differential (on/off throttle), ERS mode, fuel mix, pit limiter and pit status are all in the UDP stream. Only "next compound" isn't. A "call → confirmation" feature ("brake bias +1 requested … confirmed at 56 %") is feasible and fully legitimate.

## Pit actuator flow (sub-project 6)

1. The engineer chooses "box this lap, mediums" in pitwall and sends it over the reserved `command` channel.
2. The forwarder on the driver's PC drives the **MFD pit panel** with key presses and sets the compound for the next stop.
3. Confirmation comes back through UDP:
   - `m_mfdPanelIndex` (CarTelemetry) shows which MFD panel is open (1 = Pits), so the macro can check its starting point and each step instead of navigating blind.
   - `m_pitStopWindowIdealLap/LatestLap` (Session) belong to the current strategy and change when it changes, which confirms the change indirectly.
   - After the stop, the fitted compound shows up anyway.
4. **Safety:**
   - the actuator acts only at a calm moment (full throttle, steering straight, not in a braking zone)
   - the driver sees the MFD open and can cancel

The box call itself is first of all information for the driver, who drives into the pits; pitwall then checks the pit status.

**It starts with a spike, which must answer:**
1. Do `SendInput` key presses work in F1 25 with Javelin active (offline test first)?
2. Can the pit panel be navigated deterministically using `m_mfdPanelIndex`?
3. Do the pit-window fields reliably confirm a strategy change?

The real implementation follows only if all three hold.

**Unverified:** the exact layout of the F1 25 pit panel (its entries, and how many steps it takes to reach the compound).
