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

## Managing people

Accounts are by invitation only.

| Role | Can do |
|---|---|
| Viewer | See the map and barangay profiles. Can't change anything. |
| Encoder | Viewer, plus add, edit, move and delete records, add statuses and photos, edit barangay baseline values, and see History. |
| Admin | Encoder, plus see deleted records and restore them, manage people, and change the types, forms and lists. |

Do all of this on the **Users** page: **Admin** in the header, then **Users**.

| To | On the Users page |
|---|---|
| See everyone | The list at the bottom shows each person's role, status and last sign-in |
| Add someone | Fill in **Invite someone**, then choose to email it or get a link to send yourself |
| Give a new link (forgotten password, expired link) | **Email a new link** or **Get a new link** on their row |
| Change a role | The role list on their row |
| Correct a name | **Edit name** on their row |
| Remove access | **Deactivate** on their row |
| Give access back | **Reactivate** on their row |

- **Links:** a link works once and expires, so send it privately and soon. Getting a link works even before email is set up.
- **Role changes** apply the next time the person loads the map.
- **People who leave:** deactivate them rather than deleting the account. Their name stays on what they encoded.
- **There's always an Admin:** you can't change your own role or deactivate yourself, and the database refuses any change that would leave no active Admin. To step down, have another Admin do it.

If the page can't reach its function, the same things can be done from this computer with `npm run users -- list`, `invite someone@example.com --role encoder --name "Full Name"`, `link`, `role`, `deactivate` and `reactivate`.

### Before inviting the MAOs

**Set up a custom SMTP sender first.** Supabase's built-in sender only delivers to your own Supabase team, and only 2 emails an hour, so invites to the MAOs would fail.

The project has no email domain of its own, so use a **dedicated Gmail account with an app password**. It's free and needs no domain. Most free services need a domain you own: Resend does, and Brevo replaces a Gmail sender's address, which hurts delivery. If the office gets its own domain, Brevo's free plan (300 emails a day) is the better choice.

1. **Create a new Gmail account just for this**, such as `da.marinduque.map@gmail.com`. An app password can reach the whole mailbox, so keep this separate from anyone's personal email.
2. **Turn on 2-Step Verification** for that account, at [myaccount.google.com/security](https://myaccount.google.com/security). Google requires it for app passwords.
3. **Create an app password**, at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords). Name it `Supabase`, and copy the 16 letters it shows.
4. **In Supabase, go to Authentication > Emails > SMTP Settings**, turn on custom SMTP, and enter:

   | Setting | Value |
   |---|---|
   | Sender email | The new Gmail address |
   | Sender name | `DA Marinduque Intervention Map` |
   | Host | `smtp.gmail.com` |
   | Port | `587` |
   | Username | The new Gmail address |
   | Password | The 16 letters, without spaces |

5. **Check the limit**, under Authentication > Rate Limits. It starts at 30 emails an hour, which is enough for the MAOs.
6. **Test it.** On the Users page, invite an address that isn't on the map yet, choosing to email it. Confirm the email arrives, look in spam too, and confirm its link opens the page to set a password. Then deactivate that test account.

The app password stays in Supabase's settings. Don't put it in `.env.local` or anywhere in this project, and never paste it into a chat. Changing the Gmail account's password cancels the app password, so make a new one and update Supabase if that happens.

If invites land in spam, ask the MAOs to mark the first one as not spam. Google's own advice is to prefer other sign-in methods over app passwords, but Supabase's email settings only take a password. Only invites and password resets are sent, so the volume stays low.

## Customizing the map

An Admin can change these from **Admin** in the header. Changes reach every open map within a couple of seconds, with no code release.

| Page | What it changes |
|---|---|
| **Intervention types** | Add a type or activate one, which adds its layer to the map. Set its name, color, icon, geometry, which standard fields are required or hidden, its status list, and its custom fields |
| **Categories** | What a record is within its type, with its group and icon |
| **Programs** | Banner programs. A program's color is the color of its markers everywhere, including exports |
| **Statuses** | All the status names, and whether each **counts as assessed**: says a unit's condition has been checked. Each type picks its own list on its page, and which of them count as operational |
| **Other lists** | Category groups, beneficiary types, location bases and icons |
| **Barangay fields** | The baseline values on each barangay's profile |

