# DA Marinduque Agri-Machinery Intervention Map — Website Specification

**Project:** Web-based GIS dashboard for DA interventions (farm machinery and SPIS) in the Province of Marinduque
**Prepared for:** Provincial Agriculture Office (PAO), Marinduque — ABE Section
**Prepared by:** Engr. Jan James P. Graza, ABE
**Source data:** *Consolidated Inventory Report – SPIS and Farm Machinery Equipment, Province of Marinduque* (RAED, Oct 21, 2026; generated from the ABEMIS Inventory Database)
**Version:** 1.0 (draft)

---

## 1. Purpose

Build a website that:

1. Plots every DA-funded farm machinery and SPIS intervention in Marinduque on an interactive map, like a GIS viewer.
2. Shows a dashboard (counts, charts, filters) that stays linked to the map.
3. Lets authorized users add, edit or import records. The map and dashboard update as soon as a record is saved.
4. Exports the map data as **KML** and **KMZ** for Google Earth, plus CSV, GeoJSON and a printable map.

The map module should be designed so it can later be added to the **ABE Project Data Consolidation System (ABE PDCS)** as one of its modules.

---

## 2. Users and Roles

| Role | Can do |
|---|---|
| **Admin** (ABE/PAO) | Manage users, all CRUD, bulk import, delete, view audit log |
| **Encoder** (MAO / ABE staff) | Add and edit records, upload photos, import CSV/XLSX |
| **Viewer** (PAO head, partners) | View map and dashboard, filter, export |
| **Public** (optional, later) | Read-only map with limited fields (no beneficiary contact info) |

---

## 3. Source Data Summary

The PDF has two tables. Both carry coordinates.

### 3.1 Table A: Farm Machinery and Equipment (about 195 records)

| Column | Example | Notes |
|---|---|---|
| Machine Name | Hand Tractor (Walking-type), Pump and Engine Set, Rice Combine Harvester | Free text with many variants. Normalize to a category list (§4.3) |
| Year Funded | 2014–2026 | Integer |
| Banner Program | Rice Program, Corn Program, High Value Crop Development Program, National Livestock Program, National Organic Agriculture Program | Use a lookup table |
| Beneficiary | Polo Farmers Association | FCA / LGU / cooperative |
| Status | Turned-over, Serviceable | Allow more values (§4.4) |
| Region | MIMAROPA (Region IV-B) | Fixed |
| Province | Marinduque | Fixed |
| Municipality | Boac, Buenavista, Gasan, Mogpog, Santa Cruz, Torrijos | Lookup |
| Barangay | Tawiran | Lookup per municipality |
| Latitude / Longitude | 13.4671083 / 122.06859 | Decimal degrees, WGS84 |

### 3.2 Table B: Solar-Powered Irrigation Systems (4 records)

| Column | Example |
|---|---|
| Project Type | Solar-Powered Irrigation System |
| Project Title | Installation of Bacong Solar Powered Irrigation System |
| Banner Program | Rice / HVCDP / National Organic Agriculture Program |
| Year Funded | 2017–2025 |
| Beneficiary | Pag Asa Farmers Association |
| Municipality / Barangay | Gasan / Bacongbacong |
| Latitude / Longitude | 13.289232 / 121.867325 |
| Stage | Inventory, Completed |

### 3.3 Data-quality issues found in the PDF (handle these in import and validation)

- **Missing coordinates:** 2 SPIS records have `0, 0` (Pangi, Gasan; Ihatub, Boac). Store them as *unlocated*, list them in a "Needs geotag" panel, and leave them off the map.
- **Out-of-province point:** Forage/Silage Chopper, 2025, Livestock, Malibago, Torrijos has longitude `122.90523`. That is outside Marinduque and is probably a typo (Malibago is near 122.00° E). The validator must flag it.
- **Coordinates that don't match the barangay:** some points sit in a different municipality than the one encoded (for example, a Gasan record plotted near Boac). Run a point-in-polygon check against municipal boundaries and flag mismatches.
- **Shared coordinates:** several machines share the exact same point (same FCA). Use marker clustering or spiderfy so none are hidden.
- **Typos in names:** e.g. "AssociatiDating Bayan Farmers Associationon", "Organikonhg", "SYTEM", "jolo". Keep the raw value and add a cleaned display value.
- **Multi-line cells:** PDF text extraction breaks machine names across lines ("Agricultural Tractor: Rotary-Tilling type"). Seed the database from a cleaned CSV, not from raw PDF text.

