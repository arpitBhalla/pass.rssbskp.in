# Pass Register: RSSB SKP

The register for numbered passes, with ten sheets: **Mobile Pandal, Mobile Non Pandal, Bike Pandal, Bike
Non Pandal, Sewa Vehicle, Tractor Trolley, Gate 3 Entry, BAV Parking, Gate 3 - VIP and Admin**. Each sheet has its own serial
numbers from 0001. Every printed pass carries a QR code that the gate checks with a phone.
Several desks can work at once; every change is saved in Postgres with who made it.

## Run it

Needs Node 22+ and Postgres (on a Mac: `brew install postgresql@15 && brew services start postgresql@15`).

```sh
pnpm install
cp .env.example .env         # then set DATABASE_URL (see Production database below)
pnpm build && pnpm start     # http://localhost:5180
```

The database is created and set up automatically on the first start. The first person to open the
app creates the admin user; after that, only the admin adds people (**Users** tab), and everyone logs in.
There's no public sign-up.

**Production database** (DigitalOcean managed Postgres): `.env` holds the `DATABASE_URL` of the login
`rssb_passes`, which owns only the `passes` database (other logins on the cluster can't open it).
The address is the one DigitalOcean gives (`?sslmode=require`): the app always checks the server
against DigitalOcean's CA, kept in the code (`src/server/db/doCa.ts`), whatever the address says about
ssl. Its backups go to `backups/production`.
`.env.development.local` keeps `pnpm dev` on the local database. Don't create a `.env.local`: it
would override `.env` for `pnpm start` too. The admin login (`doadmin`) is in the DigitalOcean
control panel, not in this folder.

**Other computers and the gate phones on the same network** open `http://<this computer's IP>:5180`.
Find the IP with `ipconfig getifaddr en0` on a Mac. This needs `pnpm start` (above): the development
server (`pnpm dev`) only works fully on this computer, as Next.js blocks its pages for other addresses.

## Use it

- **Pick passes:** select rows (click a Sr. No., then Shift+click or drag) or enter From and To in the
  right panel. The bar above the sheet then prints them, ticks them Given or deletes them; **Clear**
  (or clicking into a cell) drops the selection. The sheet's name is written faintly behind the rows, so it's clear which sheet
  you are typing into.
- **Give a range:** pick the passes, fill Area / Incharge / Dept / … in the right panel and click **Give**. It needs the Incharge, or
  at least one of Name, Dept and Phone; the rest is optional. Missing serials are added. The sheet
  shows when each pass was added and by whom (**Added**, **Added by**).
  Bike sheets also have Reg. No.; Sewa Vehicle, Tractor Trolley, Gate 3 Entry, BAV Parking, Gate 3 - VIP
  and Admin have Vehicle and Reg. No. A number plate is written one way however it's typed: `hr 24 ab 9168` becomes
  `HR-24AB-9168`; anything else (`E-SCOOTY`) stays as typed. Searching `hr24ab` finds it.
  Values already filled are never overwritten: those passes are listed and left alone.
- **Cells work like Excel's:** a click (or Tab, Enter, the arrow keys) only selects a cell, without a
  caret, so dragging across cells never starts typing in the first one. Typing replaces what's in the
  cell; **double-click** or **F2** edits it instead, with the caret where you clicked (or at the end).
  The cell turns white while being edited. Enter (down), Tab (right) or leaving it saves; **Esc**
  drops the edit. While a cell is selected the arrow keys move between cells (after typing into it,
  ← → still do; after a double-click or F2 they move the caret), **Delete** empties it and
  **Backspace** empties it to type afresh. A printed pass's cells say they're locked.
- **Type or paste from Excel:** click a cell and type (Enter moves down). Copy cells in Excel and paste
  into the first cell: lines fill downward, columns fill rightward, and a copied header row is skipped.
  If the paste would replace cells that already hold something, a yellow bar lists them first:
  **Paste over** (Enter) or **Cancel** (Esc). One value pasted into a selected cell replaces it the
  same way; into a cell being edited it goes in at the caret. Filling (Ctrl+D, dragging the corner)
  doesn't ask.
  Empty rows are serials not in the register yet. Typing or pasting into one adds that serial, and the
  row at the bottom adds the next one.
- **Like Excel** (on a Mac, ⌘ instead of Ctrl): drag across cells (or click one, then Shift+click
  another) to select a block, and **Ctrl+C** copies it for Excel or for pasting elsewhere in the sheet
  (**Ctrl+V**). With only the cursor in a cell, Ctrl+C copies that cell; with rows picked by Sr. No., it
  copies them with their Sr. No. (pasted back into the sheet, they fill from Name). **Ctrl+X** cuts:
  copies, then empties those cells. **Delete** (or Backspace) empties a block of cells, or the rows
  picked by Sr. No.; the passes stay in the register (to remove passes, use **Delete … passes** in the
  bar). **Ctrl+D** fills down: a cell gets the value of the cell above it, and
  a block copies its top row into the rows below. Or drag the small square at the corner of the cell
  (or block) down or right to copy it into the cells it passes. A fill is saved as one change (**Undo**
  reverses it), and printed passes are never overwritten. **Esc** clears the block. The row and column
  of the cell being typed in are highlighted.
- **Collapsed ranges:** consecutive passes given to one incharge with the same details show as one row
  (▸ 0003–22: the second serial without the digits it shares with the first; hover for the full
  range). Click ▸ to see each. Editing the collapsed row changes all of them.
- **Issued To** (after Given): who collected the pass at the desk. It can be filled in after the pass
  is printed (the rest of a printed row is locked), and pasted, filled or imported the same way. It
  isn't printed on the pass; the gate check shows it.
- **Given:** tick **Given** in a row when the pass is handed over (filling in details doesn't tick it;
  a collapsed row ticks all of its passes). A pass is printed first: Given can't be ticked until
  Printed is (unticking Printed later, e.g. to reprint, leaves Given as it is). For a range, use **Mark … given** / **Untick … given** in the
  bar above the sheet. A printed pass that isn't ticked Given checks
  **CHECK** at the gate.
- **Delete:** pick the passes, click **Delete … passes** in the bar above the sheet and confirm.
  Printed passes are skipped (untick Printed first). The serials become empty rows again. It is in
  **History**, and **Undo** brings the passes back as they were, unless a serial was used again.
- **Search:** type a serial number to check a pass at the gate, or any name / area / phone. Filter by
  Given / Not given / Printed, or by **Date added**.
- **Print:** pick the passes and click **Preview & print** in the bar above the sheet. The passes are the RSSB
  SKP templates redrawn to measure, as vector graphics (sharp at any size), with the changes of design
  v1: every pass has the tab with the Tag (`NOV - 2026`) at the bottom, the 150 × 100 mm passes are
  headed RSSB SIKANDERPUR-M.C., and Bike passes have no Valid For line:

  | Sheets | Pass size | Per A3+ | Per A4 |
  | --- | --- | --- | --- |
  | Mobile Pandal / Non Pandal | 63.5 × 88.9 mm | 25 (edges touching: one cut separates two) | 9 |
  | Bike Pandal / Non Pandal | 88 × 60 mm | 25 (turned sideways) | 8 |
  | Sewa Vehicle, Tractor Trolley, Gate 3 Entry (orange), BAV Parking (purple), Gate 3 - VIP (red), Admin (teal) | 150 × 100 mm | 9 (turned sideways) | 2 |

  Gate 3 - VIP and Admin print in design v2, picked from the redesign (`../passes-design-v2`): Gate
  3 - VIP as the **Ticket** (a perforated stub with the QR code and serial), Admin as the **Rail**
  (colour bars top and bottom, Rozha One masthead).

  Pick **A3+** (329 × 483 mm, also sold as 13 × 19 in) or **A4** in the preview; each desk remembers
  its choice. In the print dialog choose that paper, scale 100% (Actual size), margins None, and
  headers and footers off. When the dialog closes the passes are ticked **Printed**. If it didn't
  print, click **Didn't print? Undo**. Printed passes are skipped next time. Missing serials in the
  range print as blank passes. Print one sheet first and measure a pass with a ruler.
- **Mark printed:** passes printed some other way? Pick them and click **Mark … printed**. Same
  rules as printing; **Undo** reverses it.
- **Printed passes are locked:** nothing in a printed row can change until **Printed** is unticked
  (on its own, as a separate step), except **Issued To** and **Given**.
- **Undo:** the **Undo** button (or Ctrl+Z, ⌘Z on a Mac) undoes your last change in the sheet you are
  in (each sheet has its own), also with the cursor in a cell, as in Excel (while typing in a cell,
  Ctrl+Z undoes the typing). Press it again for the change before. It shows at once and is saved in the
  background; if the server refuses (someone changed those passes since), it comes back with the reason. The **History** tab lists every
  change with who made it and can undo any of them, unless those passes were changed again afterwards.
- **Import / Export** (top right of the sheet): **Import CSV…** adds or fills passes from a CSV file;
  **Export this sheet** saves the open sheet (what's shown, if searching) as CSV for Excel; **Export all
  sheets** saves every sheet as one Excel file (.xlsx), a tab per sheet.
- **Report:** passes per sheet by Area then Dept (or Dept then Area), with serial numbers and
  incharges. Export it to Excel or print it.
- **Gate check:** every printed pass has a QR code holding only its code (44 digits, no address).
  Gate volunteers open the check page, `http://<this computer's IP>:5180/v` (Settings shows it with a
  QR code to open it on a phone), log in once (any user; the admin adds them under **Users**) and add
  it to the home screen. For each pass: tap **Scan a pass** and photograph the QR code from 10–20 cm.
  The page says **VALID** (green), **CHECK** (yellow: genuine, but the register disagrees, e.g. the
  name was changed after printing, or it isn't marked printed or Given) or **NOT VALID** (red: a fake, not in
  the register, or printed before a new key), or **TRY AGAIN** if the photo has no readable QR code.
  It shows the register's details (name, dept, area, incharge, vehicle, Reg. No.) and when the pass
  was scanned before; every scan is recorded. It takes a photo rather than showing the camera live
  because phones only allow a live camera on https. The phone must reach this computer (same Wi-Fi).
  The code holds the sheet, serial, a short hash of the name and a 10-byte tag made with a secret
  only the server has, so a copied design can't make a pass that checks VALID. A photocopy of a real
  pass still checks VALID: compare the name with the person and watch for repeat scans. Passes
  printed before 2026-11-12 hold a link with the code instead; Scan reads those too.
- **Settings** (admin): the signature, the **Tag** in the tab at the bottom of every pass (`NOV - 2026`), the
  **Gate check page** address for phones (shown when Settings is opened by the network address, not
  `localhost`) and the **QR key** (**Make a new key** cancels every pass printed before it: they check NOT VALID). Set once;
  every desk uses them. Settings also shows every pass as it prints. An SVG signature stays vector.
  The bar above the sheet says when one is missing.
- Dept suggestions come from the sip app's department list (`src/lib/depts.ts`), and area suggestions
  from `src/lib/areas.ts`. Any other text is accepted too.

## Safety

- Changes show on screen the moment you make them and are sent to the server in the background, one
  at a time in order; **Saving…** shows at the top meanwhile. Closing the tab then asks first, and so
  does closing it with text typed into a cell that hasn't been left yet (that text is saved meanwhile). If the
  server refuses a change, it comes off the screen again and the message says why.
- **Bad connection:** if saving takes more than 4 seconds an amber bar says how many changes are still
  saving; if the server can't be reached a red bar says how many are **not saved yet**. Either way the
  rows not saved yet are marked with an amber dot, and they are sent again by themselves (every few
  seconds, and after 30 seconds without an answer) until the server answers. Keep the tab open. A
  change is never saved twice, even when its answer was lost and it was sent again: each request
  carries a code the server remembers (`changes.request_id`).
- **Two desks adding the next pass at once:** a pass typed in the bottom row (or an empty row), or
  pasted below the last one, takes the next number; if another desk took that number a moment
  earlier, it is saved after the last pass instead and a message says so ("Sewa Vehicle 0002 was just
  taken by another desk, so Navneet Gumber is saved as 0003"; History notes it too). A number never
  shows twice on screen. Given, printed and imported ranges keep their numbers: refused if taken.
  The bottom row empties the moment a pass is added (it shows above at once); if the server refuses
  it, what was typed comes back.
- Every action saves completely or not at all. If someone else changed the same passes a moment
  earlier, nothing is saved, the sheet refreshes, and you're told who changed them.
- **Backups:** a `pg_dump` goes to `./backups` at start-up and every 30 minutes when something changed
  (the last 48 are kept). A red banner shows if a backup fails. To restore one:

  ```sh
  pg_restore --clean --if-exists -d passes backups/passes-<date>.dump
  ```

  Open desks reload by themselves.
- **Several desks:** each open sheet asks the server for changes every 5 seconds (every 15 seconds
  in a background tab). Only changed rows are sent, so it's light.

## Moving data from the old app

Open the old app (`legacy/old-app.html`) in the browser that has the data, click **Export to Excel**,
then in each sheet of the new app use **Import / Export → Import CSV…** with that file. Each sheet takes its own rows:
Mobile / Bike and Pandal / Non Pandal pick the sheet, serials like `M-0105` become 105, and
Printed = Yes keeps them printed. Rows without Pandal / Non Pandal are counted and skipped.

## Develop

```sh
pnpm dev         # http://localhost:5180
pnpm test        # needs Postgres: uses the passes_test database
pnpm typecheck && pnpm lint
```

Next.js 16 (App Router), tRPC 11, Kysely + Postgres, Tailwind 4, TypeScript. The server code is in
`src/server`, the shared types in `src/shared/types.ts`, and the sheet logic in `src/lib` (unit tested).
The pass templates are `src/components/cards` (positions in mm, measured on the template images).
The design version is kept in code only (`TEMPLATE_VERSION` in `PassCard.tsx`, now v2; not printed):
raise it when the design changes. v2 passes are `Ticket.tsx` and `Rail.tsx`, with their shared parts in
`v2kit.tsx`.
Fonts are bundled in `src/fonts` (SIL Open Font License): Roboto Condensed, Source Sans 3 and
Archivo Black for the passes, and for the v2 passes also Rozha One, Archivo SemiCondensed, Martian
Mono and Big Shoulders Display; Atkinson Hyperlegible Next for the app.
