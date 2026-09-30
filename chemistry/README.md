# Chem Test Builder — text edition (local build, not yet deployed)

`Text Test Builder.html` is the Chem Test Builder rebuilt on the Text Bank: every Regents question is typeset from text
(Liberation Serif + a STIX Two Math symbol subset) instead of being pasted in as a cropped image. Figures, tables, graphs,
structural formulas and answer-booklet templates are still pictures, at their printed size.

Open the HTML file directly (double-click) — it works offline like the image edition. Nothing in `Test Builder\` is touched;
this folder is self-contained.

## What is different from the image edition

- **Worksheet settings → Layout**: *Default* keeps the printed widths (two columns, wide questions span the page);
  *Force wide* writes every question across the page in one column.
- **Worksheet settings → Fill columns** (on by default): balances the two columns before a wide question and lets a short
  question move ahead of a wide one so a column is never left empty; turn it off to keep the exact order you built.
- **Worksheet settings → Size**: *Normal* 11.5 pt (as printed), *Large* 14 pt, *Enlarged* 16 pt on landscape pages
  (the NYSED large-type editions are 15–16 pt New Caledonia on landscape letter, one column). Figures scale with the text.
  Enlarged always uses one column.
- Version B shuffles the answer choices of every multiple-choice question (text or pictures, including "Which row" tables),
  not only the 1,729 the image pipeline could cut apart.
- Constructed-response clusters reflow: passage text, then each question with its answer lines / blanks / box / template,
  credit marker as printed. Scoring pages are typeset from the rating-guide text (acceptable-response lists as bullets),
  with drawn keys kept as pictures.
- New-format clusters reflow the same way (lead sentence, optional reference-tables note, passages, questions).
- The answer-key table splits across pages when it has more columns than fit (40 rows per column; 2 columns per page with sources, 4 without).
- A question whose text file is missing shows a hint instead of crashing; a missing figure prints as a dashed box.
- **Make Word** produces editable .docx files (worksheet and key) with the `docx` library (MIT, `lib\docx.umd.js`). Word
  reflows the text: Default layout becomes two-column sections, wide questions and clusters one-column; figures are inline
  pictures at printed size; isotope notation is Office math; answer lines are ruled paragraphs. Pages will not match the PDF.
  `tools\make_docx_test.js <list.json> [wide|default] [normal|large|enlarged]` builds one from a saved list; `tools\docx2pdf.py`
  converts with Word for checking.
- Custom questions can carry a picture for each answer choice (New question… → Pictures for the choices). Four pictures print
  as a 2 × 2 grid with the labels underneath; a mix prints stacked. Uploads are shrunk to 900 px wide.
- Browser storage is separate from the image edition (`ttb.*` keys), so both apps can be open side by side.

## Files

| path | what |
|---|---|
| `Text Test Builder.html` | the app: `Test Builder\Chem Test Builder.html` + `tools\patch_app.py` (anchored patches; re-run after copying a new master) |
| `lib\textpdf.js` | the renderer: blocks/runs → ops → pdf-lib pages; packer; `buildItems`, `buildModel`, `makePDF` (Node and browser) |
| `lib\textpdf.v1.js` | the first version used for the 200-question A/B/C/D test |
| `lib\fonts.js` | Liberation Serif R/B/I + `STIX2Math-Symbols.otf` as base64 (`tools\` has no builder for it; see chem-text-builder notes) |
| `bank.js`, `new.js` | copies of the image edition's metadata banks (answers, units, types, cluster structure) |
| `bank-text\<exam>.js` | text + figures per exam from `Text Bank\` (`py tools\build_textbank.py`; ~17 MB in all) |
| `tools\make_test.js` | Node driver for the 200-question comparison (`Test\`) |
| `Test\` | the A/B/C/D PDFs, the app-generated T1–T3 samples, picks and models |

## Rebuilding after the Text Bank changes

```
py tools\build_textbank.py            # all exams (or list exam codes)
```
Then reload the app. If the master app changes: copy `Test Builder\Chem Test Builder.html` here as `Text Test Builder.html`
and run `py tools\patch_app.py` (every anchor is asserted; a failing anchor means the master moved).

## Known gaps

- Word math renders element symbols in italic (Office math default); upright symbols need a post-processing step not yet written.
- Choice pictures in custom questions are stored in the browser only; the shared (Apps Script) edition would need Drive files for them.
- `#load=` links from the image edition work here; saved worksheet files too (the old `oScale` option is ignored).
- Shared (Apps Script) mode is untouched but untested in this edition.