---

## 4. Data Model

Use **one interventions table** with a `type` field so new kinds of intervention (SSIP, FMR, PFC, etc.) can be added later without schema changes.

### 4.1 `interventions`

| Field | Type | Required | Notes |
|---|---|---|---|
| id | UUID | ✔ | |
| intervention_type | enum | ✔ | `machinery`, `spis`, `ssip`, `fmr`, `other` |
| category_id | FK → categories | ✔ | Normalized machine or project type |
| name_raw | text | ✔ | As written in the source |
| title | text | | Project title (SPIS/SSIP) |
| banner_program_id | FK → programs | ✔ | |
| year_funded | int | ✔ | 2000 to the current year |
| fund_source | text | | GAA, RCEF, etc. (optional) |
| quantity | int | | Default 1 |
| unit_cost | numeric | | Optional |
| beneficiary | text | ✔ | |
| beneficiary_type | enum | | FCA, Cooperative, LGU, PLGU, Individual |
| municipality_id | FK | ✔ | |
| barangay_id | FK | ✔ | |
| latitude | numeric(10,7) | | Nullable means unlocated |
| longitude | numeric(10,7) | | |
| geom | geometry(Point, 4326) | | Auto-filled from lat/lon (PostGIS) |
| status | enum | ✔ | See §4.4 |
| stage | enum | | For projects: Proposed, Inventory, On-going, Completed |
| date_turned_over | date | | |
| serial_no / engine_no | text | | |
| remarks | text | | |
| photos | file[] | | Geotagged photos |
| data_source | text | | e.g. "ABEMIS export 2026-10-21" |
| qa_flags | text[] | | Auto: `no_coords`, `out_of_province`, `muni_mismatch`, `duplicate_point` |
| created_by / updated_by | FK users | | |
| created_at / updated_at | timestamp | | |

### 4.2 Lookup tables

`programs`, `categories`, `municipalities` (with boundary polygons), `barangays` (with optional polygons), `users`, `audit_log`.

### 4.3 Machine/project categories (normalize to these)

- **Land preparation:** Four-Wheel Tractor, Hand Tractor (Walking-type), Rotary Tiller, Multi-cultivator, Disc Plow / Harrow
- **Planting:** Rice Transplanter (Walk-behind / Riding), Seeder
- **Crop care:** Power Sprayer, Grass Cutter
- **Harvesting:** Rice Combine Harvester, Rice Reaper
- **Postharvest:** Rice Thresher, Multi-crop Dryer, Flatbed Dryer, Rice Mill, Corn Sheller, Corn Husker-Sheller, Corn Mill, Hammer Mill, Moisture Meter, Grain Collector, Hermetic Bag, Plastic Crate
- **Processing:** Cassava Granulator, Cassava Chipper, Cassava Grater, Vacuum (Pack) Sealer, Feed Pelletizer, Forage/Silage Chopper
- **Irrigation:** Pump and Engine Set, Solar-Powered Irrigation System (SPIS), Small Water Impounding Project, Diversion Dam
- **Other**

Each category has an **icon** and a **group color** for the map.

### 4.4 Status values

`Turned-over`, `Serviceable`, `Needs Repair`, `Unserviceable`, `For Condemnation`, `Undelivered/For Distribution`. Map style: green = serviceable/turned-over, amber = needs repair, red = unserviceable, grey = unknown.

---

## 5. Features

### 5.1 Interactive map (the main screen)

- **Basemaps** (toggle): OpenStreetMap, Esri World Imagery (satellite), topographic, and Google-like hybrid (satellite + labels).
- **Overlay layers** (toggle, with legend):
  - Marinduque provincial boundary
  - Municipal boundaries (6) with labels
  - Barangay boundaries (optional, shown at higher zoom)
  - Farm machinery points
  - SPIS / irrigation points
  - Future layers: FMR lines, SSIP, LAFMP zones
