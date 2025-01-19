
<script lang="ts">
	import { onMount } from 'svelte'
  import Chart from 'chart.js/auto';
  import { readings, fanPower, heaterPower } from '../store.js';

  let canvas;

  onMount(() => {
    const ctx = canvas.getContext('2d');
    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        datasets: [
          { label: 'Bean Temp', borderColor: 'blue', data: [] },
          { label: 'Exhaust Temp', borderColor: 'red', data: [] },
          { label: 'Fan Power', borderColor: 'green', data: [] },
          { label: 'Heater Power', borderColor: 'orange', data: [] }
        ]
      },
      options: {
        scales: {
          x: { type: 'time', time: { unit: 'minute' } },
          y: { min: 0, max: 250 }
        }
      }
    });

    readings.subscribe((data) => {
      // Update chart data dynamically
    });
  });
</script>

<canvas bind:this={canvas}></canvas>
