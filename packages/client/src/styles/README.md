# SES Design System — Implementation Notes

This folder defines the design tokens and overrides that drive the new SES UI.

## Files (in import order)

1. **`tokens.css`** — Source of truth for design tokens. All other CSS reads from
   here via `--ses-*` CSS custom properties.

   To swap themes at runtime, set `<html data-ses-theme="paper|dark">`.
   To swap density, set `<html data-ses-density="compact|regular|spacious">`.

2. **`element-overrides.css`** — Maps Element Plus's `--el-*` variables to our
   `--ses-*` tokens, so all `<el-button>`, `<el-input>`, `<el-table>`, etc.
   pick up the SES look automatically. Also tweaks shadows, padding, radii
   on a per-component basis.

   **Must be imported AFTER** `element-plus/dist/index.css`.

3. **`app.css`** — Shared helper classes used across views:
   - `.ses-brand` / `.ses-brand-label` — brand link + responsive product label;
     `SesLogo.vue` renders the shared transparent SES logo from `assets/ses-logo.png`
   - `.ses-stage` — stage pills (working_draft, comment_draft, …)
   - `.ses-type-chip` — standard-type chips (national, industry, …)
   - `.ses-stage-seg` — segmented stage picker used in new-doc dialog & settings
   - `.ses-save-pill` — auto-save indicator
   - `.ses-avatar` / `.ses-avatar-stack` — contributor avatars
   - `.ses-scroll` — themed scrollbar

4. **`standard-nodes.css`** — Existing GB/T 1.1 node typography (chapters,
   clauses, term defs, tables). Untouched — referenced for reference.

## Conventions

- All custom CSS variables use the `--ses-` prefix
- Color tokens use **oklch** so theme swaps are perceptually consistent
- One accent (`--ses-accent`) drives all focus/highlight states
- Stage / type colors are semantic — each maps to its own hue family

## Adding a new theme variant

Add a new `:root[data-ses-theme="myname"] { … }` block in `tokens.css`. Only
override the surface / line / ink scale; semantics (ok / warn / err / info)
inherit from `:root` so they stay legible across themes.
