# DESIGN.md — learnRust

Interactive Rust ownership/borrowing visualizer and tutorial — sandbox + terminal +
leveled challenges + level builder + golf.

## Product

**Name:** learnRust  
**One job:** make Rust's invisible memory rules visible while the learner types code.  
**Audience:** developers hitting the borrow checker for the first time.  
**Surface:** full-viewport client-side SPA (no backend), same posture as LGB.

### Interaction model (LGB parallel)

| LGB | learnRust |
| --- | --- |
| commit tree | stack / heap / borrow graph |
| `git commit` etc. | Rust-subset statements (`let`, move, `&`, `&mut`, `drop`, `clone`) |
| sandbox | free-play memory lab |
| levels + series | levels in packs: Moves, Borrowing, Lifetimes |
| git golf | command golf (fewest statements) |
| `build level` / `import level` | same |
| `undo` / `reset` | same |
| `?command=` permalink | `?cmd=` / `?level=` |

### Mini-language (teaching subset)

- Types: `i32`, `bool`, `String`, `Vec<i32>`, `&T`, `&mut T`
- Statements: `let`, assignment, `clone()`, `&` / `&mut`, `drop(x)`, `use(x)`,
  `print(x)`, `x.push(v)`, blocks `{ ... }`, `//` comments
- Copy: `i32`, `bool`. Move: `String`, `Vec<i32>`
- Checker: move-after-use, shared vs exclusive borrows, use-while-borrowed,
  simplified NLL (borrow ends at last use)

### Win conditions (data-driven, no eval)

`goal.checks[]`: `owned_by`, `dropped`, `value_is`, `borrow_live`, `no_moves`,
`var_exists`, `type_is`, `commands_lte` (golf optional).

---

## Visual direction

**Style anchor:** runtime debugger chrome over an engineering schematic of memory —
think a dark IDE locals/heap pane crossed with a drafting-table callout drawing.
Not a marketing site, not a card grid.

**Why this anchor:** the subject *is* machine state. The memorable image should be
the memory graph itself (bindings, heap cells, borrow arcs), framed like a debugger
view the learner already trusts.

### Palette

| Token | Hex | Role |
| --- | --- | --- |
| `void` | `#1A1D24` | app background |
| `panel` | `#242830` | terminal, dialogs, chrome |
| `line` | `#3A4150` | 1px structural borders, grid |
| `ink` | `#E8E4D9` | primary text (warm bone, not pure white) |
| `ink-dim` | `#9AA3B2` | secondary labels |
| `oxide` | `#E07A3D` | **accent** — moves, live owners, primary CTA |
| `flux` | `#6BA3A0` | shared borrows `&T` |
| `weld` | `#C4A35A` | mutable borrows `&mut T` |
| `fault` | `#C45C5C` | borrow-check errors |

One accent (`oxide`). `flux` / `weld` / `fault` are *semantic* (memory state), not decoration.

### Typography

- **Display / UI:** Space Grotesk — technical grotesque with enough character to not read Inter-default
- **Code / terminal / memory labels:** IBM Plex Mono
- **Scale:** 11 caption · 13 body · 15 terminal · 18 panel title · 28 level title · 40 hero numeral
- Weights: 400 / 500 / 600 only
- Sentence case. No ALL-CAPS eyebrows. No single-word italic accents in headlines

### Layout system

Full-viewport three-band shell (LGB posture):

```
+--------------------------------------------------+
|  logo   sandbox  levels  help        level title  |
|                                         3 / 12   |
+--------------------------------------------------+
|                                                    |
|   +-------------+     +---------------------+     |
|   | STACK       |     | HEAP                |     |
|   | frame main  |     | [String 0x1] hello  |     |
|   |  a ─────────────► |                     |     |
|   |  r &a ─────(arc)  |                     |     |
|   +-------------+     +---------------------+     |
|                 borrow legend                     |
+--------------------------------------------------+
|  $ let a = String::from("hello");                 |
|  history…                                         |
|  $ _                                              |
+--------------------------------------------------+
```

- Spacing rhythm: 4 / 8 / 12 / 16 / 24 / 40
- Max radius 4px. Borders are 1px `line`. No soft drop shadows
- Density: high in the canvas, generous padding in dialogs (24–40)
- Alignment: left for code and history; canvas is a fixed schematic, not freeform art

### Signature moments (the only planned motion)

1. **Move transfer** — on `let b = a` for a non-Copy type, the heap cell physically
   translates from `a`'s binding to `b`'s while `a` flips to `moved` (struck, dim).
2. **Borrow arc lock** — a live `&mut` draws a thick `weld` ring on the heap cell;
   illegal access flashes `fault` and prints a rustc-shaped multi-line diagnostic.

Respect `prefers-reduced-motion`. No entrance choreography, no hover card lifts.

### Principles

1. Memory is the product; chrome stays quiet
2. Diagnostics teach (span + error code + note + help)
3. Color = state (owner / shared / mut / fault), never decoration
4. Structure encodes meaning (frames, heap, arcs) — not cards
5. Errors explain the *rule*, not just the rejection

## Level manifest

| # | Pack | Title | Point |
| --- | --- | --- | --- |
| 1 | moves | Bind | `let` creates a binding |
| 2 | moves | Copy | `i32` copies; both bindings stay valid |
| 3 | moves | Move | `String` moves; source is invalidated |
| 4 | moves | Use after move | detect and fix moved-value use |
| 5 | moves | Clone | deep copy to keep both |
| 6 | moves | Drop | `drop` ends ownership early |
| 7 | moves | Rebind | reassigning drops the old value |
| 8 | borrowing | Shared | many `&T` at once |
| 9 | borrowing | Exclusive | one `&mut T` only |
| 10 | borrowing | Conflict | no `&` while `&mut` is live |
| 11 | borrowing | Push | mutation needs `&mut` |
| 12 | borrowing | Freeze | owner frozen while borrowed |
| 13 | lifetimes | Scope | borrows end with their binding |
| 14 | lifetimes | NLL | borrow ends at last use |
| 15 | lifetimes | Return | returning a borrow of a local is rejected |

Each level: `id`, `name`, `series`, `intro[]`, `hint`, `start[]` statements,
`goal.checks[]`, optional `par` (golf), `solution[]`.

### Image manifest

No raster images. The memory schematic is SVG drawn from live state.
Icons are inline SVG paths only.

## Tech

- Vite + TypeScript (strict)
- Vitest for engine tests
- Vanilla DOM + SVG (no React) — same “simple client-side” posture as LGB
- Zero runtime network calls
