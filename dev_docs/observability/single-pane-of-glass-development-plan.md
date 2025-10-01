# Observability: Single Pane of Glass — Development Plan

## Goals

- Provide a clean, dense, and modern observability surface for Open Edison sessions and agent/tool execution.
- Support visual exploration (zoom/brush, crosshair, synced tooltips), concise labeling, and stable panel sizing.
- Deliver a Grafana-like experience for local SQLite data with minimal dependencies.

## Principles

- Two-column layout on desktop (no overflow), consistent panel framing, fixed panel heights.
- Prefer concise SI formatting (1.2k, 3.4M) and human dates; always show units.
- Interactivity that informs: crosshair, zoom/brush, annotations; avoid gratuitous animation.
- Fast: decimate or downsample where necessary; avoid blocking renders.

## Tech Choices (initial)

- Charts: Chart.js baseline, with optional plugin add-ons:
  - chartjs-plugin-zoom (zoom/pan, brush)
  - chartjs-plugin-annotation (thresholds, markers)
  - chartjs-plugin-datalabels (selective labels)
- Formatters: d3-format, dayjs
- Layout: CSS Grid (repeat(2, minmax(0, 1fr))) with min-width: 0 and overflow hidden per tile
- Optional: Apache ECharts (via echarts-for-react) for richer interactions (evaluate in Phase 3)

## Information Architecture

- Header KPIs: total sessions; total tool calls; sessions with private data; sessions with untrusted content
  - Each KPI includes: unit badge, sparkline (7-day trend), delta vs previous period
- Controls: date window with histogram, draggable window, presets (today/week/month/year/all)
- Panels (first release):
  1) Calls over time (by day) — line, optional 7d MA, linear/log toggle
  2) Top tools by calls — vertical bar, top 15, Others aggregation
  3) Session length distribution — binned histogram (log-ish bins)
  4) Tool call durations — linear bins (0–1s, 1–2s), dynamic log-binned view, p50/p90/p95 overlays
  5) Duration percentile (CDF) — line with p50/p90/p95 markers
  6) Trifecta combinations — categorical bars with legend (Private/Untrusted/External)

## UX and Visual Design

- Panel component with title, subtitle, unit, toolbar (expand, download CSV, copy image)
- Axis titles, max tick counts, ellipsized labels with tooltips
- Consistent color palette, low-opacity grid, small legends on the right
- Crosshair guideline; synced hover between time charts (Phase 3)

---

## Phased Roadmap

### Phase 1 — Foundation (Layout, Labels, Stability)

- [ ] Create `Panel` component (title, subtitle, unit, toolbar)
- [ ] Apply strict two-column grid to Observability; ensure min-w-0 + overflow hidden on all tiles
- [ ] Add d3-format + dayjs; replace raw labels with SI/time formatters across panels
- [ ] Calls over time: log/linear toggle; axis titles; reduced grid opacity; max tick count
- [ ] Popular tools: top 15; full labels via tooltips; Others aggregation if more entries
- [ ] Session length: binned ranges with SI labels (e.g., 1–2, 3–4, 5–9...)
- [ ] Durations (linear/log bins): units (ms/s), p50/p90/p95 captions in legend
- [ ] CDF: p50/p90/p95 vertical annotations with labels

### Phase 2 — Interactivity & Controls

- [ ] Date selector: brush/zoom on the sparkline; selection syncs with rc-slider
- [ ] Crosshair on all charts; tooltip shows aligned timestamp/values
- [ ] Zoom in/out controls and reset for time charts (chartjs-plugin-zoom)
- [ ] Panel toolbar actions (CSV export, copy image, expand modal)
- [ ] KPI sparklines + previous-period delta

### Phase 3 — Performance & Advanced Visuals

- [ ] Decimation/downsampling for high-point series; throttle hover updates
- [ ] Optional migrate Calls over time and histogram to ECharts for better label/brush
- [ ] Add annotations: max/min spikes, threshold bands
- [ ] Virtualize legends/lists if long (react-virtual)

### Phase 4 — Polish & Docs

- [ ] Theming polish (light/dark); color aliasing for consistency
- [ ] Add help popovers with definitions (what is p95, log bins, trifecta)
- [ ] Write user docs (Observability quickstart) and developer docs (panel patterns)

