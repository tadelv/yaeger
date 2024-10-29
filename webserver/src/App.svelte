<script>
  import FanSlider from './components/FanSlider.svelte';
  import HeaterSlider from './components/HeaterSlider.svelte';
  import TemperatureReadout from './components/TemperatureReadout.svelte';
  import RoastGraph from './components/RoastGraph.svelte';
  import EventButtons from './components/EventButtons.svelte';
  import SettingsDialog from './components/SettingsDialog.svelte';
  import RoastSettingsDialog from './components/RoastSettingsDialog.svelte';
  import { startRoast, stopRoast, resetRoast } from './store.ts';
  import { readings } from './store.ts';

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
</script>

<div>
  {#if showStart}
    <button on:click={startRoast1}>Start</button>
  {:else if showStop}
    <button on:click={stopRoast1}>Stop</button>
  {:else if showReset}
    <button on:click={reset}>Reset</button>
  {/if}

  <FanSlider />
  <HeaterSlider />
  <RoastGraph />
  <EventButtons />
  <SettingsDialog />
  <RoastSettingsDialog />
</div>
