import van from "vanjs-core";
const { label, button, div, input, select, option, canvas, p, span } = van.tags;

import { Profile, RoastState } from "./model";

export const profile = van.state<Profile | undefined>();
export const followProfileEnabled = van.state(true);
const profileName = van.state("");

export function followProfile(
  profile: Profile,
  roast: RoastState,
): number | undefined {
  if (!roast.startDate) return undefined;

  const elapsedTime = (new Date().getTime() - roast.startDate.getTime()) / 1000; // Elapsed time in seconds
  let accumulatedTime = 0;

  for (const step of profile.steps) {
    accumulatedTime += step.duration;
    if (elapsedTime <= accumulatedTime) {
      // We're in this step
      const stepStartTime = accumulatedTime - step.duration;
      const progress = (elapsedTime - stepStartTime) / step.duration;

      // Interpolate setpoint
      const prevSetpoint =
        stepStartTime === 0
          ? profile.steps[0].setpoint
          : profile.steps.find((s, i) => profile.steps[i + 1] === step)
              ?.setpoint || step.setpoint;
      const nextSetpoint = step.setpoint;

      return (
        Math.floor(
          interpolateSetpoint(
            prevSetpoint,
            nextSetpoint,
            progress,
            step.interpolation,
          ) * 10,
        ) / 10
      );
    }
  }

  // If no valid step is found, return last setpoint
  return profile.steps.length > 0
    ? profile.steps[profile.steps.length - 1].setpoint
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

export const ProfileControl = () =>
  div(
    "Profile:",
    profile.val ? profileName.val : "waiting",
    p(),
    UploadProfileInput,
    button(
      {
        onclick: () => {
          const fileInput = document.getElementById("profileInput");
          fileInput?.click();
        },
      },
      "Load",
    ),
    button(
      {
        onclick: () => {
          profile.val = undefined;
        },
      },
      "Clear",
    ),
    p(),
    label(
      input({
        type: "checkbox",
        checked: followProfileEnabled,
        oninput: (e) => (followProfileEnabled.val = e.target.checked),
      }),
      "Follow Profile Enabled",
    ),
  );

function isValidProfile(obj: any): obj is Profile {
  return obj && typeof obj.steps === "object";
}

const UploadProfileInput = () => {
  const fileInput = input({
    type: "file",
    id: "profileInput",
    accept: "application/json",
    style: "display: none;",
  });
  fileInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        console.log("reading: ", e.target.result);
        const jsonData = JSON.parse<Profile>(e.target.result);
        const jsonProfile: Profile = jsonData as Profile;
        if (isValidProfile(jsonProfile) == false) {
          throw "Invalid profile";
        }
        profileName.val = file.name;
        profile.val = jsonProfile;
      } catch (error) {
        console.log("upload failed:", error);
      }
    };
    reader.readAsText(file);
  });

  return div(fileInput);
};
