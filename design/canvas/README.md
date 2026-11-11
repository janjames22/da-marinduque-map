# Design canvas source (Phase 11)

This is the signed-off design, backed up from the claude.ai design canvas **Intervention Map Design** (https://claude.ai/artifact/LvSgChD6pwXb7nXuZsv2Ze, private to the owner). Phase 12 onward builds the app to match it.

| File | Screen |
|---|---|
| `SignIn.dc.html`, `PhoneSignIn.dc.html` | Sign in |
| `Main.dc.html`, `PhoneHome.dc.html` | Home |
| `PhoneDrawer.dc.html` | Home with the menu open, phone |
| `Dashboard.dc.html`, `PhoneDashboard.dc.html` | Dashboard |
| `Map.dc.html`, `PhoneMap.dc.html` | Map |
| `Records.dc.html` | Interventions list |
| `Record.dc.html`, `PhoneRecord.dc.html` | Intervention detail |
| `Sidebar.dc.html` | The shared desktop sidebar |
| `canvas.json` | Where each screen sits on the canvas |

Notes:

- These files run only inside the design canvas. Opened directly in a browser, they show the bare markup. To view the design, open the canvas link.
- **The canvas is the master copy.** If the design changes there, copy the changed files here again in the same commit as the matching `STATUS.md` entry.
- Colors, type and spacing follow [`../tokens.json`](../tokens.json). Inline styles in these files are for the mock-ups. Phase 12 turns the tokens into CSS variables and does not copy those styles.
- The owner's own edits are included: on Sign in, the office name is written out, and in the Interventions list, the ID and item text is 12 px.
