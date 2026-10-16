# Writing a question for the Science Test Builder (AI handoff)

You are writing **one question, or one cluster of questions,** for a high-school science teacher who uses the Science
Test Builder app (NY Regents style: chemistry, physics, earth science, biology). The teacher will tell you the subject,
the topic and what kind of question they want. You hand back **one JSON file** in the format below. The teacher imports
it, sees it in the app's editor, and saves it. Everything in the file must be your own work in the public domain of
textbook-style science; do not copy a published exam question or a copyrighted figure.

## 0. Before you write anything: ask the teacher

Ask these in one message and wait for the answers (skip any the teacher already gave):

1. **Topic and unit.** What should the question be about? Which unit of the course (the units are listed in the
   appendix at the end of this file; name the unit, you will put its id in the file)?
2. **What kind.** One multiple-choice question, one written question, or a cluster (several questions on one
   scenario)? How many questions, and for a cluster, how many multiple choice and how many written?
3. **For a cluster: old style or new style?**
   - *Old style* (the "Old Regents" list): a shared passage or diagram followed by written questions in the style of
     the old Regents Part B-2 / C, each tagged with a unit and an old question type.
   - *New style* (the "New clusters" tab): the 2025+ Regents format, a titled real-world scenario with a mix of
     multiple-choice and written questions, each tagged with a performance expectation (NYSSLS standard) and a
     new-format type. New style is only available when the appendix lists new-format types.
4. **Level and credit.** Regents level, honors, or a review sheet? How many credits for each written question (1 or 2
   is usual)?
5. **Pictures.** Does the teacher want a diagram, a graph grid or a data table in it, or text only? If the teacher
   gave you a document with figures, say that you will keep every figure and name them in document order (section 3).
6. **Anything to avoid or include** (a formula, a lab they did, a misconception to target).

Then, **for a new-style cluster only**, before you build the file: propose the performance expectation for each
question (code and a few words of what it says), ask whether those make sense, and adjust. For old-style questions
pick the unit and the question type from the appendix yourself (where the appendix groups types by subtopic, the
subtopic you mean is set by the type you choose; the teacher may also name a subtopic); say which you chose when you
hand the file back.

## 1. The file

A UTF-8 text file whose whole content is one JSON object:

```json
{
  "title": "Wave speed on a string",
  "parts": [ ... ]
}
```

- `title`: a short name for the teacher's list (under 80 characters). Not printed on the test.
- `parts`: the pieces of the question in print order. One multiple-choice question is one `mc` part. One written
  question is one `cr` part. A cluster is a `passage` part followed by two or more `mc` / `cr` parts (more passages
  may sit between questions). A file normally holds one question or one cluster (at most 12 parts). When the teacher
  asks for several questions at once, hand back either one file per question or one file whose top level is a JSON
  list of such objects; the app imports those in bulk without a preview.
- Optional `"figScale"`: 10 to 200, a percent applied to every picture in the record (default 100).
- `"style"`: `"old"` (default) or `"new"` for a new-style cluster (section 0, question 3). Only a cluster can be
  new style, and only when the appendix lists new-format types.

Nothing else at the top level. Unknown fields are ignored.

## 2. The parts

### `passage` (shared text and pictures before the questions)

```json
{ "t": "passage", "heading": "", "text": "Base your answers to questions {a} and {b} on the information below.\nA student ...", "figs": [] }
```

- `text`: the paragraphs, separated by `\n` (each line is its own paragraph). Start a cluster's passage with the
  Regents lead sentence and use `{a}` for the number of the first question of the cluster and `{b}` for the last; the
  app fills in the real numbers.
- `heading`: optional bold heading above the text (usually empty).
- `figs`: pictures under the text (section 3), usually one at most.

### `mc` (multiple choice: four choices, one correct)

```json
{ "t": "mc", "stem": "What is the period of the wave?", "figs": [], "choices": ["0.25 s", "0.50 s", "2.0 s", "4.0 s"], "answer": 3 }
```

- `stem`: the question. `figs`: pictures between the stem and the choices (optional).
- `choices`: exactly four strings. Regents style: one correct answer, three plausible distractors, parallel wording,
  numbers in a sensible order, units on every number.
- `answer`: 1, 2, 3 or 4, the position of the correct choice.
- Picture answers: give four pictures in `"cimgs": [img, img, img, img]` (section 3) and four empty strings in
  `choices`.
- "Which row…" table choices: give the column headings in `"thead": "Heading A | Heading B"` and each choice as its
  cells, `"Signal A | Signal B"`, with the same number of `|` everywhere.
- Chemistry equation under the stem: `"eq": "2H_2 + O_2 → 2H_2O"` (optional).

### `cr` (written response with an answer space)

