
<script lang="ts">
	import { onMount } from 'svelte'
  import Chart from 'chart.js/auto';
	import 'chartjs-adapter-date-fns';
  import { readings, events, roastStart } from '../store.ts';
	import { get } from 'svelte/store';

	const verticalLinePlugin = {
		 getLinePosition: function (chart, pointIndex) {
				 const meta = chart.getDatasetMeta(0); // first dataset is used to discover X coordinate of a point
				 const data = meta.data;
				 return data[pointIndex.idx].x;
		 },

		 renderVerticalLine: function (chartInstance, pointIndex) {
				 const lineLeftOffset = this.getLinePosition(chartInstance, pointIndex);
				 const scale = chartInstance.scales.y;
				 const context = chartInstance.ctx;
				 // render vertical line
				 context.beginPath();
				 context.strokeStyle = '#ff0000';
				 context.moveTo(lineLeftOffset, scale.top);
				 context.lineTo(lineLeftOffset, scale.bottom);
				 context.stroke();

				 // write label
				 context.fillStyle = "#ff0000";
				 context.textAlign = 'center';
				 context.fillText(pointIndex.label, lineLeftOffset, (scale.bottom - scale.top) / 2 + scale.top);
		 },

		 beforeDatasetsDraw: function (chart, easing) {
				if(chart.config._config.lineAtIndex) {
				console.log("doing ", chart.config._config.lineAtIndex)
				  chart.config._config.lineAtIndex.forEach(pointIndex => {
					  this.renderVerticalLine(chart, pointIndex)
				  })
				}
		 }
	};

  let canvas;



	const data = {
		labels: [
		],
        datasets: [
			{ label: 'Bean Temp', borderColor: 'orange', data: [] },
          { label: 'Exhaust Temp', borderColor: 'green', data: []  },
          { label: 'Fan Power', borderColor: 'blue', data: [] },
          { label: 'Heater Power', borderColor: 'red', data: [] }
        ]
      }
  onMount(() => {
		console.log('mount')
    const ctx = canvas.getContext('2d');
    const chart = new Chart(ctx, {
      type: 'line',
      data: data,
      options: {
        scales: {
					x: { grace: 20, type: 'linear', bounds: 'ticks', beginAtZero: true },
          //x: { type: 'time', time: { unit: 'minute' } },
          y: { min: 0, max: 250 }
        },
				responsive: true,
				animation: false,
				//    layout: {
				//	padding: {
				//		right: 250
				//	}
				//}
      },
			lineAtIndex: [],
			plugins: [verticalLinePlugin]
    });


    readings.subscribe((inData) => {
      // Update chart data dynamically
			var lastRead = inData[inData.length - 1]
			console.log('last read:', lastRead)
			if (lastRead == undefined) {
				console.log('resetting')
				chart.data.labels = []
				chart.data.datasets.forEach((dataset) => {
					dataset.data = []
				})
				chart.config._config.lineAtIndex = []
				chart.update()
			} else {
			chart.data.datasets[1].data.push(lastRead.ET)
			chart.data.datasets[0].data.push(lastRead.BT)
			chart.data.datasets[2].data.push(lastRead.fanVal);
			chart.data.datasets[3].data.push(lastRead.heaterVal);
			
			
			data.labels.push(`${Math.floor(new Date().getTime() / 1000 - get(roastStart))}`)
			chart.update()
			}
    });

		events.subscribe(((inEvents) => {
			console.log("got ", inEvents)
			chart.config._config.lineAtIndex = inEvents
			console.log(chart.lineAtIndex)
		}))
//startRoast()
  });
</script>

<div>
<canvas bind:this={canvas}></canvas>
</div>
