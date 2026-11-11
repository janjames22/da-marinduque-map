# Figma Build Guide (Phase 11)

| | |
|---|---|
| **For** | The owner, building the design in Figma on the Free plan |
| **Inputs** | [`tokens.json`](tokens.json), [`kit-preview.html`](kit-preview.html), [`../docs/DESIGN-BRIEF.md`](../docs/DESIGN-BRIEF.md) |
| **Outputs** | A Figma file, `design/tokens.json` exported again, and one PNG per frame in `design/screens/` |
| **Version** | 0.1 (2026-11-11) |

## Contents

1. [Before you start](#1-before-you-start)
2. [Set up the file](#2-set-up-the-file)
3. [Import the tokens](#3-import-the-tokens)
4. [Text and effect styles](#4-text-and-effect-styles)
5. [Layout grids](#5-layout-grids)
6. [Components](#6-components)
7. [Screens](#7-screens)
8. [Check the quality](#8-check-the-quality)
9. [Export back to the repo](#9-export-back-to-the-repo)
10. [When to move to a paid plan](#10-when-to-move-to-a-paid-plan)

---

## 1. Before you start

1. **Open `design/kit-preview.html` in your browser** (double-click it). It shows the colors, type, components and a Home screen built from the tokens. That's the look to match in Figma.
2. Sign in to Figma, in the browser or the desktop app. The Free plan is enough for one design file.
3. **Inter** is the font. It's built into Figma, so there's nothing to install.
4. Install the **Tokens Studio for Figma** plugin from the Figma Community. Its free version imports `tokens.json`. Plugin menus change between versions, so the steps in §3 may be worded slightly differently in yours.

**Rules for the whole file**

- Use **Auto Layout** on every card, button, list and page column, so things resize properly.
- Use **variables and styles only.** Never type a hex color or a font size by hand. That's what lets the design come back to code exactly.
- Use real wording and the real numbers in this guide. No "Lorem ipsum".
- Use the **Lucide** icon set (search "Lucide" in the Figma Community), at 20 px with a 1.75 stroke. The app will use the same set.

---

## 2. Set up the file

1. Create a design file named **Intervention Map – Design**.
2. Add four pages:

| Page | Holds |
|---|---|
| Cover | The file name, version and date, and a link to this guide |
| Tokens | Color swatches and the type scale, for reference |
| Components | Every component from §6 |
| Screens | The frames from §7 |

---

## 3. Import the tokens

### With Tokens Studio (recommended)

1. Open the plugin: **Plugins → Tokens Studio for Figma**.
2. Start a new empty set, then open the JSON editor and paste the whole of `tokens.json`. Save.
3. Check that the groups `color`, `semantic`, `data`, `font`, `space`, `radius`, `shadow` and `size` appear.
4. Choose **Styles & Variables → Export to Figma**. Export colors, sizes, spacing and radius as **variables**, and typography and shadows as **styles**.
5. Open Figma's **Variables** panel and check that `semantic/bg/page` is `#f7f6f3` and `semantic/action/primary` is `#1b6b3f`.

### Without the plugin

Create two variable collections by hand:

- **Primitives:** every value under `color` in `tokens.json`, for example `green/900 = #0f3f22`.
- **Semantic:** every value under `semantic`, each one pointing at a primitive (alias), for example `bg/page → neutral/50`.

Then add `space`, `radius` and `size` as number variables, and the `data` colors as a third collection named **Data**.

---

## 4. Text and effect styles

### Text styles (Inter)

| Style | Size / line height | Weight | Use |
|---|---|---|---|
| Display | 36 / 44 | Bold | KPI numbers |
| Title | 28 / 36 | Bold | Page titles, the welcome banner |
| Title small | 18 / 24 | Semibold | Card titles |
| Body | 16 / 24 | Regular | Form inputs, longer text |
| Body small | 14 / 20 | Regular | Tables, labels, most text |
| Body small strong | 14 / 20 | Semibold | Buttons, sidebar links (Medium), table links |
| Caption | 12 / 16 | Regular | Notes under numbers |
| Caption strong | 12 / 16 | Semibold | Column headings, sidebar group headings, badges |

Turn on **tabular numbers** (Type settings → Details → Numbers → Tabular) for Display, Body small and Caption, so columns of numbers line up.

### Effect styles

| Style | Shadow |
|---|---|
| Card | Y 1, blur 3, `#1f1e1c` at 6% |
| Dialog | Y 12, blur 32, `#1f1e1c` at 18% |

---

## 5. Layout grids

| Frame | Size | Grid |
|---|---|---|
| Desktop | 1440 × 1024 (taller if the page scrolls) | Sidebar 248 px fixed on the left, top bar 64 px. In the content area: 12 columns, 32 px margins, 24 px gutters, content no wider than 1200 px |
| Phone | 390 × 844 (taller if the page scrolls) | 4 columns, 16 px margins, 16 px gutters. Sidebar becomes a drawer, opened from a menu button in the top bar |

Spacing comes only from the scale: 4, 8, 12, 16, 24, 32, 48. Gaps between cards are 16 or 24. Padding inside cards is 24 (16 on phones).

---

## 6. Components

Build them in this order, each as a component with variants. Measurements are in px. Colors refer to `semantic` variables.

| # | Component | Spec | Variants |
|---|---|---|---|
| 1 | Button | Height 40 (44 on phones), padding 0 16, radius `sm`, Body small strong, optional 20 px icon on the left, 8 gap | Kind: primary (fill `action/primary`, white text), secondary (white, 1 px `border/input`), quiet (no fill, `text/link`), danger (`action/danger`). State: default, hover (primary uses `action/primary-hover`), focus (2 px `focus/ring`, 2 px offset), disabled (45% opacity) |
| 2 | Button on dark | Like secondary, with a 1 px white border at 35%, white at 6% fill, white text | For the welcome banner |
| 3 | Text field and select | Label (Body small, Medium) above, 6 gap. Box height 44, radius `sm`, 1 px `border/input`, Body text. Hint (Caption, `text/secondary`) below | State: default, focus, error (2 px `status/danger-text` border, hint in that color), disabled. Required: adds a red `*` to the label |
| 4 | Badge | Height 24, padding 0 10, radius `pill`, Caption strong, a 6 px dot in the text color, 6 gap | success, warning, danger, info, neutral (fills and text from `status/*`) |
| 5 | Notice | Padding 12 16, radius `sm`, 1 px border, 20 px icon, 12 gap | info (`status/info-*`), warning, danger |
| 6 | Card | Fill `bg/surface`, 1 px `border/card`, radius `md`, Card shadow, padding 24 | With header (Title small, optional note in Body small secondary, actions on the right) or plain |
| 7 | KPI tile | Card with padding 20. Label (Body small Medium, secondary), value (Display), note (Caption, secondary), optional 36 × 36 icon tile top right (fill `bg/icon-tile`, radius `sm`, icon `text/link`) | Plain, hero (gradient `bg/sidebar-start` → `color/green/800`, white value, label and note in `text/on-dark-muted`), placeholder (dashed 1 px `border/input`, page fill, "Data to follow") |
| 8 | Chart card | Card with header: title, note, and quiet buttons "Table" and "CSV" on the right | Bar chart, stacked bar, segmented bar, table view |
| 9 | Segmented bar | Height 14, radius `pill`, 2 px gaps between parts, a legend grid underneath: dot, name, number and percent | |
| 10 | Table | Column headings Caption strong, secondary, 10 12 padding, 1 px bottom border. Rows 48 high, 0 12 padding, 1 px `border/card` dividers. Numbers right-aligned. Footer: "1–25 of 199" on the left, previous and next buttons on the right | Default, row hover (`bg/surface-muted`), empty state |
| 11 | Filter bar | Card, padding 16, labelled selects in a row with 16 gaps. On phones it collapses to a "Filters" button | |
| 12 | Sidebar | Width 248, gradient `bg/sidebar-start` → `bg/sidebar-end`, padding 20 12. Brand: 40 × 40 logo tile (`bg/logo-tile`, radius `sm`, `map-pin` icon in green 900), "Intervention Map" (16 Semibold, white), "Provincial Agriculture Office Marinduque" (Caption, `text/on-dark-muted`). Group headings Caption strong in `text/on-dark-muted`, 16 12 6 padding | Link item: height 40, radius `sm`, 20 px icon, 12 gap, white Body small Medium. States: default, hover (white at 8%), current (white fill, green 900 text), focus (2 px `focus/ring-on-dark`) |
| 13 | Top bar | Height 64, 1 px bottom border, right-aligned: 36 px initials circle (fill `action/primary`), name (Body small strong) over role (Caption, secondary), menu chevron | Desktop, phone (menu button on the left) |
| 14 | Page header | Title, one line of note text (Body small secondary, 4 gap), primary action on the right | |
| 15 | Empty state | 40 px icon in a 64 px icon tile, one line of title, one line of help, optional button. Centered in its card | |
| 16 | Dialog | Card with Dialog shadow, radius `lg`, title, body, buttons right-aligned (secondary then primary) | |
| 17 | Map marker | 24 px circle, 2 px white border, a small shadow, a 13 px white icon. Fill is the type's color from `data/type/*` | Farm Machinery (circle, `tractor` icon), SSIP (diamond: a rounded square turned 45°, `droplets` icon), selected (36 px with a 4 px `focus/ring` halo) |
| 18 | Cluster | Circle with `action/primary` fill and white Body small strong count, a 6 px halo at 25% | 36, 44 and 52 px for under 10, under 100, and 100 or more |
| 19 | Legend card | White, radius `sm`, Card shadow, padding 10 12, Caption text, one row per item with its marker shape | |
| 20 | Popup card | Width 240, radius `md`, Dialog shadow, padding 14: name (Body small strong), type and status badges, three facts (Beneficiary, Place, Year), link "Open the record" | |

Copy the exact look from `kit-preview.html` where it shows a component.

---

## 7. Screens

Draw these on the Screens page. Each frame is named `<screen>-<width>`, for example `dashboard-1440`. Desktop frames include the sidebar and top bar. The signed-in person is **"Juan dela Cruz", Admin**, a made-up name.

| Frame | Desktop 1440 | Phone 390 |
|---|---|---|
| Sign in | `sign-in-1440` | `sign-in-390` |
| Home | `home-1440` | `home-390`, and `home-drawer-390` with the drawer open |
| Dashboard | `dashboard-1440` | `dashboard-390` |
| Map | `map-1440` | `map-390` |
| Interventions list | `records-1440` | |
| Intervention detail | `record-1440` | `record-390` |

The content below is real data from the RAED report of 2026-10-21. The app will compute the live numbers in Phase 13.

### 7.1 Sign in

| Part | Content |
|---|---|
| Left half | Sidebar gradient. Logo tile with "Intervention Map" and "Provincial Agriculture Office Marinduque". Headline (Title, white): "Every DA intervention in Marinduque, on one map." Three steps in a row with icons and thin connecting lines: **Mapped** "Field or office", **Checked** "QA queue", **Reported** "Reports and exports". At the bottom: "Provincial Agriculture Office, Marinduque" |
| Right half | Page fill. "Sign in" (Title). Email (required), Password (required), a full-width primary button "Sign in" |
| States to show | Wrong password: a danger notice above the button, "That email and password don't match." |
| Phone | Only the right half, with the logo and name above "Sign in" |

Don't add a block of demo accounts like agri-dms has. This system holds real data.

### 7.2 Home

Exactly as shown in `kit-preview.html` §1:

| Block | Content |
|---|---|
| Welcome banner | "Welcome, Juan" / "Figures come from every record in the system, including those not yet on the map." / buttons Open dashboard, View the map, Add intervention |
| Work waiting | One row: icon tile `map-pin-off`, "27 records are waiting for verified coordinates", "26 have none, 1 is outside Marinduque. They're counted, but not on the map.", arrow. Add a second row: "Records needing QA", with a made-up count |
| Tiles | Interventions **199** (hero, "195 Farm Machinery · 4 SSIP"), Beneficiaries **151** ("Approximate, by name"), Barangays reached **97** ("of 218 barangays"), % operational **100%** ("Of 32 assessed units. 163 not assessed") |
| Type cards | Farm Machinery: segmented bar of 195 units, Irrigation 60 (31%), Land preparation 53 (27%), Postharvest 45 (23%), Processing 22 (11%), Other groups 15 (8%). SSIP: **4**, badges "Completed 2", "Inventory 2". Farm-to-Market Roads: placeholder, "Data to follow" |
| Phone | Cards stacked in one column, tiles two per row |

### 7.3 Dashboard

| Block | Content |
|---|---|
| Page header | "Dashboard" / "All 199 records, including 27 not on the map yet. Data as of Nov 11, 2026." / secondary button "Export" |
| Filter bar | Program "All programs", Year funded "2014" to "2026", Municipality "All municipalities", quiet button "More filters" |
| Tiles, row 1 | Total interventions **199** (hero, "199 units"), Farm Machinery **195**, SSIP **4**, Farm-to-Market Roads (placeholder, "Data to follow") |
| Tiles, row 2 | % operational **100%** ("Of 32 assessed units"), Beneficiaries **151**, Barangays with no intervention yet **121** ("of 218"), Awaiting coordinate verification **27** ("14% of records", link "See the list") |
| Units by category group | Segmented bar, full width: Irrigation 64, Land preparation 53, Postharvest 45, Processing 22, Crop care 8, Harvesting 5, Planting 2 |
| Units by municipality | Bars: Santa Cruz 48, Boac 38, Torrijos 36, Gasan 33, Mogpog 25, Buenavista 19 |
| Status by municipality | Stacked bars (Turned-over / Serviceable / Inventory / Completed): Santa Cruz 38/10/0/0, Boac 29/8/0/1, Torrijos 28/8/0/0, Gasan 27/4/2/0, Mogpog 24/1/0/0, Buenavista 17/1/0/1. Status colors from Admin: Turned-over `#2e7d32`, Serviceable `#43a047`, Inventory `#546e7a`, Completed `#00897b` |
| Units by program | Rice 62, High Value Crop Development 59, Corn 38, Organic Agriculture 30, Livestock 9, Urban and Peri-Urban 1 |
| Units by year funded | 2014: 8, 2015: 1, 2016: 13, 2017: 26, 2018: 3, 2019: 6, 2020: 13, 2021: 5, 2022: 36, 2023: 22, 2024: 19, 2025: 44, 2026: 3 |
| Units by category (top 15) | Pump and Engine Set 60, Hand Tractor (Walking-type) 33, Four-Wheel Tractor 14, Rice Thresher 14, Plastic Crate 9, Forage/Silage Chopper 7, then shorter bars |
| Awaiting coordinate verification | The table from `kit-preview.html` §2, grouped by municipality, "1–25 of 27", with Chart and CSV buttons |
| Layout | Tiles four per row. Category group full width. The next charts two per row. The table full width at the bottom |
| Phone | One column. Tiles two per row. Charts full width, each with a Table button |

### 7.4 Map

| Block | Content |
|---|---|
| Page header | "Map" / "Click a barangay for its profile, or a marker for the record." |
| Notice (info) | "172 of 199 records are on the map. 27 are waiting for verified coordinates." with a link "See the list" |
| Filter bar | As on the dashboard |
| Map | Fills the rest of the frame. Light basemap, the island in the middle, everything outside it dimmed. Municipality lines darker than barangay lines |
| Layer panel (left, 320 wide, collapsible) | **Intervention layers:** Farm Machinery (on, 195), SSIP (on, 4), Farm-to-Market Roads (off, disabled, "Data to follow"). **Boundaries:** Municipalities (on), Barangays (on). **Shade barangays by:** None, Number of interventions, Gap view. **Basemap:** Light, Satellite. **Saved views** |
| Map parts | Markers, two clusters (12 and 38), the legend card bottom left, zoom, locate and full screen controls top right, and one open popup: Cassava Chipper / Serviceable, Farm Machinery / Bangcauangan Farmers Association / Bangcuangan, Santa Cruz / 2017 |
| Phone | The map full screen under the top bar. Layer panel and filters open as a bottom sheet from two buttons. The notice becomes one line above the map |

### 7.5 Interventions list

| Block | Content |
|---|---|
| Page header | "Interventions" / "199 records" / primary "Add intervention" |
| Filter bar | As on the dashboard, plus a search field "Search name, beneficiary or ID" |
| Table columns | ID, Item, Type, Beneficiary, Barangay, Municipality, Year, Status, Map |
| Rows | RAED-2026-10-21-001, Cassava Granulator, Farm Machinery, Tanauan City Corn Growers Association, Tiguion, Gasan, 2015, Turned-over, on the map |
| | RAED-2026-10-21-002, Cassava Granulator, Farm Machinery, Tigwi Corn and Vegetable Farmers Association, Tigwi, Torrijos, 2016, Turned-over, on the map |
| | RAED-2026-10-21-004, Cassava Chipper, Farm Machinery, Bangcauangan Farmers Association, Bangcuangan, Santa Cruz, 2017, Serviceable, on the map |
| | RAED-2026-10-21-192, Hand Tractor (Walking-type), Farm Machinery, Balimbing Farmers Association, (blank), Boac, 2017, Turned-over, badge "No coordinates yet" |
| | RAED-2026-10-21-196, Pangi Solar-Powered Irrigation System, SSIP, Pangi Farmers Association, Pangi, Gasan, 2025, Inventory, badge "No coordinates yet" |
| Footer | "1–25 of 199" |

Type and status are badges. "On the map" is a small map-pin icon button that opens the record on the map.

### 7.6 Intervention detail

| Block | Content |
|---|---|
| Page header | "Cassava Chipper", with badges Farm Machinery and Serviceable / "RAED-2026-10-21-004 · Bangcuangan, Santa Cruz" / secondary "Update status", primary "Edit" |
| Details card (left, 2/3 width) | Type: Farm Machinery. Category: Cassava Chipper. Category group: Processing. Program: Corn Program. Year funded: 2017. Quantity: 1. Beneficiary: Bangcauangan Farmers Association. Source: ABEMIS Inventory via RAED Consolidated Inventory Report (2026-10-21) |
| Location card (left) | A small map with the marker. 13.4782, 122.0063. Link "Open on the map" |
| Status history card (left) | A timeline with one entry: Serviceable, "as of 2026-10-21 (RAED report)" |
| Audit trail card (right, 1/3) | "Imported · Nov 5, 2026 · System import" |
| Photos card (right) | Empty state: "No photos yet", button "Add photo" |
| Second state to draw | The same page for RAED-2026-10-21-192, where the Location card shows the info notice "No coordinates yet, so this record is not on the map" and a button "Enter coordinates" |
| Phone | One column, header buttons full width |

---

## 8. Check the quality

Before exporting, go through this list:

- [ ] Every color and text style comes from a variable or style. (Select a frame: the right panel shows no raw hex values.)
- [ ] Text contrast meets WCAG AA: 4.5:1 for normal text, 3:1 for large text and for input borders. Check with a free contrast plugin from the Community.
- [ ] Buttons and links are at least 44 px tall on phone frames.
- [ ] Spacing uses only the scale (4, 8, 12, 16, 24, 32, 48).
- [ ] Every number matches §7.
- [ ] Nothing needs color alone to be understood: badges have words, markers have icons and shapes.
- [ ] The sidebar's current link and focus states are shown at least once.
- [ ] Each frame side by side with `kit-preview.html` looks like the same product.

If you change a token in Figma, for example a color, change it in the variables, not on the frame.

---

## 9. Export back to the repo

1. **Tokens:** in Tokens Studio, export the tokens to a JSON file in the same format and save it over `design/tokens.json`. If you didn't use the plugin, tell me which values you changed.
2. **Screens:** select each frame, and in the right panel under **Export** choose PNG at 1x for desktop frames and 2x for phone frames. Save them into `design/screens/` with the frame's name, for example `design/screens/dashboard-1440.png`.
3. Tell me: **"Phase 11 exports are in design/"**. I'll check them against this guide, show you anything that doesn't match, and commit them once you approve.

Don't export the whole page as one image. One frame per file keeps each image small, which saves tokens when I read them.

---

## 10. When to move to a paid plan

Stay on Free unless one of these happens:

| Sign | What a paid plan adds |
|---|---|
| The design looks right in Figma, but what I build from the PNGs keeps missing details | **Dev Mode** with Figma's **MCP server**: I read sizes, spacing and variables straight from a selected frame, instead of guessing from an image |
| Building the components by hand takes too long | Figma's AI features (for example Figma Make) can draft screens from a prompt for you to edit |
| More than one person needs to edit the file | More editors and shared libraries |

If you upgrade, set up Figma's Dev Mode MCP server by following Figma's own guide, then add it to Claude Code with `claude mcp add`. I'll help with that step when you get there. Check Figma's current plans and prices first, because they change.
