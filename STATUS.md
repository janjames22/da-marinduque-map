# Project Status

The DA Marinduque Intervention Map is a web GIS for DA interventions across Marinduque's 218 barangays. It's built with React, Vite, TypeScript and Leaflet, runs on Supabase (database, logins, storage, live updates) and is hosted on Netlify.

- Spec: [`docs/spec/DA-Marinduque-Intervention-Map-Spec.md`](docs/spec/DA-Marinduque-Intervention-Map-Spec.md). §9 covers build phases and §10 covers acceptance criteria.
- Running and deploying: [`docs/OPERATIONS.md`](docs/OPERATIONS.md)
- ABE PDCS options: [`docs/ABE-PDCS-INTEGRATION.md`](docs/ABE-PDCS-INTEGRATION.md)
- UI/UX roadmap: [`docs/UI-UX-ROADMAP.md`](docs/UI-UX-ROADMAP.md). Phases 10 to 17, with a preview before each commit and each deployment.

**Keep this file current.** Every piece of work updates it in the same commit, and gets pushed to GitHub right away (see [How we commit and push](#how-we-commit-and-push)).

---

## Current state

_Last updated: 2026-11-11_

- **Branch:** `phase-12-ux-foundation`, pushed, not merged into `main` until Gate 2
- **Built:** Phases 1 to 9. Phase 9 includes the invite emails, which are sent through Gmail SMTP.
- **Open items:**
  - The Shapefile export still needs a manual check in QGIS. So far only automated tests check it.
  - ABE PDCS integration is only a proposal. The options are written up and nothing is merged.
  - Drawing lines and polygons on the map isn't built yet. Editing works for points only.
  - 27 records stay off the map until the region verifies their location: 26 with no coordinates, 1 outside Marinduque. See [`docs/DESIGN-BRIEF.md`](docs/DESIGN-BRIEF.md) §2.
  - UI/UX roadmap questions still open: Q-5 (FMR data format), Q-6 (basemap provider).
  - Laptop screens (below 1440 px): the full sidebar leaves the map page squeezed, and the dashboard's Wider button can't widen. To fix in Phase 14. The computer tests run at 1440 px until then.
  - This computer has no `.env.local` yet, so it can't build a draft (Gate 2) or deploy, and nobody can sign in to a local copy. The owner adds it from their safe copy of the keys.
- **Built:** Phases 10 and 11 of the UI/UX roadmap. The design is signed off: 6 desktop and 6 phone screens on the [Intervention Map Design](https://claude.ai/artifact/LvSgChD6pwXb7nXuZsv2Ze) canvas (private to the owner), with its source backed up in [`design/canvas/`](design/canvas/README.md).
- **Office name, decided at sign-off:** "Intervention Map" with "Provincial Agriculture Office Marinduque" underneath, and the footer line "Provincial Agriculture Office, Marinduque". "Department of Agriculture –" is dropped.
- **In progress:** Phase 12, the foundation. It's built, and it passed Gate 1 (the owner's local preview) on 2026-11-11. It brings the design tokens as CSS, the Inter font, the Lucide icons, the new sidebar and top bar, the new sign-in screens, and the map at `/map` with old addresses redirected.
- **Next:** Gate 2. Once `.env.local` is on this computer, `npm run deploy:preview` makes a private Netlify draft for the owner to check. When it's approved, merge into `main` and run `npm run deploy`. Then Phase 13: the Home and Dashboard pages.

## Phases completed

The phases were built in a different order from the spec's §9. Export came before Admin customization and Custom views, so the history numbers them differently from the spec. The table below uses the history's numbers.

| Phase | Branch | Merged | Outcome |
|---|---|---|---|
| 1. Data prep | `main` | 2026-11-05 | Project scaffold, core schema, Marinduque boundaries, RAED seed CSV loaded |
| 1b. Schema revision | `phase-1b-schema` | 2026-11-05 | Spec v2.0 for the whole province, customizable intervention types, SPIS folded into SSIP |
| 2. Barangay base layer | `phase-2-barangay-layer` | 2026-11-05 | All 218 barangays, profiles, choropleth |
| 3. On-map editing | `phase-3-editing` | 2026-11-05 | Point editing on the map |
| 4. Supabase switch | `phase-4-supabase` | 2026-11-06 | Logins, roles, storage, live updates |
| 5. Export | `phase-5-export` | 2026-11-06 | KMZ, KML, CSV, GeoJSON and Shapefile exports |
| 6. Admin customization | `phase-6-admin` | 2026-11-07 | Admin customization, Users page, live test fixes |
| 7. Dashboard and views | `phase-7-dashboard`, `phase-7-fixes`, `phase-7-assessed` | 2026-11-08 | Dashboard, records table, custom views, audit log page; % operational counts only assessed units |
| 8. Import and QA | `phase-8-import`, `phase-8-fixes` | 2026-11-09 | Import wizard, QA queue, condition check, backup names with the time, Undo after import |
| 9. Reports | `phase-9-reports`, `phase-9-fixes` | 2026-11-09 | Reports, print map, signature blocks, ABE PDCS write-up |
| Docs: invite emails | `docs-email` | 2026-11-09 | Invite emails set up through Gmail SMTP |
| 10. Design brief | `docs-design-brief` | 2026-11-11 | PDF report confirmed against the data, routes and sidebar, 36-screen inventory, Home and Dashboard content, Figma handoff. Owner decisions: name "Intervention Map", Home for everyone, separate from agri-dms |
| 11. Design | `design-figma-kit`, `design-canvas-signoff` | 2026-11-11 | Tokens, kit preview and Figma guide, then 12 screens on a claude.ai design canvas, signed off by the owner. Source in `design/canvas/` |

## Work log

New entries go at the top. Each entry gets the date, what was done, and the commit or branch.

### 2026-11-11

- Phase 12 built and through Gate 1, on branch `phase-12-ux-foundation`:
  - **Look and frame:** `design/tokens.json` turned into `src/app/tokens.css` by `npm run build:tokens`, with a test that keeps the two in step. Inter is bundled with the site, and Lucide gives the icons. A new sidebar (grouped by role), a top bar with an account menu, a drawer on phones, and a two-panel sign-in.
  - **Addresses:** the map moved to `/map`. Old links to `/`, `/barangays/…` and `/records/…` redirect.
  - **Previews:** added `npm run deploy:preview` for Gate 2, documented in `docs/OPERATIONS.md`.
  - **Tests:** the end-to-end tests now use the sidebar, and computer screens are tested at 1440 px. Results: 1,112 unit tests passed, 636 end-to-end tests passed, 0 failed, 11 skipped. The production build passes its check for private data.
  - **The 4 phone QA and import tests that failed in the baseline run** passed in this run and again one at a time. They failed only in the slow first run.
  - **Undone at the owner's request:** an icon-only sidebar for laptop screens was tried and taken out.
- Fixed a flaky unit test, "adds a units column only when a record holds several" (`tests/reports.test.ts`). It changed whichever record came first, but records are sorted by random ids, so about 1 run in 50 it picked an SSIP and failed. It now picks a Farm Machinery record. All 1,102 tests pass. Branch `fix-flaky-units-test`. Also ran `npm install` on this computer for the first time.
- Phase 11 done: the owner signed off the design, including their own edits (office name written out on Sign in, smaller ID and item text in the Interventions list). The office wording now reads the same on every screen and in the docs. The canvas source is backed up in `design/canvas/`. Branch `design-canvas-signoff`.
- Phase 11: Claude drew the six phone screens (390 px) on the same canvas: Sign in, Home, Home with the menu open, Dashboard, Map with the selected record in a bottom sheet, and Intervention detail.
- Phase 11: Claude drew the six desktop screens (Sign in, Home, Dashboard, Map, Interventions list, Intervention detail) and a shared sidebar on a claude.ai design canvas, on the owner's choice over a paid Figma plan. The Map screen uses the real municipality boundaries. Waiting for the owner's review.
- Phase 11 started: added the Figma kit in `design/`, approved by the owner at Gate 1. Tokens in W3C format for Tokens Studio, a browser preview of the look, and a build guide with every component and frame, filled with real report numbers. Map and chart colors stay as they are in the app. Branch `design-figma-kit`.
- Phase 10 done: added `docs/DESIGN-BRIEF.md`, approved by the owner. The PDF report (2026-10-21) matches the seed data: 199 records, 195 Farm Machinery, 4 SSIP, every municipality. Branch `docs-design-brief`.
- Added `docs/UI-UX-ROADMAP.md`: the plan to restyle the app after the agri-dms sample, in Phases 10 to 17, with Figma as the design source, preview gates, and the rule that records without coordinates are counted on the dashboard and kept off the map.
- Cloned the repo locally and added this `STATUS.md` to track status and work.

---

## How we commit and push

So that no work gets lost:

1. **Commit each logical piece of work as soon as it's done.** Don't leave work uncommitted at the end of a session.
2. **Push right after committing:** `git push origin <branch>`. Work that is only on this computer isn't safe.
3. **Update this file in the same commit:** the work log, current state and open items.
4. **Larger work goes on a branch** named after the phase or topic, like `phase-10-<topic>` or `docs-<topic>`. Merge it into `main` with `git merge --no-ff` and a message like `Merge phase-10-<topic>: <what it adds>`. Then push both `main` and the branch.
5. **Before committing, check the work:** `npm run typecheck` and `npm test`. Also run `npm run build` when the build could be affected.
6. **Never commit secrets.** `.env.local` is ignored by git and has to stay that way.

### Commit messages

Follow the existing history:

- The subject is a short, plain-English summary in sentence case. Keep it to 72 characters or fewer, with no trailing period. Write it as a command ("Add", "Fix", "Count only…"), not a past-tense report.
- Use a prefix when it helps: `Phase N: …` for phase work, `Docs: …` for documentation only.
- When the reason isn't obvious, add a body after a blank line that explains **why**.

Examples from this repo:

```
Phase 9: reports, print map, signature blocks, ABE PDCS write-up
Count only assessed units in % operational
Docs: invite emails are set up through Gmail SMTP
Merge phase-8-fixes: Undo on the page that says an import came in
```