- **Nothing is deleted:** lists and fields are archived, so existing records keep their meaning. An archived item leaves the choices for new records, stays on records that have it, and can be restored.
- **What can't change:** a code or field key, once made. A saved field's kind. A type's geometry once it has records. A status stays on a type's list while any record is at it.
- **Custom field kinds:** text, number, date, dropdown, yes or no, and photo. Barangay fields can't be photos, as photos belong to a record.
- **Icons:** upload a simple one-color SVG with a `viewBox`, up to 20 KB. Files holding scripts or links are refused.
- **Line and polygon types:** these can be set up but **not activated until drawing them on the map is built**. Their Active switch is greyed out with the note "Needs drawing tools (not yet built)", and the database refuses it too, so no record is saved without a shape.
- **Two Admins at once:** if someone else saves a type or the barangay fields while you're editing them, you're told, and your save is held until you load their version.

## The dashboard and records table

On a computer these sit beside the map, and on a phone the **Map**, **Dashboard** and **List** tabs take turns. Everything follows the map's filters, so the map, the numbers, the table and an export can't disagree. **Limit to map view** narrows them to what's on screen, and leaves out records with no coordinates while it's on.

| Figure | How it's counted |
|---|---|
| Total interventions | Records, whatever their quantity |
| Machinery units, SSIPs and other types' units | The quantity on each record |
| Beneficiaries (approx.) | Different beneficiary names, ignoring case, spacing and punctuation, so "Bantad F.C.A." and "bantad fca" count once. It's approximate until records have beneficiary types and there's a proper list of beneficiaries |
| % operational | Units at a status marked as operational on that type's page in Admin, out of the units whose condition has been checked. A status that doesn't **count as assessed** in Admin, Statuses, such as Turned-over (delivered, not checked) or Unknown, is left out, and its units are shown under the figure as not yet assessed. Turned-over, Undelivered/For Distribution, Proposed, Inventory, On-going, Completed and Unknown start that way |
| Barangays with no intervention yet | Out of the barangays the filters cover |
| Records needing QA | Any QA flag except a shared point, which is often correct |

**Show table** on each chart gives the same numbers as a table. **Export this table** exports all the rows found, on every page, in their order, and is logged like any other export. The search shows in the dialog, the audit log and a KML or KMZ's "Read me". It's left out of the file name, as it can be someone's name.

## Coloring, filtering and saved views

- **Color markers by** and **Filter by another field**, in the layers panel, offer every field, including each type's custom fields. Text that belongs to one record, such as a beneficiary's name, can be filtered but not used for color.
- **Exports keep program colors**, even while the map is colored by something else.
- **Saved views** keep the layers, filters, colors, basemap and map position. Anyone signed in can save their own. A view is personal until shared with everyone, and only its owner can change it.
- **The default view:** an Admin can pick **Open on this** on a shared view, and everyone's map then opens on it, with a notice saying so. It doesn't apply to a link to a barangay or record. To retire it, choose **Stop opening on this**.
- **Removing a shared view:** an Admin can delete anyone's shared view, such as one left by someone who has moved on. Nobody can see another person's personal views, including Admins.
- **Something removed later:** a view that uses a field, program or type that has since gone still opens, and ignores it.

## The audit log

**Admin**, then **Audit log**, shows who changed what and when, for Admins only. Filter by person, record, action and date. Times and dates are Philippine time. Each line links to its record, or to the page where that item is managed. A record that's been deleted opens on its history.

