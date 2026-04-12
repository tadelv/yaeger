# Graphing Framework Options for the Preact Miniweb

The graph views are now rendered with native Preact + SVG components (`src/graphs.tsx`) so we can avoid heavyweight runtime chart adapters and keep full control over behavior and styling.

## Alternative frameworks to consider

### 1) Plotly.js (`react-plotly.js` with Preact compatibility)
- **Best for:** advanced interactions (zoom, pan, lasso, annotations, export).
- **Pros:** rich feature set, scientific chart types, mature ecosystem.
- **Cons:** larger bundle size and heavier rendering cost on constrained devices.

### 2) Apache ECharts (`echarts-for-react` or direct integration)
- **Best for:** highly configurable dashboards with many chart types.
- **Pros:** excellent performance for large datasets, strong theming, nice toolbox.
- **Cons:** complex API and non-trivial integration in lightweight UIs.

### 3) uPlot
- **Best for:** very fast timeseries rendering with minimal footprint.
- **Pros:** tiny + fast, ideal for live telemetry.
- **Cons:** fewer out-of-box interactions and chart varieties.

### 4) Lightweight Charts (TradingView)
- **Best for:** smooth timeseries at high frequency.
- **Pros:** very performant and polished line/candlestick rendering.
- **Cons:** API is finance-oriented, so some roast telemetry UX is custom work.

### 5) Visx (Airbnb)
- **Best for:** custom visualizations where we want React/Preact-first composition.
- **Pros:** low-level primitives, excellent flexibility, D3 power without full D3 imperative flow.
- **Cons:** more engineering time than turnkey chart libraries.

## Recommendation

- **Short term:** keep the current Preact+SVG implementation for predictable behavior and small dependency overhead.
- **If we need stronger interactivity:** evaluate **uPlot** first (performance), then **Plotly** if product requirements need rich analytic interactions.