---

## Detailed TODOs

### Backend/API (if needed)

- [ ] Add CSV export endpoints for selected charts (or client-side CSV from data)
- [ ] Consider lightweight stats endpoint (pre-aggregated counts by day) for very large DBs

### Frontend Components

- [ ] `Panel` wrapper component
- [ ] `KpiCard` with sparkline
- [ ] `TimeSeriesPanel` with options (log/linear, MA overlay)
- [ ] `BarPanel` with label overflow handling and Others aggregation
- [ ] `HistogramPanel` (linear/log) with percentile overlays
- [ ] `CDFPanel` with percentile annotations
- [ ] `TrifectaPanel` legend + bars

### Controls

- [ ] `DateRangeControl` unified: sparkline brush + rc-slider sync + presets
- [ ] `Toolbar` (download CSV, copy, expand)

### Performance

- [ ] Dataset decimation (Chart.js decimation plugin) on time series over N points
- [ ] Memoize heavy aggregations; move to web worker if needed

### Testing

- [ ] Unit tests for formatters (SI/time), binning, percentiles
- [ ] Visual checks for label overflow and tooltip truncation
- [ ] Interaction tests for brush/zoom/reset, crosshair sync

---

## Acceptance Criteria (Phase 2)

- Two columns with no horizontal overflow at desktop widths
- Every panel has titles, units, and readable axes
- Smooth date selection and brush/zoom; crosshair interaction working
- KPIs with sparklines and deltas; tool labels readable with tooltips

## Risks

- Very large datasets from sqlite can degrade FPS. Mitigate with decimation and aggregation.
- Plugin interaction (zoom + annotation) can add complexity; evaluate ECharts where helpful.

## Success Metrics

- Panels render under 100ms on typical data; interactions are fluid on commodity hardware
- Users can answer “what happened and when?” in < 10 seconds with the Observability view

---

## Detailed Specifications (Appendix A)

### Data contracts (frontend)

Sessions API (already in server):

```ts
type ToolCall = {
  id: string
  tool_name: string
  parameters: Record<string, unknown>
  timestamp: string // ISO
  duration_ms?: number | null
  status?: string
  result?: unknown
}

type Session = {
  session_id: string
  correlation_id: string
  created_at?: string | null
  tool_calls: ToolCall[]
  data_access_summary: Record<string, unknown>
}

type SessionsResponse = { sessions: Session[] }
```

Frontend derives `day` = ISO.slice(0,10) and `ts = Date.parse(iso)`.

### Aggregations

- Calls over time (by day)
  - Group by `day`, `value = Σ session.tool_calls.length` that fall within day window.
  - Optional 7‑day moving average: centered or trailing, choose trailing for simplicity.
  - Dynamic ticks: max ~8 labels across width; format `YYYY‑MM‑DD` → `MM‑DD`.

- Top tools by calls
  - Count by `tool_name` across filtered sessions; sort desc; keep top 15; aggregate remainder into `Other` if `> 0`.
  - Show labels fully with tooltip; x‑axis autoskip off; grid off.

- Session length distribution
  - Bin sizes (logish): `1–2, 3–4, 5–9, 10–20, 21–43, 44–94, 95–204, ...` (×~2)
  - Rule: start at 1, multiply by ~2, round to nearest integer; render as `'lo–hi'`.

- Duration histograms
  - Linear: 0–1s, 1–2s (prevalence in local runs). Render as SI seconds.
  - Log: dynamic bins start at `1ms` (0.001s). Let `edges[i+1] = edges[i] × r`, choose `r` s.t. `binCount≈10`. Trim zero-count leading/trailing bins. Labels in ms/s with SI.
  - Overlays: compute p50, p90, p95 from durations (ms) and render as vertical annotation badges.

- CDF (Duration percentile)
  - Sort durations; for `p∈{0,5,10,…100}` compute percentile via linear interpolation; convert to seconds. Annotate p50/p90/p95.

- Trifecta combinations
  - Extract `lethal_trifecta.has_*` flags from `data_access_summary`; count 8 combos in order `---, P--, -U-, --E, PU-, P-E, -UE, PUE`.

### Date Range Selector

