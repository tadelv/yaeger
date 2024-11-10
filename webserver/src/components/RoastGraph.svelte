
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
				  chart.config._config.lineAtIndex.forEach(pointIndex => {
					  this.renderVerticalLine(chart, pointIndex)
				  })
				}
		 }
	};

  let canvas;


	let etData = []
	let btData = []
	let fanData = []
	let heaterData = []

	$: data = {
		labels: [
		],
        datasets: [
			{ label: 'Bean Temp', borderColor: 'blue', data: etData },
          { label: 'Exhaust Temp', borderColor: 'red', data: btData  },
          { label: 'Fan Power', borderColor: 'green', data: fanData },
          { label: 'Heater Power', borderColor: 'orange', data: heaterData }
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
			lineAtIndex: get(events),
			plugins: [verticalLinePlugin]
    });


    readings.subscribe((inData) => {
      // Update chart data dynamically
			var lastRead = inData[inData.length - 1]
			console.log('last read:', lastRead)
			if (inData.length == 0) {
				console.log('resetting')
			//	// Clear all data
			//	etData = []
			//	btData = []
			//	fanData = []
			//	heaterData = []
				data.labels = []
				chart.update()
			}
			if (lastRead == undefined) {
				console.log('resetting')
				// Clear all data
				//etData = []
				//btData = []
				//fanData = []
				//heaterData = []
				//data.labels = []
				//chart.update()
				return
			}
			etData.push(lastRead.ET)
			btData.push(lastRead.BT)
			fanData.push(lastRead.fanVal);
			heaterData.push(lastRead.heaterVal);
			
			
			data.labels.push(`${Math.floor(new Date().getTime() / 1000 - get(roastStart))}`)
			chart.update()
    });
//startRoast()
  });
</script>

<div>
<canvas bind:this={canvas}></canvas>
</div>
