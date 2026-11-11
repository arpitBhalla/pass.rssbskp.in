# Pass Register: RSSB SKP

The register for numbered passes, with eight sheets: **Mobile Pandal, Mobile Non Pandal, Bike Pandal, Bike
Non Pandal, Sewa Vehicle, Tractor Trolley, Gate 3 Entry and BAV Entry**. Each sheet has its own serial
numbers from 0001. Every printed pass carries a QR code that the gate checks with a phone.
Several desks can work at once; every change is saved in Postgres with who made it.

## Run it

Needs Node 22+ and Postgres (on a Mac: `brew install postgresql@15 && brew services start postgresql@15`).

```sh
pnpm install
cp .env.example .env.local   # only if Postgres isn't at postgres://localhost:5432
pnpm build && pnpm start     # http://localhost:5180
```

The database is created and set up automatically on the first start. The first person to open the
app creates the admin user; after that, only the admin adds people (**Users** tab), and everyone logs in.
There's no public sign-up.

**Other computers on the same network** open `http://<this computer's IP>:5180`. Find the IP with
`ipconfig getifaddr en0` on a Mac.

## Use it

- **Give a range:** in the right panel enter From and To (or select rows: click a Sr. No., then
  Shift+click or drag), fill Area / Incharge / Dept / … and click **Give**. It needs the Incharge, or
  at least one of Name, Dept and Phone; the rest is optional. Missing serials are added. The sheet
  shows when each pass was added and by whom (**Added**, **Added by**).
  Bike sheets also have Reg. No.; Sewa Vehicle, Tractor Trolley, Gate 3 Entry and BAV Entry have Vehicle
  and Reg. No.
  Values already filled are never overwritten: those passes are listed and left alone.
- **Type or paste from Excel:** click a cell and type (Enter moves down). Copy cells in Excel and paste
  into the first cell: lines fill downward, columns fill rightward, and a copied header row is skipped.
  Empty rows are serials not in the register yet. Typing or pasting into one adds that serial, and the
  row at the bottom adds the next one.
- **Collapsed ranges:** consecutive passes given to one incharge with the same details show as one row
  (▸ 20). Click ▸ to see each. Editing the collapsed row changes all of them.
- **Search:** type a serial number to check a pass at the gate, or any name / area / phone. Filter by
  Given / Free / Printed, or by the dates passes were added.
- **Print:** enter a range in the right panel and click **Preview & print**. The passes are the RSSB
  SKP templates redrawn to measure, as vector graphics (sharp at any size):

  | Sheets | Pass size | Per A3+ | Per A4 |
  | --- | --- | --- | --- |
  | Mobile Pandal / Non Pandal | 63.5 × 88.9 mm | 25 (edges touching: one cut separates two) | 9 |
  | Bike Pandal / Non Pandal | 88 × 60 mm | 25 (turned sideways) | 8 |
  | Sewa Vehicle, Tractor Trolley, Gate 3 Entry (orange), BAV Entry (purple) | 150 × 100 mm | 9 (turned sideways) | 2 |

  Pick **A3+** (329 × 483 mm, also sold as 13 × 19 in) or **A4** in the preview; each desk remembers
  its choice. In the print dialog choose that paper, scale 100% (Actual size), margins None, and
  headers and footers off. When the dialog closes the passes are ticked **Printed**. If it didn't
  print, click **Didn't print? Undo**. Printed passes are skipped next time. Missing serials in the
  range print as blank passes. Print one sheet first and measure a pass with a ruler.
- **Mark printed:** passes printed some other way? Enter the range and click **Mark … printed**. Same
  rules as printing; **Undo** reverses it.
- **Printed passes are locked:** nothing in a printed row can change until **Printed** is unticked
  (on its own, as a separate step).
- **Undo:** the **Undo** button (or Ctrl+Z) undoes your last change. The **History** tab lists every
  change with who made it and can undo any of them, unless those passes were changed again afterwards.
- **Report:** passes per sheet by Area then Dept (or Dept then Area), with serial numbers and
  incharges. Export it to Excel or print it.
- **Gate check:** every printed pass has a QR code. Scanning it with a phone's camera opens the pass
  check page: **VALID** (green), **CHECK** (yellow: genuine, but the register disagrees, e.g. the name
  was changed after printing or it isn't marked printed) or **NOT VALID** (red: a fake, not in the
  register, or printed before a new key). It shows the register's details (name, dept, area,
  incharge, vehicle, Reg. No.) and when the pass was scanned before; every scan is recorded.
  Gate volunteers log in once on their phone (any user; the admin adds them under **Users**). The
  phone must reach this computer (same Wi-Fi). The QR holds the sheet, serial, a short hash of the
  name and a 10-byte code made with a secret only the server has, so a copied design can't make a
  pass that checks VALID. A photocopy of a real pass still checks VALID: compare the name with the
  person and watch for repeat scans.
- **Settings** (admin): the signature, the **Valid For** line of Bike passes (e.g. `28th & 29th
  NOV-2026`, ordinals print raised), the **Tag** of the 150 × 100 mm passes (`SKP-2026`), the **Pass
  check address** the QR codes open (e.g. `http://192.168.1.20:5180`; empty = the address of the desk
  that prints; passes can't be printed with a `localhost` address, as phones couldn't open it) and the
  **QR key** (**Make a new key** cancels every pass printed before it: they check NOT VALID). Set once;
  every desk uses them. Settings also shows every pass as it prints. An SVG signature stays vector.
  The Print box says when one is missing.
- Dept suggestions come from the sip app's department list (`src/lib/depts.ts`), and area suggestions
  from `src/lib/areas.ts`. Any other text is accepted too.

## Safety

- Every action saves completely or not at all. If someone else changed the same passes a moment
  earlier, nothing is saved, the sheet refreshes, and you're told who changed them.
- **Backups:** a `pg_dump` goes to `./backups` at start-up and every 30 minutes when something changed
  (the last 48 are kept). A red banner shows if a backup fails. To restore one:

  ```sh
  pg_restore --clean --if-exists -d passes backups/passes-<date>.dump
  ```

  Open desks reload by themselves.
- **Several desks:** each open sheet asks the server for changes every 2 seconds (every 15 seconds
  in a background tab). Only changed rows are sent, so it's light.

## Moving data from the old app

Open the old app (`legacy/old-app.html`) in the browser that has the data, click **Export to Excel**,
then in each sheet of the new app click **Import CSV** with that file. Each sheet takes its own rows:
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
Fonts are bundled in `src/fonts` (SIL Open Font License): Roboto Condensed, Source Sans 3 and
Archivo Black for the passes, Atkinson Hyperlegible Next for the app.
