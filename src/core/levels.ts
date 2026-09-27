/**
 * Built-in level packs.
 */

import type { Level, SeriesMeta } from './types';

export const SERIES: SeriesMeta[] = [
  {
    id: 'moves',
    title: 'Moves',
    blurb: 'Ownership, Copy, Clone, and Drop',
  },
  {
    id: 'borrowing',
    title: 'Borrowing',
    blurb: 'Shared and mutable references without the panic',
  },
  {
    id: 'lifetimes',
    title: 'Lifetimes',
    blurb: 'When borrows end — lexical, NLL, and escape',
  },
];

export const LEVELS: Level[] = [
  {
    id: 'moves-1',
    name: 'Bind',
    series: 'moves',
    intro: [
      'Welcome to learnRust. The canvas shows stack bindings on the left and heap cells on the right.',
      'Create a `String` binding named `s` holding `hello`.',
      'Try: `let s = String::from("hello");`',
    ],
    hint: 'let s = String::from("hello");',
    start: [],
    goal: {
      checks: [
        { type: 'owned_by', var: 's', valueType: 'String', value: '"hello"' },
      ],
      success: ['s owns a heap String. Moves come next.'],
    },
    par: 1,
    solution: ['let s = String::from("hello");'],
  },
  {
    id: 'moves-2',
    name: 'Copy',
    series: 'moves',
    intro: [
      '`i32` implements `Copy`. Assigning it duplicates the bits; both bindings stay valid.',
      'Bind `a = 42`, then `b = a`. Both must still hold 42.',
    ],
    hint: 'let a = 42; let b = a;',
    start: [],
    goal: {
      checks: [
        { type: 'owned_by', var: 'a', valueType: 'i32', value: '42' },
        { type: 'owned_by', var: 'b', valueType: 'i32', value: '42' },
        { type: 'not_moved', var: 'a' },
      ],
      success: ['Copy types never invalidate the source.'],
    },
    par: 2,
    solution: ['let a = 42;', 'let b = a;'],
  },
  {
    id: 'moves-3',
    name: 'Move',
    series: 'moves',
    intro: [
      '`String` is not `Copy`. `let b = a` moves ownership: `a` becomes invalid.',
      'Move `hello` from `a` into `b`. The goal is a moved `a` and a live `b`.',
    ],
    hint: 'let a = String::from("hello"); let b = a;',
    start: ['let a = String::from("hello");'],
    goal: {
      checks: [
        { type: 'moved', var: 'a' },
        { type: 'owned_by', var: 'b', valueType: 'String', value: '"hello"' },
      ],
      success: ['One owner at a time. That is the whole game.'],
    },
    par: 1,
    solution: ['let b = a;'],
  },
  {
    id: 'moves-4',
    name: 'Use after move',
    series: 'moves',
    intro: [
      'The seed code moves `s` into `t`. Printing `s` after that is E0382.',
      'Fix the program so `print(t)` runs and the goal is met — without cloning if you can.',
    ],
    hint: 'Use t, not s. drop/print the live owner only.',
    start: [
      'let s = String::from("hello");',
      'let t = s;',
    ],
    goal: {
      checks: [
        { type: 'moved', var: 's' },
        { type: 'owned_by', var: 't', valueType: 'String', value: '"hello"' },
        { type: 'not_moved', var: 't' },
      ],
      success: ['Moved values cannot be used again. Follow the owner.'],
    },
    par: 1,
    solution: ['print(t);'],
  },
  {
    id: 'moves-5',
    name: 'Clone',
    series: 'moves',
    intro: [
      'Need both bindings? Deep-copy with `.clone()`.',
      'End with two live Strings that both hold `hello`.',
    ],
    hint: 'let a = String::from("hello"); let b = a.clone();',
    start: ['let a = String::from("hello");'],
    goal: {
      checks: [
        { type: 'owned_by', var: 'a', valueType: 'String', value: '"hello"' },
        { type: 'owned_by', var: 'b', valueType: 'String', value: '"hello"' },
      ],
      success: ['Two heap cells, two owners. Clone is explicit on purpose.'],
    },
    par: 1,
    solution: ['let b = a.clone();'],
  },
  {
    id: 'moves-6',
    name: 'Drop',
    series: 'moves',
    intro: [
      'Owners drop at end of scope. You can also drop early.',
      'Keep `keep`, but drop `temp` on purpose.',
    ],
    hint: 'drop(temp);',
    start: [
      'let keep = String::from("keep");',
      'let temp = String::from("temp");',
    ],
    goal: {
      checks: [
        { type: 'owned_by', var: 'keep', valueType: 'String', value: '"keep"' },
        { type: 'dropped', var: 'temp' },
      ],
      success: ['RAII: drop frees the heap cell.'],
    },
    par: 1,
    solution: ['drop(temp);'],
  },
  {
    id: 'moves-7',
    name: 'Rebind',
    series: 'moves',
    intro: [
      'Assigning a new value to an owner drops the previous heap value.',
      'Start from `v` holding `old`, end with `v` holding `new`.',
    ],
    hint: 'v = String::from("new");',
    start: ['let v = String::from("old");'],
    goal: {
      checks: [{ type: 'value_is', var: 'v', value: '"new"' }],
      success: ['Reassignment ends the old ownership.'],
    },
    par: 1,
    solution: ['v = String::from("new");'],
  },
  {
    id: 'borrowing-1',
    name: 'Shared',
    series: 'borrowing',
    intro: [
      'A shared borrow `&T` lets many readers look at the same value.',
      'Create two live shared borrows of `s`.',
    ],
    hint: 'let r1 = &s; let r2 = &s;',
    start: ['let s = String::from("hello");'],
    goal: {
      checks: [
        { type: 'borrow_live', var: 'r1', mutable: false },
        { type: 'borrow_live', var: 'r2', mutable: false },
        { type: 'not_moved', var: 's' },
      ],
      success: ['Shared borrows multiply. Exclusive ones do not.'],
    },
    par: 2,
    solution: ['let r1 = &s;', 'let r2 = &s;'],
  },
  {
    id: 'borrowing-2',
    name: 'Exclusive',
    series: 'borrowing',
    intro: [
      'One `&mut T` at a time. That is how mutation stays race-free without a GC.',
      'Take a mutable borrow of `s`. No other live borrows allowed.',
    ],
    hint: 'let m = &mut s;',
    start: ['let s = String::from("hello");'],
    goal: {
      checks: [
        { type: 'borrow_live', var: 'm', mutable: true },
        { type: 'no_borrow_on', var: 's' }, // will fail while m is live... wait
      ],
      success: [],
    },
    par: 1,
    solution: [],
  },
  {
    id: 'borrowing-3',
    name: 'Conflict',
    series: 'borrowing',
    intro: [
      'Seed code has a live shared borrow `r`.',
      'Try to take `&mut s` while `r` is still live — then make it work with NLL.',
    ],
    hint: 'Use r once (print(r)), then take &mut. Or drop(r) first.',
    start: [
      'let s = String::from("hello");',
      'let r = &s;',
    ],
    goal: {
      checks: [
        { type: 'borrow_live', var: 'm', mutable: true },
        { type: 'owned_by', var: 's', valueType: 'String' },
      ],
      success: ['End the shared borrow (last use or drop), then go exclusive.'],
    },
    par: 2,
    solution: ['print(r);', 'let m = &mut s;'],
  },
  {
    id: 'borrowing-4',
    name: 'Push',
    series: 'borrowing',
    intro: [
      'Mutation needs `&mut`. Shared refs are read-only windows.',
      'Grow `v` to `[1, 2, 3]` via a mutable borrow.',
    ],
    hint: 'let m = &mut v; m.push(2); m.push(3);',
    start: ['let v = vec![1];'],
    goal: {
      checks: [{ type: 'value_is', var: 'v', value: 'vec![1, 2, 3]' }],
      success: ['`&mut` is write permission.'],
    },
    par: 3,
    solution: ['let m = &mut v;', 'm.push(2);', 'm.push(3);'],
  },
  {
    id: 'borrowing-5',
    name: 'Freeze',
    series: 'borrowing',
    intro: [
      'While any borrow is live, the owner cannot be moved or dropped.',
      'Keep `r` live and make sure `s` is still valid (not moved).',
    ],
    hint: 'let r = &s; print(r);',
    start: ['let s = String::from("hello");'],
    goal: {
      checks: [
        { type: 'borrow_live', var: 'r', mutable: false },
        { type: 'not_moved', var: 's' },
        { type: 'owned_by', var: 's', valueType: 'String' },
      ],
      success: ['Borrows freeze the owner.'],
    },
    par: 1,
    solution: ['let r = &s;'],
  },
  {
    id: 'lifetimes-1',
    name: 'Scope',
    series: 'lifetimes',
    intro: [
      'A block drops its locals in reverse order when it ends.',
      'Create `tmp` inside a block. After the block, `outer` must still be alive.',
    ],
    hint: '{ let tmp = String::from("t"); }  // end of block drops tmp',
    start: ['let outer = String::from("outer");'],
    goal: {
      checks: [
        { type: 'owned_by', var: 'outer', valueType: 'String', value: '"outer"' },
        { type: 'dropped', var: 'tmp' },
      ],
      success: ['Scope end is an implicit drop.'],
    },
    par: 1,
    solution: ['{ let tmp = String::from("t"); }'],
  },
  {
    id: 'lifetimes-2',
    name: 'NLL',
    series: 'lifetimes',
    intro: [
      'Non-lexical lifetimes: a borrow ends at its last use, not at the closing brace.',
      'Seed has `r = &s`. Use `r` once, then mutate `s`.',
    ],
    hint: 'print(r); s = String::from("done");',
    start: [
      'let s = String::from("hello");',
      'let r = &s;',
    ],
    goal: {
      checks: [{ type: 'value_is', var: 's', value: '"done"' }],
      success: ['After the last use of `r`, `s` is free again.'],
    },
    par: 2,
    solution: ['print(r);', 's = String::from("done");'],
  },
  {
    id: 'lifetimes-3',
    name: 'Escape',
    series: 'lifetimes',
    intro: [
      'A borrow cannot outlive the value it points at.',
      'In a block, borrow `s`, then drop `s` while the ref binding still exists — the checker must reject it.',
      'Make the program valid: end the borrow before dropping `s`, and leave `s` dropped at the end.',
    ],
    hint: 'let r = &s; print(r); drop(r); drop(s);',
    start: ['let s = String::from("data");'],
    goal: {
      checks: [
        { type: 'dropped', var: 's' },
        { type: 'no_borrow_on', var: 's' },
      ],
      success: ['End the borrow, then drop the owner. Order matters.'],
    },
    par: 3,
    solution: ['let r = &s;', 'print(r);', 'drop(r);', 'drop(s);'],
  },
];

/** Fix borrowing-2 goal: want exactly one live &mut and no other borrows. */
const exclusive = LEVELS.find((l) => l.id === 'borrowing-2');
if (exclusive) {
  exclusive.goal = {
    checks: [
      { type: 'borrow_live', var: 'm', mutable: true },
      { type: 'not_moved', var: 's' },
      { type: 'owned_by', var: 's', valueType: 'String' },
    ],
    success: ['Exactly one mutable borrow. The owner stays put, frozen.'],
  };
  exclusive.solution = ['let m = &mut s;'];
}

/** Levels registered at runtime via `import level {json}`. */
const customLevels = new Map<string, Level>();

export function registerLevel(level: Level): void {
  customLevels.set(level.id, level);
}

export function levelsBySeries(series: Level['series']): Level[] {
  return [...customLevels.values(), ...LEVELS].filter((l) => l.series === series);
}

export function getLevel(id: string): Level | null {
  return customLevels.get(id) ?? LEVELS.find((l) => l.id === id) ?? null;
}

export function levelIndex(id: string): number {
  return LEVELS.findIndex((l) => l.id === id);
}