- **"No login (a script or Supabase's dashboard)"** means the change didn't come through the website, such as a seed, a correction by script or an edit in Supabase's table editor.
- **"An account since removed"** means that person's account no longer exists. The line stays.
- **Nothing here can be edited**, even by an Admin. The only lines that ever leave are the temporary ones from the live tests in [Proving it works](#proving-it-works).
- **Reasons:** changing a barangay needs a reason everywhere on the website: Resolve flag, **Move and set barangay**, and the Edit form. The reason shows on the line. A script can still change a barangay without one, and the log then shows no login.

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

## Backups

```
npm run backup
npm run backup -- --photos
```

This writes dated files to `backups/`. Without `--photos`, the photo files themselves aren't copied.

| File | Use |
|---|---|
| `snapshot-<date>.json` | What `npm run restore` reads |
| `interventions`, `status-history` and `barangay-attributes`, as `.csv` and `.geojson` | Opening in a spreadsheet or QGIS |
| `photos-<date>/` | The photo files, with `--photos` |

We suggest a backup at least weekly, and always before a migration or restore. The Supabase free plan has no automatic backups you can rely on, so these files may be the only copy.

Backups stay on this computer until you copy them elsewhere, so keep a copy on another drive. **They hold beneficiary names, so don't share them.** They don't include logins or passwords.

## Restoring

Take a fresh backup first, if the database is still readable. A restore runs as one transaction, so if it fails, nothing changes.

**Into an empty database:**

```
npm run restore -- backups/snapshot-2026-11-05.json --yes
```

**Over existing records:**

```
npm run restore -- backups/snapshot-2026-11-05.json --yes --replace
```

**`--replace` removes every record made since the backup.** Status entries, photo links, saved views and import batches go back to the backup too, and any work encoded since then is lost. The audit log keeps its newer entries. Photo files uploaded since then stay in storage, but nothing links to them.

Add `--photos backups/photos-2026-11-05` to either command to upload the photo files too. Ask everyone to reload the map afterwards.

**Moving to a new Supabase project:**

1. Point `.env.local` at the new project and run `npm run db:migrate`. Don't run `db:seed`.
2. Run the restore without `--replace`.
3. Repeat steps 4 and 5 of [First-time setup](#first-time-setup), and invite everyone again.
4. Deploy, since the website's settings have changed, and set the Supabase URL settings in the new project, as described in [Deploying](#deploying).

The new project has no accounts, so "created by" and "updated by" become empty and saved views are left out. The audit log keeps the old account ids.

A backup made before `0009_assessed.sql` doesn't say which statuses count as assessed. Restoring it keeps the settings the project already has, and a status that only the backup has starts out counting. Check Admin, Statuses afterwards.

## Changing the database

Run the migration before deploying the site that needs it. Otherwise, people can't use the new features until it's applied. For example, exports are refused until `0006_export.sql` is in.

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

These tests create temporary `e2e-test-` accounts, test records, list items and saved views, then remove them, including from the audit log. They make invite links rather than sending invite emails, so test the email itself as described in [Before inviting the MAOs](#before-inviting-the-maos). If a run crashes, the next run cleans up what it left. The test records can appear briefly on the real map, so run these when nobody is encoding.

**If a default view is set,** choose **Stop opening on this** before running `test:e2e:live`, and set it again afterwards. The tests never change a real default, but several of them expect the map to open on everything.

## Working on the code

**Once `.env.local` exists, `npm run dev` uses the real data.** Use `npm run dev:local` for development work.

| Command | Data |
|---|---|
| `npm run dev:local` | Local mode. Data stays in that browser. |
| `npm run dev` | The real project if `.env.local` is filled in, otherwise local mode. |
| `npm run dev:phone` | Same as `dev`, over https and open to your network. Use it on a trusted network only. |

Local mode and the browser tests need the local dataset, so run `npm run build:local-seed` once.

`npm test` and `npm run test:e2e` never touch the real project. The browser tests answer every Supabase call themselves.

## When something goes wrong

| What you see | What to do |
|---|---|
| "This copy of the map isn't set up" | The site was built without its settings. Fill in `.env.local`, then `npm run deploy`. |
| "That link has expired or was already used" | Send a new one with `npm run users -- link`. |
| An invite link opens the wrong site | Set `APP_URL`, and the Supabase URL settings, as described in [Deploying](#deploying). Then make a new link. |
| Someone is told their account has no role | If they were deactivated, use `reactivate`. Otherwise they have a login but no profile, which can happen if an invite was interrupted. Give them one with `npm run users -- role someone@example.com encoder`, then add their name in Supabase's Table Editor, in `profiles`. |
| The site can't load data, and scripts can't connect | The project may be paused. Supabase pauses inactive free projects, and you can resume one from its dashboard. |
| A script can't connect, but the site works | Check `SUPABASE_DB_URL`. Use the Session pooler address, and percent-encode special characters in the password. |
| "VITE_... holds a secret" | A secret key is in a setting that gets built into the website. Remove it from `.env.local` and rotate the key. |
| A key may have leaked | Rotate it in Supabase, under Project Settings > API, and update `.env.local`. If it's the publishable key, deploy again. |
