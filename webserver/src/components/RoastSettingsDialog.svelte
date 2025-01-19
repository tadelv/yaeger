
<script lang="ts">
  import Dialog from "@smui/dialog";
	import TextField from "@smui/textfield"
  let show = false;
</script>

<Dialog bind:open={show}>
  <h2>Roast Settings</h2>
  <TextField label="Fresh beans weight" />
  <TextField label="Roasted beans weight" />
  <!-- Additional placeholder fields for future settings -->
</Dialog>
