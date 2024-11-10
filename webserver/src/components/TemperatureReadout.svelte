
<script lang="ts">
  import { readings } from '../store.ts';
	import TextField from "@smui/textfield"
</script>

<div>
	{#if $readings.length > 0}
  <TextField label="Bean Temp" value={$readings[$readings.length - 1].BT} input$readonly />
  <TextField label="Exhaust Temp" value={$readings[$readings.length - 1].ET} input$readonly />
  <TextField label="Ambient Temp" value={$readings[$readings.length - 1].Amb} input$readonly />
{/if}
</div>
