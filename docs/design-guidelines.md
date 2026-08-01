# Design Guidelines — Tennis Report Hub

> The visual system. One theme, dark, Vietnamese-first, optimized for late-night reporting.

## 1. Design principles

1. **Calm dark canvas.** The primary user works late. The palette stays in cool slate territory, with `blue-500` as the single accent. No high-saturation yellows or pinks except for the rare status signal.
2. **Information density over decoration.** A reporter scans ~20 matches a day. Every line of vertical space has to earn its keep. Use 11–13px for secondary text, 13–14px for body, and reserve 16px+ for page titles.
3. **Vietnamese as a first-class citizen.** Word breaks on Vietnamese diacritics work because the font (`Inter`) ships Vietnamese subsets. Don't ship icons that depend on Latin diacritic positioning.
4. **Status over chrome.** A red `LIVE` dot, a green `Mới` badge, an amber `Soon` chip — these are how state is communicated. Don't add borders or shadows where a 9px pill does the job.
5. **No motion unless it carries information.** One pulse animation (`pulse-dot`, 1.5s) for the live indicator. One short fade-in (`fade-in`, 200ms) for cards. That's the entire motion vocabulary.

## 2. Color palette

Defined as CSS custom properties in `src/index.css` under `@theme inline`, exposed as Tailwind tokens.

### 2.1 Semantic tokens

| Token                | Light counterpart | Value     | Used for                            |
| -------------------- | ----------------- | --------- | ----------------------------------- |
| `background`         | n/a (dark only)   | `#0f172a` | App background (`bg-background`)    |
| `foreground`         | n/a               | `#e2e8f0` | Default text (`text-foreground`)    |
| `card`               | n/a               | `#1e293b` | Card / dialog surface               |
| `primary`            | n/a               | `#3b82f6` | Primary action, links, focus ring   |
| `secondary`          | n/a               | `#334155` | Subdued surfaces, secondary buttons |
| `muted`              | n/a               | `#334155` | Muted backgrounds                   |
| `muted-foreground`   | n/a               | `#94a3b8` | Secondary text                      |
| `accent`             | n/a               | `#1e40af` | Subtle accent surface (`bg-accent/5`)|
| `destructive`        | n/a               | `#ef4444` | Destructive action (clear data)     |
| `success`            | n/a               | `#22c55e` | New-report badge, positive state    |
| `warning`            | n/a               | `#f59e0b` | Cautions, unset config              |
| `border`             | n/a               | `#334155` | Default 1px borders                 |
| `input`              | n/a               | `#334155` | Form input border                   |
| `ring`               | n/a               | `#3b82f6` | Focus ring                          |

### 2.2 Slate scale (override of the default Tailwind scale)

`@theme inline` redefines the `slate-*` family to align with the dark theme. **Do not import the default Tailwind palette in this project** — use the redefined values:

| Token       | Value     |
| ----------- | --------- |
| `slate-50`  | `#f8fafc` |
| `slate-100` | `#f1f5f9` |
| `slate-200` | `#e2e8f0` |
| `slate-300` | `#cbd5e1` |
| `slate-400` | `#94a3b8` |
| `slate-500` | `#64748b` |
| `slate-600` | `#475569` |
| `slate-700` | `#334155` |
| `slate-800` | `#1e293b` |
| `slate-900` | `#0f172a` |
| `slate-950` | `#020617` |

The app uses these directly: `bg-slate-900` for the page, `bg-slate-800/30` for elevated cards, `border-slate-800` for separators, `text-slate-400` for secondary text.

### 2.3 One accent: `blue-500`

Only one color carries semantic emphasis: `blue-500` (`#3b82f6`). It shows up as:

- The "Tennis" sports tab pill
- The `<RefreshCw>` "Làm mới" button outline
- The default-template star badge
- The link/hover color (`hover:text-blue-300`)
- Focus rings on inputs and buttons

If a second accent is needed (e.g. for "Bóng đá" once v2-7 lands), use `emerald-500` and document it in this file.

## 3. Typography

| Use                       | Family            | Size  | Weight | Line height |
| ------------------------- | ----------------- | ----- | ------ | ----------- |
| Page title (`h1`)         | Inter             | 14–16 | 600    | 1.25        |
| Card title (`h2` / `h3`)  | Inter             | 13    | 600    | 1.3         |
| Body                      | Inter             | 14    | 400    | 1.5         |
| Secondary text            | Inter             | 11–12 | 400    | 1.45        |
| Mono (scores, times, IDs) | `font-mono` (system monospace) | 11–12 | 400 | 1.4 |

