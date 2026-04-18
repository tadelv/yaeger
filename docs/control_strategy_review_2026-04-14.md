# Control Strategy Review (PID) and Alternatives

Date: 2026-04-14

## Current PID implementation review

The current firmware uses a single-loop PID that drives heater output only (`0..100%`) every 400 ms and smooths the output before commanding the heater SSR. The fan is not part of the closed-loop PID objective during normal operation. Instead, fan is controlled manually or by separate flows (autotune/delay measurement/manual safety). This is simple and robust, but it leaves roast quality and disturbance rejection potential on the table.

### What is working well

- Control update cadence and safety clamping are explicit (`PID_UPDATE_INTERVAL_MS`, actuator clamp `0..100`).
- Anti-windup exists via conditional integration and integral clamping.
- A process-delay predictor and delay measurement path already exist, which is a strong foundation for model-based control.
- Relay autotune and multiple tuning formulas are already supported.

### Main control gaps

1. **Single-input closed loop:** only heater is optimized by PID; fan is not coordinated in the control objective.
2. **No explicit multivariable constraints:** there is no built-in optimization that co-manages heater/fan tradeoffs while respecting user preferences (e.g., min/max fan envelope).
3. **Fixed-gain behavior across roast phases:** a single PID structure can struggle across drying/Maillard/development dynamics.
4. **No direct optimization of slope trajectories (RoR):** current loop tracks temperature, but profile slope can be more important for roasting consistency.

## Recommended fan envelope feature (applies to all candidate controllers)

Add user-configurable fan bounds and make *every* controller obey them.

### Proposed new preferences and runtime fields

- `controlFanMin` (0..100), default `30`
- `controlFanMax` (0..100), default `80`
- enforce `controlFanMin <= controlFanMax` (swap if reversed)

### Actuator mapping rule

Any controller computes raw commands:

- `heaterRaw` in 0..100
- `fanRaw` in 0..100

Then apply envelope:

- `heater = clamp(heaterRaw, 0, 100)`
- `fan = clamp(fanRaw, controlFanMin, controlFanMax)`

This gives users hard limits on airflow while still allowing automatic variation of fan.

## Controller alternatives (6 options)

Below are six options that can command **both heater and fan** while supporting user fan min/max bounds.

### 1) Linear MPC (recommended long-term target)

**What it is:** finite-horizon optimization on a linearized thermal model with constraints.

**Why it fits this project:**
- Naturally handles two actuators (heater + fan).
- Explicitly enforces constraints (`heater 0..100`, `fan min..max`, rate limits).
- Can track temperature and RoR targets simultaneously.

**Suggested objective:**
- Track bean temperature and/or ET targets.
- Penalize RoR error and actuator aggressiveness.
- Penalize fan movement to reduce noise/mechanical wear.

**Complexity:** medium/high (requires model ID + QP solver or lightweight custom optimizer).

### 2) LQR + integral action (LQI)

**What it is:** state-feedback controller on linear model; add integral states for zero steady-state error.

**Why it fits:**
- Lower compute load than MPC.
- Good multivariable coordination when model is decent.
- Stable and predictable tuning via Q/R matrices.

**How to enforce fan limits:**
- Compute unconstrained command, then saturate and apply simple anti-windup logic.
- Optional reference governor to pre-shape commands so saturation is less frequent.

**Complexity:** medium.

### 3) Gain-scheduled 2x PID (heater PID + fan PID)

**What it is:** keep PID family but use separate loops and phase-based gain schedules.

**Why it fits:**
- Fastest migration path from current implementation.
- Familiar tuning workflow.
- Can use roast phase breakpoints (drying/Maillard/development) and temperature ranges.

**Fan behavior:**
- Fan PID can regulate ET-BT delta, RoR damping, or smoke proxy.
- Always clamp by user `fanMin/fanMax`.

**Complexity:** low/medium.

### 4) ADRC (Active Disturbance Rejection Control)

**What it is:** observer-based control that estimates unmodeled disturbances in real time.

**Why it fits:**
- Handles disturbances (batch size variance, charge temp shifts, ambient changes) better than fixed PID.
- Reduces reliance on precise process model.

**Fan integration:**
- Use dual-channel ADRC (heater + fan) or heater ADRC with fan as scheduled auxiliary.
- Apply fan envelope at command stage.

**Complexity:** medium.

### 5) Fuzzy supervisory control (over PID/PI inner loops)

**What it is:** rule-based supervisor adjusts setpoints/gains/actuator splits based on roast context.

**Why it fits:**
- Encodes operator heuristics explicitly.
- Useful when precise modeling is hard but domain expertise is strong.

**Fan integration:**
- Rules can increase fan during high RoR overshoot risk and cap by user envelope.

**Complexity:** medium; interpretability high.

### 6) IMC / Smith-predictor MIMO variant

**What it is:** model-based control compensating dead time, extending your current predictor concept into dual-actuator control.

**Why it fits:**
- Builds directly on existing delay-estimation mechanics.
- Good compromise before full MPC.

**Fan integration:**
- Use decoupling matrix from identified plant gains.
- Clamp fan by user bounds.

**Complexity:** medium.

## Recommended roadmap

