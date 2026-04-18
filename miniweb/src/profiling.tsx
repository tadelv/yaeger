import { ChangeEvent } from "preact/compat";
import { useState } from "preact/hooks";
import { Profile, ProfileStep, RoastState } from "./model";

export const ROAST_EVENT_TAGS = [
  { key: "charge", label: "Charge" },
  { key: "dry-end", label: "Dry End" },
  { key: "first-crack-start", label: "First crack start" },
  { key: "first-crack-end", label: "First crack end" },
  { key: "second-crack-start", label: "Second crack start" },
  { key: "second-crack-end", label: "Second crack end" },
  { key: "drop", label: "Drop" },
] as const;

const INTERPOLATIONS: ProfileStep["interpolation"][] = [
  "linear",
  "ease-in",
  "ease-out",
  "ease-in-out",
];

const DEFAULT_PHASE_VALUES = [
  { duration: 60, setpoint: 150, fanValue: 40 },
  { duration: 240, setpoint: 170, fanValue: 45 },
  { duration: 180, setpoint: 205, fanValue: 55 },
  { duration: 90, setpoint: 212, fanValue: 65 },
  { duration: 60, setpoint: 220, fanValue: 70 },
  { duration: 30, setpoint: 224, fanValue: 75 },
  { duration: 30, setpoint: 90, fanValue: 100 },
];

export type ProfileStore = {
  profile?: Profile;
  profileName: string;
  followProfileEnabled: boolean;
};

export const profileStore: ProfileStore = {
  profile: undefined,
  profileName: "",
  followProfileEnabled: false,
};

export function createDefaultProfile(): Profile {
  return {
    name: "Custom roast profile",
    steps: ROAST_EVENT_TAGS.map((tag, index) => ({
      name: tag.label,
      tag: tag.key,
      interpolation: index === ROAST_EVENT_TAGS.length - 1 ? "linear" : "ease-out",
      duration: DEFAULT_PHASE_VALUES[index].duration,
      setpoint: DEFAULT_PHASE_VALUES[index].setpoint,
      fanValue: DEFAULT_PHASE_VALUES[index].fanValue,
    })),
  };
}

export function activateProfile(profile: Profile, sourceName?: string) {
  const normalized = normalizeProfile(profile, sourceName || profile.name || "Custom profile");
  profileStore.profile = normalized;
  profileStore.profileName = normalized.name || sourceName || "Custom profile";
}

export function followProfile(
  profile: Profile,
  roast: RoastState,
): { setPoint: number; fanValue?: number } | undefined {
  if (!roast.startDate) return undefined;

  const elapsedTime = (new Date().getTime() - roast.startDate.getTime()) / 1000;
  let accumulatedTime = 0;

  for (let stepIndex = 0; stepIndex < profile.steps.length; stepIndex += 1) {
    const step = profile.steps[stepIndex];
    const duration = Math.max(0, step.duration);
    accumulatedTime += duration;
    if (elapsedTime <= accumulatedTime || stepIndex === profile.steps.length - 1) {
      const stepStartTime = accumulatedTime - duration;
      const progress = duration > 0 ? (elapsedTime - stepStartTime) / duration : 1;
      const prevSetpoint =
        stepIndex === 0
          ? profile.steps[0].setpoint
          : profile.steps[stepIndex - 1].setpoint;

      return {
        setPoint:
          Math.floor(
            interpolateSetpoint(
              prevSetpoint,
              step.setpoint,
              clampNumber(progress, 0, 1),
              step.interpolation,
            ) * 10,
          ) / 10,
        fanValue: step.fanValue,
      };
    }
  }

  return undefined;
}

