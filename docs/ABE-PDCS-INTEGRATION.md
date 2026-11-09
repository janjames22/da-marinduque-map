# Making the Intervention Map a module of ABE PDCS

**Status:** a proposal, not built. Nothing has been merged. This sets out the ways the map could become a module of the ABE Project Data Consolidation System (ABE PDCS), what each would move where, and what has to be known about ABE PDCS before choosing.

## 1. What the map is today

| Part | What it is | Where |
|---|---|---|
| Website | React, Vite and TypeScript, one page app | Netlify |
| Map module | Everything specific to interventions: map, forms, dashboard, import, QA, reports, admin | `src/modules/intervention-map/` |
| App shell | Sign-in, header, page routing | `src/app/` |
| Database | PostgreSQL with PostGIS, row-level security, audit triggers, database functions for every change | Supabase |
| Accounts | Email and password, invitation only, three roles (Admin, Encoder, Viewer) | Supabase Auth, `profiles` table |
| Photos | Private bucket, signed links | Supabase Storage |
| Live updates | One signal per change, maps reload | Supabase Realtime |
| User admin | Invites, roles, deactivation | Supabase Edge Function `admin-users` |

Three seams already make a move easier:

- **One data interface.** The screens talk to a `DataStore` (`data/store.ts`), not to Supabase. A local version and a Supabase version both pass the same tests. A third, for ABE PDCS's backend, could replace the Supabase one without changing a screen.
- **The rules live in the database.** Who may do what, the QA flags, versions and the audit log are all enforced by PostgreSQL, so another front end can't get around them.
- **The module stands alone.** It takes a signed-in user and nothing else from the app shell.

## 2. What to find out about ABE PDCS first

1. **Its technology:** front end framework, back end, database. Is it PostgreSQL? Can it have PostGIS?
2. **Its hosting:** where it runs, who deploys it, and how often.
3. **Its accounts:** how people sign in, whether it has roles, and whether it can act as a single sign-on provider (OpenID Connect or SAML).
4. **Its data:** does it already hold projects, beneficiaries (FCAs) or programs? A real beneficiary list would replace the map's approximate name matching.
5. **Its API:** can other systems read from it or write to it, and how they're authorised.
6. **Its people:** who maintains it, and whether they would take on PostGIS and the map's database rules.

## 3. Three ways to join them

### A. Linked, not joined

ABE PDCS shows a menu item, or a summary tile, that opens the map. Each keeps its own sign-in and database.

- **Moves:** nothing.
- **Work:** about a day: a link, and optionally a small read-only figure from the map shown in ABE PDCS.
- **Good:** no risk to either system. Can be done now.
- **Not so good:** two sign-ins, two places to keep people's accounts, and no shared lists.

### B. Shared sign-in, separate data (recommended first step)

People sign in once, with ABE PDCS's accounts. The map keeps its own database. Each system reads what it needs from the other through an API.

- **Moves:** accounts. `profiles` stays, keyed to the ABE PDCS user, with the map's role kept per person or taken from an ABE PDCS role.
- **Sign-in:** Supabase Auth accepts sign-ins from another identity provider. It has single sign-on with SAML 2.0 on paid plans, and "third-party auth" from some providers. The site's sign-in page would hand over to ABE PDCS. Check Supabase's current plan terms before choosing.
- **Data both ways:**
  - ABE PDCS reads summaries from the map through database functions made for it, such as counts by municipality, program and status, the inventory, and units waiting for a condition check.
  - The map imports ABE PDCS project lists through the existing import wizard, or through a scheduled import that uses the same `import_records` function.
- **Work:** a few weeks, mostly on the sign-in hand-over and a small read API with its own key and audit lines.
- **Good:** one sign-in, and each system keeps its own rules and backups. Easy to undo.
- **Not so good:** two databases to back up. Lists such as programs exist in both until one owns them.

### C. One module in one system

The map's screens run inside ABE PDCS as one of its pages, and its tables move into ABE PDCS's database.

- **Moves:**
  - the map module, `src/modules/intervention-map/`, into ABE PDCS's front end, if it's React; otherwise it runs as an embedded page;
  - every table, function and trigger in `supabase/migrations/` into a schema of its own, such as `intervention_map`;
  - accounts and roles into ABE PDCS's;
  - photos into ABE PDCS's file storage;
  - live updates into whatever ABE PDCS uses, or polling.
- **Needs:** PostgreSQL with PostGIS for the location checks and boundaries. Without it, the QA flags, barangay matching and exports would have to be rewritten.
- **Work:** one to three months, depending on ABE PDCS's technology. If ABE PDCS isn't PostgreSQL, the database rules, which are most of the safety, have to be rebuilt in its back end and tested again.
- **Good:** one system, one sign-in, one backup, shared lists.
- **Not so good:** the biggest change and the hardest to undo. ABE PDCS's team takes on PostGIS, the migrations and the map's release cycle.

## 4. What moves where

| Part | A. Linked | B. Shared sign-in | C. One module |
|---|---|---|---|
| Accounts and roles | Map | ABE PDCS signs in; map keeps roles | ABE PDCS |
| Programs, categories, statuses, types | Map | Map, matched to ABE PDCS by code | ABE PDCS, or shared |
| Beneficiaries | Map (names as written) | Matched to ABE PDCS's list where it has one | ABE PDCS's list |
| Interventions, status history, photos | Map | Map | ABE PDCS database, map schema |
| Barangay boundaries and baselines | Map | Map | ABE PDCS database, map schema |
| QA flags, dismissals, imports | Map | Map | ABE PDCS database, map schema |
| Audit and export log | Map | Map, plus ABE PDCS's own | ABE PDCS |
| Reports and signature blocks | Map | Map, or ABE PDCS's report settings | ABE PDCS |
| Backups | Map's backup script | Both systems | ABE PDCS |

## 5. Suggested path

1. **Now:** option A, a link from ABE PDCS to the map. No risk, and people can use both straight away.
2. **When ABE PDCS's accounts are settled:** option B. Sign in once, and add a small read API so ABE PDCS can show the map's figures. Match programs and categories by code.
3. **Only if ABE PDCS runs PostgreSQL with PostGIS, and its team will look after the map's rules:** option C. Move the schema in one go from a backup, using the restore script's checks, and keep the map's tests running against the new home.

## 6. Before deciding

- Who owns each list (programs, categories, beneficiaries), so changes are made in one place only.
- Whether ABE PDCS keeps the same three roles, or needs others, such as a regional view.
- Supabase's plan and costs if single sign-on is needed, and any data residency rules for government data.
- How a person removed from ABE PDCS is removed from the map on the same day.
