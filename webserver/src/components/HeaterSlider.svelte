<script>
  import Slider from "@smui/slider";
  import TextField from "@smui/textfield";
  import Button from "@smui/button";
  import { heaterPower, updateHeaterPower } from '../store.ts';
	import HeatWave from 'svelte-material-icons/HeatWave.svelte';

  function increment() { updateHeaterPower($heaterPower + 1); }
  function decrement() { updateHeaterPower($heaterPower - 1); }
	function handleInput(_) {
		updateHeaterPower($heaterPower)
  }
</script>

<div>
	<HeatWave width=50 height=50 />
  <TextField label="Heater Power" type="number" value={$heaterPower} input$readonly />
  <Button on:click={increment}>+</Button>
  <Button on:click={decrement}>-</Button>
  <Slider min="0" max="100" step="5" bind:value={$heaterPower} on:click={handleInput} discrete tickMarks />
</div>
