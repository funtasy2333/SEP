# SES Frontend — Design Refresh

This commit ports the design from the `SES Home.html` / `SES Editor.html`
prototypes into the real `packages/client` source.

## What changed

### New files

```
src/
├── constants/
│   └── standards.ts                       — STAGE_LABELS, TYPE_LABELS, TYPE_DEFS
├── styles/
│   ├── tokens.css                         — --ses-* design tokens (incl. dark / paper themes)
│   ├── element-overrides.css              — Element Plus theme bridge
│   ├── app.css                            — shared helpers (.ses-brand, .ses-stage, …)
│   └── README.md                          — how the styles fit together
└── components/home/
    ├── HomeNav.vue                        — top nav for the home page
    ├── StatCards.vue                      — 4-up stat strip
    ├── TemplateRail.vue                   — quick-create template picker
    ├── DocCard.vue                        — single document card
    └── NewDocDialog.vue                   — polished new-doc creation flow
```

### Rewritten files

```
src/
├── App.vue                                — sets data-ses-theme on <html>
├── main.ts                                — imports tokens / overrides / app.css
├── views/
│   ├── HomeView.vue                       — stats + templates + filtered grid/list
│   └── EditorView.vue                     — new top-nav, toolbar, body, dialogs
└── components/editor/
    ├── DocumentOutline.vue                — styled to design system
    ├── EditorContent.vue                  — paper card + halo gradient
    └── SlashMenu.vue                      — popover restyle
```

### Untouched (deliberately)

- All Tiptap extensions in `src/extensions/` — design refresh is visual only
- `src/serializer/` — export pipeline
- `src/api/`, `src/stores/` — data layer
- `src/components/version/VersionPanel.vue` — keep as-is; the surrounding
  `.version-sidebar` chrome in `EditorView.vue` provides the polish
- `src/components/editor/EditorToolbar.vue` — no longer mounted from
  `EditorView.vue` (the new template inlines the toolbar). Leave the
  file in place for backwards compat; safe to delete in a follow-up.

## How to run

No new dependencies. Standard:

```bash
pnpm install
pnpm --filter @ses/client dev
```

## Theming at runtime

```ts
document.documentElement.dataset.sesTheme = 'dark'      // 'light' | 'paper' | 'dark'
document.documentElement.dataset.sesDensity = 'compact' // 'compact' | 'regular' | 'spacious'
```

Both default to `light` + `regular`. Wire these into a settings dialog once
the settings tab is built out.

## Element Plus compatibility

We override `--el-color-primary` and family in `element-overrides.css`, so
**all existing `<el-button>`, `<el-input>`, `<el-table>`, `<el-dialog>`,
`<el-radio-button>`, `<el-tag>`, `<el-dropdown>` instances pick up the new
palette without any per-call changes**. Where a component needed deeper
restyling (`<el-dialog>` chrome, radio button rounding), it's done at the
override layer too.

## TypeScript notes

- `NewDocDialog.vue` emits `create` with a typed form object — `HomeView.vue`
  consumes it and persists via the existing `documentStore.createDocument()`
- `DocCard.vue` reads `chapterCount` from the doc's ProseMirror JSON; the
  progress bar uses a stage-based heuristic (`stageProgress` map) until
  real validation data lands (Phase 6)

## Known follow-ups (not blocking)

1. The settings & preview tabs are still placeholders in `EditorView.vue` —
   they were polished as prototypes (see `SES Editor.html`); port them next
2. Diff modal + Code modal exist as prototypes — not yet ported to Vue
3. `EditorToolbar.vue` is now dead code — leave for one release, then remove
