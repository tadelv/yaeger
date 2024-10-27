
<script lang="ts">
  import { readings } from '../store.js';
	import TextField from "@smui/textfield"
</script>

<div>
  <TextField label="Bean Temp" value={readings.BT} readonly />
  <TextField label="Exhaust Temp" value={readings.ET} readonly />
</div>
