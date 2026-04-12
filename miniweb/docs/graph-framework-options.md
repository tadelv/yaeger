# Graphing Framework Options for the Preact Miniweb

The graph views are now rendered with lightweight componentized charts in Preact.

## Alternative frameworks to consider

### 1) uPlot ✅ (First contender)
- **Best for:** fast timeseries rendering with minimal footprint.
- **Pros:** tiny + very fast, ideal for live telemetry.
- **Cons:** fewer out-of-box interactions and chart varieties.

### ~~2) Plotly.js (`react-plotly.js` with Preact compatibility)~~
- **Status:** deprioritized/struck off for this app due bundle/runtime overhead.

### 3) Apache ECharts (`echarts-for-react` or direct integration)
- **Best for:** highly configurable dashboards with many chart types.
- **Pros:** excellent performance for large datasets, strong theming, rich toolbox.
- **Cons:** more complex API and integration surface.

### 4) Lightweight Charts (TradingView)
- **Best for:** smooth timeseries at high frequency.
- **Pros:** very performant and polished line rendering.
- **Cons:** finance-oriented API means extra adaptation work.

### 5) Visx (Airbnb)
- **Best for:** custom visualizations with React/Preact-first composition.
- **Pros:** low-level primitives, flexible architecture, D3-style power.
- **Cons:** requires more engineering than turnkey chart libraries.

## Recommendation

- **Primary contender now:** **uPlot**.
- **Now evaluating:** **Visx** when we want more custom composition while staying lightweight.
