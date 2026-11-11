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

- **Branch:** `main`, in sync with `origin/main`
- **Built:** Phases 1 to 9. Phase 9 includes the invite emails, which are sent through Gmail SMTP.
- **Open items:**
  - The Shapefile export still needs a manual check in QGIS. So far only automated tests check it.
  - ABE PDCS integration is only a proposal. The options are written up and nothing is merged.
  - Drawing lines and polygons on the map isn't built yet. Editing works for points only.
  - 27 records stay off the map until the region verifies their location: 26 with no coordinates, 1 outside Marinduque. See [`docs/DESIGN-BRIEF.md`](docs/DESIGN-BRIEF.md) §2.
  - UI/UX roadmap questions still open: Q-5 (FMR data format), Q-6 (basemap provider).
- **In progress:** Phase 11. The owner chose to have Claude draw the design on a claude.ai design canvas instead of building it in Figma. Figma's MCP server can draw in a file only on a paid plan. The six desktop screens are drawn: [Intervention Map Design](https://claude.ai/artifact/LvSgChD6pwXb7nXuZsv2Ze) (private to the owner). They follow `design/tokens.json` and use real report numbers.
- **Next:** the owner reviews the six desktop and six phone screens and leaves comments on the canvas. Phase 11 closes with the owner's sign-off. A Figma copy is optional. No app code changes until then.

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
| 11. Figma kit (first half of Phase 11) | `design-figma-kit` | 2026-11-11 | `design/tokens.json`, `design/kit-preview.html`, `design/FIGMA-GUIDE.md`. The Figma design itself is still to come |

## Work log

New entries go at the top. Each entry gets the date, what was done, and the commit or branch.

### 2026-11-11

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
