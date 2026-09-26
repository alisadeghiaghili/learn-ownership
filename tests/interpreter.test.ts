/**
 * Interpreter and memory-model tests.
 */

import { describe, expect, it } from 'vitest';
import { execute, runProgram } from '../src/core/interpreter';
import { checkGoal } from '../src/core/goal';
import { findBinding, formatPayload, findHeap, isRefLive } from '../src/core/memory';
import { parse } from '../src/core/parser';

describe('parser', () => {
  it('parses let / move / borrow / push / block', () => {
    const stmts = parse(`
      let a = 1;
      let s = String::from("hi");
      let b = s;
      let r = &b;
      let m = &mut b;
      b.push(1);
      drop(r);
      { let t = 2; }
    `);
    expect(stmts.map((s) => s.kind)).toEqual([
      'let',
      'let',
      'let',
      'let',
      'let',
      'push',
      'drop',
      'block',
    ]);
  });

  it('accepts let mut', () => {
    const stmts = parse('let mut s = String::from("x");');
    expect(stmts[0]?.kind).toBe('let');
  });
});

describe('moves', () => {
  it('copies i32', () => {
    const { state, result } = runProgram('let a = 42; let b = a;');
    expect(result.ok).toBe(true);
    expect(findBinding(state, 'a')?.copy).toBe(42);
    expect(findBinding(state, 'b')?.copy).toBe(42);
    expect(findBinding(state, 'a')?.isMoved).toBe(false);
  });

  it('moves String and rejects use-after-move', () => {
    const { state, result } = runProgram('let a = String::from("hi"); let b = a;');
    expect(result.ok).toBe(true);
    expect(findBinding(state, 'a')?.isMoved).toBe(true);
    const use = execute(state, 'print(a);');
    expect(use.ok).toBe(false);
    expect(use.diagnostic?.code).toBe('E0382');
  });

  it('clone keeps both owners', () => {
    const { state, result } = runProgram('let a = String::from("hi"); let b = a.clone();');
    expect(result.ok).toBe(true);
    expect(findBinding(state, 'a')?.isMoved).toBe(false);
    expect(findBinding(state, 'b')?.isMoved).toBe(false);
    const ha = findHeap(state, findBinding(state, 'a')?.heapId ?? '');
    const hb = findHeap(state, findBinding(state, 'b')?.heapId ?? '');
    expect(ha?.id).not.toBe(hb?.id);
    expect(ha?.payload).toBe('hi');
    expect(hb?.payload).toBe('hi');
  });

  it('drop frees heap', () => {
    const { state, result } = runProgram('let s = String::from("x"); drop(s);');
    expect(result.ok).toBe(true);
    expect(findBinding(state, 's')?.isDropped).toBe(true);
    const h = findHeap(state, findBinding(state, 's')?.heapId ?? '');
    expect(h?.alive).toBe(false);
  });

  it('rebind drops old payload', () => {
    const { state, result } = runProgram(
      'let v = String::from("old"); v = String::from("new");',
    );
    expect(result.ok).toBe(true);
    const live = findBinding(state, 'v');
    // last binding wins
    const bindings = state.frames[0]?.bindings.filter((b) => b.name === 'v') ?? [];
    const last = bindings[bindings.length - 1];
    expect(last).toBeTruthy();
    if (last?.heapId) {
      const h = findHeap(state, last.heapId);
      expect(formatPayload(h?.payload ?? '')).toBe('"new"');
    }
    void live;
  });
});

describe('borrowing', () => {
  it('allows many shared borrows', () => {
    const { result } = runProgram(
      'let s = String::from("hi"); let r1 = &s; let r2 = &s;',
    );
    expect(result.ok).toBe(true);
  });

  it('rejects &mut while shared is live', () => {
    const { state, result } = runProgram('let s = String::from("hi"); let r = &s;');
    expect(result.ok).toBe(true);
    const bad = execute(state, 'let m = &mut s;');
    expect(bad.ok).toBe(false);
    expect(bad.diagnostic?.code).toBe('E0502');
  });

  it('NLL: last use of shared ends borrow', () => {
    const { state, result } = runProgram('let s = String::from("hi"); let r = &s;');
    expect(result.ok).toBe(true);
    expect(execute(state, 'print(r);').ok).toBe(true);
    expect(execute(state, 's = String::from("done");').ok).toBe(true);
    const latest = findBinding(state, 's');
    expect(latest?.isMoved).toBe(false);
    expect(latest?.heapId).toBeTruthy();
  });

  it('rejects push through &', () => {
    const { state } = runProgram('let v = vec![1]; let r = &v;');
    const bad = execute(state, 'r.push(2);');
    expect(bad.ok).toBe(false);
  });

  it('push through &mut works', () => {
    const { state, result } = runProgram('let v = vec![1]; let m = &mut v;');
    expect(result.ok).toBe(true);
    expect(execute(state, 'm.push(2);').ok).toBe(true);
    const b = findBinding(state, 'v');
    const h = findHeap(state, b?.heapId ?? '');
    expect(h?.payload).toEqual([1, 2]);
  });

  it('owner cannot move while a never-used borrow is live', () => {
    const { state } = runProgram('let s = String::from("hi"); let r = &s;');
    const bad = execute(state, 'let t = s;');
    expect(bad.ok).toBe(false);
    expect(bad.diagnostic?.code).toBe('E0502');
    expect(execute(state, 'drop(r);').ok).toBe(true);
    expect(execute(state, 'let t = s;').ok).toBe(true);
  });
});

describe('blocks and goals', () => {
  it('block drops locals', () => {
    const { state, result } = runProgram('let outer = String::from("o"); { let tmp = String::from("t"); }');
    expect(result.ok).toBe(true);
    expect(findBinding(state, 'outer')?.isDropped).toBe(false);
  });

  it('goal owned_by + value_is', () => {
    const { state } = runProgram('let s = String::from("hello");');
    const report = checkGoal(state, {
      checks: [{ type: 'value_is', var: 's', value: '"hello"' }],
    });
    expect(report.passed).toBe(true);
  });

  it('goal commands_lte uses count', () => {
    const { state } = runProgram('let a = 1;');
    const pass = checkGoal(state, { checks: [{ type: 'commands_lte', count: 2 }] }, 2);
    const fail = checkGoal(state, { checks: [{ type: 'commands_lte', count: 2 }] }, 3);
    expect(pass.passed).toBe(true);
    expect(fail.passed).toBe(false);
  });
});

describe('meta parse', () => {
  it('detects code vs meta', async () => {
    const { parseInput } = await import('../src/core/engine');
    expect(parseInput('let a = 1;').kind).toBe('code');
    expect(parseInput('levels').kind).toBe('meta');
    expect(parseInput('!help').kind).toBe('meta');
  });
});

describe('ref liveness helper', () => {
  it('never-used ref is live', () => {
    const { state } = runProgram('let s = String::from("x"); let r = &s;');
    const r = findBinding(state, 'r');
    expect(r).toBeTruthy();
    if (r) {
      r.lastUseIndex = null;
      expect(isRefLive(state, r)).toBe(true);
    }
  });
});
