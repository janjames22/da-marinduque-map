# DA Marinduque Intervention Map — Website Specification

**Project:** Customizable, real-time GIS map of all DA interventions in the Province of Marinduque, built on its 218 barangays
**Prepared for:** Provincial Agriculture Office (PAO), Marinduque — ABE Section
**Prepared by:** Engr. Jan James P. Graza, ABE
**Starting dataset:** *Consolidated Inventory Report – SPIS and Farm Machinery Equipment, Province of Marinduque* (RAED, Oct 21, 2026; generated from the ABEMIS Inventory Database)
**Version:** 2.0. Data model (§4) and build phases (§9) confirmed.

**Changes from v1.0:** the system is no longer a viewer for the RAED machinery inventory. RAED is now only the first import. Barangays are the base layer, intervention types and their fields are defined by admins, editing happens on the map, and status changes are kept as history.

---

## 1. Purpose

Build a website where the PAO can encode, see and plan **any DA intervention in any barangay** of Marinduque:

1. Show all 218 barangays on an interactive map at all times, including those with no interventions, so gaps are visible for planning.
2. Let authorized users add, move, reshape, edit and delete interventions directly on the map. Changes appear on every open map immediately.
3. Let admins define new intervention types, with their own geometry, icon, color, statuses and fields, without code changes.
4. Let each user choose what the map shows: layers, color, filters. Views can be saved and shared.
5. Keep a dashboard (counts, charts, filters) linked to the map.
6. Export any layer as **KML** and **KMZ** for Google Earth, plus GeoJSON, CSV and a printable map.

The map module should be designed so it can later be added to the **ABE Project Data Consolidation System (ABE PDCS)** as one of its modules.

---

## 2. Users and Roles

| Role | Can do |
|---|---|
| **Admin** (ABE/PAO) | Manage users, intervention types, form fields and lookups; all editing; bulk import; restore deleted records; view audit log |
| **Encoder** (MAO / ABE staff) | Add, edit, move and soft-delete interventions; update status; upload photos; edit barangay baseline values; import CSV/XLSX |
| **Viewer** (PAO head, partners) | View map, dashboard and barangay profiles; filter; save views; export |
| **Public** (optional, later) | Read-only map with limited fields |

---

## 3. Starting Dataset: RAED Report

The RAED report is the first import, not the system's scope. It lists machinery already turned over, plus SPIS. It is tagged `data_source = "RAED 2026-10-21"`. Machinery records go under the type **Farm Machinery**. The 4 SPIS records go under the type **SSIP**, category SPIS.

**Seed file:** `data/source/seed_interventions.csv`, 199 records (195 machinery, 4 SPIS), already cleaned. The original PDF is used only for spot checks. Each row's `source_page` gives its page.

| Count | Values |
|---|---|
| Municipality | Santa Cruz 48, Boac 38, Torrijos 36, Gasan 33, Mogpog 25, Buenavista 19 |
| Status | Turned-over 163, Serviceable 32; the 4 SPIS records take their status from the Stage column (Inventory 2, Completed 2). The report gives no status dates, so these show as "as of 2026-10-21 (RAED report)" |
| Banner program | Rice 62, HVCDP 59, Corn 38, Organic 30, Livestock 9, Urban and Peri-Urban 1 |
| Year funded | 2014–2026, peaking in 2025 (44) and 2022 (36) |

### 3.1 Data-quality issues in the RAED data

Importing must keep these records and flag them. It must never drop or silently correct them.

