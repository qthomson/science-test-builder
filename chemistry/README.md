# Chem Test Builder

Pick questions from past Physical Setting/Chemistry Regents exams (or write your own), arrange them, and get
ready-to-print PDFs with answer keys. Nothing to install: it runs in your web browser from this folder.


## Where it runs

- **Department web app (recommended):** the Apps Script page opened with a school Google account. Everything is shared:
  **Save…** and **Open…** use the department library (every save is a new version with your name and the date;
  Copy opens someone else's worksheet as your own). Each worksheet carries a **Type** (worksheet, practice, quiz, test, lab) and a
  **Unit** set next to the title, and the Open dialog narrows the list by year made, person, type and unit, custom questions are visible to everyone with the author's name, and the
  Unit Mapper's **Save for everyone** applies to all copies. The header shows who is signed in.
- **Website copy:** `https://qthomson.github.io/science-test-builder/chemistry/` runs the same app without sign-in; saving is
  by file only (Save list… downloads a file, Open list… opens one).
- **Folder copy:** unzip and double-click; same as the website copy, plus the optional `bank/custom.js` and `bank/unit-map.js`
  drop-in files.

## Using it

1. Open **`Chem Test Builder.html`** (double-click). Chrome or Edge work best.
2. On the left, filter by **Unit** (our Scope & Sequence units), **Question type**, **Kind** (multiple choice,
   constructed-response clusters, your own questions), **Exam**, **Figure**, or **Reference table**, or search the
   question text. Click a question to add it; click again to remove it. "Hide added" tidies the list.
3. On the right you see the actual pages. Hover a question for **move up / move down / remove** buttons.
   Half-page questions fill two columns; full-width questions and clusters go across the page, in the order you chose.
4. **Insert** adds three kinds of items, which move and delete like questions:
   - **Column break** – the next question starts in the next column (or the next band, if you were already in the right column).
   - **Page break** – the next question starts a new page.
   - **PDF page…** – whole pages from a PDF of your own (a reference sheet, a diagram page). Pick the file, then the page(s).
     They print exactly as they are and are saved with your list.
5. **Worksheet settings…** holds numbering start, question size (100% = exactly as printed on the exam), the name/date line,
   the reference-tables note, an optional **answer blank** in the margin before every multiple-choice number ( ___ 4. ) for
   quick grading, which teacher pages to include (answer key, constructed-response scoring pages, the
   reference-table list, source exams), and **Versions** (see below).
6. **Make PDFs** builds the files, named after the title (`Title.pdf` and `Title-key.pdf` for a single version), and shows a
   dialog with a **Save** and an **Open** button for each. Some school browsers block automatic downloads from a local page;
   if Save does nothing, use Open and save or print from the PDF viewer. Nothing to set in a print dialog: letter paper,
   half-inch margins, true size. **Print** still prints the on-screen worksheet straight from the browser if you just want paper now.
7. **Save…** downloads a small file with your selection, breaks, inserted pages and settings; **Open…** brings it
   back later or on another computer that has this folder. The last worksheet you were building is also remembered in the browser.
8. **New question…** lets you write your own multiple-choice question: an optional intro line ("Given the particle
   diagram:"), an optional diagram image, the question, four choices, the correct one, half or full width, unit and
   question type (or Misc), and which reference table it needs. It is saved in your browser, tagged **Custom**, filterable
   under Kind → *My questions*, and has an **Edit** button on its card. Custom questions are real text, so they print crisply
   at any size. **Export my questions…** downloads `custom.js`; drop that file into the `bank` folder and every copy of the
   builder will see those questions.

Numbers follow reading order on the page (down the left column, then the right, then any full-width question below),
just like the exam, so the answer key always matches what prints.

## Versions A and B

In *Worksheet settings → Versions*:

| Choice | Files made | What differs |
|---|---|---|
| One version | `Title.pdf`, `Title-key.pdf` | — |
| One version, printed as Form A and Form B | `Title-A.pdf`, `Title-B.pdf`, `Title-key.pdf` | only the label; same questions, same order, one key |
| Two versions, labeled | `Title-A.pdf`, `Title-A-key.pdf`, `Title-B.pdf`, `Title-B-key.pdf` | Form B has every multiple-choice question's answer choices in a different order (constructed response is unchanged) |
| Two versions, no label | same four files | as above, without "Form A/B" on the page |

Form B uses a second set of question images in which the four choices were re-ordered inside the original crop, so both
forms paginate identically. 1,727 of the 1,800 multiple-choice questions have a B version; the few that could not be
re-ordered safely (choices that are a table, labels drawn as graphics, …) read the same in both forms, and the settings
dialog tells you how many of your chosen questions that affects. Custom questions are re-ordered too.

## Reference tables (2011 vs 2025 edition)

Every question is tagged with the 2011-edition tables a typical student would use for it, and whether that information is
still on the 2025 edition. The **Reference table** filter has: *No table needed*, *Needs a table (either edition)*,
*Needs the 2011 tables (not on 2025)*, *Table info is on the 2025 tables*. Each card shows a small chip (e.g. `E, S · 2011`).
While you build, a line above the pages lists which tables the chosen questions need and for which question numbers; the same
list prints at the bottom of the answer key, with tables that exist only on the 2011 edition in bold.
The tagging rules and the table-by-table comparison are in `..\Analysis\reference-tables-2011-vs-2025.md`; the per-question
tags are in `..\Analysis\reference-tables-by-question.tsv` (fix a tag there and rebuild the bank).

## New Regents clusters (Physical Science: Chemistry, 2026 on)

The left panel has a switch: **Old Regents 2012–2026** and **New Regents clusters**. The new exam is all storyline clusters
(4–5 questions, multiple choice and constructed response mixed, one column, answer space printed in the booklet), so the new
bank is kept completely separate: its own folder (`bank-new`), its own archetype list (N-numbers, see
`..\Analysis\new-regents\new_types.py`), and its own filters.

- A cluster is added or removed as a whole. Its pages are laid out once, in advance, and drop into the worksheet unchanged
  (a passage always stays on the same page as the question that follows it); only the question numbers change. If a cluster
  is the first thing on the worksheet, its first page is scaled down a little to leave room for the title line.
- Cards show the storyline title, the exam, the MC/CR count, the number of pages, and unit badges for every unit its
  questions touch (`eng` = engineering/evaluation questions that belong to no unit).
- **Unit rule** with the unit picker: *Cluster touches this unit*, *Only this unit*, or *This unit and earlier only*
  (nothing beyond where the class is, using our Scope & Sequence order).
- MC answers come from the official key; constructed-response scoring blocks come from the rating guide and print on the
  scoring pages like the old clusters. Version B reorders the choices of new-cluster multiple-choice questions too
  (51 of the 65 so far; the "Which row…" table questions keep their order in both forms).
- The lead-in sentence keeps its wording; the "record your answers on the separate answer sheet" boilerplate is removed.

Bank so far: June 2026 (11 clusters, 50 questions), August 2026 (11 clusters, 48 questions), and the three Spring 2025
sample clusters (15 questions). Sources are in `..\New Regents`.

### Adding a new-format exam (someone comfortable running a script)

Put the exam, scoring key (.xlsx) and rating guide in `..\New Regents` named like `2027-01 PS Chemistry Exam.pdf`,
`2027-01 PS Chemistry Scoring Key.xlsx`, `2027-01 PS Chemistry Rating Guide.pdf`, then:

```bash
cd tools\new
py extract_psc.py 2027-01        # clusters -> bank-new/meta, bank-new/img, check pages in bank-new/check
py extract_psc_key.py 2027-01    # rating-guide blocks + MC answers
py make_b_psc.py 2027-01         # version B crops for the MC questions -> bank-new/img-b
py build_new.py                  # rebuilds bank-new/new.js and bank-new/data/*.js (pre-paginates every cluster)
```

Then tag the questions: add one line per question to `..\Analysis\new-regents\new-question-inventory.txt`
(`PSC-2027-01|Q07|N23|short description`), adding archetypes to `new_types.py` if none fits, and run
`py build_new.py --no-data`. Check the colored boxes on `bank-new/check/PSC-2027-01_p##.png`: green = lead-in, blue = passage,
red = question, orange = a question continued from the previous page.

### When the department changes units

Open **`Unit Mapper.html`** (same folder). Three tabs: **Units** (reorder with the arrows, rename in place, add or remove;
the number the test builder shows is the unit's position in this list), **Old Regents archetypes** and **New Regents
archetypes** (a unit dropdown per archetype; click a row to see two example questions from the bank). **Export unit-map.js**
downloads one small file. Drop it into the `bank` folder and every copy of the test builder uses it on the next open:
unit names and order, every question's unit, the badges, the filters and the "this unit and earlier" rule. Send the same file
to Quinn so the master tables are updated too. Your changes are also remembered in your browser until you reset them.

Behind the scenes, the master tables are:

`..\Analysis\inventory-parts\sns_map.py` (old archetypes → unit, and the unit list)
and `..\Analysis\new-regents\new_types.py` (new archetypes → unit). Edit them and rebuild metadata:
`py build_bank.py --no-data` and `py tools\new\build_new.py --no-data`. No images are touched; cards, filters and the
"this unit and earlier" rule follow the new mapping.

## What's in the folder

| Item | Purpose |
|---|---|
| `Chem Test Builder.html` | the app (keep it next to the `bank` and `lib` folders) |
| `Unit Mapper.html` | edit the unit order and which unit each archetype belongs to; exports `bank/unit-map.js` |
| `bank/bank.js` | the question bank index: every question's exam, number, answer(s), unit, type, tables, size |
| `bank/data/` | one file per exam with the question images (A and B versions, work spaces, scoring blocks) |
| `bank-new/new.js`, `bank-new/data/` | the new-format cluster bank (index + per-exam image data) |
| `lib/` | the PDF library, PDF viewer and the Liberation Serif fonts (open licenses) the app uses offline |
| `tools/` | scripts that build the bank from the exam PDFs (only needed to add more exams) |

The `bank/img`, `bank/img-b`, `bank/img4`, `bank/meta` and `bank/check` folders are the build pipeline's working files;
they are not needed to run the app.

## What's in the bank

**All 36 Regents exams from January 2012 to August 2026, Parts A and B-1 (questions 1–50): 1,800 multiple-choice
questions.** Each is a 300-dpi crop of the original exam with the question number removed; the app adds its own numbers.
The few "Base your answers to questions 31 and 32…" groups keep their shared passage/diagram, are added or removed
together, always print on one page, and the numbers in the lead-in sentence are replaced with the worksheet's own numbers.

**Parts B-2 and C (constructed response) come as clusters: 423 clusters, 1,260 questions.** A cluster is the passage/data from
the exam plus each question's stem, with that question's work space pulled in from the official answer booklet (lines, unit
blanks, templates, graph frames). Clicking a cluster card opens a **preview** of the whole cluster first; untick any question to leave it out, then Insert.
Clusters are otherwise added and removed as a whole and print full width; the passage stays with its
first question and a stem is never separated from its work space. To leave one question out of a cluster, hover it on the page and
click its ✕ (the rest of the cluster stays), or click its stem in the cluster's card; the card then shows "3 of 4 questions" with a
**put back** button. Numbering, the key and the scoring pages follow. The lead-in keeps its original wording, so a cluster cut down
to one question reads "questions 7 and 7". Empty work boxes are capped at 1.25 in. Turn on the
**constructed-response scoring pages** and the key gets the rating guide's "Acceptable responses" block for every
constructed-response question.

Known wording quirk: one stem (Aug 2015 Q57) still says "in your answer booklet".

## Adding exams (someone comfortable running a script)

Needs Python 3 with `pip install pymupdf openpyxl pillow numpy`. Exam PDFs, scoring keys, answer booklets and rating
guides live in `..\Regents Exams`, named like the existing ones.

```bash
cd tools
py extract_mc.py 2027-01     # crops Q1-50 -> bank/img, bank/meta/2027-01.json, bank/check/2027-01_p*.png
py extract_cr.py 2027-01     # Q51-85 clusters from the exam + answer booklet -> bank/meta/2027-01_cr.json
py extract_key.py 2027-01    # rating-guide scoring blocks for Q51-85 -> bank/meta/2027-01_key.json
py make_b.py 2027-01         # version B crops -> bank/img-b, bank/meta/2027-01_b.json, A|B sheets in bank/check
py build_bank.py             # rebuilds bank/bank.js and bank/data/*.js from every meta file
py qa_bank.py 2027-01        # checks counts/sizes/answers and writes bank/check/2027-01_sheet.png
```

Glance at the `bank/check/…_sheet.png` contact sheet (every question in one red box, no number inside) and the
`bank/check/…_b_p*.png` sheets (A on the left, B on the right). The unit/type tags come from
`..\Analysis\old-chem-regents-question-inventory.txt` and the reference-table tags from
`..\Analysis\reference-tables-by-question.tsv`; a new exam needs rows in both.
