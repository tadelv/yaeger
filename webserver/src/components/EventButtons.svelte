
<script>
  import Button from "@smui/button";
  import { addEvent } from '../store.ts';

  const events = ["Charge", "Dry End", "First Crack Start", "First Crack End", "Second Crack Start", "Second Crack End", "Drop"];
</script>

<div>
  {#each events as event}
    <Button on:click={() => addEvent(event)}>{event}</Button>
  {/each}
</div>