- `body { font-size: 14px; line-height: 1.5; }` is the base.
- `font-feature-settings: "cv11", "ss01", "ss03"` is set on the root for slightly nicer Inter numerals.
- Headings (`h1`–`h6`) all set `font-weight: 600; letter-spacing: -0.01em; color: #f1f5f9;` — a touch of negative tracking reads tighter on a dark background.

## 4. Spacing & radii

- **Spacing scale**: Tailwind default. Common values in the UI: `1` (4px), `1.5` (6px), `2` (8px), `3` (12px), `4` (16px), `6` (24px), `8` (32px).
- **Radius**: `--radius: 0.5rem` is the default. `--radius-sm` 6px for small chips, `--radius-md` 8px for inputs and small cards, `--radius-lg` 12px for the main cards.
- **Padding inside cards**: `p-3` (12px) for compact cards, `p-4` (16px) for standard cards. Never both in the same card.
- **Gap between cards in a list**: `gap-2` (8px) on dense lists, `gap-3` (12px) on overview cards, `gap-4` (16px) for top-level page sections.

## 5. Elevation

- The base is flat. The app does not use box-shadows for elevation by default.
- One token: `--shadow-soft: 0 2px 8px 0 rgb(0 0 0 / 0.2);` — used only on dialog overlays via Radix's data attributes, not on regular cards.
- To create the "elevated card" effect, layer translucent backgrounds: `bg-slate-800/30` over the `bg-slate-900` page.
- Borders are the dominant depth cue: `border-slate-800` for default, `border-slate-700` for hover, `border-blue-500/30` for selected/active.

## 6. Components — visual rules

### 6.1 Button

Five variants live in `components/ui/button.tsx`:

- `default` — solid `bg-primary` (`#3b82f6`), white text
- `outline` — transparent background, `border-slate-700`, hover `bg-slate-800`
- `ghost` — transparent, hover `bg-slate-800/50`
- `success` — solid `bg-success` (`#22c55e`), used for the "Đã copy" state
- `destructive` — used in Settings for "Xóa tất cả dữ liệu" with `text-red-300 hover:text-red-200`

Sizes: `default` (h-9), `sm` (h-7), `icon-sm` (h-6 w-6, square). Icon-only buttons always use `icon-sm`.

### 6.2 Card

`bg-slate-800/30`, `border-slate-800`, default `rounded-md`. Hover: `hover:border-slate-700`. The "Mặc định" template card uses `border-blue-500/30 bg-blue-500/5` to signal selected.

### 6.3 Badge

- `slate` — neutral pill, used for "R16", "F", "QF" round labels and the "v1.0.0" version chip
- `blue` — selected state, used for "Mặc định" template
- All badges are uppercase, font-mono, ~10px. The "Mới" pill is a custom inline span, not a `Badge` — it uses solid `bg-emerald-500` for stronger emphasis.

### 6.4 Dialog

Radix `<Dialog>` styled with `bg-slate-900`, `border-slate-800`, `text-slate-100`. Overlay: `bg-black/60` via Radix's `data-[state=open]:animate-in`. No custom backdrop blur (kept off for performance).

### 6.5 Form controls

- **Input**: `bg-slate-900` base (darker than the card surface), `border-input`, `focus:ring-2 focus:ring-ring focus:border-ring`. Compact heights: `h-8` (32px) for in-card forms, `h-9` (36px) for page-level inputs.
- **Select**: same height rules, custom chevron from `lucide-react`. Item rows use `bg-slate-800` on hover.
- **Textarea**: `min-h-[200px]`, `font-mono` for the template editor (so placeholders are readable). Resize is allowed vertically only.

### 6.6 Status indicators

- **LIVE** — `bg-red-500/20 text-red-300` with a 1.5s pulse-dot on a small inline `<span class="pulse-dot">`.
- **Scheduled** — `bg-slate-800/60 text-slate-400` ("Đã lên lịch" / no badge needed beyond the time).
- **Completed** — `bg-blue-500/20 text-blue-300` ("Đã kết thúc") or the time + final-score combo on the row.
- **Watchlist status** (`pending` / `generating` / `completed` / `failed`) — see `components/ui/status-badge.tsx`.

## 7. Layout grid