| Issue | Records | Handling |
|---|---|---|
| No coordinates | 26 (24 blank, 2 written as `0, 0`) | Stored as unlocated, listed in "Needs geotag", left off the map |
| Outside the province | 1: Malibago, Torrijos, longitude `122.90523` (the barangay lies at about 122.0° E) | Flagged and left off the map; a person confirms the correction |
| Outside the encoded municipality | 5, including Malibago | Flagged, still plotted, with a warning in the popup |
| Outside the encoded barangay | 28 of the 169 located records that have a linked barangay (median about 1.4 km away, leaving out the Malibago typo) | Flagged, still plotted. Counted under the encoded barangay. The popup says "Plotted in [X], encoded as [Y]" |
| Blank barangay | 5 | Flagged; shown under "Unassigned" |
| Barangay name not on the official list | 4 (Pingan, Pag asa, Pagasa, Barangay 367) | Flagged; shown under "Unassigned"; the raw name is kept |
| Beneficiary names a place outside Marinduque | 7 (Guiuan, Tanauan, Taal) | Manual review flag carried over from the seed file |
| Shared coordinates | 24 records | Normal when one FCA has several machines. Use clustering and spiderfy so none are hidden |

Corrections to these records go through a reviewed file (§5.6). For a printed field check, the MAOs get `data/corrections/for-field-verification.csv`, which leaves out records flagged only for shared coordinates.

RAED records have `location_basis` = "Unknown": the report doesn't say whether a coordinate marks the unit, the FCA's office or the barangay center.

**Coverage:** the RAED records reach 93 of the 218 barangays through their encoded barangay. The other 125 show as "no intervention yet" until more data is encoded. This reflects what has been encoded, not what exists on the ground.

---

## 4. Data Model

Nothing user-facing is hard-coded. Programs, categories, statuses, beneficiary types, icons, colors, intervention types and form fields are all data that admins can edit.

The only fixed values are system vocabulary that code depends on: user roles, geometry kinds, field input kinds and QA flags.

Editable lookups are archived rather than deleted, so existing records keep their meaning.

### 4.1 `intervention_types` (admin-defined)

| Field | Notes |
|---|---|
| id, code, name | `code` is stable once created |
| geometry_kind | `point`, `line` or `polygon`. Cannot change once the type has records |
| icon_id, color | Default style for the layer |
| core_field_rules | jsonb: whether each standard field is required, optional or hidden for this type |
| field_schema | jsonb: the custom fields (§4.3) |
| sort_order, is_active | |

**Active types:** Farm Machinery (point) and SSIP (point, marking the pump or intake location).

**Inactive types:** Farm-to-Market Road (line), Postharvest Facility (point), Irrigation Canal (line), Service Area (polygon) and Other (point). These have `is_active = false` and are hidden in the UI. The framework stays in place, so an admin can activate them from `/admin`.

`geom` stays generic so SSIP service-area polygons can be added later. SSIP is a point type for now, and a type's geometry kind can't change once it has records, so that change will need its own design: a separate polygon on the record, or a linked Service Area record.

### 4.2 `interventions`

| Field | Type | Notes |
|---|---|---|
| id | UUID | |
| intervention_type_id | FK | Required |
| category_id | FK | Optional, depending on the type |
| title | text | Project title. The display name falls back to the category |
| banner_program_id | FK | Rules per type |
| year_funded | int | Rules per type |
| quantity | int | Default 1 |
| unit_cost | numeric | Optional |
| fund_source | text | Optional |
| beneficiary | text | Cleaned name |
| beneficiary_type_id | FK | |
| municipality_id | FK | Required. Primary municipality |
| barangay_id | FK | Primary barangay. Null means unassigned, and the record is flagged |
| barangay_raw | text | Barangay name as written in the source |
| location_basis_id | FK | Optional. What the coordinates mark (§4.5). The popup shows it, and the map can filter or color by it |
| geom | geometry(Geometry, 4326) | Point, line or polygon, matching the type. Null means unlocated |
| status_id | FK | Current status. Maintained from `status_history`; not edited directly |
| attributes | jsonb | Custom field values, validated against the type's `field_schema` |
| remarks | text | |
| data_source | text | e.g. `RAED 2026-10-21` |
| import_batch_id | FK | Set for imported records |
| source_id, source_page | text, int | Source traceability |
| source_raw | jsonb | The complete source row, for any dataset |
| qa_flags | text[] | See §4.6 |
| version | int | Stops two users overwriting each other's edits |
| created_by/at, updated_by/at, deleted_at | | Soft delete |

