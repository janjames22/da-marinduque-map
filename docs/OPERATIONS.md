# Running the Intervention Map

For the Admin who sets up and looks after the map. Commands run in the project folder, on the Admin's computer.

The site has two parts: the website on Netlify, and the database, logins, photos, live updates and the Users page's function on Supabase. Everything is controlled from this computer through `.env.local`, which holds the project's keys. Git ignores that file, so **keep your own safe copy of the keys, and never paste them into a chat or commit them.**

## First-time setup

1. **Create a Supabase project.** Singapore is the closest region. Save the database password.
2. **Fill in the settings.** Copy `.env.example` to `.env.local` and follow the notes in it. Leave `APP_URL` empty for now.
3. **Build the database and load the RAED records:**
   ```
   npm run db:migrate
   npm run db:seed
   ```
   `db:seed` only runs on an empty database, so it can't overwrite anything people have encoded.
4. **Turn off public sign-ups.** In Supabase, go to Authentication > Sign In / Providers and turn off "Allow new users to sign up".
5. **Check the project:**
   ```
   npm run check:supabase
   ```
   Fix any line marked `PROBLEM`. The script only reads, and prints no keys or record data. The "At least one Admin" note clears in the next step.
6. **Add yourself as the first Admin.** The Users page needs an Admin, so the first one comes from here:
   ```
   npm run users -- invite you@example.com --role admin --name "Your Name"
   ```
7. **Put the Users page's function on Supabase.** Sign the Supabase command line in once, then deploy it:
   ```
   npx supabase@3 login
   npm run deploy:functions
   ```