- **Markers:** icon by category, color by banner program (or by status, switchable). Cluster at low zoom; spiderfy points that share coordinates.
- **Popup / side panel on click:** machine name, program, year, beneficiary, status, barangay/municipality, coordinates (copy button), photos, "Open in Google Maps" link, "Edit" (if permitted).
- **Heatmap toggle:** density of interventions.
- **Choropleth toggle:** shade municipalities by number of units (or by value).
- **Tools:** search (beneficiary, barangay, machine), locate-me, measure distance/area, draw a polygon to select points inside it, coordinate readout on mouse move, scale bar, fullscreen.
- **Map ↔ dashboard sync:** filters apply to both. Panning or zooming can optionally limit dashboard numbers to the visible area ("Filter by map extent").

### 5.2 Dashboard

KPI cards at the top:
- Total interventions
- Total machinery units
- Number of SPIS
- Beneficiary FCAs served
- % serviceable
- Records needing geotag or QA

Charts:
- Units per **municipality** (bar)
- Units per **banner program** (bar or donut)
- Units per **year funded** (line or column, 2014 onward)
- Units by **category** (horizontal bar, top 15)
- **Status** breakdown (stacked bar per municipality)

Data table:
- Sortable, searchable, paginated
- Clicking a row zooms the map to that point

Global filter bar (applies to map, charts and table):
- Municipality, Barangay, Banner Program, Category, Year range, Status, Intervention type

### 5.3 Data entry with live map update

- **Add / Edit form** with dropdowns from lookups. Barangay list depends on the selected municipality.
- **Coordinate picker:** click on the map, drag the marker, type DD or DMS, or paste from Google Maps ("13.4671, 122.0686"). Auto-convert DMS to decimal.
- **Use device GPS** button for field encoding on a phone.
- **Photo upload:** read EXIF GPS from geotagged photos and offer to use it as the coordinates.
- **Live validation before saving:**
  - Lat 13.15–13.60 and Lon 121.78–122.20 (Marinduque bounding box). Then run the point-in-polygon check against the selected municipality; warn if it doesn't match.
  - Warn on duplicates (same category + beneficiary + year + barangay).
  - Required fields filled.
- **Realtime:** after saving, the new marker appears on every open map and the dashboard numbers refresh without a page reload (via a realtime subscription; see §6).
- **Bulk import:** upload CSV/XLSX using a provided template. Column-mapping screen, preview of rows with QA flags, then commit. The ABEMIS export format should import directly.
- **Audit log:** who changed what, and when. Edits are soft-deleted and restorable.

### 5.4 Export and download

| Format | Content | Use |
|---|---|---|
| **KML** | Current filtered points, styled, organized in folders | Google Earth, QGIS |
| **KMZ** | Zipped `doc.kml` + custom icons (+ optional photos) | Google Earth (preferred, keeps icons) |
| GeoJSON | Current filtered features | QGIS, web GIS |
| CSV / XLSX | Table with all fields | Reports, ABEMIS updating |
| PNG / PDF | Printable map with title, legend, north arrow, scale, date, "Prepared by" | Reports, presentations |
| Shapefile (optional) | Zipped .shp/.shx/.dbf/.prj | ArcGIS/QGIS users |

Every export respects the active filters. The file name includes the scope and date, e.g. `Marinduque_Machinery_RiceProgram_2026-11-04.kmz`.

#### KML structure (required)

```
Document: "DA Interventions – Marinduque (exported 2026-11-04)"
├── Styles (one per program/category, icon + color)
├── Folder: Boundaries (optional)
├── Folder: Boac
│   ├── Folder: Rice Program
│   │   └── Placemark: "Hand Tractor – Tumapon FA (2022)"
│   ├── Folder: Corn Program
│   └── ...
├── Folder: Buenavista
└── ... (Gasan, Mogpog, Santa Cruz, Torrijos)
```