```json
{ "t": "cr", "stem": "Calculate the speed of the wave. [Show all work, including the equation and substitution with units.]", "figs": [],
  "credit": 2, "space": { "kind": "work", "h": 1.5, "label": "Answer:", "len": 1.5, "unit": "m/s" },
  "note": "v = fλ = (2.0 Hz)(0.50 m) = 1.0 m/s. 1 credit for the equation and substitution, 1 for the answer with unit." }
```

- `stem`: the question. Regents written questions end with the credit in brackets, which the app adds itself from
  `credit`, so do not type it. `figs`: pictures under the stem (optional).
- `credit`: 1 to 4 (whole number). `note`: the scoring guide for the teacher's key: the correct answer and what earns
  each credit (printed on the key, never on the test).
- `space`: the answer space, one of:

| `kind` | fields | prints |
|---|---|---|
| `lines` | `"n"`: 1–25, or omit it for the teacher's default | ruled lines for a written answer |
| `work` | `"h"` inches of blank work space (1–3), `"label"` (default `Answer:`), `"len"` blank length in inches, `"unit"` | room to show work, then `Answer: ______ unit` |
| `short` | `"label"`, `"len"`, `"unit"` | one line such as `Mass: ______ g` |
| `blank` | `"h"` inches | an empty space |
| `box` | `"h"` inches | a box |
| `labelled` | `"labels"`: one label per line (`"Independent variable:\nDependent variable:"`) | one ruled line after each label |
| `checks` | `"options"`: one per line | check boxes |
| `grid` | `"cols"`, `"rows"` (2–40), `"title"`, `"xlab"`, `"ylab"` | a graph grid with axis titles, drawn by the app |
| `table` | `"heads"`: `"Trial, Mass (g), Volume (mL)"`, `"rows"` (1–20) | an empty table to fill in, drawn by the app |
| `picture` | `"img"`: a picture (section 3) | the picture is the answer space (label it, draw on it) |
| `none` | | no space |

Use `work` for any calculation, `short` for a single value with a unit, `lines` for explanations, `grid` when the
student must plot, `picture` when the student draws on a diagram (give the blank diagram as the picture).

Tags on every `mc` and `cr` part, from the appendix at the end of this file:

- Old style: `"unit"` (the unit id) and `"type"` (the old question-type number whose description fits best).
- New style: `"pe"` (one performance-expectation code, or a list of them) and `"ntype"` (the new-format type number).
  New-style clusters do not use `unit` or `type`. The lead sentence "Base your answers to questions {a} through {b}…"
  is added by the app, so the passage starts with the scenario itself (a short title as `heading`, then the story).

## 3. Pictures

Every picture is an object with a short name and a label, plus its pixels when you can supply them:

```json
{ "name": "image1", "about": "ray diagram, concave mirror", "svg": "<svg …>…</svg>" }
```

- `name`: a file name or a short id (`image1`, `diagram2.png`). `about`: one to five words saying what the picture is.
  Both are required: the teacher sees the label when a picture is still missing.
- The pixels, in order of preference:
  1. **Inline SVG** in `"svg"` for anything you draw yourself (ray diagrams, circuits, free-body diagrams, waves, apparatus):
     plain SVG text, `viewBox` or width/height in px (96 px = 1 inch), white background, black strokes 2 px or more,
     text 14 px or larger. The app turns it into a picture. This is the way to go in a chat.
  2. **A file by name**: give only `name` and `about`. The teacher chooses the image file with the JSON, and the app
     matches it by name. If the teacher gave you a Word file, call the pictures `image1`, `image2`, … **in the order
     they appear in the document** and tell the teacher to choose the Word file together with the JSON: the app takes
     the pictures straight out of it. Never drop a figure the source has, and never rewrite the text to avoid it.
  3. **Base64** in `"src"` (`data:image/png;base64,…`, PNG or JPEG, with `w` and `h` in pixels) only if you can run code
     and encode the real file. Never invent base64. Keep each picture under 1 MB, 300 to 900 pixels wide.
- A graph grid or a table to fill in needs no picture: use the `grid` or `table` answer space. A data table in a passage
  is typed as a Markdown table (section 4).
- End your reply with the list of pictures the teacher must supply, one line each: `name — about — where it is in the
  source`, and tell the teacher the three ways in: choose the files (or the Word file) with the JSON, or paste each one
  into its labelled slot after the import.

## 4. Text markup