8. **Put the site online** (see [Deploying](#deploying)), then [prove that it works](#proving-it-works).

## Deploying

The first time, connect this folder to Netlify:

```
npx netlify-cli login
npx netlify-cli sites:create
```

Then, for the first deploy and every one after it:

```
npm run deploy
```

This builds the site here and uploads it, so Netlify never sees `.env.local`. The deploy stops if the build check finds anything private in the website files.

When `supabase/functions` has changed, also run `npm run deploy:functions`. Supabase gives the function the project's keys itself, so the secret key is never sent to Netlify or built into the website.

After the first deploy, do these two things so invite links go to the right place:

1. Set `APP_URL` in `.env.local` to the site's address. This doesn't need a new deploy.
2. In Supabase, go to Authentication > URL Configuration. Set the Site URL to the same address, and add it to the Redirect URLs.

The `VITE_` settings are built into the website, so deploy again if the project URL or publishable key changes.

### Previewing before going live

Every change to how the site looks is checked twice before it goes live (the gates in `docs/UI-UX-ROADMAP.md` §11):

1. **On this computer.** Run `npm run dev:local` and open the address it prints. Local mode uses the sample data in this browser only, so nothing you do there reaches the real records.
2. **On a private Netlify address.** Run:
   ```
   npm run deploy:preview
   ```
   This builds the site and uploads it as a draft. Netlify prints a "Website draft URL". Only people with that link can open it, and the live site doesn't change.

**A draft uses the real database.** Sign in and look around, but don't import, delete or edit records there unless you mean it.

When the draft is approved, run `npm run deploy` to put the same version live.

## Managing people

Accounts are by invitation only.

| Role | Can do |
|---|---|
| Viewer | See the map and barangay profiles. Can't change anything. |
| Encoder | Viewer, plus add, edit, move and delete records, add statuses and photos, edit barangay baseline values, and see History. |
| Admin | Encoder, plus see deleted records and restore them, manage people, and change the types, forms and lists. |

Do all of this on the **Users** page, under **Administration** in the sidebar.

| To | On the Users page |
|---|---|
| See everyone | The list at the bottom shows each person's role, status and last sign-in |
| Add someone | Fill in **Invite someone**, then choose to email it or get a link to send yourself |
| Give a new link (forgotten password, expired link) | **Email a new link** or **Get a new link** on their row |
| Change a role | The role list on their row |
| Correct a name | **Edit name** on their row |
| Remove access | **Deactivate** on their row |
| Give access back | **Reactivate** on their row |

- **Links:** a link works once and expires, so send it privately and soon. Getting a link works even when an email doesn't arrive.
- **Role changes** apply the next time the person loads the map.
- **People who leave:** deactivate them rather than deleting the account. Their name stays on what they encoded.
- **There's always an Admin:** you can't change your own role or deactivate yourself, and the database refuses any change that would leave no active Admin. To step down, have another Admin do it.

If the page can't reach its function, the same things can be done from this computer with `npm run users -- list`, `invite someone@example.com --role encoder --name "Full Name"`, `link`, `role`, `deactivate` and `reactivate`.

### Invite emails

**Email is set up.** Since 2026-11-09, invites and password resets go out through Gmail's SMTP server from `graza.janjames22@gmail.com`, and a test invite arrived. Invite the MAOs on the Users page with **Invite someone**, choosing to email it. If an invite doesn't turn up, ask them to look in spam and mark it as not spam, or use **Get a new link** on their row and send the link privately.

- **Keep custom SMTP on.** Supabase's built-in sender only delivers to your own Supabase team, and only 2 emails an hour.
- **The limit** is under Authentication > Rate Limits. Supabase starts it at 30 emails an hour, which is enough for the MAOs.
- **The app password** stays in Supabase's settings. Don't put it in `.env.local` or anywhere in this project, and never paste it into a chat.
- **If emails stop going out,** the app password may have been cancelled, which happens when the Gmail account's password changes. Make a new one (steps 2 and 3 below) and enter it in Supabase.

To set it up again, or move it to another account:

1. **Use a Gmail account kept just for this.** An app password can reach the whole mailbox, so it's best kept apart from anyone's personal email.
2. **Turn on 2-Step Verification** for that account, at [myaccount.google.com/security](https://myaccount.google.com/security). Google requires it for app passwords.
3. **Create an app password**, at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords). Name it `Supabase`, and copy the 16 letters it shows.
4. **In Supabase, go to Authentication > Emails > SMTP Settings**, turn on custom SMTP, and enter:

   | Setting | Value |
   |---|---|
   | Sender email | The Gmail address |
   | Sender name | `DA Marinduque Intervention Map` |
   | Host | `smtp.gmail.com` |
   | Port | `587` |
   | Username | The Gmail address |
   | Password | The 16 letters, without spaces |

5. **Test it.** On the Users page, invite an address that isn't on the map yet, choosing to email it. Confirm the email arrives, look in spam too, and confirm its link opens the page to set a password. Then deactivate that test account.

Gmail needs no email domain of the office's own. If the office gets one, Brevo's free plan (300 emails a day) is the better choice. Google's own advice is to prefer other sign-in methods over app passwords, but Supabase's email settings only take a password. Only invites and password resets are sent, so the volume stays low.

## Customizing the map

An Admin changes these on the pages under **Administration** in the sidebar. Changes reach every open map within a couple of seconds, with no code release.

| Page, then tab | What it changes |
|---|---|
| **Types and fields**, **Intervention types** | Add a type or activate one, which adds its layer to the map. Set its name, color, icon, geometry, which standard fields are required or hidden, its status list, and its custom fields |
| **Lists**, **Categories** | What a record is within its type, with its group and icon |
| **Lists**, **Programs** | Banner programs. A program's color is the color of its markers everywhere, including exports |
| **Lists**, **Statuses** | All the status names, and whether each **counts as assessed**: says a unit's condition has been checked. Each type picks its own list on its page, and which of them count as operational |
| **Lists**, **Other lists** | Category groups, beneficiary types, location bases and icons |
| **Types and fields**, **Barangay fields** | The baseline values on each barangay's profile |
| **Signature blocks** | The signature blocks at the foot of every report and printed map. See [Signature blocks](#signature-blocks) |

- **Nothing is deleted:** lists and fields are archived, so existing records keep their meaning. An archived item leaves the choices for new records, stays on records that have it, and can be restored.
- **What can't change:** a code or field key, once made. A saved field's kind. A type's geometry once it has records. A status stays on a type's list while any record is at it.
- **Custom field kinds:** text, number, date, dropdown, yes or no, and photo. Barangay fields can't be photos, as photos belong to a record.
- **Icons:** upload a simple one-color SVG with a `viewBox`, up to 20 KB. Files holding scripts or links are refused.
- **Line types**, such as Farm-to-Market Road, can be switched on since Phase 16 (`0012_lines.sql`). The map draws their lines, and a road can be saved before its line is traced. Since Phase 16b (`0013_line_drawing.sql`) the line is drawn and reshaped on the map. See [Farm-to-Market Roads](#farm-to-market-roads).
- **Polygon types:** these can be set up but **not activated until drawing them on the map is built**. Their Active switch is greyed out with the note "Needs drawing tools (not yet built)", and the database refuses it too, so no polygon record is saved without a shape.
- **Two Admins at once:** if someone else saves a type or the barangay fields while you're editing them, you're told, and your save is held until you load their version.

## Farm-to-Market Roads

The Farm-to-Market Road type is a line type. It stays off until an Admin switches it on in **Types and fields**, which waits for the region's FMR data (roadmap question Q-5). Local mode switches it on with eight made-up sample roads, so the screens can be tried. They're marked "Sample FMR" and never reach the live database.

| Where | What it shows |
|---|---|
| **Map** | Each road with a traced line, as a line in its Color by color with a white edge. Dashed while the road is Proposed or On-going, solid after. Its length shows on the line from zoom 13 in. The legend counts the solid and dashed roads |
| **Popup and record page** | The traced line's length, the reported Length from the form, and the barangays the road runs through |
| **Home and Dashboard** | The roads' total km, with the number of roads, how many aren't traced yet, how many are measured from the map, and how many have no length at all |

- **A road's length** is the Length entered on its form, as the source reports it, so the totals match the source. A road without one counts the length of its traced line, measured along the earth's surface.
- **A road without a traced line** is counted in every total and kept off the map, as a record without coordinates is. It says "No traced line yet", and it's on the Dashboard's list for the region to verify.
- **A road links to every barangay its line crosses**, so a barangay's filter and profile count it, as the database's `intervention_barangays` does.
- **Roads come in from a file** through **Import**, with their lines, since Phase 16c. See [Importing roads](#importing-roads).

### Drawing and reshaping a road's line

Since Phase 16b, Encoders and Admins draw a road's line on the map, in its Edit form or its Resolve flag form. Nothing is saved until the form is.

| To | Do this |
|---|---|
| **Draw a new line** | In the form, choose **Draw the line**, then tap the map along the road, in order. **Undo last point** takes the last one back. Tap **Done** when the line is finished. The form shows the length and the number of points as you go |
| **Move a point** | Drag it |
| **Add a bend** | Drag or tap the small dot between two points |
| **Remove a point** | Tap it to pick it, then choose **Remove point N** |
| **Carry on the line** | **Add points at the end** |
| **Take the line away** | **Clear the line**. Once saved, the road waits for its line again |

- **From a road's own page:** **Draw its line on the map** on a road waiting for one opens its form near its barangay, ready to add points. **Reshape on the map** on a traced road opens it with the line ready to reshape. Viewers get neither.
- **From the QA queue:** **Fix on the map** on a road flagged No coordinates opens the Resolve flag form ready to add points. The flag clears once the line has two points and is saved, with a reason, as any fix needs.
- **A line needs two points or more.** A road placed as a single point is refused, by the form and by the database.
- **A line in several parts**, as an import can bring in, can't be reshaped in a form yet. Its form says so, and an edit keeps the line as it is.
- A point placed before the type is set to Farm-to-Market Road becomes the road's first point.

## Room for the map

**The Map opens map first, every time.** On a computer the menu, the layers and filters card and the dashboard start put away, so the map has the page, and each has a button to bring it out. What's brought out stays out while you move about the map, a barangay or a record, until you leave the Map. The next visit starts map first again. On a phone the menu is a drawer, the layers a sheet and the dashboard a tab, as before.

| To bring out | Use | To put it away |
|---|---|---|
| **The menu** | **Menu**, at the top left of the top bar | The same button. On the Map this lasts for the visit. On other pages the menu stays as you last left it, next time too |
| **The layers and filters card** | **Layers**, under the map's zoom and full screen buttons | The **×** at the top of the card |
| **The dashboard** | **Dashboard**, in the map's toolbar | Its own close button |

**The panel on the right**, a barangay's profile, a form, the list of unassigned records or the dashboard, can also be put away without closing it: the panel button at the bottom right of the map. While it's away the button names it, and brings it back. A form or profile put away keeps what's in it. Opening another panel brings it out.

**The legend** has its own button at its top. It starts open when the map has room for it, and folded into a small **Legend** button when the map is short, such as in a small window. It's never taller than the room below the map's buttons on the left, and scrolls inside when it needs more.

**Full screen**, the button under the map's zoom buttons, gives the map the whole screen alone, with its zoom buttons, toolbar and legend. **Esc**, or the same button, leaves it. Anything that opens beside or over the map, such as a barangay's profile, a form, Export, Print map or a photo, leaves full screen first. On a phone it hides the browser's bars too. An iPhone has no full screen for pages, so there the map fills the browser window instead.

Panels slide in and fade out, and the legend folds, unless your device is set to reduce motion.

## The dashboard and records table

On a computer these sit beside the map, and on a phone the **Map**, **Dashboard** and **List** tabs take turns. Everything follows the map's filters, so the map, the numbers, the table and an export can't disagree. **Limit to map view** narrows them to what's on screen, and leaves out records with no coordinates while it's on.

| Figure | How it's counted |
|---|---|
| Total interventions | Records, whatever their quantity |
| Machinery units, SSIPs and other types' units | The quantity on each record |
| Beneficiaries (approx.) | Different beneficiary names, ignoring case, spacing and punctuation, so "Bantad F.C.A." and "bantad fca" count once. It's approximate until records have beneficiary types and there's a proper list of beneficiaries |
| % operational | Units at a status marked as operational on that type's page in Admin, out of the units whose condition has been checked. A status that doesn't **count as assessed** in Admin, Statuses, such as Turned-over (delivered, not checked) or Unknown, is left out, and its units are shown under the figure as not yet assessed. Turned-over, Undelivered/For Distribution, Proposed, Inventory, On-going, Completed and Unknown start that way |
| Barangays with no intervention yet | Out of the barangays the filters cover |
| Records needing QA | Any QA flag except a shared point, which is often correct, or a flag someone has dismissed in the QA queue |

**Show table** on each chart gives the same numbers as a table. **Export this table** exports all the rows found, on every page, in their order, and is logged like any other export. The search shows in the dialog, the audit log and a KML or KMZ's "Read me". It's left out of the file name, as it can be someone's name.

### Home and the Dashboard page

**Home** (`/`) is where everyone lands after signing in. It shows the headline figures for the whole province, whatever the map's filters, and a card for each type. Encoders and Admins also see what's waiting for them: records needing QA, records waiting for verified coordinates, and units with no condition recorded yet.

**Dashboard** (`/dashboard`) has the same figures as the panel beside the map, on a page of its own, and adds:

- **Filters shared with the map.** A filter set on the Dashboard is on the map too, and the other way round.
- **Units by category group**, as one bar.
- **CSV on every chart.** Each chart's table downloads as a CSV, logged like any other export.
- **Awaiting coordinate verification.** This lists the records with no coordinates, or coordinates outside Marinduque, by municipality. They're counted in every total but not drawn on the map. **Download verification sheet** gives the region a CSV in the same columns as `data/corrections/for-field-verification.csv`. When the region confirms a location, fix it from the QA queue. The record then goes on the map and leaves this list.

The Farm-to-Market Roads card says "Data to follow" until that type is switched on in Admin (Phase 16).

## Coloring, filtering and saved views

- **Color markers by** and **Filter by another field**, in the layers panel, offer every field, including each type's custom fields. Text that belongs to one record, such as a beneficiary's name, can be filtered but not used for color.
- **Exports keep program colors**, even while the map is colored by something else.
- **Saved views** keep the layers, filters, colors, basemap and map position. Anyone signed in can save their own. A view is personal until shared with everyone, and only its owner can change it.
- **The default view:** an Admin can pick **Open on this** on a shared view, and everyone's map then opens on it, with a notice saying so. It doesn't apply to a link to a barangay or record. To retire it, choose **Stop opening on this**.
- **Removing a shared view:** an Admin can delete anyone's shared view, such as one left by someone who has moved on. Nobody can see another person's personal views, including Admins.
- **Something removed later:** a view that uses a field, program or type that has since gone still opens, and ignores it.

## The audit log

**Audit log**, under **Administration** in the sidebar, shows who changed what and when, for Admins only. Filter by person, record, action and date. Times and dates are Philippine time. Each line links to its record, or to the page where that item is managed. A record that's been deleted opens on its history.

- **"No login (a script or Supabase's dashboard)"** means the change didn't come through the website, such as a seed, a correction by script or an edit in Supabase's table editor.
- **"An account since removed"** means that person's account no longer exists. The line stays.
- **Nothing here can be edited**, even by an Admin. The only lines that ever leave are the temporary ones from the live tests in [Proving it works](#proving-it-works).
- **Reasons:** changing a barangay needs a reason everywhere on the website: Resolve flag, **Move and set barangay**, the Edit form and the QA queue. The reason shows on the line. A script can still change a barangay without one, and the log then shows no login.

## QA and import

Admins and Encoders get **QA and import** in the header. It has three pages. Viewers don't get it.

### The QA queue

Every flagged record, worst first: outside Marinduque, no coordinates, a barangay not on the list, then mismatches, name checks and shared points. Each flag is split by municipality. Filter by municipality, flag or record. Each record offers what fits its flag:

- **Fix on the map** opens the record on the map with Resolve flag, for moving a point or adding coordinates.
- **Set barangay** offers where the point is plotted and, for a name not on the list, the nearest names. It needs a reason, like any barangay change.
- **Set location basis** is for a point that marks somewhere else on purpose, such as the FCA's office. The point stays outside the barangay, so the same reason also dismisses the flag.
- **Update status** adds a status, dated today unless changed.
- **Dismiss** is for a flag that's right as it is. It needs a reason. The flag stays on the record, but it leaves the queue and the "Records needing QA" count. **Show dismissed** lists those flags with who dismissed them and why, and **Put back in the queue** reopens one. A dismissal ends by itself if the data changes so the flag goes. Dismissing a name check clears it.

Fixing the data clears a flag by itself. Every change goes in the audit log.

### Condition check

Units delivered but not yet looked at: those at a status that doesn't **count as assessed**. It opens on Turned-over, and the **Status** filter lists the other such statuses that have records, such as Inventory or Completed. Filter by municipality to go through one MAO's area. A button for each status that does count as assessed opens a short form: the date it was checked (today unless changed) and what was found. Once saved, the unit leaves the list and counts in % operational.

### Importing records

**Import** brings a file in as one batch. Nothing is saved until the last step.

1. **File:** a CSV, Excel (.xlsx), Google Earth (.kml, .kmz) or GeoJSON (.geojson) file of up to 2,000 rows. Choose what it lists and say where it came from, such as "ABEMIS export". Use the same name for every file from that source, because the columns and values chosen are remembered under it. For a workbook, the first sheet with anything on it is read, and title rows above the header are skipped.
2. **Columns:** check which field each column fills. Starred fields need a column. Set the status for rows without one, and the date the file's statuses were true, such as the day it was exported.
3. **Values:** names the lists don't know, such as "RICE PROG", need a choice. A name the lists already have, in any case or spacing, is matched by itself. Sta. Cruz is Santa Cruz.
4. **Check:** every row, with the same checks as the Edit form and the flags it will get. Rows to fix must be fixed in the file or left out. Rows whose ID was already imported from the same source are left out unless you untick that. Rows that only look like a record already on the map are warned about, not left out.

A barangay the list doesn't have still comes in, flagged, and waits in the QA queue. Every row keeps its whole source row with the record.

**A map file's rows** are its placemarks or features: their fields are the columns, and a point's coordinates come as two more columns, "Latitude (from the map file)" and "Longitude (from the map file)". **A row with no municipality** in the file takes it, and its barangay, from where its point or line is, and says so in a warning. Then the file needs no Municipality column. A row that can't be placed that way is stopped at the check.

#### Importing roads

Choose **Farm-to-Market Road** under what the file lists, once an Admin has switched the type on. A road's line comes from a KML, KMZ or GeoJSON file, so a road type isn't offered the latitude and longitude columns.

- **A line in one part** comes in as a line drawn on the map does, so it can be reshaped there later.
- **A line in several parts**, as QGIS or Google Earth's MultiGeometry can save one, comes in as one road in parts. It shows and measures like any road, but can't be reshaped in a form yet.
- **A row with no line**, or with a point, comes in waiting for its traced line, with a warning, as a road added on the map does.
- **The check** shows each road's traced line, its length and its parts.
- **The file must be in longitude and latitude** (WGS 84, EPSG:4326), as KML always is. A GeoJSON file saved in metres, such as UTM, is refused with a note to save it again in WGS 84.
- **To try it,** import [`docs/samples/sample-fmr-roads.geojson`](samples/sample-fmr-roads.geojson) in local mode. It has three made-up roads, one in two parts with only a title.

**Undo this import**, under Earlier imports, takes a whole batch off the map, with a reason. The person who imported it or an Admin can do this, until anyone changes one of its records. After that, change or delete those records one at a time. Undone records are deleted, so an Admin can still restore one from its history. The RAED batches were loaded by script and can't be undone here.

## Exports

Every signed-in role can export, from the **Export** button on the map or **Export this barangay** in a profile. An export takes what the map's filters show, and each one is recorded in the audit log: who, the format, the filters and the record count. If the log can't be written, nothing is downloaded.

| Format | Records without coordinates | Good for |
|---|---|---|
| KMZ | Listed by name in the "Read me" folder | Google Earth, with the map's icons |
| KML | Listed by name in the "Read me" folder | Google Earth and QGIS, with colored dots |
| CSV | Included, with blank latitude and longitude | Excel |
| GeoJSON | Included, with no geometry | QGIS and web maps |
| Shapefile | Listed in `records-left-out.txt` in the .zip | QGIS and ArcGIS |

- **The "Read me" folder:** every KML and KMZ opens with a top-level folder, "Read me – legend and unlocated records". It holds one pin, labeled "Read me", just past the top left corner of the exported area. Open it for the legend and the list of records without coordinates.
- **Barangay gap map:** this layer's folder is set to off in the file, while the boundary outlines stay on. Switch the folder on in Google Earth to show it.
- **Shapefile field names:** these are limited to 10 characters, so `fields.txt` in the .zip gives each one's full name. Text over 254 bytes is cut short, and `fields.txt` says which fields that happened to.
- **Records outside Marinduque:** these have coordinates, so they're exported where they're plotted, even though the map leaves them off. In KML and KMZ, they go in a separate top-level folder, "QA – needs location check", not in their municipality's. In CSV, Shapefile and GeoJSON, they stay with the other records, and the first column, "QA – needs location check", marks them. The next column has all of a record's QA flags.
- **Sample files:** `npm run export:samples` writes samples to `exports/samples/`, using the local dataset. Run `npm run build:local-seed` first.
- **Exported files hold beneficiary names, so take care who gets them.** `exports/` is ignored by git.

## Reports

**Reports**, in the header, is for everyone signed in. Each report covers every record on the map, whatever the map's filters. It downloads as a PDF ready to print and sign, and the inventory also comes as Excel. Like an export, every download is recorded in the audit log, and if the log can't be written, nothing is downloaded.

- **Municipal profile:** choose a municipality. One A4 page has its map, its figures, tables by program, status and category, and the barangays with no intervention yet.
- **Beneficiary profile:** find a beneficiary by name or municipality, or open **All for this beneficiary** in a record's popup. It lists everything they received, where each is, and each one's status history. Names are matched ignoring case, spacing and punctuation, so check that every intervention listed belongs to them. The file name leaves the beneficiary's name out, as it can be a person's.
- **Inventory report:** the layout of the RAED Consolidated Inventory Report, on legal paper, landscape. Choose a municipality, program or year, or none for the whole province. The Excel workbook has the same title, columns and rows, and prints the same way. Years, units and coordinates are numbers, so they sort.
- **Print map:** beside **Export** on the map. It prints the map as it is on screen, with a title you can change, the filters, the legend, a north arrow, a scale bar, the date, the data sources and the signature blocks, on A4, Letter or Legal. Move and zoom the map first, and close the side panels for a wider map. If a basemap's tiles can't be copied, the map prints without them and says so.

### Signature blocks

Every report and printed map ends with signature blocks, left to right: a label, room to sign, the name, and the position. They start as "Prepared by: Engr. Jan James P. Graza, Agricultural and Biosystems Engineer" and "Noted by: Susana Arellano-Uy, RAgr., MPA, OIC Provincial Agriculturist". An Admin changes them on the **Signature blocks** page, under **Administration** in the sidebar: edit a name, position or label, add one such as "Approved by", move one up or down, or archive one to leave it off. Changes show on the next report made, and go in the audit log.

## Backups

```
npm run backup
npm run backup -- --photos
```

This writes files to `backups/`, named by the Philippine date and time they were taken, such as `snapshot-2026-11-08-1942.json`, so two backups on one day sit side by side. A backup never overwrites another. Without `--photos`, the photo files themselves aren't copied.

| File | Use |
|---|---|
| `snapshot-<date>-<time>.json` | What `npm run restore` reads |
| `interventions`, `status-history` and `barangay-attributes`, as `.csv` and `.geojson` | Opening in a spreadsheet or QGIS |
| `photos-<date>-<time>/` | The photo files, with `--photos` |

We suggest a backup at least weekly, and always before a migration or restore. The Supabase free plan has no automatic backups you can rely on, so these files may be the only copy.

Backups stay on this computer until you copy them elsewhere, so keep a copy on another drive. **They hold beneficiary names, so don't share them.** They don't include logins or passwords.

## Restoring

Take a fresh backup first, if the database is still readable. A restore runs as one transaction, so if it fails, nothing changes.

**Into an empty database:**

```
npm run restore -- backups/snapshot-2026-11-05-0930.json --yes
```

**Over existing records:**

```
npm run restore -- backups/snapshot-2026-11-05-0930.json --yes --replace
```

**`--replace` removes every record made since the backup.** Status entries, photo links, saved views, import batches and dismissed flags go back to the backup too, and any work encoded since then is lost. The audit log keeps its newer entries. Photo files uploaded since then stay in storage, but nothing links to them.

Add `--photos backups/photos-2026-11-05-0930` to either command to upload the photo files too. Ask everyone to reload the map afterwards.

**Moving to a new Supabase project:**

1. Point `.env.local` at the new project and run `npm run db:migrate`. Don't run `db:seed`.
2. Run the restore without `--replace`.
3. Repeat steps 4 and 5 of [First-time setup](#first-time-setup), and invite everyone again.
4. Deploy, since the website's settings have changed, and set the Supabase URL settings in the new project, as described in [Deploying](#deploying).

The new project has no accounts, so "created by" and "updated by" become empty and saved views are left out. The audit log keeps the old account ids.

A backup made before `0009_assessed.sql` doesn't say which statuses count as assessed. Restoring it keeps the settings the project already has, and a status that only the backup has starts out counting. Check Admin, Statuses afterwards.

A backup made before `0010_import_qa.sql` has no dismissed flags and no undone imports. Restoring it leaves every flag open in the QA queue, and its imports as not undone.

A backup made before `0011_reports.sql` has no signature blocks. Restoring it keeps the ones the project already has.

## Changing the database

Run the migration before deploying the site that needs it. Otherwise, people can't use the new features until it's applied. For example, exports are refused until `0006_export.sql` is in. `0012_lines.sql` (Phase 16) only relaxes two rules and switches nothing on, so it's safe to apply while the live site still runs older screens. `npm run test:live` passes before and after it, as its type test is about polygons, which stay refused. `0013_line_drawing.sql` (Phase 16b) lets the save functions take a road's line, and saves points as before, so it's safe to apply early too. It has to be in before the screens that draw lines go live: the older save functions ignore a line, so a drawn line would be dropped without an error. `0014_line_import.sql` (Phase 16c) does the same for imports: it lets `import_records` take a road's line, in one part or several, and imports points as before. It has to be in before the screens that import lines go live, for the same reason.

Add a new numbered file to `supabase/migrations`, take a backup, then run `npm run db:migrate`. Each file runs once, in its own transaction, and a failed file is rolled back. Never edit a file that has already been applied, because the change won't run.

## Proving it works

Both of these use the real project and need a filled-in `.env.local`:

```
npm run test:live
npm run test:e2e:live
```

- **`test:live`** checks what each role can and can't do on the real service, including Storage and Realtime.
- **`test:e2e:live`** opens two browsers at once, and checks that an edit on a computer reaches a phone within the limit in the spec (about 2 seconds, tested at 2.5).

To run the browser test against the deployed site instead of a local build, in PowerShell:

```
$env:LIVE_URL = "https://your-site.netlify.app"
npm run test:e2e:live
Remove-Item Env:LIVE_URL
```

**Netlify's badge.** Netlify can add a "Powered by Netlify" badge script (`/.netlify/scripts/hud?variant=public`) to every page of a new deploy. Its setting is under **Project configuration → General → Powered by Netlify badge**. The site's security rules keep the badge from showing either way. The live tests that fail on anything blocked don't load that one script (see `e2e-live/netlify.ts`); anything else that's blocked still fails them.

These tests create temporary `e2e-test-` accounts, test records, imports, dismissed flags, list items, a test signature block and saved views, then remove them, including from the audit log. They also download each report and print the map. They make invite links rather than sending invite emails, so test the email itself as described in [Invite emails](#invite-emails). If a run crashes, the next run cleans up what it left. The test records can appear briefly on the real map, so run these when nobody is encoding.

**If a default view is set,** choose **Stop opening on this** before running `test:e2e:live`, and set it again afterwards. The tests never change a real default, but several of them expect the map to open on everything.

## Working on the code

**Once `.env.local` exists, `npm run dev` uses the real data.** Use `npm run dev:local` for development work.

| Command | Data |
|---|---|
| `npm run dev:local` | Local mode. Data stays in that browser. |
| `npm run dev` | The real project if `.env.local` is filled in, otherwise local mode. |
| `npm run dev:phone` | Same as `dev`, over https and open to your network. Use it on a trusted network only. |

Local mode and the browser tests need the local dataset, so run `npm run build:local-seed` once.

The colors, type and spacing come from `design/tokens.json`, the signed-off design. After it changes, run `npm run build:tokens` to rewrite `src/app/tokens.css`. `npm test` fails while the two disagree.

`npm test` and `npm run test:e2e` never touch the real project. The browser tests answer every Supabase call themselves.

### Loading speed

The first load holds the app's frame, Home and the map with Leaflet, as most people open the map. The Dashboard's charts, the Interventions, Admin, work and report pages, and the PDF, Excel and file readers each load when they're opened. The data starts loading as soon as someone signs in, and once the first page has its data the browser fetches the other pages' code while it's idle, so a page is usually ready by the time it's asked for. Phase 17b tried loading the map apart too, which halved the first load, but the map then took 0.2 to 0.4 s longer to appear after signing in, so it was left in.

`npm run build` measures the first load, gzipped as Netlify sends it, and fails if it's over budget: 215 kB of script and 22 kB of styles (`FIRST_LOAD_BUDGET` in `scripts/check-bundle.ts`). In Phase 17b it was 199 kB and 20 kB. If a change goes over, load the new code with the page that needs it, with `lazy()` or `import()`, rather than raising the budget.

Files under `/assets` have a hash of their content in their name, so `netlify.toml` lets browsers keep them for a year. `index.html` and the boundaries are checked on every visit, so a deploy shows at once.

### Loading, errors and empty pages

Every page shows the same three states (`overview/PageState.tsx`): **Loading…** with a spinner, shown only once the wait is noticeable; **could not load**, in plain words with **Try again**, and the original message under **Details**; and a page an account can't open. An error while drawing a page shows in place of that page, with the menu still there (`app/ErrorBoundary.tsx`). A list with nothing to show says why: no records yet, filters that match nothing (with **Show all records**), a search that finds nothing (with **Clear the search**), or, in the map's panel, nothing in the map's view.

## When something goes wrong

| What you see | What to do |
|---|---|
| "This copy of the map isn't set up" | The site was built without its settings. Fill in `.env.local`, then `npm run deploy`. |
| "That link has expired or was already used" | Send a new one with `npm run users -- link`. |
| An invite link opens the wrong site | Set `APP_URL`, and the Supabase URL settings, as described in [Deploying](#deploying). Then make a new link. |
| Someone is told their account has no role | If they were deactivated, use `reactivate`. Otherwise they have a login but no profile, which can happen if an invite was interrupted. Give them one with `npm run users -- role someone@example.com encoder`, then add their name in Supabase's Table Editor, in `profiles`. |
| "A newer version of the map is out" | A deploy went out while that tab was open, so the page's old files are gone. The app reloads once by itself; if the message stays, **Reload the page**. |
| "No connection. Check your internet, then try again." | The browser couldn't reach the site or Supabase. Once back online, **Try again**. |
| "Something went wrong on this page" | The page broke while drawing. **Try again**, or open another page from the menu. If it keeps happening, the message under **Details** and the browser's console say what broke. |
| The site can't load data, and scripts can't connect | The project may be paused. Supabase pauses inactive free projects, and you can resume one from its dashboard. |
| A script can't connect, but the site works | Check `SUPABASE_DB_URL`. Use the Session pooler address, and percent-encode special characters in the password. |
| "VITE_... holds a secret" | A secret key is in a setting that gets built into the website. Remove it from `.env.local` and rotate the key. |
| A key may have leaked | Rotate it in Supabase, under Project Settings > API, and update `.env.local`. If it's the publishable key, deploy again. |
