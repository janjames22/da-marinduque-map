# Project Status

The DA Marinduque Intervention Map is a web GIS for DA interventions across Marinduque's 218 barangays. It's built with React, Vite, TypeScript and Leaflet, runs on Supabase (database, logins, storage, live updates) and is hosted on Netlify.

- Spec: [`docs/spec/DA-Marinduque-Intervention-Map-Spec.md`](docs/spec/DA-Marinduque-Intervention-Map-Spec.md). §9 covers build phases and §10 covers acceptance criteria.
- Running and deploying: [`docs/OPERATIONS.md`](docs/OPERATIONS.md)
- ABE PDCS options: [`docs/ABE-PDCS-INTEGRATION.md`](docs/ABE-PDCS-INTEGRATION.md)
- UI/UX roadmap: [`docs/UI-UX-ROADMAP.md`](docs/UI-UX-ROADMAP.md). Phases 10 to 17, with a preview before each commit and each deployment.

**Keep this file current.** Every piece of work updates it in the same commit, and gets pushed to GitHub right away (see [How we commit and push](#how-we-commit-and-push)).

---

## Current state

_Last updated: 2026-11-13_

- **Branch:** `phase-16b-line-drawing`, with Phase 16b at Gate 2. `fix-legend-over-marker` holds the fix for a marker left under the legend after a move, waiting for the owner's go-ahead to merge. `main` is in sync with `origin/main`, with Phases 15b, 15c and 16a merged.
- **The live site's address is now https://marinduque-intervention-system.netlify.app:** the owner renamed the Netlify site from `da-marinduque-map` on 2026-11-13. It's the same site (the same site id since 2026-11-11), still on Phase 15a. **https://da-marinduque-map.netlify.app returns 404**, as Netlify doesn't redirect an old name, so old links and bookmarks need the new address. Drafts are now at `<deploy id>--marinduque-intervention-system.netlify.app`. The earlier entries keep the old address, as it was then. `APP_URL` in `.env.local` has the new address. The owner is setting it in Supabase too (Authentication > URL Configuration: the Site URL, and a Redirect URL), which invites and password resets from the Users page need.
- **Phase 16b passed Gate 1, Gate 2 draft up:** drawing and reshaping a road's line on the map, in its Edit form and its Resolve flag form, on `phase-16b-line-drawing`. Draft: https://6af66f8a66ca57d040704c9b--marinduque-intervention-system.netlify.app. See the work log.
- **Phase 16a approved, live deploy pending:** Farm-to-Market Roads on the map and the dashboard, on made-up sample roads in local mode, passed both gates on 2026-11-13 and is merged into `main`. It goes live with 15b, 15c, the rest of 16 and 17 in the one deploy after Phase 17. Phase 16 comes in three parts: 16a roads on the map and the dashboard, 16b drawing and reshaping lines, 16c importing lines.
- **Live database is on `0013`:** `0012_lines.sql` and `0013_line_drawing.sql` were applied on 2026-11-13 at the owner's go-ahead, after a backup. 0012 lets a line type be switched on and a road wait for its traced line, and switches nothing on. 0013 lets the save functions take a road's line, and points save as before. The live 15a screens still refuse to switch on any type that isn't a point, so the road type can't be switched on there until the new screens are deployed.
- **0013 is applied but on the 16b branch only:** `main` doesn't have the file yet, which `npm run check:supabase` allows, as it only looks for missing files. An applied file must not be edited, so if Gate 1 asks for a change to the save functions, it goes in a new `0014` file.
- **Phases 15b and 15c approved, live deploy pending:** the work pages, Reports, the Export and Print map dialogs, the Admin pages, the forms and the shared controls passed both gates on 2026-11-12 and are merged into `main`. Until the next production deploy the live site is on Phase 15a.
- **Next production deploy after Phase 17:** the owner decided on 2026-11-12 to hold the live deploy until Phase 17 is done, so 15b, 15c, 16 and 17 go live in one `npm run deploy`, one 15-credit deploy instead of three. Every phase still gets its Gate 2 draft, which costs nothing. Only approved work is merged into `main`, so a deploy from it stays safe if a live bug needs one sooner. Phase 16's database changes are already on the live database, so they have to keep working with the 15a site.
- **Next:** Gate 2 for Phase 16b, then 16c, then Phase 17. The owner decided on 2026-11-12 to build Phase 16 without the FMR data, on made-up sample roads. The real import gets checked when the data comes (Q-5).
- **Built:** Phases 1 to 9. Phase 9 includes the invite emails, which are sent through Gmail SMTP.
- **Open items:**
  - The Shapefile export still needs a manual check in QGIS. So far only automated tests check it.
  - ABE PDCS integration is only a proposal. The options are written up and nothing is merged.
  - Drawing polygons on the map isn't built yet. Roads are drawn on the map since Phase 16a. Drawing and reshaping a road's line is on the 16b branch, not yet through Gate 1, and importing lines is 16c.
  - A road whose line is in several parts, as an import can bring in, can't be reshaped in its form. Its line stays as it is through an edit.
  - Flaky test, older than 16b: "a plain move needs no reason, takes a note if given, and leaves a flag in place" (`e2e/editing.spec.ts`, computer) fails about 2 times in 10, on `main` as on the 16b branch. The popup's pan leaves the marker near the bottom of the map, and once the move closes the popup, the legend comes back over the marker, so the test's click lands on the legend or the zoom buttons. A person who moves a marker there would find it under the legend too.
  - The inventory report lists roads in its project layout, with no Length column and blank Latitude and Longitude. A road layout with the length could follow once the FMR data shows what the region reports.
  - Roads count under "No group" in Units by category group, as they have no category.
  - A road is dashed while its status is named Proposed or On-going. The status list has no codes, so renaming those two statuses would stop the dashes.
  - 27 records stay off the map until the region verifies their location: 26 with no coordinates, 1 outside Marinduque. See [`docs/DESIGN-BRIEF.md`](docs/DESIGN-BRIEF.md) §2.
  - UI/UX roadmap questions still open: Q-5 (FMR data format), Q-6 (basemap provider).
  - Laptop screens: since Phase 14 the map opens without the dashboard panel, so it has room at 1280 px. With the panel opened at that width, Wider can still only widen a little. The computer tests run at 1440 px.
- **Built:** Phases 10 and 11 of the UI/UX roadmap. The design is signed off: 6 desktop and 6 phone screens on the [Intervention Map Design](https://claude.ai/artifact/LvSgChD6pwXb7nXuZsv2Ze) canvas (private to the owner), with its source backed up in [`design/canvas/`](design/canvas/README.md).
- **Office name, decided at sign-off:** "Intervention Map" with "Provincial Agriculture Office Marinduque" underneath, and the footer line "Provincial Agriculture Office, Marinduque". "Department of Agriculture –" is dropped.
- **Built:** Phase 12, the foundation, through both gates on 2026-11-11. It brings the design tokens as CSS, the Inter font, the Lucide icons, the new sidebar and top bar, the new sign-in screens, and the map at `/map` with old addresses redirected.
- **Live:** Phase 12 is on https://da-marinduque-map.netlify.app since 2026-11-11. The owner deployed it with `npm run deploy`, because Claude Code's permissions don't let Claude deploy to production. Checked signed out: the security headers are on, Inter loads, and the only blocked script is Netlify's own badge, which is known since Phase 9.
- **Live:** Phase 13, the Home and Dashboard pages, is on https://da-marinduque-map.netlify.app since 2026-11-11 (deploy `6af47bcaae5f3dff886714f1`). Checked signed out: the security headers are on and Inter loads. The only blocked script is Netlify's badge, as before.
- **Live:** Phase 14, the map restyle, is on https://da-marinduque-map.netlify.app since 2026-11-12 (deploy `6af4953cc6a4eec06e04faca`). Checked signed out: the security headers are on, Inter loads, and the new map code is served. The only blocked script is Netlify's badge, as before.
- **Live:** Phase 15a, the Interventions pages, the phone map rework and the faster page changes, is on https://da-marinduque-map.netlify.app since 2026-11-12 (deploy `6af4ffdaa684b00e692f1740`). Claude ran `npm run deploy` from `main` at the owner's request. Checked signed out: the security headers are on, Inter loads, `/records` is served, and none of the Phase 15b work went out. The only blocked script is Netlify's badge, as before.
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
| 16a. Roads on the map | `phase-16-fmr` | 2026-11-13 | Line types can be switched on (`0012_lines.sql`, applied live 2026-11-13), roads drawn with a white casing, dashed while unfinished and labelled with their length, road km on Home and the Dashboard, a road's length and barangays on its page, local mode's rules for lines, and 8 sample roads in local mode only |
| 15c. Admin pages and forms | `phase-15c-admin-forms` | 2026-11-12 | Admin pages each with a sidebar link, Types and fields and Lists with tabs, shared buttons, fields and notices in the new design, a Change history card on the record page, and the old styles out of `app.css` |
| 15b. Work pages and Reports | `phase-15b-work-pages` | 2026-11-12 | QA queue, Condition check and Import as pages of their own, Import as a stepper, Reports as cards, and the Export and Print map dialogs in one frame that keeps the keyboard inside |
| 15a. Interventions pages | `phase-15a-records` | 2026-11-12 | The Interventions list at `/records` and a page per record, the owner's phone map fixes (one row of buttons, layers as a sliding sheet, folded legend), transitions, data loaded once per sign-in for faster page changes, and Philippine dates for saved times. Live |
| 14. Map restyle | `phase-14-map-style` | 2026-11-11 | Light basemap, dimmed outside the province, green clusters, card-style map parts, the dashboard panel closed by default, an on-the-map count, and fixes for record popups and page overflow. Live |
| 13. Home and Dashboard | `phase-13-dashboard` | 2026-11-11 | Home at `/` with work waiting and a card per type, and the Dashboard page with shared filters, CSVs and the list of records awaiting coordinate verification. Live |
| 12. Foundation | `phase-12-ux-foundation` | 2026-11-11 | Design tokens as CSS, Inter font, Lucide icons, the new sidebar, top bar and sign-in screens, the map at `/map` with old links redirected, and `npm run deploy:preview`. Live |

## Work log

New entries go at the top. Each entry gets the date, what was done, and the commit or branch.

### 2026-11-13

- Found the Netlify site renamed from `da-marinduque-map` to `marinduque-intervention-system`, while putting up the 16b draft. The old address returns 404. The live deploy is still Phase 15a (`6af4ffdaa684b00e692f1740`). The owner confirmed the rename was meant, and is updating Supabase's URL settings. Claude set `APP_URL` in `.env.local` to the new address, and `npm run check:supabase` passes.
- Phase 16b passed Gate 1, approved by the owner after trying it in local mode on a computer and a phone. The Gate 2 draft is up: https://6af66f8a66ca57d040704c9b--marinduque-intervention-system.netlify.app. It's built from `phase-16b-line-drawing`, without the hidden marker fix. Checked signed out: the security headers are on, the Inter fonts load, the line drawing code is served, the sample roads aren't in the deployed files, and there are no console errors or failed requests.
- Phase 16b ready for Gate 1, on branch `phase-16b-line-drawing`. The full e2e run had 709 passed, 1 failed and 11 skipped, in 21 minutes. The one failure, "a plain move needs no reason, takes a note if given, and leaves a flag in place" on a computer, failed 2 times in 10 when repeated on its own, and also 2 in 10 on `main` without 16b, in a separate worktree. So it's an older flaky test and not 16b's (see Open items). The dev server also logged the Leaflet error noticed in Phase 15b (`layerPointToContainerPoint` of null, from `revealMarker`), with no test failing because of it.
- Applied `0012_lines.sql` and `0013_line_drawing.sql` to the live database, at the owner's go-ahead. The owner asked for 0013, and chose to apply 0012 with it, as `npm run db:migrate` applies the files in order and both have to be in before the next production deploy.
  - **Before:** a backup with `npm run backup` (`backups/*-2026-11-13-0846.*`: 1,167 records, 968 of them deleted, 1,168 status entries, 218 barangays). The live database had every migration up to `0011_reports.sql`.
  - **After:** both files are recorded in `private.schema_migrations`, `line_from_json` and `shape_from_json` exist, all 16 checks of `npm run check:supabase` pass, and `npm run test:live` passes all 54 tests. The record count is still 1,167 after the live tests' temporary accounts were removed.
  - **The live 15a site:** its screens refuse to switch on any type that isn't a point, so nothing changes there until the new screens are deployed.
- Phase 16b, more work on branch `phase-16b-line-drawing`. Not yet through Gate 1:
  - **Resolve flag form:** a road's line is drawn and reshaped there too, as in its Edit form. Before, it kept the line as it was, as reshaping wasn't built. The QA queue's Fix on the map, on a road flagged No coordinates, opens it ready to add points, and the flag clears once the line is saved. While the form is open the road's own line gives way to the one being fixed. The line controls moved into `edit/LineLocation.tsx`, which both forms share.
  - **Docs:** `docs/OPERATIONS.md` has a section on drawing and reshaping a road's line, and says why `0013_line_drawing.sql` has to be in before these screens go live: the older save functions ignore a line, so a drawn line would be dropped without an error. The spec now says lines are drawn with the app's own layer on Leaflet's markers, with Leaflet-Geoman kept for polygons.
  - **Tests:** 2 new end-to-end tests in `e2e/roads.spec.ts`, for a road waiting for its line and a traced road in the Resolve flag form.
  - **Checks:** typecheck, 1,138 unit tests, and all 34 tests in `e2e/roads.spec.ts` on a computer and a phone. The full e2e run is in the entry above.
- Phase 16b, work in progress committed on branch `phase-16b-line-drawing`, so it isn't lost. Not yet through Gate 1. Drawing and reshaping a road's line on the map:
  - **Drawing:** a road's form has Draw the line. Each tap on the map adds a point at the end, Undo last point takes the last one back, and Done finishes. The readout gives the length and the number of points as it goes. A point placed before the road type is chosen becomes the road's first point, and back again if the type changes back.
  - **Reshaping:** a traced road's Edit form opens with its line in the draft's orange and a handle on each point. A point can be dragged, a small dot between two points dragged or tapped to add a bend, and a tapped point picked for Remove point N. Add points at the end and Clear the line are there too. While the form is open the road's own line gives way to the one being reshaped, and nothing is saved until the form is. The new layer is `map/LineDraftLayer.tsx`. Its handles are bigger to touch than they look, for phones.
  - **On the map while drawing:** clicks reach the map through markers and other roads, the legend makes way, a popup closes, and a line partly out of view is brought into it, again once a phone's sheet is up.
  - **Record pages:** an editor gets Draw its line on the map on a road waiting for one, which opens its form near its barangay, straight into adding points, and Reshape on the map on a traced road. Viewers get neither.
  - **Database (`0013_line_drawing.sql`):** `create_intervention` and `update_intervention` take a line beside the point, as [longitude, latitude] pairs. A line needs two points or more, a record can't have both, and a patch with the line set to null takes it away, so the road waits for one again. Compared with `0007_admin.sql`, only the shape handling changed. Not applied to the live database yet.
  - **Screens and local mode:** the same rules are checked before saving. Local mode saves, reshapes and clears a line, and relinks the barangays it crosses.
  - **Not covered:** a line in several parts, as an import can bring in, can't be reshaped in the form and stays as it is.
  - **Tests:** 5 new unit tests, and 6 new end-to-end tests in `e2e/roads.spec.ts` with 2 more updated.
  - **Checks:** typecheck, 1,138 unit tests, the production build with its check for private data, and all 30 tests in `e2e/roads.spec.ts` on a computer and a phone. The full e2e run hasn't been done on this work yet.
- Fixed a phone bug behind the flaky test "the orange marker can be dragged to fine-tune", on branch `fix-phone-drag-test`. On a phone, the closed Layers sheet waits below the map, moved down by its own height, and a moved box still counts toward what can be scrolled. So the map page was 619 px taller than its frame, and focusing a field in a form, such as Type or paste coordinates, scrolled the page and took the map and the new marker off the top of the screen. The test then dragged at a spot off screen, so it failed about half the time. The phone map area now clips at its edge (`src/app/map-phone.css`), and the sheet still rises from the bottom as before.
  - **Tests:** the frame test in `e2e/overview.spec.ts` now checks the frame's own box as well as the window, and a new test in `e2e/editing.spec.ts` types coordinates three times and checks the map and the marker stay on screen. Both failed before the fix and pass after it. The drag test passed 10 times out of 10, where it failed about half the time before, and all 158 phone map tests pass.
  - **Full e2e run:** 689 passed, 5 failed and 11 skipped. All 5 pass when run again. One of them, the frame test on a phone, also failed twice in 8 repeats, each time before its new check, on the first page: its code didn't load, with `net::ERR_NETWORK_CHANGED`, as this computer's network connection changed mid-run.
- Phase 16a passed Gate 2, approved by the owner, and is merged into `main`. After the merge `main` matches the tested branch file for file. `0012_lines.sql` is still waiting for the owner's go-ahead before it's applied to the live database.
- Phase 16a passed Gate 1, approved by the owner. The Gate 2 draft is up: https://6af63fc1c7518f81002f6a39--da-marinduque-map.netlify.app. Checked signed out: the security headers are on (framing blocked by the security policy), Inter loads, the road layer's code is served, and there are no console errors or failed requests. The sample roads aren't in the deployed files.
- Phase 16a built on branch `phase-16-fmr`, ready for Gate 1. Farm-to-Market Roads on the map and the dashboard, built on made-up sample roads as the owner decided:
  - **Database (`0012_lines.sql`):** a line type can be switched on, and a road can be saved before its line is traced. It's then counted in every total, flagged `no_coords` and kept off the map, as a point record waits for its coordinates. Polygons still can't be switched on. The migration switches nothing on, and isn't applied to the live database yet.
  - **Map (M-11):** each traced road as a line in its Color by color with a white casing, dashed while Proposed or On-going, and labelled with its length from zoom 13 in. Roads have their own layer, `map/RoadLayer.tsx`, under the markers. A road's link opens the map on it with its popup, which gives the traced length beside the form's Length. The legend and the printed map's legend explain the solid and dashed lines.
  - **Length:** the Length on a road's form, as the source reports it, so the totals match the source. Without one, the length of its traced line, measured along the earth's surface. One place, `lib/roads.ts`, for the map, the pages and the figures.
  - **Home and Dashboard:** the roads' total km in place of "Data to follow", with the number of roads, how many aren't traced yet, how many are measured from the map and how many have no length. The Dashboard's follows its filters.
  - **Record pages:** a road's Location card gives its length, its traced line and the barangays it runs through. A road without a line says "No traced line yet", in the list and the list for the region too, and offers no coordinates to enter. The form shows a road's line in place of the point picker and keeps it through an edit.
  - **Local mode:** its copy of the database's rules now handles lines: flags, the plotted barangay (the point on the line PostGIS picks) and a link to every barangay a line crosses. A new test runs 300 generated lines through both and they agree, and another edits a sample road through both.
  - **Sample roads:** `scripts/sample-roads.ts` adds 8 made-up roads to the local seed only, through the real triggers, with the road type switched on. Six have a traced line, two wait for one, and they're named "Sample FMR".
  - **Fixed:** in local mode an edit to a road would have dropped its line, as the engine rebuilt the shape from a point. Now an edit that leaves the location alone keeps the shape.
  - **Fixed, on the live site since Phase 15a:** a record's page showed a custom field's unit twice, such as "2.5 km km", for any field with a unit.
  - **Tests:** 13 new unit tests and 11 new end-to-end tests in `e2e/roads.spec.ts`. The tests that counted records, barangays or types from the RAED data alone now count from the seed, as it has the sample roads. The live tests' type check is about polygons now, which the live database refuses before and after `0012_lines.sql`, so `npm run test:live` passes either way. (Corrected 2026-11-13: this first said the migration was needed.)
  - **Docs:** a Farm-to-Market Roads section in `docs/OPERATIONS.md`, the roadmap's Phase 16 parts and change log, and the spec's rule for line types.
  - **Checks:** typecheck, 1,133 unit tests, and the production build with its check for private data. The full e2e run had 678 passed, 14 failed and 11 skipped. It took 3.5 hours, as the computer slept partway through. 13 of the 14 pass when run again. The last, dragging the orange marker on a phone (`e2e/editing.spec.ts`, "the orange marker can be dragged to fine-tune"), fails 2 or 3 times in 5 when repeated, with the road layer on or off, so it's an older flaky test and not 16a's.

### 2026-11-12

- Decided with the owner: the next production deploy waits until Phase 17 is done, and covers 15b, 15c, 16 and 17. Phase 16 comes before 17.
- Phases 15b and 15c passed Gate 2, approved by the owner, and are merged into `main`: `phase-15b-work-pages` first, then `phase-15c-admin-forms`. After the merges `main` matches the tested 15c branch file for file. Going live waits for the owner to run `npm run deploy`.
- Corrected this file: Phase 15a went live this morning, recorded on `main` only, so the 15b and 15c branches still said the live site was on Phase 14. The one deploy after 15c therefore covers 15b and 15c, not 15a.
- Phase 15c passed Gate 1, approved by the owner. The Gate 2 draft, which covers 15b too, is up: https://6af5cd2cd58be030f21e6c44--da-marinduque-map.netlify.app. Checked signed out: the security headers are on (framing blocked by the security policy, as on the live site), Inter loads, and there are no console errors or failed requests.
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
- Phase 15a is live (deploy `6af4ffdaa684b00e692f1740`). Claude switched from `phase-15b-work-pages` to `main` first, so only 15a went out, then ran `npm run deploy` at the owner's request. Checked signed out on the live site: the security headers are on, Inter loads, `/records` and the record pages are served, and the Work pages are still the 15a version.
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
