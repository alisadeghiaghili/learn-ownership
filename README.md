# learnOwnership

Interactive Rust **ownership** visualizer and tutorial — structurally modeled on
[learnGitBranching](https://github.com/pcottle/learnGitBranching): a client-side
sandbox, a command terminal, leveled challenges, command golf, and a level builder.

**Live:** https://alisadeghiaghili.github.io/learn-ownership/

## Why

Git's hard part is history shape; Rust's hard part is memory ownership. Both are
invisible on a bare prompt and obvious on a diagram. This lab types a small Rust
subset and draws stack, heap, moves, and borrows as you go.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm test
npm run build    # static output in ./build
```

## Command surface

| Input | Meaning |
| --- | --- |
| `let s = String::from("hello");` | bind |
| `let b = a;` | move or copy |
| `let b = a.clone();` | deep copy |
| `let r = &s;` · `let m = &mut s;` | borrow |
| `drop(x);` `print(x);` `use(x);` `read(x);` | use / end |
| `v.push(1);` | mutate a `Vec<i32>` |
| `{ ... }` | nested scope (RAII drop) |
| `levels` `show level moves-1` | level packs |
| `goal` `hint` `solution` | level tools |
| `undo` `reset` `sandbox` | session tools |
| `build level` `import level` | level builder |

URL permalinks: `?level=moves-1&cmd=let%20b=a;`

## Design

See [DESIGN.md](./DESIGN.md) — palette, type, layout, and the level manifest.

## Status

Teaching subset: `i32`, `bool`, `String`, `Vec<i32>`, `&T`, `&mut T`.
Borrow checking includes move errors, shared/exclusive conflicts, and simplified
NLL (a reference expires after its last use).
