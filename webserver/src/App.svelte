<script>
  import FanSlider from "./components/FanSlider.svelte";
  import HeaterSlider from "./components/HeaterSlider.svelte";
  import TemperatureReadout from "./components/TemperatureReadout.svelte";
  import RoastGraph from "./components/RoastGraph.svelte";
  import EventButtons from "./components/EventButtons.svelte";
  import SettingsDialog from "./components/SettingsDialog.svelte";
  import RoastSettingsDialog from "./components/RoastSettingsDialog.svelte";
  import {
    uploadRoast,
    startRoast,
    stopRoast,
    resetRoast,
    connectWebSocket,
    downloadRoast,
  } from "./store.ts";
  import { onMount, onDestroy } from "svelte";

  let showStart = true;
  let showStop = false;
  let showReset = false;

  function startRoast1() {
    startRoast();
    showStart = false;
    showStop = true;
  }

  function stopRoast1() {
    stopRoast();
    showStop = false;
    showReset = true;
  }

  function reset() {
    resetRoast();
    showReset = false;
    showStart = true;
  }

  let socket;

  onMount(() => {
    console.log("connecting");
    socket = connectWebSocket();
    const fileInput = document.getElementById("fileInput");
    console.log("file", fileInput);
    fileInput.addEventListener("change", (event) => {
      console.log("change event: ", event);
      const file = event.target.files[0];
      if (!file) {
        return;
      }
      const reader = new FileReader();

      reader.onload = (e) => {
        try {
          console.log("reading: ", e.target.result);
          const jsonData = JSON.parse(e.target.result);
          uploadRoast(jsonData);
        } catch (error) {
          console.log("upload failed:", error);
        }
      };
      reader.readAsText(file);
    });
  });

  onDestroy(() => {
    console.log("destroying");
    socket?.close();
  });

  function download() {
    const blob = new Blob([downloadRoast()], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "roast.json";
    a.click();

    URL.revokeObjectURL(url);
  }

  function upload() {
    const fileInput = document.getElementById("fileInput");
    fileInput.click();
  }
</script>

<div>
  {#if showStart}
    <button on:click={startRoast1}>Start</button>
    <button on:click={upload}>Upload</button>
  {:else if showStop}
    <button on:click={stopRoast1}>Stop</button>
  {:else if showReset}
    <button on:click={reset}>Reset</button>
    <button on:click={download}>Download</button>
  {/if}

  <FanSlider />
  <HeaterSlider />
  <TemperatureReadout />
  <RoastGraph />
  <EventButtons />
  <SettingsDialog />
  <RoastSettingsDialog />
  <input
    type="file"
    id="fileInput"
    accept="application/json"
    style="display: none;"
  />
</div>
