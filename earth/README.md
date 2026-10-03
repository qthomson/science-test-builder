# Earth Science Test Builder data

Earth Science data for the merged Science Test Builder (`C:\Qdev\School\Science Test Builder\index.html`). The app is the
chemistry text edition; `bank\subject.js` supplies the subject strings (name, title, 2011/2026 edition labels, `etb.`
storage prefix, `ESS` new-format prefix, names of the dropped 2011 tables).

| what | made by |
|---|---|
| `bank\bank.json/.js` — 1,950 MC + 207 stimuli + 409 CR clusters (1,365 items): answers, type T1–T165, unit, descriptor, 2011-table needs (`tables`, `table_kinds`, `ref`, `refnote`) | `Earth Science\Text Bank\tools\build_es_bank.py` |
| `bank-new\new.json/.js` — 53 ESS clusters (250 q): archetype N1–N98, unit | same |
| `bank\reftables.js` — crops of the 2011 ESRT items the 2026 edition dropped/cut, SPHEAT/WATER as typed constants, the 2011 equations as text | `Chemistry\Text Builder\tools\build_reftables.py earth` |
| `bank-text\*.js` — question text + figures (133 MB) | `Chemistry\Text Builder\tools\build_textbank.py --root "C:\Qdev\School\Earth Science"` |

Units: Quinn's 2026–27 course, stored as ids 1–10 with `unit_codes` 0–9 (U0 Skills and maps, U1 The Universe, U2 Planet
Motions, U3 Formation of the Spheres, U4 Plate Tectonics, U5 Earth's Changing Surface, U6 Earth's History, U7 Meteorology and
Climate Change, U8 Resources, U9 Humans and Earth's Systems). Types and units come from `Earth Science\Analysis\old_types.py`
and `new-regents\new_types.py`; per-question tags are in `Text Bank\tagging\output-*.tsv` (type, type2, confidence,
descriptor, ref_codes, ref_note).

Reference-table warnings follow the rule "only when a question needs something the 2026 ESS tables do not offer and the
question does not supply it"; the per-code rulebook is `Text Bank\tagging\lost-items.md`. `table_kind` says whether an
item is a table (picture insert), a constant (typed line) or an equation (typed).