### 4.3 Custom fields: `field_schema`

```json
{
  "fields": [
    { "key": "engine_no", "label": "Engine No.", "input": "text" },
    { "key": "capacity_hp", "label": "Capacity", "input": "number", "unit": "hp" },
    { "key": "date_turned_over", "label": "Date turned over", "input": "date" },
    { "key": "drive_type", "label": "Drive type", "input": "dropdown", "required": true,
      "options": [{ "value": "engine", "label": "Engine" }, { "value": "solar", "label": "Solar" }] },
    { "key": "has_operator", "label": "Has trained operator", "input": "yes_no" },
    { "key": "site_photo", "label": "Site photo", "input": "photo" }
  ]
}
```

- Input kinds: text, number, date, dropdown, yes/no, photo.
- `key` and option `value` never change once in use. Labels can.
- Removing a field archives it. Existing values are kept.
- Values are checked in the form and again in the database.
- Variant, engine number, serial number and date turned over are Farm Machinery custom fields, not fixed columns, because they don't apply to every type.
- SSIP starts with water source, service area (ha), farmer-beneficiaries (no.), pump capacity and solar capacity (kWp). Progress is tracked by status alone.

### 4.4 Barangays

`barangays` holds the official name, PSGC code, polygon and `attributes` (jsonb) for baseline values. `barangay_field_schema` is a single admin-editable schema in the §4.3 format, starting with agricultural area, number of farmers, main crops, irrigated area and remarks. All are optional.

`intervention_barangays` (intervention_id, barangay_id, link_source) lists every barangay a record belongs to, so a road crossing three barangays appears in all three profiles. It is maintained automatically:

- **Point:** the encoded barangay.
- **Line or polygon:** the encoded barangay, plus every barangay the shape crosses.

### 4.5 Other tables

| Table | Key columns |
|---|---|
| `status_history` | id, intervention_id, status_id, status_date, date_basis, source_note, remarks, photo_id, created_by, created_at. Entries are added, never overwritten. A backdated entry doesn't replace a later one as current. `date_basis` says whether the date is when the status changed (`changed`) or when it was reported (`as_of`), so RAED entries show as "as of 2026-10-21 (RAED report)" |
| `statuses` | id, name, color, sort_order, is_active |
| `intervention_type_statuses` | intervention_type_id, status_id, sort_order, is_default, counts_as_operational: the status list for each type, and which of its statuses count as operational for that type |
| `programs` | id, code, name, color, sort_order, is_active |
| `categories` | id, code, name, intervention_type_id, category_group_id, icon_id, sort_order, is_active |
| `category_groups` | id, code, name, sort_order |
| `beneficiary_types` | id, name, sort_order, is_active |
| `location_bases` | id, name, color, sort_order, is_active. Starts with: Actual unit/structure location; FCA office/storage; Barangay center (approximate); Unknown |
| `icons` | id, name, image. KML/KMZ exports use a PNG version |
| `municipalities` | id, name, psgc_code, boundary |
| `intervention_photos` | id, intervention_id, storage_path, caption, taken_at, exif_location |
| `saved_views` | id, name, owner_id, config (layers, filters, style, extent, basemap), is_shared |
| `import_batches` | id, file_name, data_source, intervention_type_id, column_mapping, counts, imported_by, imported_at |
| `profiles` | id, full_name, role |
| `audit_log` | id, table_name, record_id, action, old_row, new_row, actor_id, context, at. Covers every create, edit and delete, including admin changes. `context` holds extra detail, such as the evidence behind a correction |

### 4.6 QA flags

Flags are recalculated by the database on every save. Values sent by a client are ignored, except manual flags.

