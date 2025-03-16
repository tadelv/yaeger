import sys
import json
import pandas as pd
import numpy as np
from scipy.signal import savgol_filter
import plotly.graph_objs as go
from plotly.subplots import make_subplots

#call with "python3 fig-gen.py roast.json", python3 being which command your system uses.
#In my case "pdm run python3 fig-gen.py ex_roast.json" as i'm using a .venv through PDM

# Ensure the correct number of arguments
if len(sys.argv) != 2:
    print("Usage: python fig-gen.py <input_file.json>")
    sys.exit(1)

# Get file name from arguments
file_path = sys.argv[1]

# Check if the file is a JSON file
if not file_path.lower().endswith('.json'):
    print("Error: Input file must be a JSON file.")
    sys.exit(1)

# Load the JSON data
with open(file_path, 'r') as file:
    data = json.load(file)

# Convert the measurements to a Pandas DataFrame
measurements = pd.json_normalize(data['measurements'])
measurements['timestamp'] = pd.to_datetime(measurements['timestamp'])
measurements['elapsed_time'] = (measurements['timestamp'] - measurements['timestamp'].min()).dt.total_seconds()

# Set a threshold for detecting when the value is stationary for too long (e.g., 1 ms)
pause_threshold = 1e-3  # For example, 1 ms of no change

# Calculate the difference between consecutive measurements
measurements['delta_BT'] = measurements['message.BT'].diff().abs()
measurements['delta_ET'] = measurements['message.ET'].diff().abs()

# Identify pauses in the data (i.e., no change in values)
measurements['pause_BT'] = measurements['delta_BT'] <= pause_threshold
measurements['pause_ET'] = measurements['delta_ET'] <= pause_threshold

# Interpolate during pauses (optional)
measurements['interpolated_BT'] = measurements['message.BT'].copy()
measurements['interpolated_ET'] = measurements['message.ET'].copy()

# Use linear interpolation during pauses
measurements['interpolated_BT'] = measurements['interpolated_BT'].interpolate(method='linear')
measurements['interpolated_ET'] = measurements['interpolated_ET'].interpolate(method='linear')

# Smooth BT and ET values using Savitzky-Golay filter on the interpolated data
window_length = 21  # Larger window for better smoothing (odd number)
polyorder = 2  # Polynomial order for smoothing
measurements['smoothed_BT'] = savgol_filter(measurements['interpolated_BT'], window_length, polyorder)
measurements['smoothed_ET'] = savgol_filter(measurements['interpolated_ET'], window_length, polyorder)

# Add an offset to the temperature values if needed (e.g., 5°C)
BT_temperature_offset = 0
ET_temperature_offset = 0
measurements['smoothed_BT'] += BT_temperature_offset
measurements['smoothed_ET'] += ET_temperature_offset

# Calculate rate of rise for ET and BT using smoothed values
measurements['rate_of_rise_BT'] = measurements['smoothed_BT'].diff() / measurements['elapsed_time'].diff()
measurements['rate_of_rise_ET'] = measurements['smoothed_ET'].diff() / measurements['elapsed_time'].diff()

# Apply a threshold to limit ROR spikes
ror_threshold = 10
measurements['capped_rate_of_rise_BT'] = np.clip(measurements['rate_of_rise_BT'], -ror_threshold, ror_threshold)
measurements['capped_rate_of_rise_ET'] = np.clip(measurements['rate_of_rise_ET'], -ror_threshold, ror_threshold)

# Create a Plotly figure
fig = make_subplots(specs=[[{"secondary_y": True}]])

# Add traces for smoothed measurements
fig.add_trace(go.Scatter(x=measurements['elapsed_time'], y=measurements['smoothed_ET'], mode='lines', name='ET', line=dict(color='blue')), secondary_y=False)
fig.add_trace(go.Scatter(x=measurements['elapsed_time'], y=measurements['smoothed_BT'], mode='lines', name='BT', line=dict(color='orange')), secondary_y=False)
fig.add_trace(go.Scatter(x=measurements['elapsed_time'], y=measurements['message.Amb'], mode='lines', name='Amb', line=dict(color='green')), secondary_y=False)
fig.add_trace(go.Scatter(x=measurements['elapsed_time'], y=measurements['message.BurnerVal'], mode='lines', name='BurnerVal', line=dict(color='red')), secondary_y=False)
fig.add_trace(go.Scatter(x=measurements['elapsed_time'], y=measurements['message.FanVal'], mode='lines', name='FanVal', line=dict(color='purple')), secondary_y=False)

# Add vertical lines for events
events = pd.json_normalize(data['events'], sep='_')
events['timestamp'] = pd.to_datetime(events['measurement_timestamp'])
events['elapsed_time'] = (events['timestamp'] - measurements['timestamp'].min()).dt.total_seconds()
for _, event in events.iterrows():
    fig.add_shape(
        type="line",
        x0=event['elapsed_time'], x1=event['elapsed_time'],
        y0=0, y1=1,
        xref="x", yref="paper",
        line=dict(color="red", width=2, dash="dash")
    )
    fig.add_annotation(
        x=event['elapsed_time'], y=1.05,
        text=event['label'],
        showarrow=False,
        xref="x", yref="paper",
        textangle=-90,
        font=dict(color="red")
    )

# Add traces for rate of rise
fig.add_trace(go.Scatter(x=measurements['elapsed_time'], y=measurements['capped_rate_of_rise_ET'], mode='lines', name='ROR ET', line=dict(color='cyan', dash='dash')), secondary_y=True)
fig.add_trace(go.Scatter(x=measurements['elapsed_time'], y=measurements['capped_rate_of_rise_BT'], mode='lines', name='ROR BT', line=dict(color='olive', dash='dash')), secondary_y=True)

# Update layout
fig.update_layout(
    title='Measurements Over Time',
    xaxis_title='Elapsed Time (seconds)',
    yaxis_title='Measurement Values',
    yaxis2_title='Rate of Rise (Scaled)',
    legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
    height=1200
)

# Save the figure as an HTML file
fig.write_html("temperature_plot.html")

# Show the plot
fig.show()
