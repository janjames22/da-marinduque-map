# Project Status

The DA Marinduque Intervention Map is a web GIS for DA interventions across Marinduque's 218 barangays. It's built with React, Vite, TypeScript and Leaflet, runs on Supabase (database, logins, storage, live updates) and is hosted on Netlify.

- Spec: [`docs/spec/DA-Marinduque-Intervention-Map-Spec.md`](docs/spec/DA-Marinduque-Intervention-Map-Spec.md). §9 covers build phases and §10 covers acceptance criteria.
- Running and deploying: [`docs/OPERATIONS.md`](docs/OPERATIONS.md)
- ABE PDCS options: [`docs/ABE-PDCS-INTEGRATION.md`](docs/ABE-PDCS-INTEGRATION.md)
- UI/UX roadmap: [`docs/UI-UX-ROADMAP.md`](docs/UI-UX-ROADMAP.md). Phases 10 to 17, with a preview before each commit and each deployment.

**Keep this file current.** Every piece of work updates it in the same commit, and gets pushed to GitHub right away (see [How we commit and push](#how-we-commit-and-push)).

---

## Current state

_Last updated: 2026-11-12_

- **Branch:** `phase-15c-admin-forms`, started from `phase-15b-work-pages`. Phase 15a is merged into `main`.
- **Phase 15c built, waiting for Gate 1:** the Admin pages, the forms and the shared controls in the new design, and the old styles taken out of `app.css`. Committed as work in progress until the owner approves it. As 15c is built on 15b, one Gate 2 draft can cover both.
- **Phase 16 after 15c:** the owner decided on 2026-11-12 to finish 15c first, then build Phase 16 (Farm-to-Market Roads) without the FMR data, on made-up sample roads. The real import gets checked when the data comes (Q-5).
- **Phase 15b through Gate 1, draft up for Gate 2:** the QA queue, Condition check, Import and Reports pages and the Export and Print map dialogs in the new design. The owner approved Gate 1 on 2026-11-12. Draft: https://6af5bbfd98ca670dce805e44--da-marinduque-map.netlify.app.
- **Going live in one deploy:** to save Netlify credits, 15a, 15b and 15c go live together with one `npm run deploy` after 15c, instead of one deploy each. Each production deploy costs 15 credits, and drafts cost none. The owner decided this on 2026-11-12. Until then the live site stays on Phase 14.
- **Phase 15a approved, live deploy pending:** the Interventions pages, the phone map rework and the faster page changes passed both gates on 2026-11-12 and are merged into `main`. They go live when the owner runs `npm run deploy`.
- **Built:** Phases 1 to 9. Phase 9 includes the invite emails, which are sent through Gmail SMTP.
- **Open items:**
  - The Shapefile export still needs a manual check in QGIS. So far only automated tests check it.
  - ABE PDCS integration is only a proposal. The options are written up and nothing is merged.
  - Drawing lines and polygons on the map isn't built yet. Editing works for points only.
  - 27 records stay off the map until the region verifies their location: 26 with no coordinates, 1 outside Marinduque. See [`docs/DESIGN-BRIEF.md`](docs/DESIGN-BRIEF.md) §2.
  - UI/UX roadmap questions still open: Q-5 (FMR data format), Q-6 (basemap provider).
  - Laptop screens: since Phase 14 the map opens without the dashboard panel, so it has room at 1280 px. With the panel opened at that width, Wider can still only widen a little. The computer tests run at 1440 px.
- **Built:** Phases 10 and 11 of the UI/UX roadmap. The design is signed off: 6 desktop and 6 phone screens on the [Intervention Map Design](https://claude.ai/artifact/LvSgChD6pwXb7nXuZsv2Ze) canvas (private to the owner), with its source backed up in [`design/canvas/`](design/canvas/README.md).
- **Office name, decided at sign-off:** "Intervention Map" with "Provincial Agriculture Office Marinduque" underneath, and the footer line "Provincial Agriculture Office, Marinduque". "Department of Agriculture –" is dropped.
- **Built:** Phase 12, the foundation, through both gates on 2026-11-11. It brings the design tokens as CSS, the Inter font, the Lucide icons, the new sidebar and top bar, the new sign-in screens, and the map at `/map` with old addresses redirected.
- **Live:** Phase 12 is on https://da-marinduque-map.netlify.app since 2026-11-11. The owner deployed it with `npm run deploy`, because Claude Code's permissions don't let Claude deploy to production. Checked signed out: the security headers are on, Inter loads, and the only blocked script is Netlify's own badge, which is known since Phase 9.
- **Live:** Phase 13, the Home and Dashboard pages, is on https://da-marinduque-map.netlify.app since 2026-11-11 (deploy `6af47bcaae5f3dff886714f1`). Checked signed out: the security headers are on and Inter loads. The only blocked script is Netlify's badge, as before.
- **Live:** Phase 14, the map restyle, is on https://da-marinduque-map.netlify.app since 2026-11-12 (deploy `6af4953cc6a4eec06e04faca`). Checked signed out: the security headers are on, Inter loads, and the new map code is served. The only blocked script is Netlify's badge, as before.
- **Next:** Phase 15, the remaining pages in the new design, in three parts: 15a the Interventions list and record page, with the phone map and speed fixes (merged), 15b the QA queue, Condition check, Import and Reports, 15c the Admin pages, forms, and removing the old styles.
- **Report PDFs keep the full header:** "Department of Agriculture – Provincial Agriculture Office, Marinduque" stays on the reports, as official documents. Only the app's screens use the shorter office name. The owner decided this on 2026-11-11.

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
| 15a. Interventions pages | `phase-15a-records` | 2026-11-12 | The Interventions list at `/records` and a page per record, the owner's phone map fixes (one row of buttons, layers as a sliding sheet, folded legend), transitions, data loaded once per sign-in for faster page changes, and Philippine dates for saved times |
| 14. Map restyle | `phase-14-map-style` | 2026-11-11 | Light basemap, dimmed outside the province, green clusters, card-style map parts, the dashboard panel closed by default, an on-the-map count, and fixes for record popups and page overflow. Live |
| 13. Home and Dashboard | `phase-13-dashboard` | 2026-11-11 | Home at `/` with work waiting and a card per type, and the Dashboard page with shared filters, CSVs and the list of records awaiting coordinate verification. Live |
| 12. Foundation | `phase-12-ux-foundation` | 2026-11-11 | Design tokens as CSS, Inter font, Lucide icons, the new sidebar, top bar and sign-in screens, the map at `/map` with old links redirected, and `npm run deploy:preview`. Live |

## Work log

New entries go at the top. Each entry gets the date, what was done, and the commit or branch.

### 2026-11-12

- Phase 15c finished on branch `phase-15c-admin-forms`, ready for Gate 1:
  - **Fixed:** on a phone, tapping the menu link of the page already open left the menu over the page, as the address didn't change. Every menu link now closes it (`src/app/shell/AppShell.tsx`).
  - **Signature blocks test:** that list is the only one on its page, so its Add button is in the page header, outside the list. The test looks for it there now.
  - **Wording:** the Reports page links to "Signature blocks" by its new name, and `docs/OPERATIONS.md` names the Administration pages and their tabs instead of "Admin in the header", which went in Phase 12.
  - **Old styles:** no class in `app.css` is unused. The three unused classes left in `shell.css` are variants of the shared badge and notice, kept for the screens to come.
  - **Checks:** typecheck, 1,120 unit tests, and the production build with its check for private data. The full e2e run had 669 passed, 5 failed and 11 skipped. All 5 pass when run again, and the 8 that failed in the run before passed in this one, so both runs' failures came from load during the long run.
- Phase 15c, work in progress committed on branch `phase-15c-admin-forms`, so it isn't lost. Not yet through Gate 1:
  - **Admin pages:** each has its own sidebar link. Types and fields (Intervention types, Barangay fields) and Lists (Categories, Programs, Statuses, Other lists) are pages with tabs. The old Admin menu down the side is gone. Styles in `admin/admin.css`.
  - **Shared controls:** buttons, fields, hints, errors and notices in the new design, in `src/app/controls.css`. About 750 lines of old rules are out of `app.css`.
  - **Record page:** a Change history card shows Encoders and Admins the audit trail, newest first, from the new `edit/ChangeHistory.tsx`, which the map's History panel shares.
  - **Checks:** typecheck passes. The full e2e run had 666 passed, 8 failed and 11 skipped. The failures: the signature blocks test (computer and phone), a beneficiary profile test, the phone Admin menu test, one computer barangay editing test, and three phone marker-moving tests that have stalled in long runs before.
- Decided with the owner: finish Phase 15c first, then build Phase 16 without the FMR data.
- Phase 15b passed Gate 1, approved by the owner. The Gate 2 draft is up: https://6af5bbfd98ca670dce805e44--da-marinduque-map.netlify.app. Checked signed out: the security headers are on, Inter loads, and there are no console errors or blocked requests.
- Decided with the owner: Phase 15 goes live in one production deploy after 15c, to save Netlify credits.
- Phase 15b finished on branch `phase-15b-work-pages`, ready for Gate 1:
  - **Export and Print map dialogs** in the new design (design brief screens 29 and 30). They share one frame, `overview/Dialog.tsx`, which has a title with a line under it, a round close button, a body that scrolls, and Cancel and the main button along the bottom. On a phone the dialog rises from the bottom as a sheet, like the map's layers.
  - **Export:** the formats are cards with the chosen one outlined in green, and the filters in force are chips. The count and the file name sit beside Download, so they stay in view however far the choices scroll. Notes about records that can't be plotted are in a notice.
  - **Print map:** the hint is a notice, and Paper and Orientation sit side by side on a computer.
  - **Keyboard:** Escape closes a dialog, Tab stays inside it, and closing puts the focus back on the button that opened it. A new test in `e2e/export.spec.ts` checks this.
  - The old `.export-dialog` styles are gone from `app.css`.
  - **Checks:** typecheck, 1,120 unit tests, and the production build with its check for private data. The full e2e run had 670 passed, 0 failed and 11 skipped, and the new keyboard test passes on a computer and a phone.
  - **Noticed, not fixed:** in the long e2e run the dev server once logged a Leaflet error (`layerPointToContainerPoint` of null) from `revealMarker` in `InterventionLayer.tsx`. A record's popup opened after the map had already closed. No test failed because of it.
- Phase 15b started on branch `phase-15b-work-pages`, committed and pushed as work in progress. Not yet through Gate 1:
  - **QA queue, Condition check and Import** are each their own page now, reached from the sidebar under Records. The old "QA and import" tabs are gone, and an unknown address under them opens the QA queue. Each page has a page header, a filter bar card, and cards for its lists.
  - **Import** shows its steps as a stepper, and Earlier imports is a card with an Undone badge on undone batches.
  - **Reports** lists the four reports as cards with an icon and the format of each (PDF, A4; PDF or Excel, legal; and so on), and the signature blocks sit in their own card. The Municipal, Beneficiary and Inventory report pages are restyled to match.
  - **Shared parts:** an `EmptyState` card for empty lists, and new button, badge, notice and page-tab styles in `src/app/shell.css`. The work and report styles moved out of `app.css` into `work/work.css` and `reports/reports.css`.
  - **Tests updated** for the new page landmarks and headings: `e2e/work.spec.ts`, `e2e/reports.spec.ts`, and one line of `e2e/auth.spec.ts`.
  - **Checks:** typecheck, 1,120 unit tests, and the production build with its check for private data. The full e2e run had 670 passed, 0 failed and 11 skipped. Its first pass had 7 failures. Three were the `auth.spec.ts` line still looking for the old QA queue region, and they pass after the fix. The other four were mobile map editing tests that stalled for 28 minutes in the long run, and all 56 mobile editing tests pass when run again on their own.
- Phase 15a passed Gate 2 and is merged into `main`. Going live waits for the owner to run `npm run deploy`.
- Phase 15a, second round, through Gate 1. The owner tried the live map on a phone and found the buttons overlapping, the layers panel covering the map, and each page slow to open:
  - **Phone map:** one row of buttons over the map (Layers; + Add, Export and Print as icon buttons), the layers panel as a sheet that slides up with the map dimmed behind it and its own close button, the legend folded into a Legend button, zoom at the bottom right, Map / Dashboard / List as one rounded switch, and the sources on one line. Styles in `src/app/map-phone.css`; the computer layout is unchanged.
  - **Transitions:** the sheet slides, the backdrop fades, panels rise in, the legend fades open, buttons give when pressed, and pages fade in. All off when the device asks for less motion.
  - **Speed:** the data loads once per sign-in and every page shares it (`useMapData` keeps one session, with live updates), instead of each page loading the boundaries and every table again. The other pages' code is fetched in the background once the first page is up, and "Loading…" only shows after 0.3 s. On the local dev server, Home, Interventions and the Map now open in about 0.3 to 0.5 s.
  - **Checks:** typecheck, 1,120 unit tests, and the full e2e run with 670 passed. Five phone tests were updated for the folded legend and the one-row toolbar.
- Phase 14 is live (deploy `6af4953cc6a4eec06e04faca`), deployed by the owner from `main`. The Phase 15a work was set aside first, so only Phase 14 went out.
- Known bug found by the tests after midnight: a few dates (QA dismissals, last sign-in, deleted records) show the UTC date, so between midnight and 8 a.m. Philippine time they show the day before. Fixed on `phase-15a-records` with one helper, `manilaDate()`.
- Phase 15a built and through Gate 1, on branch `phase-15a-records`:
  - **Interventions list** at `/records`: every record, with the same filters as the Dashboard and the map, a count per type, search, sorting and Export this table. Records without coordinates carry a "No coordinates yet" badge. Add intervention (Encoders and Admins) opens the map.
  - **Record page** at `/records/:id`: details with the custom fields, location with Google Maps and map links, status history, QA flags and photos. A record without coordinates says it is not on the map, links to the list for the region to verify, and gives editors "Enter verified coordinates". A missing record gets a not-found message.
  - **Addresses and sidebar:** `/records/:id` is now the record page and no longer redirects to the map, which keeps `/map/records/:id`. Interventions is first under Records, and Viewers get it too.
  - **Also fixed:** the Program filter stuck out of its card on phones, on the Dashboard too.
  - **Checks:** typecheck, 1,120 unit tests, and the full e2e run with 668 passed. Its only 2 failures were the date bug, and those tests pass after the fix.

### 2026-11-11

- Phase 14 passed Gate 2 and is merged into `main`. Going live waits for the owner to run `npm run deploy`.
- Phase 14 built and through Gate 1, on branch `phase-14-map-style`. The owner's brief was that the map overwhelmed users:
  - **Calmer map:** a Light grey basemap by default (Esri World Light Gray, with labels; OpenStreetMap and the others are still offered), the area outside Marinduque dimmed, lighter barangay shading and lines, green group markers with a halo, and card-style buttons, legend, popup and zoom controls.
  - **Less at once:** the dashboard panel beside the map starts closed and opens from its button, remembered per person. A header shows "X of Y records are on the map", with a link to the list of records waiting for coordinates. The layers card has Filters first, then layers and shading, then Map style and Shortcuts.
  - **Phones:** a one-line note, no duplicate Dashboard button, smaller buttons and legend.
  - **Fixed:** a link straight to a record could leave its popup closed, when the map re-grouped the markers while settling. It reopens now.
  - **Fixed:** in a short window, hidden labels and chart tooltips stretched the page past the frame onto blank space. The scrolling panels now contain them, and a new test checks six pages.
  - **Not done, as decided at Gate 1:** the filters stay in the left card rather than a bar above the map.
  - **Tests:** 1,119 unit tests passed. 652 end-to-end tests passed, 0 failed, 11 skipped.
- Phase 13 is live: the owner ran `npm run deploy`, and it was checked signed out on the live site.
- Phase 13 passed Gate 2 and is merged into `main`.
- Phase 13 built and through Gate 1, on branch `phase-13-dashboard`:
  - **Home at `/`:** a welcome banner, work waiting for Encoders and Admins, headline tiles, a card per type, and an FMR "Data to follow" card. Every figure counts every record.
  - **Dashboard at `/dashboard`:** filters shared with the map, the tiles, units by category group, the five charts with Show table and a logged CSV, and the list of records awaiting coordinate verification with **Download verification sheet**.
  - **Sidebar:** Home and Dashboard links added. Unknown addresses now open Home.
  - **Fixed:** in local mode, Discard local changes now reloads the map, not Home.
  - **Tests:** 1,119 unit tests passed, 7 of them new. 648 of 650 end-to-end tests passed, plus 11 skipped. The 2 that failed were the Discard bug above, and they pass after the fix. 14 new end-to-end tests cover Home and the Dashboard.
  - **Owner at Gate 1:** "all features in the UI/UX is good except the map", which goes to Phase 14.
- Phase 12 is live: the owner ran `npm run deploy`, deploy `6af4714978e1a6e0c7c26959`. Checked signed out on the live site.
- Phase 12 Gate 2 approved by the owner, and merged into `main` (`68b573f`).
- Phase 12 Gate 2 draft is up: https://6af46f36d1b297e398bd44b9--da-marinduque-map.netlify.app.
  - **Setup on this computer:** `.env.local` is in place, `npm run check:supabase` passes all 16 checks (1,167 records, 2 Admins), and the folder is linked to the `da-marinduque-map` Netlify site.
  - **Draft checked signed out:** it loads under the real security headers, Inter loads, and there are no console errors.
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
