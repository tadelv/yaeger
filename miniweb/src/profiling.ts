import van from "vanjs-core";
const { label, button, div, input, select, option, canvas, p, span } = van.tags;

import { Profile, RoastState } from "./model";

export const profile = van.state<Profile | undefined>();

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

      return interpolateSetpoint(
        prevSetpoint,
        nextSetpoint,
        progress,
        step.interpolation,
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
  type: "linear" | "ease-in" | "ease-out",
): number {
  switch (type) {
    case "linear":
      return start + (end - start) * progress;
    case "ease-in":
      return start + (end - start) * Math.pow(progress, 2);
    case "ease-out":
      return start + (end - start) * (1 - Math.pow(1 - progress, 2));
    default:
      return end;
  }
}

// TODO: profile follow toggle
// also state for loaded profile?
// anything else?
export const ProfileControl = () =>
  div(
    "Profile:",
    profile.val ? "loaded" : "waiting",
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
  );

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
        console.log(typeof jsonData);
        profile.val = jsonData;
      } catch (error) {
        console.log("upload failed:", error);
      }
    };
    reader.readAsText(file);
  });

  return div(fileInput);
};