function interpolateSetpoint(
  start: number,
  end: number,
  progress: number,
  type: ProfileStep["interpolation"],
): number {
  switch (type) {
    case "linear":
      return start + (end - start) * progress;
    case "ease-in":
      return start + (end - start) * Math.pow(progress, 2);
    case "ease-out":
      return start + (end - start) * (1 - Math.pow(1 - progress, 2));
    case "ease-in-out":
      return (
        start +
        (end - start) *
          (progress < 0.5
            ? 2 * Math.pow(progress, 2)
            : 1 - Math.pow(-2 * progress + 2, 2) / 2)
      );
    default:
      return end;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function isInterpolation(value: unknown): value is ProfileStep["interpolation"] {
  return INTERPOLATIONS.includes(value as ProfileStep["interpolation"]);
}

function readString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function readNumber(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeStep(step: unknown, index: number): ProfileStep {
  const raw = isObject(step) ? step : {};
  const tag = ROAST_EVENT_TAGS[index % ROAST_EVENT_TAGS.length];
  const defaultValues = DEFAULT_PHASE_VALUES[index % DEFAULT_PHASE_VALUES.length];
  const hasFanValue = raw.fanValue != null;
  const fanValue = hasFanValue
    ? Math.round(clampNumber(readNumber(raw.fanValue, defaultValues.fanValue), 0, 100))
    : undefined;

  return {
    name: readString(raw.name, tag?.label ?? `Phase ${index + 1}`),
    tag: readString(raw.tag, tag?.key ?? `phase-${index + 1}`),
    interpolation: isInterpolation(raw.interpolation) ? raw.interpolation : "linear",
    duration: Math.round(clampNumber(readNumber(raw.duration, defaultValues.duration), 1, 1800)),
    setpoint: Math.round(clampNumber(readNumber(raw.setpoint, defaultValues.setpoint), 0, 300)),
    fanValue,
  };
}

function normalizeProfile(profile: unknown, fallbackName = "Custom roast profile"): Profile {
  if (!isObject(profile) || !Array.isArray(profile.steps)) {
    throw new Error("Invalid profile format");
  }

  const steps = profile.steps.map((step, index) => normalizeStep(step, index));
  if (!steps.length) throw new Error("Profile needs at least one phase");

  return {
    name: readString(profile.name, fallbackName),
    steps,
  };
}

function formatDuration(seconds: number) {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function totalDuration(profile: Profile) {
  return profile.steps.reduce((sum, step) => sum + Math.max(0, step.duration), 0);
}

function slugify(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "roast-profile";
}

type ProfileControlProps = {
  onStateChange: () => void;
};

export function ProfileControl({ onStateChange }: ProfileControlProps) {
  const [error, setError] = useState("");
  const [draftProfile, setDraftProfile] = useState<Profile>(() =>
    profileStore.profile ? normalizeProfile(profileStore.profile) : createDefaultProfile(),
  );

  const setProfileName = (name: string) => {
    setDraftProfile((prev) => ({ ...prev, name }));
  };

  const updateStep = (index: number, patch: Partial<ProfileStep>) => {
    setDraftProfile((prev) => ({
      ...prev,
      steps: prev.steps.map((step, stepIndex) =>
        stepIndex === index ? normalizeStep({ ...step, ...patch }, stepIndex) : step,
      ),
    }));
  };

  const addStep = () => {
    setDraftProfile((prev) => {
      const index = prev.steps.length;
      const tag = ROAST_EVENT_TAGS[index % ROAST_EVENT_TAGS.length];
      const defaultValues = DEFAULT_PHASE_VALUES[index % DEFAULT_PHASE_VALUES.length];
      return {
        ...prev,
        steps: [
          ...prev.steps,
          {
            name: tag.label,
            tag: tag.key,
            interpolation: "linear",
            duration: defaultValues.duration,
            setpoint: defaultValues.setpoint,
            fanValue: defaultValues.fanValue,
          },
        ],
      };
    });
  };

  const removeStep = (index: number) => {
    setDraftProfile((prev) => ({
      ...prev,
      steps: prev.steps.filter((_, stepIndex) => stepIndex !== index),
    }));
  };

  const applyDraftProfile = () => {
    try {
      const normalized = normalizeProfile(draftProfile);
      activateProfile(normalized);
      setDraftProfile(normalized);
      setError("");
      onStateChange();
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "Profile could not be used");
    }
  };

  const resetDraftProfile = () => {
    setDraftProfile(createDefaultProfile());
    setError("");
  };

  const exportDraftProfile = () => {
    try {
      const normalized = normalizeProfile(draftProfile);
      const blob = new Blob([JSON.stringify(normalized, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slugify(normalized.name || "roast-profile")}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setError("");
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Profile could not be exported");
    }
  };

  const onProfileUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse((e.target?.result as string) || "{}");
        const normalized = normalizeProfile(parsed, file.name.replace(/\.json$/i, ""));
        setDraftProfile(normalized);
        activateProfile(normalized, file.name);
        setError("");
        onStateChange();
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
      }
    };
    reader.readAsText(file);
  };

  const clearActiveProfile = () => {
    profileStore.profile = undefined;
    profileStore.profileName = "";
    profileStore.followProfileEnabled = false;
    setError("");
    onStateChange();
  };

  const activeProfileName = profileStore.profile
    ? profileStore.profile.name || profileStore.profileName || "Custom profile"
    : "waiting";

  return (
    <div class="profile-control">
      <div class="profile-toolbar">
        <div class="profile-chip">Active profile: {activeProfileName}</div>
        <label class="switch-label">
          <input
            type="checkbox"
            checked={profileStore.followProfileEnabled}
            disabled={!profileStore.profile}
            onChange={(e) => {
              profileStore.followProfileEnabled = e.currentTarget.checked;
              onStateChange();
            }}
          />
          Follow profile
        </label>
      </div>

      <div class="profile-builder">
        <div class="profile-builder-header">
          <label>
            Profile name
            <input
              type="text"
              value={draftProfile.name || ""}
              onInput={(e) => setProfileName((e.target as HTMLInputElement).value)}
            />
          </label>
          <div class="profile-total">Total time: {formatDuration(totalDuration(draftProfile))}</div>
        </div>

        <div class="phase-list">
          {draftProfile.steps.map((step, index) => (
            <div class="phase-card" key={`${step.tag}-${index}`}>
              <div class="phase-card-header">
                <span>Phase {index + 1}</span>
                <input
                  type="text"
                  value={step.name || ""}
                  aria-label={`Phase ${index + 1} name`}
                  onInput={(e) => updateStep(index, { name: (e.target as HTMLInputElement).value })}
                />
                <button
                  type="button"
                  onClick={() => removeStep(index)}
                  disabled={draftProfile.steps.length <= 1}
                >
                  Remove
                </button>
              </div>

              <div class="phase-fields">
                <label class="phase-slider">
                  Time {formatDuration(step.duration)}
                  <input
                    type="range"
                    min="10"
                    max="900"
                    step="5"
                    value={step.duration}
                    onInput={(e) => updateStep(index, { duration: Number((e.target as HTMLInputElement).value) })}
                  />
                  <input
                    type="number"
                    min="1"
                    max="1800"
                    value={step.duration}
                    onInput={(e) => updateStep(index, { duration: Number((e.target as HTMLInputElement).value) })}
                  />
                </label>

                <label class="phase-slider">
                  Setpoint {step.setpoint} °C
                  <input
                    type="range"
                    min="0"
                    max="300"
                    step="1"
                    value={step.setpoint}
                    onInput={(e) => updateStep(index, { setpoint: Number((e.target as HTMLInputElement).value) })}
                  />
                  <input
                    type="number"
                    min="0"
                    max="300"
                    value={step.setpoint}
                    onInput={(e) => updateStep(index, { setpoint: Number((e.target as HTMLInputElement).value) })}
                  />
                </label>

                <label class="phase-slider">
                  Fan {step.fanValue ?? 50}%
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={step.fanValue ?? 50}
                    onInput={(e) => updateStep(index, { fanValue: Number((e.target as HTMLInputElement).value) })}
                  />
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={step.fanValue ?? 50}
                    onInput={(e) => updateStep(index, { fanValue: Number((e.target as HTMLInputElement).value) })}
                  />
                </label>

                <label>
                  Curve
                  <select
                    value={step.interpolation}
                    onChange={(e) =>
                      updateStep(index, {
                        interpolation: (e.target as HTMLSelectElement).value as ProfileStep["interpolation"],
                      })
                    }
                  >
                    {INTERPOLATIONS.map((interpolation) => (
                      <option value={interpolation} key={interpolation}>
                        {interpolation}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div class="inline-actions">
        <button type="button" onClick={applyDraftProfile}>
          Use in roast
        </button>
        <button type="button" onClick={addStep}>
          Add phase
        </button>
        <button type="button" onClick={resetDraftProfile}>
          Reset to event tags
        </button>
        <button type="button" onClick={exportDraftProfile}>
          Export profile
        </button>
        <button type="button" onClick={clearActiveProfile}>
          Clear active
        </button>
      </div>

      <input
        id="profileInput"
        type="file"
        accept="application/json"
        onChange={onProfileUpload}
      />
      {error && <p style="color:#b91c1c;">Profile error: {error}</p>}
    </div>
  );
}
