# UI/UX Roadmap

| | |
|---|---|
| **Document** | UI/UX improvement plan for the DA Marinduque Intervention Map |
| **Status** | Draft for review |
| **Version** | 0.1 (2026-11-11) |
| **Owner** | Provincial Agriculture Office – Marinduque |
| **Related** | [`STATUS.md`](../STATUS.md), [spec](spec/DA-Marinduque-Intervention-Map-Spec.md), [`OPERATIONS.md`](OPERATIONS.md) |

## Contents

1. [Purpose and scope](#1-purpose-and-scope)
2. [Design reference](#2-design-reference)
3. [Current state and target](#3-current-state-and-target)
4. [Information architecture](#4-information-architecture)
5. [Design system](#5-design-system)
6. [Data scope](#6-data-scope)
7. [Records without coordinates](#7-records-without-coordinates)
8. [Map visual design](#8-map-visual-design)
9. [Tools](#9-tools)
10. [Token-saving working rules](#10-token-saving-working-rules)
11. [Delivery workflow and preview gates](#11-delivery-workflow-and-preview-gates)
12. [Phases](#12-phases)
13. [Risks and open questions](#13-risks-and-open-questions)
14. [Definition of done](#14-definition-of-done)
15. [Change log](#15-change-log)

---

## 1. Purpose and scope

The Intervention Map's features are built (Phases 1 to 9). Its interface is still plain: a green header with link buttons, the map, and side panels. This roadmap redesigns the interface to match the look of **agri-dms**, the sample system made for the whole Provincial Agriculture Office, so both systems feel like one product.

### Goals

| # | Goal |
|---|---|
| G1 | Match the agri-dms look: sidebar navigation, card layout, green and cream palette. |
| G2 | Give the dashboard its own page, with clear totals for Farm Machinery and SSIP. |
| G3 | Show records that have no coordinates on the dashboard, and keep them off the map. |
| G4 | Make the map look professional: a calm basemap, clear markers, a readable legend. |
| G5 | Leave room for Farm-to-Market Roads (FMR), whose data comes later. |
| G6 | Build in small phases, with a preview the owner approves before each commit and each deployment. |
| G7 | Decide the design in Figma, so Claude implements a finished design instead of iterating on visuals. |

### Non-goals

- No change to the database schema, roles or the `DataStore` interface, except what FMR needs in Phase 16.
- No change of framework. The app stays on React, Vite, TypeScript, Leaflet and Supabase.
- No new features beyond the Home page, the Dashboard page and the no-coordinates view.

### Sign-off

The project owner approves each phase at its two gates (see [§11](#11-delivery-workflow-and-preview-gates)). Nothing is committed or deployed before that.

---

## 2. Design reference

**Source:** 28 screenshots of agri-dms (`agri-web-app.netlify.app`), kept outside this repo in `d:\agri-web-app\`. The sample shows cacao trees. This system shows interventions, so the layout carries over and the content changes.

### Patterns to adopt

| Pattern | In the sample |
|---|---|
| Sidebar | Dark green gradient, logo and office name at the top, links grouped under small headings, the open page as a white pill |
| Top bar | The person's initials, name, role and scope on the right, then Sign out |
| Page header | A large title, one line of grey text under it, the main action button on the right |
| Cards | White, rounded, on a cream page background, with a light border |
| Filter bar | One card of labelled dropdowns above the content |
| KPI tiles | A row of four. The first is dark green (the headline number). The others are white with a small icon |
| Charts | A title, a one-line note, and Table and CSV buttons on every chart |
| Tables | Grey column headings, generous row height, links in green, a page counter at the bottom |
| Status badges | Small pills with a dot: Active, Inactive, Not recorded |
| Detail page | Profile card, related lists, and an Audit trail card on the right |
| Sign-in | Two halves: a green panel with the tagline, and the form |
| Notices | A light blue bar with an info icon for things the person should know |

### Screen mapping

| agri-dms screen | This system |
|---|---|
| Sign in | Sign in (`src/app/auth/AuthGate.tsx`) |
| Home | **New:** Home, with a welcome banner, shortcuts, work waiting, and headline counts |
| Dashboard | **New page:** Dashboard, built from today's side panel (`dashboard/InsightsPanel.tsx`, `Charts.tsx`) |
| Map | Map (`MapPage.tsx`) |
| Farmers (list) | Interventions (list), from `dashboard/RecordsTable.tsx` |
| Farmer (detail) | Intervention (detail), from the record panels in `edit/RecordPanels.tsx` |
| New entry | Add intervention (`edit/InterventionForm.tsx`) |
| Review queue | QA queue (`work/QaQueue.tsx`) and Condition check (`work/ConditionCheck.tsx`) |
| Imports | Import (`work/ImportPage.tsx`) |
| Users | Users (`admin/UsersSection.tsx`) |
| Crops, Material sources | Types, categories, programs, statuses and other lists (`admin/`) |
| Report settings | Signature blocks (`/admin/signatures`) |
| Associations, Survey rounds | No equivalent. Not built |

---

## 3. Current state and target

| Area | Today | Target |
|---|---|---|
| Shell | Header and footer around every page (`src/app/App.tsx`) | Sidebar and top bar. Sources and attribution move to a quiet line at the bottom of the page |
| Navigation | Up to four link buttons in the header, plus "Back to the map" | Grouped sidebar links, always visible. A drawer on phones |
| Landing page | The map | Home |
| Dashboard | A side panel beside the map | Its own page at `/dashboard`. A short summary stays available beside the map |
| Map | Works, default styling | Restyled basemap, markers, clusters and legend ([§8](#8-map-visual-design)) |
| Records without coordinates | Kept off the map, listed in the QA queue | Also counted and listed on the dashboard ([§7](#7-records-without-coordinates)) |
| Styling | One 2,452-line file, `src/app/app.css`, with 10 CSS variables | Design tokens from Figma, and styles split by component |
| Type and icons | System font, no icon set | One self-hosted font family and one icon set |
| Empty, loading and error states | Plain text | Designed states, the same everywhere |
| Phones | Usable | Designed: drawer navigation, stacked cards, full-height map |

---

## 4. Information architecture

### Sidebar

| Group | Link | Route | Who sees it |
|---|---|---|---|
| Overview | Home | `/` | Everyone |
| | Dashboard | `/dashboard` | Everyone |
| | Map | `/map` | Everyone |
| Records | Interventions | `/records` | Everyone |
| | QA queue | `/qa` | Encoder, Admin |
| | Condition check | `/qa/condition` | Encoder, Admin |
| | Import | `/import` | Encoder, Admin |
| Reports | Reports | `/reports` | Everyone |
| Administration | Users | `/admin/users` | Admin |
| | Types and fields | `/admin/types` | Admin |
| | Lists | `/admin/categories` and the other list pages | Admin |
| | Signature blocks | `/admin/signatures` | Admin |
| | Audit log | `/admin/audit` | Admin |

Rules:

- The roles stay as they are: Admin, Encoder and Viewer. The sidebar reads them from `lib/permissions.ts`.
- **The map moves from `/` to `/map`.** Old links must keep working: `/` with map parameters, saved views, and barangay profile addresses redirect to `/map`. This is the riskiest change in the roadmap and gets its own tests.
- Existing routes under `/qa`, `/import`, `/reports` and `/admin` keep their addresses.

---

## 5. Design system

Figma is the source of truth ([§9](#9-tools)). The values below are a starting point taken from the sample and from today's `app.css`. Phase 11 fixes the final values.

### Tokens

| Group | Token | Starting value | Use |
|---|---|---|---|
| Color | `--green-900` | `#0f3f22` | Sidebar gradient end, hero tile |
| | `--green-700` | `#14532d` | Primary buttons, links, active states |
| | `--green-100` | a pale green, set in Figma | Icon tiles, badge backgrounds |
| | `--accent` | `#f9c80e` | Logo tile, highlights. Never for text |
| | `--page` | `#f7f6f3` | Page background |
| | `--surface` | `#ffffff` | Cards |
| | `--border` | `#dcdbd6` | Card and input borders |
| | `--text` | `#1f1e1c` | Body text |
| | `--text-secondary` | `#52514e` | Notes and labels |
| | Status colors | set in Figma | Success, warning, danger and info, each with a text and background pair |
| Type | Family | One sans-serif family, self-hosted | Headings in a heavier weight |
| | Scale | 12, 14, 16, 20, 28, 36 px | Body is 14 or 16 px |
| Spacing | Scale | 4, 8, 12, 16, 24, 32, 48 px | |
| Radius | | 8 px inputs, 12 px cards, 999 px pills | |
| Shadow | | One soft card shadow, one dialog shadow | |

### Components

| Component | Notes |
|---|---|
| Sidebar, top bar | Collapses to a drawer under 900 px |
| Page header | Title, note, primary action |
| Card | The base container |
| KPI tile | Hero and plain variants, with an optional change line |
| Filter bar | Labelled selects. Keeps today's filters from `state/map-ui` |
| Chart card | Title, note, Table and CSV buttons. Charts stay on Recharts |
| Table | Sorting, search and paging stay on TanStack Table |
| Badge | Status pills with a dot |
| Form field | Label, input, hint, error |
| Button | Primary, secondary, quiet, danger |
| Dialog | For confirmations and exports |
| Notice | Info, warning, error |
| Empty, loading and error states | One design each |
| Map parts | Marker, cluster, popup, legend card, layer control |

### Rules

- **Fonts are self-hosted.** The site's Content-Security-Policy in `netlify.toml` allows fonts from this site only. Use font files bundled with the app (for example an `@fontsource` package), not a link to Google Fonts.
- **One icon set,** imported as components so only the icons used are bundled (for example `lucide-react`, which is close to the sample's icons).
- **Accessibility:** text contrast meets WCAG AA, everything works by keyboard with a visible focus ring, touch targets are at least 44 px, and no meaning is carried by color alone.
- **Wording:** plain English and sentence case, as in the current app.

---

## 6. Data scope

| Dataset | Status | Source | Geometry |
|---|---|---|---|
| Farm Machinery | In the system | RAED Consolidated Inventory Report, Province of Marinduque | Point |
| SSIP (includes SPIS) | In the system | Same report | Point |
| Farm-to-Market Roads (FMR) | **Data to follow** | To be provided | Line |

Figures from the seed file `data/source/seed_interventions.csv` (report dated 2026-10-21). The live database may differ after corrections:

| | Count |
|---|---|
| Records | 199 |
| Farm Machinery | 195 |
| SSIP | 4 |
| With no coordinates | 26 |
| With coordinates outside Marinduque | 1 |
| Can be plotted | 172 |

| Municipality | Records | No coordinates |
|---|---|---|
| Boac | 38 | 3 |
| Buenavista | 19 | 1 |
| Gasan | 33 | 5 |
| Mogpog | 25 | 7 |
| Santa Cruz | 48 | 9 |
| Torrijos | 36 | 1 |
| **Total** | **199** | **26** |

> **To check in Phase 10:** the PDF in `Downloads` could not be opened when this roadmap was written, so these figures were not compared against it. If that PDF is newer than 2026-10-21, re-import it before designing with the numbers.

FMR appears in the design from the start as a disabled layer and an empty dashboard card labelled "Data to follow", so adding it later doesn't change the layout.

---

## 7. Records without coordinates

**Rule: a record with no coordinates is counted in every total and is never plotted.** The region verifies the coordinates first.

The app already does half of this. `isOnMap()` in `lib/display.ts` keeps records flagged `no_coords` or `out_of_province` off the map, the QA queue lists them, and `npm run build:field-sheet` writes a verification sheet (`data/corrections/for-field-verification.csv`). The dashboard is the missing half.

### Requirements

| # | Requirement | Where |
|---|---|---|
| NC-1 | Dashboard totals include records with no coordinates | Dashboard |
| NC-2 | A KPI tile shows "Awaiting coordinate verification", with the count and the share of all records | Dashboard |
| NC-3 | A table lists those records by municipality, with type, item, beneficiary and encoded barangay | Dashboard |
| NC-4 | That table downloads as CSV, in the layout of the field-verification sheet, to send to the region | Dashboard |
| NC-5 | The map shows a note: "172 of 199 records are on the map. 27 are waiting for verified coordinates", linking to NC-3 | Map |
| NC-6 | No marker is ever placed at a guessed location, a barangay centre or 0,0 | Map |
| NC-7 | In lists and on the record page, these records carry a badge: "No coordinates yet" | Records |
| NC-8 | When the region confirms coordinates, an Encoder enters them through the existing Resolve flag form. The record then appears on the map, and the change is in the audit log | QA queue |
| NC-9 | Filters apply to these counts the same way they apply to everything else | Dashboard, Map |

Records outside the province follow the same rule and are counted in the same note, under their own label.

---

## 8. Map visual design

### Requirements

| # | Element | Design |
|---|---|---|
| M-1 | Basemap | A light, muted style so the data stands out. Keep satellite as a second choice |
| M-2 | Focus | Everything outside Marinduque is dimmed with a mask, using the province boundary already in `public/boundaries` |
| M-3 | Boundaries | Thin municipality lines, thinner barangay lines, labels that appear as the person zooms in |
| M-4 | Markers | One shape, colored by category group (Land preparation, Irrigation, Postharvest, Processing, Crop care, Harvesting, Planting), with a small icon inside. SSIP gets its own shape |
| M-5 | Clusters | Green circles sized by count, in the palette |
| M-6 | Shared spots | Records with the same coordinates stay reachable (24 in the seed data share a point) |
| M-7 | Choropleth | A single green ramp from light to dark. The gap view keeps a distinct color for barangays with no records |
| M-8 | Legend | A card in a corner that explains exactly what is on screen now, and collapses on phones |
| M-9 | Popup | A small card: name, type badge, status badge, beneficiary, year, and a link to the full record |
| M-10 | Controls | Zoom, layers, locate and full screen, styled as one group |
| M-11 | FMR (later) | A colored line with a white casing, dashed while not yet completed, labelled with its length |
| M-12 | Print | The print map (`reports/PrintMapDialog.tsx`) uses the same styles |

### Technical notes

- Stay on Leaflet with raster tiles. The site's security policy already allows map images from any HTTPS host.
- A vector basemap (MapLibre) would give sharper styling, but it needs the security policy opened to the tile host and a larger bundle. It's out of scope unless Phase 14 shows raster isn't good enough.
- Any tile provider needs its terms and free-tier limits checked, and its attribution shown.

---

## 9. Tools

### Design: Figma

Figma holds the final design. Claude builds from it.

| Step | What happens | Who |
|---|---|---|
| 1 | Create one Figma file with three pages: Tokens, Components, Screens | Owner or designer |
| 2 | Define tokens as Figma variables (color, type, spacing, radius) | Owner or designer |
| 3 | Build the components from [§5](#5-design-system), then six screens: Sign in, Home, Dashboard, Map, Interventions list, Intervention detail. Desktop and phone widths | Owner or designer |
| 4 | Export tokens to `design/tokens.json` and each screen as a PNG to `design/screens/` in this repo | Owner or designer |
| 5 | Claude turns `tokens.json` into CSS variables and builds each screen from its PNG | Claude |

Two ways to get the design to Claude:

| Way | Needs | Notes |
|---|---|---|
| **Files in the repo** (default) | A free Figma account, and a token export plugin such as Tokens Studio | Works everywhere. Claude reads small files once |
| **Figma MCP server** | A Figma seat with Dev Mode. Check the current plan requirements | Claude reads the selected frame directly, with sizes and variables. Less manual export |

### Suggested AI and map tools

Check each tool's current pricing and terms before relying on it.

| Tool | Use it for | Stage |
|---|---|---|
| Figma Make, Figma First Draft | A first draft of a screen from a text prompt, to edit by hand | Phase 11 |
| Google Stitch | Quick alternative layouts from a prompt or a screenshot, exportable to Figma | Phase 11 |
| v0 | A quick React mock-up to test a layout idea. Throwaway, not merged | Phase 11 |
| Felt | AI-assisted map making and styling in the browser. Good for trying marker and choropleth looks with the real data | Phase 11, 14 |
| Atlas | Browser GIS with AI help, for a second opinion on map styling | Phase 11, 14 |
| MapTiler Customize, Mapbox Studio | Designing a basemap in the palette | Phase 14 |
| Protomaps | A self-hosted basemap with no per-request cost, if a provider's limits become a problem | Phase 14, optional |
| Kepler.gl | Exploring the data on a map before deciding what the dashboard shows | Phase 10 |
| QGIS | The pending Shapefile check, and print-quality maps | Any |
| ColorBrewer | Choropleth color ramps that stay readable for color-blind people | Phase 11, 14 |

Upload only non-sensitive data to outside tools. Beneficiary names stay out of them unless the office allows it.

---

## 10. Token-saving working rules

| # | Rule | Why |
|---|---|---|
| T-1 | Decide the design in Figma. Don't iterate on visuals in chat | Each visual round trip costs a full build and review |
| T-2 | One phase per session. Start a fresh session for the next phase | A short context is cheaper and more accurate |
| T-3 | Start each session with: "Read `STATUS.md` and `docs/UI-UX-ROADMAP.md` §12, Phase N" | The two files carry everything forward |
| T-4 | Give Claude file paths, not pasted content | Claude reads only the parts it needs |
| T-5 | Give one cropped PNG per screen, not full-desktop screenshots | Images are costly, and browser chrome is noise |
| T-6 | Don't ask Claude to read the whole PDF report. Use the CSV | The CSV is small and exact |
| T-7 | Build tokens and shared components first (Phase 12) | Later screens reuse them instead of restyling |
| T-8 | Batch feedback: list every change for a screen in one message | One round instead of many |
| T-9 | Keep each phase small enough to review in one sitting | Smaller diffs, fewer corrections |

---

## 11. Delivery workflow and preview gates

**Nothing is committed before the owner has seen it running, and nothing reaches the live site before the owner has seen it on a preview address.**

```
branch ─► build ─► checks ─► GATE 1: local preview ─► commit + push
                                                          │
       live site ◄─ merge to main ◄─ GATE 2: draft deploy ◄┘
```

| Step | Action | Command |
|---|---|---|
| 1 | Start a branch for the phase | `git switch -c phase-N-<topic>` |
| 2 | Build the phase | |
| 3 | Run the checks | `npm run typecheck`, `npm test`, `npm run test:e2e` |
| 4 | **Gate 1: local preview.** The owner opens the app on this computer and approves | `npm run dev:local` for sample data in the browser, then `npm run build` and `npm run preview` for the built site |
| 5 | Update `STATUS.md`, commit, push the branch | Rules in [`STATUS.md`](../STATUS.md) |
| 6 | **Gate 2: draft deploy.** The owner opens a private preview address and approves | `npm run build`, then `npx netlify-cli deploy --dir=dist` (no `--prod`) |
| 7 | Merge into `main` and push | `git merge --no-ff phase-N-<topic>` |
| 8 | Deploy to the live site | `npm run deploy` |
| 9 | Check the live site, and note the result in `STATUS.md` | `npm run test:e2e:live` |

Notes:

- **A draft deploy uses the live database.** It's a preview of the interface, not a sandbox. Don't test imports or deletions there.
- Phase 12 adds an npm script, `deploy:preview`, for step 6, and a section on previews in `OPERATIONS.md`.
- If either gate is refused, the changes go back to step 2 on the same branch. Work in progress that must be kept is committed to the branch only, marked `WIP` in the subject, and never merged in that state.
- Phases 10 and 11 produce documents and designs, not code. Their gate is the owner's review of the document or the Figma file.

---

## 12. Phases

Phase numbers continue from the project history, which ends at Phase 9.

| Phase | Name | Output | Depends on |
|---|---|---|---|
| 10 | Design brief | Document | None |
| 11 | Figma design system and mock-ups | Figma file, `design/` exports | 10 |
| 12 | Foundation: tokens, shell, sign-in | Code | 11 |
| 13 | Home and Dashboard pages | Code | 12 |
| 14 | Map restyle | Code | 12 |
| 15 | Records, forms and work pages | Code | 12 |
| 16 | Farm-to-Market Roads | Code | 14, and the FMR data |
| 17 | Responsive, accessibility, polish, release | Code | 13, 14, 15 |

### Phase 10: Design brief

| | |
|---|---|
| **Goal** | Agree what is being designed before anyone designs it |
| **Branch** | `docs-design-brief` |
| **Scope** | Confirm the sidebar and routes in [§4](#4-information-architecture). List every screen and its states. Compare the PDF report with the seed data. Decide what the Home page and each dashboard card show |
| **Deliverables** | `docs/DESIGN-BRIEF.md` with the screen list, dashboard card list and any data differences found |
| **Done when** | The owner approves the brief, and every count in [§6](#6-data-scope) is confirmed or corrected |

### Phase 11: Figma design system and mock-ups

| | |
|---|---|
| **Goal** | A finished design the build can follow without guessing |
| **Branch** | `design-figma-exports` (for the exported files only) |
| **Scope** | Tokens, components, and six screens at desktop and phone widths ([§9](#9-tools)). Marker, cluster and legend designs |
| **Deliverables** | The Figma file. `design/tokens.json`. `design/screens/*.png` |
| **Done when** | The owner signs off the six screens. Text contrast passes AA. The exports are in the repo |

### Phase 12: Foundation

| | |
|---|---|
| **Goal** | The new shell around the existing pages, with nothing else changed |
| **Branch** | `phase-12-ux-foundation` |
| **Scope** | CSS variables from `tokens.json`. Self-hosted font. Icon set. Sidebar and top bar replacing the header in `src/app/App.tsx`. New routes `/map` and redirects from old addresses. Sign-in screen. Shared components: card, button, badge, notice, page header. The `deploy:preview` script |
| **Deliverables** | Shell, shared components, updated e2e helpers, a preview section in `OPERATIONS.md` |
| **Done when** | Every existing page opens inside the new shell. All existing tests pass. Old links and saved views still open the right place. The sidebar shows each role only its own links |

### Phase 13: Home and Dashboard pages

| | |
|---|---|
| **Goal** | The numbers on their own page, including what isn't on the map |
| **Branch** | `phase-13-dashboard` |
| **Scope** | Home page. Dashboard page at `/dashboard` reusing `lib/dashboard.ts` and `dashboard/Charts.tsx`. Filter bar. KPI tiles. Chart cards with Table and CSV buttons. Requirements NC-1 to NC-4 and NC-9. An empty FMR card labelled "Data to follow" |
| **Deliverables** | Two pages, tests for the new counts |
| **Done when** | Dashboard totals equal the records table and the exports under the same filters. The no-coordinates count matches the QA queue. The CSV opens in Excel with the verification sheet's columns |

### Phase 14: Map restyle

| | |
|---|---|
| **Goal** | A map that looks designed |
| **Branch** | `phase-14-map-style` |
| **Scope** | Requirements M-1 to M-10 and M-12, and NC-5 and NC-6. Restyle the layer panel, barangay profile and popups as cards |
| **Deliverables** | Restyled map, updated print map |
| **Done when** | The owner approves it against the Figma screen. Markers stay readable at province zoom. No record without coordinates appears. Editing, exports and the print map still work |

### Phase 15: Records, forms and work pages

| | |
|---|---|
| **Goal** | Every remaining page in the new design |
| **Branch** | `phase-15-pages` |
| **Scope** | Interventions list at `/records`. Intervention detail page with an audit trail card. Forms. QA queue, Condition check, Import. Reports. Admin pages. Requirement NC-7 |
| **Deliverables** | Restyled pages, shipped in two or three reviewable parts, each with its own gates |
| **Done when** | No page uses the old styles. `app.css` holds no unused rules. All tests pass |

### Phase 16: Farm-to-Market Roads

| | |
|---|---|
| **Goal** | FMR on the map and the dashboard |
| **Branch** | `phase-16-fmr` |
| **Blocked by** | The FMR data, and its format (KML, Shapefile, or a table of start and end points) |
| **Scope** | Activate the existing Farm-to-Market Road type. Import lines. Draw and reshape lines if needed (spec §5.4). Requirement M-11. Dashboard cards for count and total length. Roads without a traced line follow the rule in [§7](#7-records-without-coordinates) |
| **Deliverables** | The FMR layer, import path, dashboard cards |
| **Done when** | The FMR counts and total length match the source. Lines export to KMZ and open in Google Earth |

### Phase 17: Responsive, accessibility, polish and release

| | |
|---|---|
| **Goal** | Ready for daily use on any device |
| **Branch** | `phase-17-polish` |
| **Scope** | Phone and tablet layouts. Keyboard and screen-reader pass. Loading speed and bundle size (`scripts/check-bundle.ts`). Empty, loading and error states everywhere. A short user guide with screenshots |
| **Deliverables** | The release, the guide, an updated spec §10 checklist |
| **Done when** | The [definition of done](#14-definition-of-done) holds for the whole app |

---

## 13. Risks and open questions

### Risks

| # | Risk | Effect | Mitigation |
|---|---|---|---|
| R-1 | Moving the map from `/` to `/map` breaks saved views, shared links and tests | People land on the wrong page | Redirects with tests, in Phase 12 |
| R-2 | The e2e tests depend on today's markup and wording | Many tests fail at once | Change the shell first with pages untouched. Fix the test helpers once |
| R-3 | The security policy blocks outside fonts and vector tiles | Fonts or the basemap don't load on the live site only | Self-host fonts. Stay on raster tiles. Gate 2 catches this, because the policy applies on Netlify and not locally |
| R-4 | A tile provider's free tier runs out | The basemap stops loading | Check limits in Phase 14. Keep OpenStreetMap as a fallback |
| R-5 | A draft deploy writes to the live database | Test data in real records | Previews are for looking, not for imports or deletions |
| R-6 | The restyle changes behaviour by accident | Regressions | Existing tests must pass at every gate |
| R-7 | The Figma design drifts from what was built | Two sources of truth | Changes go into Figma first, then into `tokens.json` |

### Open questions

| # | Question | Needed by |
|---|---|---|
| Q-1 | Is the PDF in `Downloads` the 2026-10-21 report, or a newer one? | Phase 10 |
| Q-2 | Who designs in Figma, and is a Dev Mode seat available for the MCP server? | Phase 11 |
| Q-3 | What name and logo does the system use: "agri-dms", "Intervention Map", or both? | Phase 11 |
| Q-4 | Should the map stay the landing page for Viewers? | Phase 10 |
| Q-5 | In what format will the FMR data arrive, and with which fields? | Phase 16 |
| Q-6 | Which basemap provider is acceptable to the office? | Phase 14 |
| Q-7 | Will this system later sit inside agri-dms, or stay separate with the same look? | Phase 10 |

---

## 14. Definition of done

A phase is done when all of these hold:

- [ ] It matches the approved Figma screens.
- [ ] `npm run typecheck`, `npm test` and `npm run test:e2e` pass.
- [ ] The owner approved Gate 1 (local preview) before the commit.
- [ ] The owner approved Gate 2 (draft deploy) before the merge.
- [ ] `STATUS.md` is updated in the same commit, and the branch is pushed.
- [ ] The live site was checked after deploying.
- [ ] No record without verified coordinates appears on the map.
- [ ] Text contrast meets AA, and the new screens work by keyboard.

---

## 15. Change log

| Version | Date | Change |
|---|---|---|
| 0.1 | 2026-11-11 | First draft |