- Composition: sparkline (Chart.js) + rc-slider range.
- Live update while dragging (rAF throttled), no snapping; `marks` subsampled (≤12 labels).
- Two‑way sync with any brush on sparkline (Phase 2) so users can drag either control.
- Presets: Today/Week/Month/Year/All time. Clamp start to existing days.

### Panel Component API

```tsx
type PanelAction = { id: 'expand'|'csv'|'image', label?: string, onClick?: () => void }

type PanelProps = {
  title: string
  subtitle?: string
  unit?: string // 'calls' | 'sessions' | 's' | 'ms'
  actions?: PanelAction[]
  children: React.ReactNode
}
```

Behavior: fixed height (14rem default), title row with actions on right; content scrolls only if needed; min‑width:0.

### Formatting Rules

- Numbers: d3‑format `~s` for SI (1.2k, 3.4M). Durations: `<1s → ms`; otherwise seconds with 1 decimal.
- Dates: `MM‑DD` in ticks; full ISO on tooltip.
- Legends: truncate middle with tooltip; maintain consistent series colors across panels.

### Interaction Rules

- Crosshair vertical line; tooltip pinned to nearest point; ESC clears selection.
- Zoom/brush on time charts (Phase 2): drag to create range, SHIFT+scroll to zoom, double‑click to reset.

### Performance Budgets

- ≤ 2,000 visible points per dataset before decimation; use Chart.js decimation plugin.
- Tooltip/crosshair updates ≤ animation frame (16ms) across devices.
- Data aggregation memoized by `[sessionsHash, startDay, endDay]`.

### Accessibility

- Color contrast ≥ 4.5:1 for text; add focus outlines on interactive controls.
- Keyboard navigation: tab to panel toolbar, space/enter to activate actions; arrow keys adjust date range when slider focused.

---

## Implementation Plan by PR (Appendix B)

1) Layout + Panel wrapper
   - Add `Panel` component, refactor all tiles to use it.
   - Enforce two‑column grid, min‑width:0; add consistent separators.

2) Formatters + labels
   - Wire `d3-format` and `dayjs`, replace axis/legend labels.

3) Date control
   - Sparkline + rc-slider sync; presets; tooltips.

4) Time series improvements
   - Calls over time: log toggle, 7‑day MA; p95 annotations in duration charts.

5) Interactivity
   - Add chartjs‑plugin‑zoom + basic brush; custom crosshair plugin across panels.

6) Performance
   - Decimation thresholds; memoization; optional worker for heavy aggregations.

7) Optional ECharts migration (subset)
   - Prototype calls-over-time in ECharts; compare label handling & brushing.

8) Polish & docs
   - Theming polish; help popovers; README/quickstart.

---

## Risks & Mitigations (Appendix C)

- Chart.js label density on small widths → use maxTicks and rotate labels only as last resort; consider ECharts if needed.
- Very large SQLite files → fallback aggregated endpoints or client‑side pre‑aggregation with SQL.js worker.
- Plugin conflicts (zoom + annotation) → encapsulate options per panel; add unit tests.

---

## Style Tokens (Appendix D)

- Colors (dark):
  - Accent: #8B5CF6 (violet)
  - Info: #60A5FA (sky)
  - Grid: rgba(160,167,180,0.15)
  - Text muted: #a0a7b4
- Spacing: 16px gaps; title row 28–32px high.
- Panel height: 14rem default; KPI: 6–8rem.

---

## SQL Snippets (Appendix E)

Counts per day (SQL.js):

```sql
-- tool_calls is JSON array; we’ll estimate by length via JSON_LENGTH when available; otherwise client-side.
SELECT date(substr(json_extract(tc.value, '$.timestamp'), 1, 10)) AS day, COUNT(*) as calls
FROM mcp_sessions AS s, json_each(s.tool_calls) AS tc
GROUP BY day
ORDER BY day;
```

Top tools:

```sql
SELECT json_extract(tc.value, '$.tool_name') AS tool, COUNT(*) as n
FROM mcp_sessions AS s, json_each(s.tool_calls) AS tc
GROUP BY tool
ORDER BY n DESC
LIMIT 100;
```

Note: SQL.js date/json helpers vary; we will keep client-side aggregations as the baseline for portability.
