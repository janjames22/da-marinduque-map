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
  - The UI/UX roadmap is a draft. Its open questions (§13) need answers, and the PDF report still has to be compared with the seed data.
- **Next:** Phase 10, the design brief, in [`docs/UI-UX-ROADMAP.md`](docs/UI-UX-ROADMAP.md) §12. No app code changes until the Figma design is signed off in Phase 11.

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

## Work log

New entries go at the top. Each entry gets the date, what was done, and the commit or branch.

### 2026-11-11

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
