
<script lang="ts">
  import Dialog from "@smui/dialog";
	import TextField from "@smui/textfield"
  let show = false;
</script>

<Dialog bind:open={show}>
  <h2>Settings</h2>
  <TextField label="WiFi Name" />
  <TextField label="WiFi Password" type="password" />
  <!-- Additional placeholder fields for future settings -->
</Dialog>