In any text field: `H_2O` or `x_{10}` for a subscript, `10^3` or `10^{-3}` for a superscript, `*word*` italic,
`**word**` bold. A data table in a passage or a stem is a Markdown table, one row per line, the first row the
headings: `| Telescope | Mirror diameter |`, then `| --- | --- |`, then `| Hubble | 2.4 m |`. It prints as a ruled table. Use real symbols: `λ`, `Δ`, `°`, `×`, `→`, `−` (minus sign) and `·`. A `\n` inside `text` starts a new
paragraph; inside a `stem` it starts a new line.

## 5. Style, as on the Regents

- One idea per question, written so a student can answer from the information given plus course knowledge.
- Numbers with units and sensible significant figures; the correct answer must come out of the given values.
- Clusters: the passage holds the shared data; each question stands on its own after reading it.
- Scoring notes give the answer and the credit split, in one or two sentences, the way the NYSED rating guides do.
- No answer letters inside the stem, no "all of the above", no trick wording.

## 6. Checklist before you hand the file back

- It parses as JSON: one object with `title` and a non-empty `parts` array (or a list of such objects for a batch).
- Every `mc` has four `choices` and an `answer` from 1 to 4 that is really the correct one.
- Every `cr` has `credit`, a `space`, and a `note` with the answer.
- Every picture has a `data:image/...;base64,` source. Nothing references a file on disk.
- The passage says `{a}` and `{b}`, not real numbers, if it mentions the question numbers.
- Every question carries its tags: `unit` and `type` (old style) or `pe` and `ntype` (new style), from the appendix.
- The whole file is under 4 MB.

## 7. Complete examples

A multiple-choice question with a table of choices:

```json
{ "title": "Sampling rate and accuracy",
  "parts": [ { "t": "mc", "stem": "Two digital recordings of one analog signal are made. Which recording has the higher sampling rate, and which is the more accurate copy of the original?",
      "figs": [], "thead": "Higher sampling rate | More accurate copy", "choices": ["Recording A | Recording A", "Recording A | Recording B", "Recording B | Recording B", "Recording B | Recording A"], "answer": 1 } ] }
```

A cluster with a calculation and a graph:

```json
{ "title": "Cart on a ramp: speed and graph",
  "parts": [
    { "t": "passage", "heading": "", "text": "Base your answers to questions {a} through {b} on the information below.\nA 2.0-kilogram cart is released from rest at the top of a ramp. Its speed is measured every 0.50 second: 0.0, 1.0, 2.0, 3.0 and 4.0 meters per second.", "figs": [] },
    { "t": "cr", "stem": "Plot the data on the grid and draw the best-fit line.", "figs": [], "credit": 2,
      "space": { "kind": "grid", "cols": 10, "rows": 10, "title": "Speed vs. Time", "xlab": "Time (s)", "ylab": "Speed (m/s)" },
      "note": "1 credit for all five points plotted within ±0.3 grid space; 1 credit for a straight best-fit line through them." },
    { "t": "cr", "stem": "Calculate the acceleration of the cart.", "figs": [], "credit": 2,
      "space": { "kind": "work", "h": 1.5, "label": "Answer:", "len": 1.5, "unit": "m/s²" },
      "note": "a = Δv/t = (4.0 m/s)/(2.0 s) = 2.0 m/s². 1 credit for the equation with substitution, 1 for the answer with unit." },
    { "t": "mc", "stem": "Which statement best describes the cart's motion?", "figs": [],
      "choices": ["constant speed", "constant acceleration", "decreasing acceleration", "increasing acceleration"], "answer": 2 } ] }
```

A new-style cluster (the tags are examples; take real ones from the appendix):

```json
{ "title": "Roller coaster energy", "style": "new",
  "parts": [
    { "t": "passage", "heading": "Roller Coaster Design", "text": "An engineering team is testing a model roller coaster. A 0.50-kilogram car is released from rest at the top of a 2.0-meter hill and rolls through a loop at the bottom.", "figs": [] },
    { "t": "mc", "stem": "Which quantity is the same at the top of the hill and at the bottom, if friction is ignored?", "figs": [],
      "choices": ["kinetic energy", "gravitational potential energy", "total mechanical energy", "speed"], "answer": 3, "pe": ["HS-PS3-2"], "ntype": 12 },
    { "t": "cr", "stem": "Calculate the speed of the car at the bottom of the hill. [Show all work, including the equation and substitution with units.]", "figs": [], "credit": 2,
      "space": { "kind": "work", "h": 1.5, "label": "Answer:", "len": 1.5, "unit": "m/s" }, "note": "mgh = ½mv²; v = √(2gh) = √(2 × 9.81 m/s² × 2.0 m) = 6.3 m/s. 1 credit for the equation and substitution, 1 for the answer with unit.", "pe": ["HS-PS3-1"], "ntype": 12 } ] }
```

<!-- APPENDIX -->
_The app appends this subject's units, question types and standards here when the handoff is downloaded from the app._