Each Placemark has:
- `<name>`: Category – Beneficiary (Year)
- `<description>`: HTML table of all attributes (shown in the Google Earth balloon)
- `<ExtendedData>`: every field as `<Data name="...">`, so attributes come through when opened in QGIS
- `<styleUrl>` pointing to the program/category style
- `<Point><coordinates>lon,lat,0</coordinates></Point>`. **Order is longitude first.**

Example:

```xml
<Placemark>
  <name>Corn Husker-Sheller – Tawiran Corn FA (2025)</name>
  <styleUrl>#corn-postharvest</styleUrl>
  <ExtendedData>
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
- Unlocated records (no coordinates) are left out of KML/KMZ and listed in a note in the document description.
- **Import KML/KMZ** too (e.g., points digitized in Google Earth), using the same mapping screen as CSV import.

### 5.5 Reports (phase 2)

- One-page municipal profile: map plus summary table per municipality, printable as PDF.
- Beneficiary profile: all interventions received by an FCA.
- Year-end inventory report in the same layout as the RAED consolidated report.

---

## 6. Recommended Tech Stack

Chosen so a solo developer can build and host it cheaply.

| Layer | Choice | Why |
|---|---|---|
| Frontend | **React + Vite + TypeScript** (or Next.js) | Component-based, easy to merge into ABE PDCS later |
| Map | **Leaflet** + `react-leaflet`, `leaflet.markercluster`, `leaflet.heat`, `leaflet-draw`, `leaflet-easyprint` | Lightweight, free, well documented |
| Charts | Recharts or Chart.js | |
| Table | TanStack Table | |
| Backend / DB | **Supabase** (PostgreSQL + **PostGIS** + Auth + Storage + **Realtime**) | Realtime gives live map updates; PostGIS handles point-in-polygon checks |
| KML/KMZ export | `tokml` (GeoJSON → KML) or a custom builder for folders/styles; **JSZip** for KMZ | Runs in the browser, no server needed |
| KML import | `@tmcw/togeojson` + JSZip | |
| CSV/XLSX | PapaParse, SheetJS | |
| Shapefile export | `shp-write` (optional) | |
| PDF/print | `leaflet-easyprint` or html2canvas + jsPDF | |
| Boundaries | PSA/NAMRIA PSGC-based municipal and barangay boundaries (GeoJSON), simplified with mapshaper | |
| Hosting | Vercel / Netlify (frontend) + Supabase free tier | |

**Offline-friendly alternative (no backend):** a single-page app that stores data in IndexedDB and syncs by importing/exporting CSV. Use this if internet access in the field is unreliable. It loses multi-user realtime updates.

---

## 7. Pages / Routes

| Route | Page |
|---|---|
| `/` | Map + dashboard (split view; map full-screen toggle) |
| `/records` | Data table with filters and bulk actions |
| `/records/new`, `/records/:id/edit` | Add/Edit form with coordinate picker |
| `/import` | CSV / XLSX / KML / KMZ import wizard |
| `/qa` | Data-quality queue (no coords, out of province, muni mismatch, duplicates) |
| `/export` | Export options (also reachable from map toolbar) |
| `/reports` | Municipal and beneficiary profiles (phase 2) |
| `/admin` | Users, lookups (programs, categories, barangays), audit log |
| `/login` | Auth |

Layout: left sidebar for filters and layers, center map, right/bottom panel for dashboard. On mobile, tabs switch between Map, Dashboard and List.

---

## 8. UI / Design Notes

- Colors follow DA identity (green primary, yellow accent) with a neutral basemap so points stand out.
- Program colors must be consistent across map, legend, charts and KML. Suggested:
  - Rice: green
  - Corn: yellow/orange
  - HVCDP: purple
  - Livestock: brown
  - Organic: teal
  - SPIS/Irrigation: blue
- Header: "Department of Agriculture – Provincial Agriculture Office, Marinduque | Agri-Machinery & Irrigation Intervention Map"
- Footer: data source and "as of" date.
- Readable on a phone, for field validation.

---

## 9. Build Phases

| Phase | Scope | Done when |
|---|---|---|
| **1. Data prep** | Clean the PDF data into `seed_interventions.csv`; normalize categories and programs; get municipal boundary GeoJSON; tag QA issues | CSV loads with no errors; QA list matches §3.3 |
| **2. Map viewer** | Leaflet map, basemaps, boundaries, clustered markers, popups, legend, filters | All located records show on the map with correct styles |
| **3. Dashboard** | KPI cards, charts, table, synced filters | Totals match the source report |
| **4. Export** | KML, KMZ, GeoJSON, CSV, PNG/PDF | KMZ opens in Google Earth Pro and Google Earth Web with icons, folders and attributes |
| **5. Data entry** | Auth, roles, add/edit form, coordinate picker, validation, realtime update | A new record appears on a second browser's map within ~2 s |
| **6. Import & QA** | CSV/XLSX/KML import wizard, QA queue, audit log | ABEMIS export imports without manual editing |
| **7. Reports & ABE PDCS integration** | Municipal profiles, print layouts; merge as a module of ABE PDCS; add FMR and SSIP layers | |

---

## 10. Acceptance Criteria

- [ ] All records from the consolidated report are in the database. The record count per municipality, program and status matches the source.
- [ ] Records with missing or invalid coordinates are flagged and excluded from the map, not plotted at 0,0.
- [ ] Clicking a marker shows its full details; markers with the same coordinates can all be reached.
- [ ] Filters update the map, charts, table and exports together.
- [ ] A saved new record appears on the map and in the dashboard totals without a reload.
- [ ] The exported **KMZ** opens in Google Earth with folders (Municipality → Program), styled icons, and an attribute balloon.
- [ ] The exported KML opens in QGIS with all attributes as fields.
- [ ] A coordinate outside Marinduque, or outside the selected municipality, triggers a warning.
- [ ] The site works on desktop and mobile Chrome.
- [ ] Only logged-in Encoders/Admins can add, edit or import; every change is logged.

---

## 11. Prompt for an AI Coding Assistant (copy-paste)

> Build a web GIS dashboard called **"DA Marinduque Agri-Machinery & Irrigation Intervention Map"** following the attached specification (`DA-Marinduque-Intervention-Map-Spec.md`). Use React + Vite + TypeScript, Leaflet (with markercluster, heat, draw), Recharts, TanStack Table, and Supabase (PostgreSQL + PostGIS, Auth, Storage, Realtime).
>
> Start with Phases 1–4:
> - (a) Create the Supabase schema from §4, including the PostGIS `geom` column, a trigger that fills `geom` from lat/lon, and a trigger that sets `qa_flags` (Marinduque bounding box, point-in-municipality check, duplicate points).
> - (b) Write a seed script for `seed_interventions.csv`.
> - (c) Build the map page with basemap switcher (OSM, Esri imagery), municipal boundaries, clustered markers styled by program/category, popups, legend and a filter sidebar.
> - (d) Build the dashboard (KPI cards, charts by municipality/program/year/category/status, data table) sharing one filter state with the map.
> - (e) Build exports: KML and KMZ (JSZip, `doc.kml` + `icons/`), with Folders by Municipality → Banner Program, per-style icons, KML `aabbggrr` colors, `ExtendedData` for every field, and coordinates written lon,lat. Also GeoJSON, CSV and PNG.
>
> Then do Phase 5: an add/edit form with a map-click coordinate picker, DMS→decimal conversion, GPS button, validation warnings, and Supabase Realtime so new records appear on all open maps without a reload.
>
> Keep components modular so this can later become a module of a larger "ABE Project Data Consolidation System."

---

## 12. Appendix: Reference Values

**Municipalities:** Boac (capital), Buenavista, Gasan, Mogpog, Santa Cruz, Torrijos
**Banner programs in the source:** Rice Program, Corn Program, High Value Crop Development Program, National Livestock Program, National Organic Agriculture Program
**Year range in the source:** 2014–2026, peaking in 2022 and 2025
**Map default view:** center ≈ 13.40° N, 121.97° E; zoom 11
**Marinduque bounding box (validation):** lat 13.15–13.60, lon 121.78–122.20
**CRS:** WGS84 (EPSG:4326) for storage and KML; Web Mercator (EPSG:3857) for display