| Flag | Meaning |
|---|---|
| `no_coords` | No geometry |
| `out_of_province` | Any part lies outside the bounding box (§12) |
| `muni_mismatch` | Geometry doesn't touch the encoded municipality (250 m tolerance) |
| `barangay_mismatch` | New. Geometry doesn't touch the encoded barangay (250 m tolerance). Depends only on location: it clears when the barangay is corrected or the point moved so they agree. Location basis doesn't affect it |
| `no_barangay` | No barangay encoded |
| `barangay_unmatched` | A barangay name was given but isn't on the official list |
| `duplicate_point` | Another point shares the exact coordinates. Informational, excluded from the "needs QA" count |
| `beneficiary_name_check` | Manual review flag. Kept until a person clears it |

### 4.7 Starting status lists

| Type | Statuses | Counts as operational |
|---|---|---|
| Farm Machinery | Turned-over, Serviceable, Needs Repair, Unserviceable, For Condemnation, Undelivered/For Distribution, Unknown | Turned-over, Serviceable |
| SSIP | Inventory, On-going, Completed, Operational, Needs Repair, Non-operational | Operational (Completed doesn't count) |
| All inactive types | Proposed, On-going, Completed, Operational, Needs Repair, Non-operational, Unknown | Operational |

Admins can edit these lists per type.

### 4.8 Starting categories

**Farm Machinery:** the machinery categories in the RAED seed, plus Disc Plow / Harrow, Seeder and Rice Reaper.

**SSIP:** Solar-Powered Irrigation System (SPIS), Small Farm Reservoir (SFR), Shallow Tube Well (STW), Pump Irrigation from Open Source (PISOS), Small Water Impounding Project (SWIP) and Diversion Dam.

**Any type:** Other.

---

## 5. Features

### 5.1 Barangay base layer and profiles

- All 218 barangay polygons are always on the map, including those with no interventions.
- **Clicking a barangay opens its profile:**
  - every intervention in it, of any type and any year
  - counts by type and by program
  - baseline attributes, editable by Encoders and Admins
  - an **"Add intervention here"** button
- **Choropleth modes:**
  - **Number of interventions**
  - **By program:** pick a program; shade by its count
  - **By type:** pick a type; shade by its count
  - **No intervention yet:** the gap view, a key planning feature. It respects active filters, so "no Rice Program machinery yet" works
- Barangay shading follows the encoded barangay, plus any barangay a line or polygon crosses.
- Records with no linked barangay are shown as an **"Unassigned"** count beside the legend, so a blank barangay isn't mistaken for a true gap.
- The gap view legend says "none encoded yet", because it reflects encoded data.
- Municipal totals count each record once, even if a road crosses several barangays.

### 5.2 Layers and customizable map view

- **Layer panel:** each active intervention type is its own toggleable layer, plus boundaries (province, municipal, barangay) and basemaps. Activating a type adds its layer automatically.
- **Basemaps:** OpenStreetMap, Esri World Imagery, topographic, and hybrid (Esri imagery + labels).
- **Color by:** program, status, year, type, location basis, or any dropdown field, including custom fields.
- **Filter by:** any field, including custom fields. Also municipality, barangay, year range and data source.
- **Saved views:** name and save the current layers, filters, style and extent. Views are private by default and can be shared with other users. A field later removed from a type is ignored, not treated as an error.
- **Markers:** icon by category or type. Cluster at low zoom; spiderfy shared coordinates. Lines and polygons are styled with the same colors.
- **Popup:** details, custom fields, photos, status timeline, location basis, coordinates (copy button), "Open in Google Maps", "Edit" (if permitted). A flagged point says "Plotted in [X], encoded as [Y]".
- **Other views and tools:** heatmap, search, locate-me, measure, draw a polygon to select, coordinate readout, scale bar, fullscreen.
- **Map ↔ dashboard sync:** filters apply to both. "Filter by map extent" optionally limits dashboard numbers to the visible area.

### 5.3 Real-time editing on the map

This is the main use of the system. Phase 3 builds point editing only, since both active types are points. Line and polygon drawing and vertex editing follow when those types are activated.

- **Add:** click the map (point) or draw (line/polygon). Starting from a barangay profile preselects that barangay.
- **Edit:** drag to move, edit vertices, and delete (soft), all directly on the map.
- **Location fill:** municipality and barangay are suggested from where the shape was placed, and can be changed.
- **Generated form:** the form comes from the type's `core_field_rules` and `field_schema`.
- **Other ways to set a location:** type DD or DMS, paste from Google Maps ("13.4671, 122.0686"), use device GPS, or use EXIF GPS from a geotagged photo.
- **Validation before saving:**
  - Inside the Marinduque bounding box, and inside the selected municipality and barangay. These show warnings that can be overridden; the flag stays on the record.
  - Possible duplicate (same type, category, beneficiary, year and barangay). A warning only, because an FCA can receive two identical units.
  - Required fields and field formats. These block saving.
- **Realtime:** every change appears on every open map and in the dashboard without a reload.
- **Simultaneous edits:** if two users edit the same record, the second is told it changed and sees the latest version. Neither edit is silently lost.
- **Status history:** changing a status adds an entry (status, date, remarks, photo, user). The popup shows the timeline, e.g. Turned-over → Serviceable → Needs Repair. An imported status with no known change date shows as "as of [date] ([source])", not as the date it changed.
- **Audit log:** every create, edit and delete is recorded. Deleted records can be restored by an Admin.

### 5.4 Admin customization

- **Intervention types:** create, activate and edit a type's name, geometry, icon, color and status list without code changes.
- **Form builder:** add, reorder and archive fields (text, number, date, dropdown, yes/no, photo).
- **Lookups:** programs, categories, category groups, statuses, beneficiary types, icons and colors.
- **Barangay baseline fields:** the same form builder.
- Changes appear on open maps without a code release.

### 5.5 Dashboard

KPI cards:
- Total interventions
- Total units
- Barangays with at least one intervention, out of 218
- Beneficiaries served
- % operational, using each type's own `counts_as_operational` statuses. For Farm Machinery this is "% turned-over or serviceable". Records with `Unknown` status are left out
- Records needing geotag or QA

Charts:
- Units per **municipality** (bar)
- Units per **banner program** (bar or donut)
- Units per **year funded** (line or column)
- Units by **type** and **category** (horizontal bar, top 15)
- **Status** breakdown (stacked bar per municipality)

Data table:
- Sortable, searchable, paginated
- Clicking a row zooms the map to that record

### 5.6 Import

- Upload CSV, XLSX, KML or KMZ. **Choose the intervention type** (or create one), then **map columns** to standard and custom fields.
- Preview rows with QA flags, then commit as one batch, tagged with a `data_source`.
- Never drop rows. Unmatched names are kept and flagged, with closest candidates shown.
- Barangay names are matched within their municipality, ignoring differences in case, spacing, hyphens and Pob./Poblacion. ñ matches both n and ny.
- The complete source row is kept in `source_raw`.
- The ABEMIS export format should import directly. The RAED seed follows this same path, so future datasets of any type are handled the same way.

**Reviewed corrections:** `data/corrections/corrections.csv` has the columns source_id, field, raw_value, corrected_value, evidence, status (proposed, confirmed or rejected), confirmed_by and confirmed_date.

- Only confirmed rows are applied.
- The raw value is kept, the change is written to `audit_log`, and the database recalculates the flags.
- A confirmed row is rejected if its raw value no longer matches the source, or if its corrected barangay isn't in the record's municipality.

### 5.7 Export and download

| Format | Content | Use |
|---|---|---|
| **KML** | Current filtered records, styled, organized in folders | Google Earth, QGIS |
| **KMZ** | Zipped `doc.kml` + custom icons (+ optional photos) | Google Earth (preferred, keeps icons) |
| GeoJSON | Current filtered features | QGIS, web GIS |
| CSV / XLSX | Table with all fields, including custom fields | Reports, ABEMIS updating |
| PNG / PDF | Printable map with title, legend, north arrow, scale, date, "Prepared by" | Reports, presentations |
| Shapefile (optional) | Zipped .shp/.shx/.dbf/.prj, one file per geometry kind | ArcGIS/QGIS users |

Every export works for any layer and any geometry, and respects the active filters. The file name includes the scope and date, e.g. `Marinduque_FarmMachinery_RiceProgram_2026-11-04.kmz`.

#### KML structure (required)

```
Document: "DA Interventions – Marinduque (exported 2026-11-04)"
├── Styles (icon for points, line and fill for lines and polygons)
├── Folder: Boundaries (optional)
├── Folder: Boac
│   ├── Folder: Tumapon
│   │   ├── Folder: Farm Machinery
│   │   │   └── Placemark: "Hand Tractor – Tumapon FA (2022)"
│   │   └── Folder: Farm-to-Market Road
│   ├── Folder: No barangay
│   └── ...
├── Folder: Buenavista
└── ... (Gasan, Mogpog, Santa Cruz, Torrijos)
```

Each Placemark has:
- `<name>`: display name – Beneficiary (Year), leaving out any part that is blank
- `<description>`: HTML table of all attributes (shown in the Google Earth balloon)
- `<ExtendedData>`: every field as `<Data name="...">`, including custom fields
- `<styleUrl>` pointing to the style in use
- Geometry: `<Point>`, `<LineString>` or `<Polygon>`. **Coordinates are longitude first.**

Example:

```xml
<Placemark>
  <name>Corn Husker-Sheller – Tawiran Corn FA (2025)</name>
  <styleUrl>#farm-machinery-corn</styleUrl>
  <ExtendedData>
    <Data name="Type"><value>Farm Machinery</value></Data>
    <Data name="Program"><value>Corn Program</value></Data>
    <Data name="Status"><value>Turned-over</value></Data>
    <Data name="Municipality"><value>Santa Cruz</value></Data>
    <Data name="Barangay"><value>Tawiran</value></Data>
    <Data name="YearFunded"><value>2025</value></Data>
  </ExtendedData>
  <Point><coordinates>122.06859,13.4671083,0</coordinates></Point>
</Placemark>
```

Notes:
- KML colors are written as `aabbggrr` (alpha, blue, green, red), not `#rrggbb`. Convert them.
- A KMZ is a ZIP containing `doc.kml` at the root and an `icons/` folder; the KML references icons by relative path.
- A record appears once in an export, under its primary barangay, even if it crosses several.
- Unlocated records are left out of KML/KMZ and listed in a note in the document description.

### 5.8 Reports (later phase)

- One-page municipal profile: map plus summary table, printable as PDF.
- Printable barangay profile.
- Beneficiary profile: all interventions received by an FCA.
- Year-end inventory report in the same layout as the RAED consolidated report.

---

## 6. Recommended Tech Stack

Chosen so a solo developer can build and host it cheaply.

| Layer | Choice | Why |
|---|---|---|
| Frontend | **React + Vite + TypeScript** | Component-based, easy to merge into ABE PDCS later |
| Map | **Leaflet** + `react-leaflet`, `leaflet.markercluster`, `leaflet.heat` | Lightweight, free, well documented |
| On-map drawing and editing | **Leaflet-Geoman** (free version) | Handles draw, drag, vertex editing and delete for all three geometry kinds |
| Forms | react-hook-form + zod, generated from `field_schema` | One form engine for every type |
| Charts | Recharts | |
| Table | TanStack Table | |
| Backend / DB | **Supabase** (PostgreSQL + **PostGIS** + Auth + Storage + **Realtime**) | Realtime gives live map updates; PostGIS handles spatial checks |
| Data access | A `DataStore` interface with two implementations: local (IndexedDB) and Supabase | The app can switch without changing screens |
| KML/KMZ export | Custom builder (for folders and styles) + **JSZip** | Runs in the browser, no server needed |
| KML import | `@tmcw/togeojson` + JSZip | |
| CSV/XLSX | PapaParse, SheetJS | |
| PDF/print | Print-layout view with `html-to-image` + jsPDF | Supports the full layout in §5.7 |
| Boundaries | HDX COD-AB Philippines (NAMRIA, PSA; CC BY-IGO, attribution required), simplified with mapshaper | |
| Hosting | Vercel / Netlify (frontend) + Supabase free tier | |

**Local mode** runs in one browser using IndexedDB, with changes shared between tabs of that browser. It exists for development and demos. It has no real sharing between devices, so real data should be encoded only after the switch to Supabase.

---

## 7. Pages / Routes

| Route | Page |
|---|---|
| `/` | Map + layer panel + dashboard (split view; map full-screen toggle) |
| `/barangays/:id` | Barangay profile (also opens as a panel on the map) |
| `/records` | Data table with filters and bulk actions |
| `/records/new`, `/records/:id/edit` | Full form, for when the map isn't convenient |
| `/import` | CSV / XLSX / KML / KMZ import wizard |
| `/qa` | Data-quality queue (flags in §4.6, including Unassigned and Needs geotag) |
| `/export` | Export options (also reachable from the map toolbar) |
| `/reports` | Municipal, barangay and beneficiary profiles (later phase) |
| `/admin` | Users, intervention types, form builder, lookups, audit log |
| `/login` | Auth |

Layout: left panel for layers and filters, center map, right or bottom panel for profile and dashboard. On mobile, tabs switch between Map, Dashboard and List.

---

## 8. UI / Design Notes

- Colors follow DA identity (green primary, yellow accent) with a neutral basemap so points stand out.
- Colors are consistent across map, legend, charts and KML. They are stored in the lookups, starting with:
  - Rice: green
  - Corn: yellow/orange
  - HVCDP: purple
  - Livestock: brown
  - Organic: teal
  - SPIS/Irrigation: blue
- Status colors, starting with: green = serviceable/turned-over, amber = needs repair, red = unserviceable, grey = unknown.
- Header: "Department of Agriculture – Provincial Agriculture Office, Marinduque | Intervention Map"
- Footer: data sources, "as of" date, and boundary attribution (NAMRIA, PSA via HDX).
- Readable on a phone, for field validation and encoding.

---

## 9. Build Phases

| Phase | Scope | Done when |
|---|---|---|
| **1. Data prep** (done) | RAED seed, 218 barangay boundaries, QA checks | Seed counts match the report |
| **1b. Schema revision** (done) | New data model (§4); RAED reloaded under Farm Machinery and SSIP; status history seeded; local dataset generated from it | Existing count and flag tests still pass on the new model |
| **2. Barangay base layer** (local data) | All 218 barangays, profiles, layer panel, choropleth modes including the gap view | Every barangay is clickable; the gap view shows the barangays with no records |
| **3. On-map editing** (local data) | `DataStore` interface; add by clicking, drag to move, soft delete, for points only; generated form; status history; audit log | Create, edit and delete work for Farm Machinery and SSIP, and show in a second tab at once |
| **4. Supabase switch** | Auth, roles, row-level security, Realtime, Storage, server-side audit | An edit in one browser appears on another device within about 2 s |
| **5. Admin customization** | Type manager, form builder, lookups, baseline fields | A new type with custom fields can be created and used with no code change |
| **6. Custom views and dashboard** | Color by and filter by any field; saved views; KPIs, charts and table | A saved view restores layers, filters, style and extent; totals match the data |
| **7. Export** | KML, KMZ, GeoJSON, CSV, XLSX, PNG/PDF for all geometries | KMZ opens in Google Earth Pro and Web with folders, styles and attributes |
| **8. Import and QA** | Import wizard for any type, QA queue | An ABEMIS export imports without manual editing, and a new dataset of another type imports the same way |
| **9. Reports and ABE PDCS** | Profiles, print layouts, merge into ABE PDCS | |

---

## 10. Acceptance Criteria

**Data**
- [ ] All RAED records are in the database, tagged `RAED 2026-10-21`. Counts per municipality, program and status match the source.
- [ ] Records with missing or invalid coordinates are flagged and left off the map, not plotted at 0,0.
- [ ] No imported row is dropped. Unmatched barangays are kept, flagged and listed.

**Barangays**
- [ ] All 218 barangays are always on the map and clickable, including those with no interventions.
- [ ] A barangay profile shows all its interventions, counts by type and program, baseline values and an "Add intervention here" button.
- [ ] All four choropleth modes work, and the gap view respects active filters.
- [ ] Records with no linked barangay are visible as "Unassigned".

**Customization**
- [ ] An Admin can create a new type with its geometry, icon, color, statuses and custom fields, then encode records of it, with no code change.
- [ ] Programs, categories, statuses, beneficiary types, icons and colors can be edited in `/admin`.
- [ ] Custom field values are validated against the type's schema in the form and in the database.
- [ ] Users can color by and filter by any field, including custom fields.
- [ ] A saved view restores layers, filters, style and extent, and can be shared.

**Editing**
- [ ] Points can be added and dragged, and records can be soft-deleted and restored.
- [ ] When a line or polygon type is activated, its shapes can be drawn and reshaped on the map.
- [ ] A change appears on every open map and in the dashboard without a reload, within about 2 s on another device.
- [ ] Simultaneous edits to one record don't silently overwrite each other.
- [ ] A status change adds a history entry, and the popup shows the timeline.
- [ ] Only logged-in Encoders/Admins can edit; every create, edit and delete is in the audit log.
- [ ] A coordinate outside Marinduque, or outside the selected municipality or barangay, triggers a warning.
- [ ] A point outside its encoded barangay counts under the encoded barangay, and its popup says "Plotted in [X], encoded as [Y]".
- [ ] Only confirmed corrections are applied; each keeps the raw value and appears in the audit log.

**Export and access**
- [ ] Filters update the map, charts, table and exports together.
- [ ] The exported **KMZ** opens in Google Earth with folders (Municipality → Barangay → Type), styles and an attribute balloon, for points, lines and polygons.
- [ ] The exported KML opens in QGIS with all attributes as fields.
- [ ] Markers with the same coordinates can all be reached.
- [ ] The site works on desktop and mobile Chrome.

---

## 11. Prompt for an AI Coding Assistant (copy-paste)

> Build a web GIS system called **"DA Marinduque Intervention Map"** following the attached specification (`docs/spec/DA-Marinduque-Intervention-Map-Spec.md`). Use React + Vite + TypeScript, Leaflet (with markercluster, heat and Geoman), Recharts, TanStack Table, and Supabase (PostgreSQL + PostGIS, Auth, Storage, Realtime).
>
> Follow the phases in §9. Barangays are the base layer. Intervention types, their fields and all lookups are data, not code. All reads and writes go through a `DataStore` interface, starting with a local (IndexedDB) implementation and later switching to Supabase. The database triggers are the final authority on QA flags, and the browser uses the same rules for live warnings.
>
> Keep components modular so this can later become a module of a larger "ABE Project Data Consolidation System."

---

## 12. Appendix: Reference Values

**Municipalities and barangay counts:** Boac (capital) 61, Buenavista 15, Gasan 25, Mogpog 37, Santa Cruz 55, Torrijos 25; 218 in total
**Banner programs in the RAED data:** Rice Program, Corn Program, High Value Crop Development Program, National Livestock Program, National Organic Agriculture Program, National Urban and Peri-Urban Agriculture Program
**Year range in the RAED data:** 2014–2026, peaking in 2025 and 2022
**Map default view:** center ≈ 13.40° N, 121.97° E; zoom 11
**Marinduque bounding box (validation):** lat 13.15–13.60, lon 121.78–122.20
**CRS:** WGS84 (EPSG:4326) for storage and KML; Web Mercator (EPSG:3857) for display