1. **Phase 1 (quick win):** implement fan envelope + **ADRC** as the primary advanced controller, while keeping current PID as fallback.
2. **Phase 2:** add gain scheduling and roast-phase-specific ADRC observer/controller parameters (drying/Maillard/development).
3. **Phase 3:** add optional LQI and MPC modes for sites that can maintain a reliable plant model.

## Minimal API/firmware changes to support alternatives

- Add `controlMode` enum in preferences/websocket payload, e.g.:
  - `pid_single` (current)
  - `pid_dual`
  - `lqi`
  - `mpc`
  - `adrc`
  - `fuzzy`
- Add `controlFanMin` / `controlFanMax` to preferences + websocket schema.
- Extend control telemetry to publish:
  - actuator raw commands (`heaterRaw`, `fanRaw`)
  - clamped commands (`heaterCmd`, `fanCmd`)
  - active constraints flags (e.g., `fanAtMin`, `fanAtMax`).

## Practical recommendation

Given bean variability (origin, age, moisture, density, and batch mass), **ADRC is the best primary fit** because it tolerates modeling uncertainty and rejects disturbances without needing a highly accurate plant model. Start with **ADRC + fan min/max envelope**, retain PID as a safe fallback mode, and only enable LQI/MPC as optional modes for environments with stronger model identification and maintenance practices.

### Why ADRC is a strong default for this roaster

- Bean-dependent dynamics are hard to model precisely and can shift roast-to-roast.
- ADRC estimates lumped disturbances online, reducing dependence on exact model fidelity.
- It can co-manage heater/fan with fewer assumptions than model-heavy approaches.
- It maps well to incremental rollout: observer first, then tighter actuator coordination.

## ADRC autotune proposal (how to make it practical)

If we implement ADRC, autotune should shift from "PID gain hunt" to "plant + observer characterization". The objective is to estimate safe starting values for:

- `b0_heater` (heater-to-temperature gain estimate)
- `b0_fan` (fan-to-cooling gain estimate)
- observer bandwidth `w0`
- controller bandwidth `wc`

### Autotune modes

1. **Quick tune (recommended default)**
   - Single button workflow for operators.
   - Uses a short sequence of bounded actuator steps and computes robust starting parameters.
2. **Advanced tune**
   - Exposes full sweep settings (step amplitude, dwell time, fan baseline, repeat count).
   - For power users validating different drum sizes/roaster configs.

### Step-by-step ADRC autotune flow

1. **Pre-check and safety lock**
   - Require roast state = idle or dedicated calibration mode.
   - Validate sensor health and stable sampling.
   - Apply fan envelope constraints (`controlFanMin`, `controlFanMax`) before any step test.

2. **Baseline stabilization phase (e.g., 20-40 s)**
   - Hold fan at a user-selected baseline inside min/max envelope.
   - Hold heater at a low safe value (or 0 for cooling characterization).
   - Estimate noise level and moving slope baseline.

3. **Heater gain test (`b0_heater`)**
   - Apply a bounded heater step (example: +15%) for a fixed dwell.
   - Measure slope change `dT/dt` after dead-time compensation window.
   - Estimate `b0_heater` from incremental response:
     - `b0_heater ~= Δ(dT/dt) / Δheater`

4. **Fan cooling test (`b0_fan`)**
   - With moderate heater hold, apply a bounded fan step (example: +10%).
   - Measure slope reduction and estimate:
     - `b0_fan ~= -Δ(dT/dt) / Δfan`
   - Clamp all fan commands by user envelope during test and runtime.

5. **Observer/controller bandwidth synthesis**
   - Choose `w0` based on measured noise and response speed (faster plant -> higher `w0`).
   - Set `wc` as a fraction of `w0` (typical start: `wc = w0 / 3` to `w0 / 5`).
   - Produce conservative defaults first; allow optional "aggressive" profile.

6. **Closed-loop verification pulse**
   - Run a short setpoint move (e.g., +3 to +5 °C).
   - Validate overshoot, settling time, and actuator saturation ratio.
   - If metrics exceed thresholds, auto-derate (`wc` down, `w0` down) and retest once.

7. **Persist + rollback safety**
   - Save tuned ADRC params with timestamp and roast context metadata.
   - Keep last-known-good profile; auto-rollback if the next roast triggers repeated saturation/oscillation alarms.

### UI/API additions for ADRC autotune

- Extend `setPidControl` into generic `setControl` (backward compatible alias retained).
- Add fields:
  - `controlMode: "pid_single" | "adrc" | ...`
  - `adrcAutotune: boolean`
  - `adrcTuneLevel: "quick" | "advanced"`
  - `adrcFanBaseline`, `adrcHeaterStep`, `adrcFanStep`, `adrcDwellSec`
- Telemetry:
  - `adrcTuneStage`, `adrcTuneProgress`, `adrcB0Heater`, `adrcB0Fan`, `adrcW0`, `adrcWc`
  - `adrcValidationOvershoot`, `adrcValidationSettlingSec`, `adrcValidationSaturationPct`

### Why this autotune approach works for variable beans

- It does not assume a fixed global bean model.
- It re-identifies local gains from fresh step data each tune.
- It keeps safety constraints explicit (heater bounds + user fan min/max).
- It is resilient to changing origin/age/batch by recalibrating dynamics instead of forcing one static parameter set.
