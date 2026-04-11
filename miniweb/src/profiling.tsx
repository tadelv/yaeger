import { ChangeEvent } from "preact/compat";
import { useState } from "preact/hooks";
import { Profile, RoastState } from "./model";

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

export function followProfile(
  profile: Profile,
  roast: RoastState,
): { setPoint: number; fanValue?: number } | undefined {
  if (!roast.startDate) return undefined;

  const elapsedTime = (new Date().getTime() - roast.startDate.getTime()) / 1000;
  let accumulatedTime = 0;

  for (const step of profile.steps) {
    accumulatedTime += step.duration;
    if (elapsedTime <= accumulatedTime) {
      const stepStartTime = accumulatedTime - step.duration;
      const progress = (elapsedTime - stepStartTime) / step.duration;
      const prevSetpoint =
        stepStartTime === 0
          ? profile.steps[0].setpoint
          : profile.steps.find((s, i) => profile.steps[i + 1] === step)?.setpoint ||
            step.setpoint;

      return {
        setPoint:
          Math.floor(
            interpolateSetpoint(
              prevSetpoint,
              step.setpoint,
              progress,
              step.interpolation,
            ) * 10,
          ) / 10,
        fanValue: step.fanValue,
      };
    }
  }

  return profile.steps.length > 0
    ? {
        setPoint: profile.steps[profile.steps.length - 1].setpoint,
        fanValue: profile.steps[profile.steps.length - 1].fanValue,
      }
    : undefined;
}

function interpolateSetpoint(
  start: number,
  end: number,
  progress: number,
  type: "linear" | "ease-in" | "ease-out" | "ease-in-out",
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

function isValidProfile(obj: unknown): obj is Profile {
  return !!obj && typeof obj === "object" && "steps" in obj;
}

type ProfileControlProps = {
  onStateChange: () => void;
};

export function ProfileControl({ onStateChange }: ProfileControlProps) {
  const [error, setError] = useState("");

  const onProfileUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse((e.target?.result as string) || "{}");
        if (!isValidProfile(parsed)) {
          throw new Error("Invalid profile format");
        }
        profileStore.profile = parsed;
        profileStore.profileName = file.name;
        setError("");
        onStateChange();
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : "Upload failed");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div class="profile-control">
      <div class="profile-chip">Profile: {profileStore.profile ? profileStore.profileName : "waiting"}</div>
      <input
        id="profileInput"
        type="file"
        accept="application/json"
        onChange={onProfileUpload}
      />
      <div class="inline-actions">
        <button
          onClick={() => {
            profileStore.profile = undefined;
            profileStore.profileName = "";
            onStateChange();
          }}
        >
          Clear
        </button>
      </div>
      <label class="switch-label">
        <input
          type="checkbox"
          checked={profileStore.followProfileEnabled}
          onChange={(e) => {
            profileStore.followProfileEnabled = e.currentTarget.checked;
            onStateChange();
          }}
        />
        Follow Profile Enabled
      </label>
      {error && <p style="color:#b91c1c;">Profile error: {error}</p>}
    </div>
  );
}