| Page           | Layout                                                              |
| -------------- | ------------------------------------------------------------------- |
| `/`            | `grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]`. The right column is `lg:sticky lg:top-[88px]`. |
| `/reports`     | `grid-cols-1 md:grid-cols-2 xl:grid-cols-3` of report cards.        |
| `/templates`   | `grid-cols-1 lg:grid-cols-2` of template cards.                     |
| `/settings`    | `grid-cols-1 lg:grid-cols-2` of setting cards; storage card spans 2. |

The top bar is `sticky top-0 z-30` with `backdrop-blur supports-[backdrop-filter]:bg-slate-900/80`. The 88px offset in the dashboard grid is the top-bar height (sports row + date row).

## 8. Iconography

Icons come from `lucide-react` exclusively. The set in active use:

- `Activity` (Dashboard nav)
- `History` (Reports nav)
- `FileText` (Templates nav, also empty-state)
- `Settings` (Settings nav)
- `Calendar`, `ChevronLeft`, `ChevronRight`, `RefreshCw` (top bar)
- `Star` (watchlist star + default-template marker)
- `X`, `Trash2`, `Plus`, `Edit3`, `Check`, `Search`, `Copy`, `Sparkles`, `Key`, `Clock`, `Globe`, `Bell`, `Database`, `Inbox`, `AlertCircle`, `Filter` etc. (per page)

Icon size: `h-3.5 w-3.5` (14px) for in-row actions and nav. `h-4 w-4` (16px) for empty-state and section headers. `h-5 w-5` (20px) for the rare emphasis icon.

**Do not import a second icon library.** The size discipline only works if every icon is the same height.

## 9. Animation

| Animation       | Duration | Easing     | Where                                |
| --------------- | -------- | ---------- | ------------------------------------ |
| `pulse-dot`     | 1.5s     | ease-in-out infinite | The LIVE dot in the dashboard |
| `fade-in`       | 200ms    | ease-out   | Cards appearing in lists             |
| `animate-spin`  | 1s       | linear     | The `<RefreshCw>` icon while fetching |

No other transitions. The app reads as static; only signals move.

## 10. Vietnamese-specific concerns

- **Font**: `Inter` includes Vietnamese diacritics in its character set. The HTML head preconnects to `fonts.googleapis.com` / `fonts.gstatic.com` and loads `Inter:wght@400;500;600;700`. No fallback to system fonts in the design — the page must look identical across machines.
- **Punctuation**: Vietnamese uses full-width punctuation (`…`, `,`, `.`). The summary cards in `/reports` truncate to 130 characters with a literal `…`. Don't swap to `...`.
- **Number formatting**: When displaying scores, dates, or times in Vietnamese, use `vi-VN` locale. `formatTime`, `formatDateVi`, `formatDateShort` already do this; new helpers must follow suit.
- **Word breaks**: No `word-break: break-all` on body text. Vietnamese words are short and break naturally; only allow `break-words` on long URLs or player names in narrow columns (use `truncate` with `flex-1 min-w-0` instead).

## 11. Accessibility

- **Contrast**: All text/background pairs meet WCAG AA. The notable ones:
  - `text-slate-100` on `bg-slate-900` — high contrast
  - `text-slate-400` on `bg-slate-900` — borderline; do not use for required actions
  - `text-blue-300` on `bg-slate-900` — link hover; verify before use
- **Focus**: All focusable elements get a `ring` from the `ring` token. Don't override focus styles unless the new style is also a visible ring.
- **Buttons**: `button:disabled` sets `cursor: not-allowed; opacity: 0.5` — keep this for any new disabled states.
- **Tap targets**: The smallest touch target is 24px (`size-icon-sm`). Anything smaller must come with a larger hit area (`p-1` around an `h-3 w-3` icon).
- **Live regions**: Toasts via Sonner are auto-announced. New toasts should not spam — use distinct messages and short durations.

## 12. Don'ts

- **No** new accent colors. If a state needs color, pick from the existing tokens (`success`, `warning`, `destructive`, `primary`).
- **No** light mode. v1 ships one theme.
- **No** shadows on regular cards. The depth is communicated via background layering.
- **No** emoji as a status badge (the `Mới` green pill is a badge, not an emoji). The 🎾 at the top of the page is a brand mark, not a status.
- **No** icon-only buttons without a `title` attribute and a visible `sr-only` label. The pattern `title="..."` is currently used — keep it.

## 13. See also

- `code-standards.md` — code-level rules that interact with the design
- `system-architecture.md` — where each visual surface lives in the tree
- `codebase-summary.md` — full inventory of UI primitives
