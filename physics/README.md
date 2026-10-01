# Physics Test Builder data

Physics data for the merged Science Test Builder (`C:\Qdev\School\Science Test Builder\index.html`, one app for every
subject with a subject chooser at start). The app is the chemistry text edition (`Chemistry\Text Builder\Text Test
Builder.html`, built by `tools\patch_app.py`). Nothing in it is physics-specific: `bank\subject.js` supplies the subject strings
(name, default worksheet title, reference-table note and names, 2006/2025 edition labels, `ptb.` storage prefix,
`PSP` new-format prefix) and the renderer picks them up through `ENG.setSubject`.

| what | where | made by |
|---|---|---|
| `bank\subject.js` | subject strings | hand-written |
| `bank\bank.json/.js` | 650 MC + 9 stimuli + 144 CR clusters (322 items): answers, type (T1–T149), unit, descriptor, tables, ref | `Physics\Text Bank\tools\build_physics_bank.py` |
| `bank-new\new.json/.js` | 13 new-format clusters (65 q): archetype N1–N74, unit | same |
| `bank
| `bank\reftables.js` | the 2006-edition items the 2025 tables dropped (table crops, constant rows, typeset equations) for the "Missing reference tables / constants" worksheet settings | `Chemistry\Text Builder\tools\build_reftables.py physics` |
| `bank-text\*.js` | question text + figures (11.4 MB) | `Chemistry\Text Builder\tools\build_textbank.py --root C:\Qdev\School\Physics` |

Units are stored as integers 1–11 in Quinn's order; `unit_codes` maps them to the course codes shown in the app
(1→U0 Basics, 2→U1 Waves & sound, 3→U2 Waves & light, 4→U2.5 Optics, 5→U3 Kinematics, 6→U4 Forces, 7→U5 Mechanical
energy & momentum, 8→U6 Electrostatics, 9→U7 Electricity, 10→U7.5 Magnetism, 11→U8 Modern). The type→unit assignments
are in `Physics\Text Bank\tools\old_types.json` (with the keep/remove verdicts from the August analysis) and
`new_types.json`; the tags per question are in `Physics\Text Bank\tagging\output-*.tsv`.

Reference-table codes come from the extractor's rulebook (`Physics\Text Bank\tools\stems.py`). The six sections that
exist only in the 2006 edition (FRICT, REFRACT, ENERGYLVL, STDMODEL, RESIST, GEOM) set `ref: old` and the bold warning on
the key.

Run locally: serve this folder (`py -m http.server 8770`) and open `Text Test Builder.html`. Site copy:
`py Chemistry\Text Builder\tools\deploy_site.py physics` stages it in `Science Test Builder\physics\` (commit + push by hand).

Not yet: the shared-library backend (Apps Script) stores one subject's lists; physics needs its own deployment or a
subject column before "shared" mode works for it. `width` of MC questions is guessed from figure widths until the
extractor emits it.
