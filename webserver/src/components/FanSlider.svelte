<script lang="ts">
  import Slider from "@smui/slider";
  import TextField from "@smui/textfield";
  import Button from "@smui/button";
  import { fanPower, updateFanPower } from '../store.ts';
	import Fan from 'svelte-material-icons/Fan.svelte'

  function increment() { updateFanPower($fanPower + 1 ); }
  function decrement() { updateFanPower($fanPower - 1); }
</script>

<div>
  <Slider min="0" max="100" step="5" bind:value={$fanPower} on:input={updateFanPower} />
	<Fan width=50 height=50 />
  <TextField label="Fan Power" type="number" bind:value={$fanPower} readonly />
  <Button on:click={increment}>+</Button>
  <Button on:click={decrement}>-</Button>
</div>
