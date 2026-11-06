# Running the Intervention Map

For the Admin who sets up and looks after the map. Commands run in the project folder, on the Admin's computer.

The site has two parts: the website on Netlify, and the database, logins, photos and live updates on Supabase. Everything is controlled from this computer through `.env.local`, which holds the project's keys. Git ignores that file, so **keep your own safe copy of the keys, and never paste them into a chat or commit them.**

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
6. **Add yourself as the first Admin:**
   ```
   npm run users -- invite you@example.com --role admin --name "Your Name"
   ```
7. **Put the site online** (see [Deploying](#deploying)), then [prove that it works](#proving-it-works).

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
| Admin | Encoder, plus see deleted records and restore them. |

| To | Run |
|---|---|
| See everyone | `npm run users -- list` |
| Add someone | `npm run users -- invite someone@example.com --role encoder --name "Full Name"` |
| Give a new link (forgotten password, expired link) | `npm run users -- link someone@example.com` |
| Change a role | `npm run users -- role someone@example.com viewer` |
| Remove access | `npm run users -- deactivate someone@example.com` |
| Give access back | `npm run users -- reactivate someone@example.com` |

- **Links:** `invite` and `link` print a link for you to send. It works once and expires, so send it privately and soon.
- **Email instead:** add `--send-email` to `invite` to have Supabase send it. Its built-in sender allows only a few emails an hour, so see [Before inviting the MAOs](#before-inviting-the-maos).
- **Role changes** apply the next time the person loads the map.
- **People who leave:** deactivate them rather than deleting the account. Their name stays on what they encoded.

### Before inviting the MAOs

**Set up a custom SMTP sender first.** Supabase's built-in email sends only a few emails an hour, so a batch of MAO invites would stall or fail.

1. Choose an email provider and verify the address the invites will come from.
2. In Supabase, go to Authentication > Emails > SMTP Settings. Turn on custom SMTP and enter the provider's host, port, username and password, plus the sender's name and address.
3. Check the email limit under Authentication > Rate Limits, and raise it if it's lower than the batch you plan to send.
4. Test it by inviting one person with `--send-email` and confirming the email arrives and the link opens the map.

The SMTP password stays in Supabase's settings. Don't put it in `.env.local` or anywhere in this project.

## Exports

Every signed-in role can export, from the **Export** button on the map or **Export this barangay** in a profile. An export takes what the map's filters show, and each one is recorded in the audit log: who, the format, the filters and the record count. If the log can't be written, nothing is downloaded.

| Format | Records without coordinates | Good for |
|---|---|---|
| KMZ | Listed by name in the file's description | Google Earth, with the map's icons |
| KML | Listed by name in the file's description | Google Earth and QGIS, with colored dots |
| CSV | Included, with blank latitude and longitude | Excel |
| GeoJSON | Included, with no geometry | QGIS and web maps |
| Shapefile | Listed in `records-left-out.txt` in the .zip | QGIS and ArcGIS |

- **Shapefile field names:** these are limited to 10 characters, so `fields.txt` in the .zip gives each one's full name. Text over 254 bytes is cut short, and `fields.txt` says which fields that happened to.
- **Records outside Marinduque:** these have coordinates, so they're exported where they're plotted, with their QA flag showing, even though the map leaves them off.
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

These tests create temporary `e2e-test-` accounts and test records, then remove them, including from the audit log. If a run crashes, the next run cleans up what it left. The test records can appear briefly on the real map, so run these when nobody is encoding.

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
