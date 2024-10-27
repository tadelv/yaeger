<script>
  import Slider from "@smui/slider";
  import TextField from "@smui/textfield";
  import Button from "@smui/button";
  import { heaterPower, updateHeaterPower } from '../store.js';

  function increment() { updateHeaterPower(heaterPower + 1); }
  function decrement() { updateHeaterPower(heaterPower - 1); }
</script>

<div>
  <Slider min="0" max="100" step="5" bind:value={$heaterPower} on:input={updateHeaterPower} />
  <TextField label="Heater Power" type="number" bind:value={$heaterPower} readonly />
  <Button on:click={increment}>+</Button>
  <Button on:click={decrement}>-</Button>
</div>
