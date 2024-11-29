<script lang="ts">
  import Slider from "@smui/slider";
  import TextField from "@smui/textfield";
  import Button from "@smui/button";
  import { fanPower, updateFanPower } from '../store.ts';
	import Fan from 'svelte-material-icons/Fan.svelte'

  function increment() { updateFanPower($fanPower + 1 ); }
  function decrement() { updateFanPower($fanPower - 1); }
	function handleInput(_) {
		updateFanPower($fanPower)
  }
</script>
<style>
  /* Change the primary color for this slider */
  .custom-slider {
    --mdc-theme-primary: #0033ff; /* set to any color */
  }
</style>

<div>
	<div class="custom-slider">
  <Slider min=0 max=100 step=5 on:click={handleInput} bind:value={$fanPower} discrete tickMarks />
	</div>
	<Fan width=50 height=50 />
  <TextField label="Fan Power" type="number" value={$fanPower} input$readonly />
  <Button on:click={increment}>+</Button>
  <Button on:click={decrement}>-</Button>
</div>
