# gitsu — design spec

A self-contained brief for a design LLM to recreate (or extend) the
visual language, information architecture, and interaction model of
**gitsu**, a worktree-first Git desktop client.

Read top to bottom. The first sections are the brand/voice rules
that govern everything; later sections are the concrete token tables
and component specs. The "Rules for a design LLM" section at the
end is the most important — it tells the LLM what to *not* do.

---

## 1. What gitsu is

**One-liner.** A worktree-first Git desktop client built on
[worktrunk](https://worktrunk.dev). Every branch gets its own folder,
its own terminal, its own state — all in one native window.

**Hero copy on the home screen.**

> **Worktrees, _first_.**
> A Git desktop client where every branch gets its own folder, its
> own terminal, its own state — all in one window, powered by
> worktrunk.

**Positioning.** "A thin native GUI over the `wt` CLI." The visual
layer that GitKraken users expect (commit DAG, diff viewer, file
history, conflict editor) — with worktrees as the primary unit of
organization.

**Tone.** Confident, restrained, developer-native. No marketing fluff.
Uses lowercase, file paths, and CLI verbs. Speaks in terms a Git
user already knows: branch, worktree, HEAD, diff, merge, hook.

---

## 2. Brand voice & copy rules

- **Lowercase brand.** "gitsu" — never "Gitsu" or "GITSU" in body copy.
  The logo glyph (a small GitFork icon in accent color) sits to the
  left of the wordmark in the header.
- **Mono for code, paths, SHAs.** Anything that is a file path,
  branch name, commit SHA, or CLI command uses `font-mono`. Always.
- **Sentence case for headers, lowercase for buttons.** "New worktree"
  (not "New Worktree"), "Cancel", "Install recommended setup". No
  ALL-CAPS.
- **Section labels are uppercase tracked.** "WORKTREES", "TERMINAL",
  "ABOUT" — `text-[10..11px] font-semibold uppercase tracking-wider
  text-fg-muted`.
- **Kbd glyphs.** Use the actual Unicode glyphs: `⌘` `⇧` `⌃` `⌥` `↵`
  `↑` `↓` `→` `←`. Never spell "Cmd" or "Ctrl" in UI — the glyph
  reads the same on Mac and Windows/Linux when paired with a
  title-attribute explanation.
- **Numbers in changes.** "+5 −2" for added/removed lines, "3 changes"
  for change-count fallback. Always use the proper minus sign `−`
  (U+2212), not a hyphen.
- **Errors are short and specific.** One sentence, a concrete next
  action when possible. No "Oops!" or "Something went wrong".

---

## 3. Information architecture

There are exactly **two top-level screens**, switched by the presence
of an active repo in the `useRepoStore`:

```
[no repo]     →  Home screen   (recents list + "Open repo" CTA)
[repo open]   →  Dashboard     (3-pane worktree-first workspace)
```

Transitions:

- **Home → Dashboard.** `pickAndOpen` (folder picker) or
  `openByPath(recent.path)`. Triggered by `⌘O`, the Home screen's
  primary button, or a click on a recent row.
- **Dashboard → Home.** `closeRepo()`. Triggered by the "← All
  projects" entry in the project switcher palette, or — future —
  clicking the "gitsu" wordmark in the header.

The dashboard's internal layout is **a single worktree-first
workspace** with three regions:

```
┌─────────────────────────────────────────────────────────────────────┐
│ Header  (logo · breadcrumb · action cluster)                         │  40px
├──────────┬───────────────────────────────────────────┬───────────────┤
│          │                                           │               │
│  Work-   │           Center: Commit graph            │   Right:      │
│  tree    │           (custom SVG DAG)                │   Commit      │
│  list    │                                           │   panel       │
│          │                                           │   (file tree  │
│  ⌘1..⌘9  │                                           │    + diff)    │
│          ├───────────────────────────────────────────┤               │
│  always  │                                           │               │
│  visible │           Bottom: Terminal strip          │               │
│  280px   │           (one or more xterm.js panes,    │               │
│          │            split horizontally/vertically)  │               │
│          │                                           │               │
└──────────┴───────────────────────────────────────────┴───────────────┘
```

Layout variants (toggled via the "Show graph" / "Hide graph" button
in the header, or `⌘⇧P` is reserved for "Projects" so use a different
binding for "toggle graph panel" — current binding is just the
button or a `prefs.hideGraphPanel` Zustand flag):

- **3-pane (default).** Left worktree list + center commit graph +
  right commit panel + bottom terminal strip.
- **Sidebar.** Worktree list is a fixed-width sidebar; terminal
  fills the rest of the row (no center/right panes). Useful for
  small windows or when the user just wants shell + worktree switcher.
- **All three regions and the bottom strip are resizable** with
  1px-wide draggable splitters that highlight on hover.

---

## 4. User flows

### 4.1 First launch

```
App opens
  → Home screen renders with empty recents
  → "Open a repository" primary button centered
  → No tutorial, no onboarding modal, no telemetry prompt
```

### 4.2 Open a repo (recents)

```
User on Home screen
  → clicks a recent row
  → row highlights (bg-[#2F3135] + -translate-y-px)
  → openByPath(recent.path) called
  → state.repo = r; state.worktrees = null (loading)
  → switch to Dashboard view (mounts WorktreeList, CommitGraph,
     CommitPanel, TerminalStrip)
  → background polls start: every 3000ms, worktree list re-fetches
  → first graph fetch for the active worktree (or main if none yet)
  → first PTY auto-spawns for the selected worktree
```

### 4.3 Open a repo (folder picker)

```
User on Home OR Dashboard (any time)
  → ⌘O (or clicks "Open repository")
  → native OS folder picker (Tauri dialog plugin)
  → user picks a folder
  → validate `.git` exists
  → insert/refresh row in `recent_repos` SQLite table
  → switch repo, re-render dashboard
```

### 4.4 Switch worktree

Three paths, all converging on `useGraphStore.setActive(path)`:

1. **Click a row in the worktree list.** The graph re-fetches.
2. **`⌘1`–`⌘9`.** Hotkeys map to the first 9 rows of `sortWorktrees`
   (the same order the list renders, so the row labels match).
   `e.code` is used (layout-independent: `Digit1`..`Digit9`).
3. **Worktree tab in the terminal strip header.** Switches the
   selected worktree for terminal sessions only (does *not* change
   the active graph).

The graph auto-scrolls to the head commit on every switch (smooth
scroll, head lands at the vertical center).

### 4.5 Create worktree

```
User on Dashboard
  → ⌘N (or clicks "New worktree" primary button)
  → CreateWorktreeDialog opens (modal, centered)
  → form fields:
       Branch name  (autofocus, monospace, placeholder "feature/auth-flow")
       Base branch  (default: worktrees.default_branch or "main")
       Run after switch  (optional, monospace, placeholder "code . | claude | zsh")
       [x] Bring over .env & build caches  (default checked; on first-time
           install of a repo, it also bootstraps the post-start hook via
           HookSetupPrompt)
  → click "Create worktree" (primary) or hit ↵
  → invoke wt_switch_create (Rust)
  → on success: refresh worktree list, switch to the new wt, close dialog
  → on error: show inline error in red, keep the form open
```

### 4.6 Remove worktree

```
User on Dashboard
  → hover a non-main worktree row → trash icon appears in the row
  → click trash
  → RemoveWorktreeDialog opens
       "Remove worktree `feature/auth-flow`?"
       Path shown in mono
       [ ] Also delete the branch
       [Cancel]  [Remove worktree]
  → invoke wt_remove (Rust)
  → on success: refresh, close dialog
  → if wt was the graph-active one, graph reverts to repo's primary
```

### 4.7 Merge worktree into default

```
User on Dashboard, worktree row with merge icon visible
  → click GitMerge icon
  → MergeDialog opens, phase = "previewing"
  → backend runs `wt merge <target> --format=json` preview
       (fast-forward? conflicts? ahead/behind counts?)
  → preview body shows: sourceBranch → targetBranch, file list,
       ahead/behind counters
  → user reviews, hits "Merge into main" (primary)
  → phase = "running", spinner
  → on success: phase = "done" with optional "remove worktree?" CTA
  → on conflicts: phase shows conflict file list with "Open in
       terminal" / "Use external mergetool" buttons (M8 editor is
       planned)
```

### 4.8 Project switch (rapid)

```
User anywhere
  → ⌘K (or clicks "Projects" button in header)
  → ProjectSwitcher palette opens (modal, top-anchored, ~570px wide)
  → input is autofocused
  → rows:
       [← All projects]  (closes current repo, returns to home)
       ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
       recent-repo-row-1  (substring filter on name + path)
       recent-repo-row-2
       ...
       current-repo-row-N  (shown with "current" badge, disabled)
  → user types → list filters live (substring, case-insensitive)
  → ↑/↓ moves highlight, ↵ triggers, Esc closes
  → ⌘K toggles (closes if already open)
  → on trigger: openByPath(path) or closeRepo() + close palette
```

### 4.9 Command palette (general actions)

A *separate* surface from the project switcher (`⌘⇧P` — the
Project Switcher in my code uses `⌘K` to be the switcher; the general
CommandPalette in this build is wired but the binding isn't shown in
the App hotkey doc yet — design intent below).

The general command palette is a different surface: a fuzzy-search
list of **actions**, not repos. Action categories:

- File / repo: Open repository (⌘O), Refresh worktrees (⌘R),
  Reopen previous repository (⌘⇧O)
- Worktrees: New worktree (⌘N), Switch to <branch> (⌘1..⌘9),
  Next/Previous worktree (⌘⇧] / ⌘⇧[), Merge into <default>…
- Terminal panes: New terminal pane (⌘T), Close current pane (⌘W),
  Split right (⌘D), Split down (⌘⇧D), Equalize splits (⌃⌘=),
  Reopen last closed (⌘⇧T)
- Layout: Toggle graph & commit panel, Toggle full screen (⌃⌘F)
- Settings: Settings (⌘,), Hooks & worktree config (⌘⇧,)

Each row shows: icon · label · (optional hint) · (right-aligned
shortcut badge in `<kbd>`). Highlighted row gets `bg-white/[0.06]`
and the icon tints to `text-fg`. Disabled actions render at 40%
opacity with `cursor-not-allowed`.

### 4.10 Settings & Hooks

```
⌘, → Settings modal
  ┌─ About (gitsu version, wt version with copy button, sidecar path)
  ├─ Hook approvals (Clear all → wipes ~/.config/worktrunk/approvals.toml)
  ├─ Layout (Reset to defaults, reloading the app)
  ├─ View (Show graph & file panel — toggle)
  └─ Resources (worktrunk.dev + worktrunk on GitHub)

⌘⇧, → Hooks & worktree config modal
  ┌─ .config/wt.toml
  │     Status: not installed | installed (with post-start) |
  │             installed (no post-start) | installed & uninstall
  ├─ .worktreeinclude (path + contents in a code block)
  └─ Recopy ignored files (From / To inputs + Recopy button)
```

### 4.11 First-time hook installation

```
Dashboard mounts for a repo
  → useHooksStore fetches hooks_snapshot
  → if `has_post_start_copy_ignored === false`:
       HookSetupPrompt banner appears at the top of the dashboard
       (above the 3-pane)
  → user clicks "Install recommended setup" or "Not now"
  → if Install: write `.config/wt.toml` with [post-start] section,
       re-snapshot, banner disappears
  → banner is dismissable; dismissal persists for the session
```

---

## 5. Design tokens

All values are exact. Copy them verbatim.

### 5.1 Color palette

| Token              | Hex        | Role                                                |
|--------------------|------------|-----------------------------------------------------|
| `bg.DEFAULT`       | `#222326`  | App background (also the body, with a faint gradient `#1A1B1D → #202125`) |
| `bg.panel`         | `#2A2C2F`  | Cards, modal panels, sidebars, pane backgrounds     |
| `bg.subtle`        | `#2D2F33`  | kbd keys, secondary surfaces                        |
| `bg.hover` (raw)   | `#2F3135`  | Hover surface for recents rows (NOT a token, used as raw hex) |
| `fg.DEFAULT`       | `#F4F5F8`  | Primary text, headings                              |
| `fg.muted`         | `#8A8F98`  | Secondary text, labels, meta                        |
| `fg.subtle`        | `#5C616B`  | Tertiary text, placeholders, hints                  |
| `accent.DEFAULT`   | `#5E6AD2`  | Primary action color, focus rings, active accents   |
| `accent.hover`     | `#6F7BE0`  | Primary hover (slightly lighter, used in btn-primary)|
| `accent.fade` (gradient) | `rgba(94,106,210,0.6) → rgba(94,106,210,0)` | Top-to-bottom fade for the left selection rail |
| `success`          | `#4CAF50`  | "merged" / "clean" / "running"                      |
| `warning`          | `#FFA726`  | "modified" / "untracked" / "spawning"               |
| `danger`           | `#EF5350`  | "error" / "remove" / failed actions                 |
| `info`             | `#5E6AD2`  | Same as accent — used for informational banners     |

Lane palette (8 desaturated colors for commit graph lanes; first
is always `accent`):

| Lane | Hex        |
|------|------------|
| 1    | `#5E6AD2`  (accent) |
| 2    | `#6B7280`  (cool gray) |
| 3    | `#9CA3AF`  (lighter gray) |
| 4    | `#D1D5DB`  (light gray) |
| 5    | `#A1A1AA`  (muted gray) |
| 6    | `#7E82A6`  (blue-gray) |
| 7    | `#8B8FA3`  (slate) |
| 8    | `#787C8E`  (dark slate) |

Border palette — almost everything is `rgba(255,255,255,0.06)`
(`border-white/[0.06]`), sometimes `0.04`, `0.08`, or `0.10`. The
gradients are used for hairline accents and selection rails.

Modal backdrop: `rgba(10, 11, 13, 0.65)` with `backdrop-filter:
blur(16px) saturate(0.9)`.

Edge light (top hairline on panels): `linear-gradient(90deg,
rgba(255,255,255,0) 0%, rgba(255,255,255,0.06) 50%,
rgba(255,255,255,0) 100%)`.

xterm.js terminal theme:
- background: `#1A1B1D`
- foreground / cursor: `#8A8F98`
- selectionBackground: `#3A3D44`

### 5.2 Typography

Two font families, both from Google Fonts, preconnected in
`index.html`:

- **Sans (UI).** `Inter` weights 300/400/500/600/700.
  Stack: `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`.
- **Mono (code, paths, SHAs, branch names, kbd).** `JetBrains Mono`
  weights 300/400/500/600/700.
  Stack: `"JetBrains Mono", ui-monospace, SFMono-Regular, monospace`.

Body baseline: `font-feature-settings: "cv11", "ss01", "ss03"`,
`-webkit-font-smoothing: antialiased`.

Type scale (no design-system scale — each surface has its own
size, picked for density):

| Context                              | Size  | Weight | Letter-spacing | Notes |
|--------------------------------------|-------|--------|----------------|-------|
| Hero (Home screen)                   | 28px  | 600    | -0.01em (tight)| tracking-tight |
| Modal h2 ("New worktree")            | 15px  | 600    | tight          | with icon |
| Section label ("WORKTREES")          | 10–11px | 600  | wider (uppercase) | `tracking-wider` |
| Body / list rows                     | 13px  | 400–500 | normal        | mono for paths/branches |
| Secondary text / meta                | 11–12px | 400  | normal         | `text-fg-muted` |
| Hints / kbd badges / footer          | 10–10.5px | 400 | normal       | `text-fg-subtle` or `text-fg-muted` |
| Graph labels (branch names)          | 10px  | 400    | normal         | mono |
| Graph columns (author, date)         | 10px  | 400    | normal         | mono for date |
| Graph message column                 | 11px  | 400    | normal         | sans |

No bold emphasis in body text. Hierarchy comes from color
(`fg` → `fg.muted` → `fg.subtle`) and size, not weight.

### 5.3 Spacing & layout

- **Base unit.** 4px. Spacing is `gap-1` (4px), `gap-2` (8px),
  `gap-3` (12px), `gap-4` (16px).
- **Container padding.** Modals: `p-5` (20px). Card rows: `px-4
  py-2.5` or `px-4 py-3`. Tight rows (worktree list, terminal tab):
  `px-2 py-0.5`.
- **Left pane width.** Default 280px, range 220–480px.
- **Right pane width.** Default 360px, range 280–600px.
- **Bottom terminal height.** Default 288px (`h-72`). When graph is
  hidden, terminal fills available (`flex-1`).
- **Splitter hit area.** 12px wide, 1px visible line centered. Hover
  state: line color → `accent/50` with a 6px glow.
- **Graph row height.** 28px (commit rows and the working-tree
  pseudo-row are the same).
- **Graph lane width.** 16px.
- **Graph circle radius.** 4px outer, 1.5px inner fill.
- **Graph label columns.** 160px labels, 110px author, 75px date,
  240px message. Column x-positions are computed from a
  `rightmostUsedLane * 16 + 24` graph column width.

### 5.4 Borders, shadows, radii

- **Border color.** `rgba(255, 255, 255, 0.06)` for separators and
  panel edges. `0.08` for stronger edges (modal borders). `0.10` for
  hover states. `0.04` for the very faintest (worktree row dividers).
- **Border radius.**
  - Pills: `rounded-full`.
  - Buttons / inputs: `rounded-md` (6px).
  - Cards / modal panels / palette: `rounded-lg` (8px).
  - Inner kbd keys: `rounded` (4px) on small, `rounded-md` on bigger.
- **Shadows.**
  - Modal panel: `0 4px 24px rgba(0, 0, 0, 0.4)`. Palette uses
    `0 8px 32px rgba(0,0,0,0.5)`.
  - Card hover: `0 2px 12px rgba(0, 0, 0, 0.2)`.
  - Error banner: `0 2px 8px rgba(239, 83, 80, 0.08)`.
  - Pane background: `0 4px 24px rgba(0, 0, 0, 0.15)`.
  - Left accent rail on selection: `0 0 6px rgba(94, 106, 210, 0.25)`.
  - Recents row hover: `-translate-y-px` + `0 2px 12px rgba(0,0,0,0.2)`.
- **Edge light.** Every panel has a 1px top hairline that fades
  from transparent to `rgba(255,255,255,0.08)` to transparent. Use
  the `.modal-panel::before` pattern or `.edge-light::before`.

### 5.5 Motion

Two cubic-bezier easings, both in `tailwind.config.js`:

| Name        | Value                                    | Used for |
|-------------|------------------------------------------|----------|
| `ease-standard` | `cubic-bezier(0.25, 0.1, 0.25, 1.0)`  | Default for hovers, transforms, color transitions |
| `ease-out-quart` | `cubic-bezier(0.25, 0.46, 0.45, 0.94)` | Reserved (legacy) |
| `ease-out-expo` | `cubic-bezier(0.16, 1, 0.3, 1)`        | Reserved (legacy) |
| `ease-glass`  | `cubic-bezier(0.25, 0.46, 0.45, 0.94)`  | Reserved (legacy) |

Durations: `100ms` (row highlights, fast color shifts), `150ms`
(default hovers), `200ms` (button states, panel transitions),
`300ms` (backdrop). Modals: `200ms` with `animation: modal-scale`
(scale 0.98 → 1, opacity 0 → 1).

Loading states use:
- `animate-pulse` on text placeholders.
- `animate-spin` on Lucide `Loader2` icons in `text-accent`.

The graph auto-scrolls with `behavior: "smooth"` (browser-native).

### 5.6 Iconography

Icons come from **lucide-react**, always at `strokeWidth={1.5}`.
Sizes: `10` (tiny in kbd/buttons), `12` (default inline), `14`
(buttons, palette rows), `16` (modal headers, list emphasis),
`18` (dashboard icon, banner icons). The brand mark is
`GitFork` at size 18 in `text-accent`.

Never use emoji as UI icons. Only the status checkmarks "✓" and "⚠"
appear inline in the HooksManager status block (and those are
literal Unicode characters in text, not "icons").

---

## 6. Component catalog

### 6.1 Buttons

Three variants via the `Button` primitive (`components/ui/primitives.tsx`):

| Variant   | Style                                                                | Used for |
|-----------|----------------------------------------------------------------------|----------|
| `primary` | Gradient bg `linear-gradient(180deg, #6F7BE0 0%, #5E6AD2 100%)`, white text, 1px transparent border, inset top highlight `0 1px 0 rgba(255,255,255,0.1)` | Main CTAs: "New worktree", "Create worktree", "Merge" |
| `ghost`   | Transparent bg, `fg-muted` text, `border 1px rgba(255,255,255,0.1)`  | Secondary actions in the header: "Settings", "Hooks", "Refresh" |
| `danger`  | `bg rgba(239,83,80,0.12)`, `text-danger`, border `rgba(239,83,80,0.18)` | Destructive: "Remove worktree" |

All buttons:
- `inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium`
- Hover: `transform: translateY(-0.5px)` + bg shift + 2-8px shadow
  in the brand color.
- Transition: all 200ms `ease-standard`.
- Focus: `box-shadow: 0 0 0 3px rgba(94, 106, 210, 0.2)` (primary
  only).
- Disabled: `opacity-50` + `cursor-not-allowed`, no hover.

### 6.2 Inputs

`.input` class in globals.css:
- `w-full rounded-md border px-3 py-1.5 text-[13px]`
- `bg rgba(255,255,255,0.03)`, border `rgba(255,255,255,0.08)`,
  text `#F4F5F8`, placeholder `#5C616B`
- Focus: `border rgba(94,106,210,0.5)`, bg
  `rgba(255,255,255,0.05)`, ring `0 0 0 3px rgba(94,106,210,0.1)`
- Transition: 200ms `ease-standard`.

For inputs with a leading icon (search, branch name, etc.) the
pattern is: `flex items-center gap-2 rounded-md border
border-white/[0.08] bg-bg px-3 py-2 focus-within:border-accent/50
focus-within:ring-2 focus-within:ring-accent/10` wrapping the icon
(at `text-fg-muted`, `shrink-0`) and the input (which is
`bg-transparent focus:outline-none`).

### 6.3 Pills

Inline status indicators. Use the `Pill` primitive with one of
five tones:

| Tone      | Background gradient                                            | Text color              | Border                | Used for |
|-----------|----------------------------------------------------------------|-------------------------|-----------------------|----------|
| `default` | `rgba(255,255,255,0.06) → rgba(255,255,255,0.02)`             | `rgba(244,245,248,0.6)` | `rgba(255,255,255,0.06)` | neutral, "detached" |
| `accent`  | `rgba(94,106,210,0.14) → rgba(94,106,210,0.08)`               | `rgba(167,174,235,0.9)` | `rgba(94,106,210,0.22)`  | "current", "ahead" |
| `success` | `rgba(76,175,80,0.12) → rgba(76,175,80,0.06)`                  | `rgba(129,199,132,0.9)` | `rgba(76,175,80,0.18)`   | "main", "clean", "running" |
| `warning` | `rgba(255,167,38,0.12) → rgba(255,167,38,0.06)`                | `rgba(255,204,128,0.9)` | `rgba(255,167,38,0.18)`  | "dirty", "modified", "untracked" |
| `danger`  | `rgba(239,83,80,0.12) → rgba(239,83,80,0.06)`                  | `rgba(255,154,154,0.9)` | `rgba(239,83,80,0.18)`   | errors |

Common shape: `inline-flex items-center gap-1 rounded-full px-2
py-[1px] text-[11px]`, height 20px, inset top highlight
`0 1px 0 rgba(255,255,255,0.04)`.

### 6.4 Cards

`.card` in globals.css:
- `rounded-lg`, bg `#2A2C2F`, border `rgba(255,255,255,0.06)`.
- Hover (`.card-hover`): `bg #2F3135`, border `rgba(255,255,255,0.1)`,
  `0 2px 12px rgba(0,0,0,0.2)`, `cursor-pointer`. Transition 200ms
  `ease-standard`.

Used for: recents on the home screen, settings sections, file rows.

### 6.5 Modal panel

The canonical modal frame, used by every dialog (Settings, Hooks,
Merge, NewWorktree, RemoveWorktree):

```
fixed inset-0 z-50
flex items-center justify-center (or items-start pt-[12vh] for palettes)
modal-backdrop                 (rgba(10,11,13,0.65) + blur 16px)
  → onClick={onClose}          (backdrop click closes)
  → inner div:
       onClick stopPropagation
       modal-panel              (edge-light + shadow)
       max-w-md / max-w-xl / max-w-2xl
       rounded-lg
       border-white/[0.08]
       bg-bg-panel              (#2A2C2F)
       shadow-[0_4px_24px_rgba(0,0,0,0.4)]
       animation: modal-scale 200ms cubic-bezier(0.25,0.1,0.25,1.0) forwards
       structure: header (border-b) → body (p-5) → footer (border-t)
```

**Header.** `flex items-center justify-between border-b
border-white/[0.06] px-5 py-3.5`. Title is `flex items-center gap-2
text-[15px] font-semibold tracking-tight text-fg` with an icon
prefix at `text-accent`. Right side: a `rounded p-1 text-fg-muted
hover:bg-white/[0.04] transition-colors duration-150` close button
with an `X` icon (16px, `strokeWidth={1.5}`).

**Body.** `p-5` for most, `p-5 space-y-4` for form dialogs. Form
fields: label `text-[12px] text-fg-muted` above the input.

**Footer.** `flex items-center justify-end gap-2 border-t
border-white/[0.06] px-5 py-3.5`. Primary on the right, ghost
"Cancel" on its left. For some dialogs (HooksManager) the footer is
a muted info row instead: `flex items-center justify-between
border-t border-white/[0.06] px-4 py-2 text-[11px] text-fg-muted`.

**Palette variant.** Same frame but `pt-[12vh]` instead of
`items-center`, and the panel uses `max-w-xl`. The header is the
search input (no title row); the footer is a hint strip
(`↑/↓ navigate · ↵ to run · esc to close`).

### 6.6 Worktree row

The most repeated card in the app. Lives in the left sidebar of
the dashboard.

```
┌─────────────────────────────────────────────────────┐
│⌘1  ●  feature/auth-flow   [current]  [clean]  ⌫    │  ← 1px left accent rail when active
│       /home/user/proj.feature-auth-flow             │
│       abc1234  initial commit                       │
│       [+5 -2 staged]  [modified]  [untracked]       │  ← only if working_tree has changes
└─────────────────────────────────────────────────────┘
```

- Container: `group relative flex cursor-pointer items-stretch
  border-b border-white/[0.04] py-3 transition-all duration-150
  ease-standard`.
- Active: `bg-white/[0.04]` + `before:absolute before:left-0
  before:top-0 before:h-full before:w-[2px] before:bg-accent
  before:shadow-[0_0_6px_rgba(94,106,210,0.25)]`.
- Hover (inactive): `hover:bg-white/[0.03]`.
- Left rail: 28px-wide mono shortcut hint
  (`text-[10px] font-mono tabular-nums`). 1–9 → "⌘1"…"⌘9", 10+ → "·".
- Branch indicator dot: 6px circle, `bg-accent` for normal,
  `bg-fg-muted` for detached.
- Branch name: `truncate font-mono text-[13px] font-medium text-fg`.
- Path: `mt-1 truncate text-[11px] text-fg-muted`.
- Last commit: `mt-1 line-clamp-1 text-[11px] text-fg-muted`, mono
  SHA + first line of message.
- Status pills: `mt-2 flex flex-wrap items-center gap-1.5 text-[11px]`.
- Action buttons (trash, merge): `flex items-center gap-0.5
  opacity-0 group-hover:opacity-100 transition-opacity
  duration-150` — appear on hover only.

### 6.7 Commit graph (custom SVG)

Pure SVG, not virtualized. ~500 commits × 28px = 14k px is fine in
modern browsers.

Constants:
- `ROW_HEIGHT = 28`, `LANE_WIDTH = 16`, `GRAPH_PAD_X = 12`,
  `CIRCLE_R = 4`, `WORKING_TREE_ROW_HEIGHT = 28`.
- Column widths: `COL_LABELS = 160`, `COL_AUTHOR = 110`,
  `COL_DATE = 75`, `COL_MESSAGE = 240`.
- Lane palette: see §5.1.
- Lane x = `COL_LABELS + GRAPH_PAD_X + lane * LANE_WIDTH + LANE_WIDTH/2`.

Layer order (z-order, bottom to top):
1. **Edges** — vertical lines (same lane, same color, opacity 0.65,
   `strokeWidth=1.5`) and cubic-Bezier curves between lanes. Color
   matches the *from* lane so the primary line stays consistent.
2. **Track lines** — vertical line through each row's lane
   (opacity 0.4). The working-tree row's track is dotted.
3. **Dotted working-tree connector** (only when uncommitted) — from
   the head's circle down to the working-tree circle, in head lane
   color, `strokeDasharray="3,3"`, opacity 0.55.
4. **Commit rows** — circle (filled, lane color) + branch/tag labels
   + dotted leader line + author/date/message columns. Selected row
   gets `bg rgba(94,106,210,0.06)` and a left accent rail with a
   top-to-bottom fade gradient.
5. **Working-tree pseudo-row** — hollow ring + center dot, in the
   head's lane color. Label pill "Working tree" with a *dashed*
   border (`strokeDasharray="2,2"`) to differentiate from real
   branch labels. Right side: `+N −M` (libgit2 line counts) or
   "N changes" fallback. `pointer-events: none` (visual only).

Branch and tag labels:
- Local branch: bg `rgba(94,106,210,0.15)`, border
  `rgba(94,106,210,0.22)`, text `#8A8F98`.
- Remote branch: bg `rgba(80,90,110,0.25)`, border
  `rgba(255,255,255,0.06)`, text `#6B7280`.
- Tag: bg `rgba(120,124,142,0.15)`, border `rgba(255,255,255,0.06)`,
  text `#8A8F98`. Annotated tags get a trailing `*` in `#6B7280`.
- Overflow: `+N` badge (mono, `#5C616B`).

Dotted leader (from label cluster to circle): `strokeDasharray="3,3"`,
stroke `#6B7080`, opacity 0.9.

Date formatting (relative): `now` / `Nm` / `Nh` / `Nd` /
`Mon Day` / `Year Mon`. Always `font-mono text-fg-muted text-[10px]`.

Auto-scroll: on graph fetch, scroll the head commit to the vertical
center of the container with `behavior: "smooth"`.

### 6.8 Terminal strip

A bottom (or fills-right) panel with a per-worktree layout tree of
PTY panes. Lives in `components/terminal/TerminalStrip.tsx`.

Structure:
- **Strip header.** 32px tall, `flex items-center gap-1 border-b
  border-white/[0.06] px-2`. Contains:
  - Terminal icon (12px, `text-fg-muted`) + label "TERMINAL" +
    `(N)` live count.
  - Worktree tab strip (horizontal scroll, mono `text-[11px]` tabs,
    6px accent or muted dot, `bg-white/[0.05]` when active).
  - Quick actions: "zoomed" chip (accent tinted, only when a pane
    is zoomed), "Equalize splits" icon, "Reopen last closed"
    icon (disabled when reopen stack empty), collapse chevron.
- **Body.** `h-72 bg-bg` normally, `flex-1` when `fillsAvailable`.
  Renders the `LayoutView` (recursive) of the worktree's layout:
  - `pane` → `PaneView` (small header with status dot, session
    number, and on-hover icon buttons for split-h / split-v /
    close) + `TerminalSessionView` (xterm.js).
  - `split` (h) → `flex-col` with two children + a 4px splitter.
  - `split` (v) → `flex-row` with two children + a 4px splitter.
  - Splitter: 1px line `bg-white/[0.04]`, hover `bg-accent/50`,
    grab cursor.
- **Focused pane.** Border `border-accent/40`, header bg
  `bg-accent/[0.06]`, status dot in `bg-success`. On mousedown,
  the pane is focused and routed to `onFocus(worktree, paneId)`.
- **xterm.js config.** `fontFamily: 'ui-monospace, "JetBrains Mono",
  SFMono-Regular, monospace'`, `fontSize: 12`, theme:
  `{ background: '#1A1B1D', foreground: '#8A8F98', cursor:
  '#8A8F98', selectionBackground: '#3A3D44' }`. Serialized
  scrollback persists across worktree switches via a
  `SerializeAddon` snapshot.

### 6.9 Project switcher palette

The ⌘K quick switcher. Different from the general command palette
in §4.9 — this one is **project-scoped** (recents only), always
shows the "← All projects" entry when a repo is open, and uses
the same `bg-accent/12` highlight + tinted icons (vs. the command
palette's `bg-white/[0.06]` highlight).

Layout: `fixed inset-0 z-50 flex items-start justify-center
pt-[12vh] modal-backdrop` → `modal-panel max-w-xl ... shadow-[0_8px_32px_rgba(0,0,0,0.5)]`.

- **Search header.** Search icon (14px, absolute left at `left-4`),
  input at `pl-10 pr-4 py-3.5 text-[14px]`. Border-b.
- **Results list.** `max-h-[60vh] overflow-y-auto py-1.5`. Each
  row: `flex items-center gap-3 px-4 py-2 text-[13px] transition-colors
  duration-100`. Active row: `bg-accent/12 text-fg`. Inactive:
  `text-fg hover:bg-white/[0.03]`. The "current" row is shown
  at 50% opacity with a "current" pill on the right.
- **"← All projects" row.** ArrowLeft icon (14px), "All projects"
  label, "back" small uppercase tracked label on the right.
- **Footer hints.** `flex items-center justify-between border-t
  border-white/[0.06] bg-bg/40 px-3 py-1.5 text-[10.5px] text-fg-muted`.
  Left: `↑ ↓ navigate · ↵ open`. Right: `esc close`. The kbd
  glyphs use a small `<Kbd>` component: `inline-flex h-[18px]
  min-w-[18px] items-center justify-center rounded border
  border-white/[0.1] bg-white/[0.04] px-1 font-mono text-[10px]
  text-fg-muted`.

### 6.10 Command palette (general actions)

The ⌘⇧P surface. Lists **actions**, not repos.

- Input row: command icon prefix + input + `esc` kbd hint.
- Results: `max-h-80 overflow-auto p-1`, each row a `<button>`
  with icon · label · (optional hint) · (optional kbd shortcut).
  Highlighted row: `bg-white/[0.06] text-fg`. Hover row: same as
  highlight. Disabled: `opacity-40 cursor-not-allowed`.
- The kbd shortcut badge on the right: `rounded bg-bg-subtle
  px-1.5 py-0.5 text-[10px] font-mono text-fg-muted`.

### 6.11 Header

```
[GitFork]  gitsu  /  my-project  [wt 0.56.0]                          updated 3s ago  [Projects] [Show graph] [Settings] [Hooks] [Refresh] [New worktree]
```

- Container: `relative flex items-center justify-between gap-4
  bg-bg px-4 py-2.5 z-10`. Bottom hairline: `absolute bottom-0
  left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/10
  to-transparent`.
- Left cluster: brand mark + wordmark "gitsu" (`text-[15px]
  font-semibold tracking-tight text-fg`) + slash separator
  (`text-fg-muted/40`) + repo basename (mono `text-[13px] text-fg`)
  + wt version pill (accent or danger tone).
- Right cluster: "updated Ns ago" timestamp (`text-[11px]
  tabular-nums text-fg-muted`) + buttons.
- "Projects" button is **always visible** (on both home and
  dashboard). On home, the "← All projects" entry still works (it
  just closes the already-null repo).
- "New worktree" is `variant="primary"` and only on the dashboard.

### 6.12 Home screen

```
                          Worktrees, first.

            A Git desktop client where every branch gets its
            own folder, its own terminal, its own state — all
            in one window, powered by worktrunk.

                          [Open a repository]

            ── RECENT ──────────────────────────────────────
            [⎇]  my-project        /home/user/code/my-project    ⌫
            [⎇]  another-repo      /home/user/code/another-repo  ⌫
```

- Centered column, `max-w-3xl`, `p-10`.
- Hero: `text-[28px] font-semibold tracking-tight text-fg`, with
  "first" highlighted in `text-accent`.
- Sub: `max-w-md text-fg-muted leading-relaxed text-[14px]`.
- CTA: centered primary button with a FolderOpen icon.
- Recent section: `mb-3 text-[11px] font-semibold uppercase
  tracking-wider text-fg-muted` label + list.
- Recent row: `.card` with hover lift, `git-branch` icon
  (16px, accent) on the left, name + path (mono, `text-fg-muted`),
  and a `text-danger` X button (opacity-0, group-hover:opacity-100)
  on the right.

### 6.13 Banners (error, hook setup, info)

- **Error banner (top, dismissable).** `flex items-start
  justify-between gap-2 border-b border-white/[0.06] bg-danger/10
  px-4 py-2 text-[13px] text-danger shadow-[0_2px_8px_rgba(239,83,80,0.08)]`.
  Left: AlertTriangle icon + message. Right: small X to dismiss.
- **Hook setup prompt.** `flex items-start gap-3 border-b
  border-white/[0.06] bg-bg-panel px-4 py-3 text-[13px] shadow-[0_2px_8px_rgba(0,0,0,0.1)]`.
  Left: Package icon (18px, accent). Title in `font-medium text-fg`,
  body in `text-[11px] text-fg-muted`. Two actions: primary "Install
  recommended setup" + ghost "Not now". Right: small X to dismiss.

### 6.14 Empty / loading / error states (component-level)

- **Empty list (worktrees).** Centered icon (Folder, 32px,
  `opacity-50`) + "No worktrees found for this repository." + hint
  "Use ⌘N to create one." with the kbd in a styled badge.
- **Loading (worktree list / graph).** Centered `animate-pulse
  text-[13px] text-fg-muted`: "Loading worktrees…" / "Loading
  commit graph…".
- **Error (worktree list / graph body).** Card-style: `m-4 flex
  items-start gap-2 rounded-md border border-danger/20 bg-danger/10
  p-3 text-[13px] text-danger`, with AlertCircle icon.
- **No commits in worktree.** Centered `text-fg-muted text-[13px]`:
  "No commits in this worktree."
- **Palette no results.** Centered muted text: `No projects match
  "foo"` / `No recent projects — open one with ⌘O` /
  `No matching actions.`
- **No merge preview.** Centered `text-fg-muted text-[13px]`:
  "No preview available."
- **Terminal spawning.** Centered `text-[11px] text-fg-muted`:
  "Spawning shell…" (with `animate-pulse` dot in the status bar).
- **Terminal exited.** Centered `text-[11px] text-fg-subtle`:
  "Shell exited. Close this pane to clean up."
- **Terminal error.** Centered `text-[11px] text-danger` with the
  error string.

---

## 7. Layout patterns in detail

### 7.1 Resizable panes (left/right)

A `ResizablePane` component renders a fixed-width container with
a 12px-wide splitter. The visible line is 1px, centered in the
hit area, half off the edge (`[side]: -6`). Hover: line shifts to
`accent/50` with a 6px glow. Mousedown captures pointer, mousemove
updates width clamped to `[min, max]`, mouseup releases. The
container is `bg-bg-panel shadow-[0_4px_24px_rgba(0,0,0,0.15)]`
with a 1px side border.

### 7.2 Modal/palette z-index

- Modals & dialogs: `z-50`.
- Backdrop: handled by the modal itself (`fixed inset-0 ... modal-backdrop`).
- Palette: `z-50` (same as modals), but `pt-[12vh]` instead of centered.

### 7.3 The graph container

`relative h-full overflow-auto bg-bg` with a click handler that
closes the commit context menu. The SVG inside uses `width` and
`height` attributes (not CSS) so the viewBox is stable on
horizontal scroll: `width={totalWidth} height={totalHeight}
viewBox="0 0 ${totalWidth} ${totalHeight}"`.

### 7.4 Selection rail (left edge of selected rows / list items)

The "selected" pattern: a 2px-wide accent-colored vertical bar at
the left of the row, with a top-to-bottom fade gradient
(`accent-fade` linearGradient in the SVG defs). On worktree rows
this is implemented via a `::before` pseudo-element; in the graph
it's a `<rect>` filled with the gradient.

---

## 8. Interaction patterns

### 8.1 Keyboard shortcuts

| Binding                | Action                              | Surface      |
|------------------------|-------------------------------------|--------------|
| `⌘N` / `Ctrl+N`        | New worktree                        | Dashboard    |
| `⌘O` / `Ctrl+O`        | Open repository (folder picker)     | Anywhere     |
| `⌘K` / `Ctrl+K`        | Project switcher palette (toggle)   | Anywhere     |
| `⌘1`–`⌘9`              | Switch to Nth worktree in list      | Dashboard    |
| `⌘⇧,`                  | Hooks & worktree config             | Anywhere     |
| `⌘,`                   | Settings                            | Anywhere     |
| `⌘R` / `Ctrl+R`        | Refresh worktrees                   | Dashboard    |
| `⌘T`                   | New terminal pane                   | Dashboard    |
| `⌘W`                   | Close current terminal pane         | Dashboard    |
| `⌘D` / `⌘⇧D`           | Split terminal right / down         | Dashboard    |
| `⌃⌘=`                  | Equalize terminal split sizes       | Dashboard    |
| `⌘⇧T`                  | Reopen last closed terminal         | Dashboard    |
| `⌘⇧]` / `⌘⇧[`          | Next / previous worktree            | Dashboard    |
| `⌘⇧O`                  | Reopen previous repository          | Anywhere     |
| `⌃⌘F`                  | Toggle full screen                  | Anywhere     |
| `⌘⇧↩`                  | Exit pane zoom                      | Dashboard    |
| `Esc`                  | Close any dialog / palette / menu   | Anywhere     |

Hotkeys are gated on `!isContentEditable && !isInputOrTextarea` —
typing into the create-worktree form or the palette's search
input never triggers a global hotkey. The palette and create-worktree
form re-implement the small subset they need (Esc, arrows, Enter,
⌘K) on their own input's `onKeyDown`.

### 8.2 Hover, focus, active

- **Buttons.** Hover: `translateY(-0.5px)` + bg shift + 2-8px
  shadow in the accent. Transition 200ms `ease-standard`. Focus:
  `box-shadow: 0 0 0 3px rgba(94, 106, 210, 0.2)`. Active (pressed):
  no special state — the hover state visually communicates it.
- **List rows.** Hover: bg `white/[0.03]` and (for cards) a
  `translateY(-0.5px)` + shadow. Transition 150ms `ease-standard`.
  Active/selected: a left accent rail (2px, accent) + slightly
  brighter bg.
- **Icon buttons in toolbars.** Hover: bg `white/[0.04]`,
  text color `fg` (from `fg-muted`). Transition 150ms.
- **Palette rows.** Active: `bg-accent/12 text-fg`. Hover (inactive):
  `bg-white/[0.03]`. Icons in the active row also tint to
  `text-accent`.

### 8.3 Modal/palette lifecycle

- **Open.** Mount the component; backdrop + panel animate in
  (200ms scale 0.98→1 + opacity 0→1, `ease-standard`).
- **Input focus.** The search input (or first input in a form) is
  auto-focused on mount.
- **Close.** Backdrop click OR `Esc`. No exit animation in v1
  (the unmount is fast enough).
- **Re-trigger.** ⌘K toggles; other modals require opening via
  their trigger again.

### 8.4 Data freshness

- **Worktree list.** Polled every 3000ms while a repo is open. The
  poll is started on `repo !== null` and stopped on `repo === null`
  (App-level effect).
- **Commit graph.** Fetched on worktree switch (`useGraphStore.setActive`).
  Cached per `activePath`; switching back to a recently-seen
  worktree reuses the cached graph.
- **Hooks snapshot.** Fetched on repo open; refreshed on demand
  (HooksManager mounts triggers a refetch).
- **PTY sessions.** Persistent — the shell process lives for the
  app's lifetime. Switching worktrees hides the xterm view but
  keeps the PTY alive; coming back restores the scrollback.

### 8.5 Async actions

Long-running actions (create, remove, merge, hook install) follow
the same pattern:
- Button becomes `disabled` and label changes to "Creating…" /
  "Removing…" / etc.
- An inline error in `bg-danger/10` appears in the dialog body on
  failure, the form remains editable.
- On success, the dialog closes, the relevant store refetches
  (worktrees, hooks, etc.), and the dashboard updates.

### 8.6 Splitter drag

Mousedown on the splitter sets `body.style.cursor = "row-resize" /
"col-resize"` and `user-select: none`. Mousemove updates the
width/ratio. Mouseup clears the cursor + select. No transitions
during drag (the cursor follows the pointer exactly).

---

## 9. Voice & copy patterns

- **Headings on the home screen.** One phrase, then a period.
  "Worktrees, first." (with "first" accented).
- **Empty states.** Factual + one CTA-shaped hint. "No worktrees
  found for this repository. Use ⌘N to create one." (the
  CTA-shaped hint is a kbd-shortcut mention, not a button).
- **Status pill text.** One word. `dirty`, `clean`, `main`,
  `current`, `detached`, `merged`, `diverged`, `behind`, `ahead`,
  `modified`, `untracked`, `running`, `spawning`, `exited`.
- **Action button labels.** Verb + object. "New worktree",
  "Create worktree", "Remove worktree", "Merge into main",
  "Install recommended setup", "Recopy". "Open a repository" is
  the one exception (article + noun for the home CTA).
- **Confirm dialogs.** State the consequence. "Remove worktree
  `feature/auth-flow`?" — no "Are you sure" or "Please confirm".
- **Code references.** Always in `<code className="font-mono">`:
  `.env`, `wt list --format=json`, `wt step copy-ignored`,
  `post-start`. Inline, not blocks.
- **Pronouns.** None. "Install gitsu's recommended hook so new
  worktrees bring over .env" — not "so your new worktrees…".

---

## 10. Rules for a design LLM (do and don't)

When generating new gitsu-style UI, follow these constraints:

### DO

- **Match the spacing rhythm.** 4 / 8 / 12 / 16 / 20 / 24. Avoid
  6, 10, 14, 18.
- **Use the exact hex values from §5.1.** Don't invent new grays or
  re-interpret the accent.
- **Pick the right font for the right content.** Inter for UI,
  JetBrains Mono for code/paths/SHAs/branch names. Never the wrong
  one.
- **Honor the 3-layer border opacity scale.** 0.04 (faintest
  dividers), 0.06 (default), 0.08 (panel edges), 0.10 (hover),
  0.18 (status borders).
- **Use the 5-tone pill system.** Default / Accent / Success /
  Warning / Danger. Add a new tone only if it earns its place.
- **Animate on transform + shadow, not on width/height/top.**
  Hovers are 200ms `ease-standard` and use `translateY(-0.5px)`.
- **Use the modal frame from §6.5** for any overlay that needs
  focus capture. Use the palette frame from §6.9 for any search-as-
  you-type overlay. Don't mix the two.
- **Use `<kbd>` for keyboard hints.** Always with the actual Unicode
  glyph (`⌘`, `⇧`, `↵`, `↑`, `↓`), not "Cmd", "Shift", "Enter".
- **Show the kbd shortcut in the row's title attribute** when the
  shortcut isn't visible inline. "Switch to feature-x (⌘3)".
- **Use the modal-scale animation for any new dialog.** 200ms,
  scale 0.98 → 1, ease-standard.
- **Gate global hotkeys on `!isInputOrTextarea`.** Re-implement the
  small subset (Esc, arrows, Enter) on each modal/palette's own
  input.

### DON'T

- **Don't add rounded-full anywhere except pills and avatars.** Use
  `rounded-md` for buttons/inputs, `rounded-lg` for cards/panels,
  `rounded` for tiny kbd keys.
- **Don't use shadows outside the documented recipes.** New shadow
  recipes break the depth model. Stick to: `0 4px 24px rgba(0,0,0,0.4)`
  for modals, `0 8px 32px rgba(0,0,0,0.5)` for palettes,
  `0 2px 12px rgba(0,0,0,0.2)` for card hovers,
  `0 0 6px rgba(94,106,210,0.25)` for the left accent rail.
- **Don't use color for emphasis in body text.** Hierarchy comes
  from `fg` / `fg.muted` / `fg.subtle` + size, not from a colored
  span. Exception: the literal "first" in the home hero (accent).
- **Don't use ALL-CAPS for body or button labels.** Only for
  section labels, and always with `tracking-wider` or
  `tracking-wider`-ish.
- **Don't use icons with `strokeWidth > 1.5` or < 1.5.** Lucide
  at 1.5 is the project standard.
- **Don't introduce a new color without a token in `tailwind.config.js`.**
- **Don't use ALL-CAPS or interjections in error messages.** No
  "Oops!", no "Uh oh!", no "Something went wrong". One sentence.
- **Don't use emoji as UI icons.** Use lucide-react.
- **Don't break the worktree-first rule.** The worktree list is
  always visible when a repo is open. The graph and commit panel
  can be hidden but the worktree list cannot.
- **Don't use a "loading spinner" as a button label.** Buttons say
  "Creating…" / "Removing…" etc. Spinners are reserved for
  full-area loading states.
- **Don't put more than one primary button in a cluster.** Multiple
  `variant="primary"` buttons in the same row read as competing
  CTAs. The secondary actions use `variant="ghost"`.
- **Don't use `border-radius` > 8px on rectangular surfaces.**
  Larger radii are reserved for pills.
- **Don't use the wrong minus/hyphen glyph.** Always `−` (U+2212)
  in `+N −M`; ASCII `-` reads as a hyphen.

### Style fingerprint summary (one paragraph for quick recall)

> Dark UI on a `#222326`/`#2A2C2F` panel system, hairline borders
> in `rgba(255,255,255,0.06)`, a single desaturated indigo accent
> (`#5E6AD2`), Inter for UI and JetBrains Mono for everything code-
> shaped. Dense: 13px body, 10–11px labels, 28px row heights, 16px
> lane widths, 4–8px gaps. Five-tone pill system (default / accent /
> success / warning / danger) with subtle inset-top highlights. Hovers
> lift by 0.5px and gain a 2–8px accent-tinted shadow. 200ms
> `cubic-bezier(0.25, 0.1, 0.25, 1.0)` is the default timing curve.
> Lucide icons at `strokeWidth={1.5}`. Modals centered with blurred
> backdrops; palettes anchor to `pt-[12vh]`; modals and palettes
> both use a 200ms scale-0.98 entrance. The voice is restrained and
> developer-native: lowercase brand, sentence-case CTAs, Unicode
> key glyphs, mono paths, no marketing fluff.

---

*End of spec. v0.1.0 — gitsu M0..M8 shipped surface, with
`docs/ARCHITECTURE.md`, `docs/IPC.md`, and
`docs/WORKTRUNK_INTEGRATION.md` as the structural sources of truth.*
