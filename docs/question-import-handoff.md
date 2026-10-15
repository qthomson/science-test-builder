# Writing a question for the Science Test Builder (AI handoff)

You are writing **one question, or one cluster of questions,** for a high-school science teacher who uses the Science
Test Builder app (NY Regents style: chemistry, physics, earth science, biology). The teacher will tell you the subject,
the topic and what kind of question they want. You hand back **one JSON file** in the format below. The teacher imports
it, sees it in the app's editor, and saves it. Everything in the file must be your own work in the public domain of
textbook-style science; do not copy a published exam question or a copyrighted figure.

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
  may sit between questions). Keep a file to one question or one cluster; at most 12 parts.
- Optional `"figScale"`: 10 to 200, a percent applied to every picture in the record (default 100).

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

Optional on `mc` and `cr`: `"unit"` and `"type"` codes of the app. Leave them out unless the teacher gave you the
codes; the teacher sets them in the editor.

## 3. Pictures

A picture is an object `{ "src": "data:image/png;base64,....", "w": 600, "h": 400 }`:

- `src`: a PNG (or JPEG) as a base64 data URL. `w` and `h`: its size in pixels (the app measures them when missing).
- The app prints at 150 pixels per inch: a 600 × 400 picture prints 4 × 2.67 inches. Keep pictures between 300 and
  900 pixels wide, under 700 tall, under 1 MB each, white background, black lines at least 2 pixels thick, labels at
  least 18 pixels tall. Draw them with code (for example Python with Pillow or matplotlib, or SVG rendered to PNG),
  never a screenshot of someone else's figure.
- Only draw a picture when the question needs one. A graph grid or a table to fill in needs no picture: use the
  `grid` or `table` answer space and the app draws it.

## 4. Text markup

In any text field: `H_2O` or `x_{10}` for a subscript, `10^3` or `10^{-3}` for a superscript, `*word*` italic,
`**word**` bold. Use real symbols: `λ`, `Δ`, `°`, `×`, `→`, `−` (minus sign) and `·`. A `\n` inside `text` starts a new
paragraph; inside a `stem` it starts a new line.

## 5. Style, as on the Regents

- One idea per question, written so a student can answer from the information given plus course knowledge.
- Numbers with units and sensible significant figures; the correct answer must come out of the given values.
- Clusters: the passage holds the shared data; each question stands on its own after reading it.
- Scoring notes give the answer and the credit split, in one or two sentences, the way the NYSED rating guides do.
- No answer letters inside the stem, no "all of the above", no trick wording.

## 6. Checklist before you hand the file back

- It parses as JSON, one object, with `title` and a non-empty `parts` array.
- Every `mc` has four `choices` and an `answer` from 1 to 4 that is really the correct one.
- Every `cr` has `credit`, a `space`, and a `note` with the answer.
- Every picture has a `data:image/...;base64,` source. Nothing references a file on disk.
- The passage says `{a}` and `{b}`, not real numbers, if it mentions the question numbers.
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
