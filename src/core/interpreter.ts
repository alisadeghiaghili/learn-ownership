/**
 * Statement interpreter and simplified borrow checker.
 */

import {
  allocHeap,
  cloneMemory,
  createMemory,
  dropHeap,
  findBinding,
  findHeap,
  formatPayload,
  isCopyType,
  liveRefsTo,
  liveRefsToName,
  pushBinding,
  pushFrame,
  popFrame,
  touch,
} from './memory';
import type { Expr, Stmt } from './parser';
import { parse, ParseError } from './parser';
import type {
  Binding,
  Diagnostic,
  ExecResult,
  MemoryState,
  ValueType,
} from './types';

function diag(
  code: string | null,
  title: string,
  label: string,
  opts: { note?: string | null; help?: string | null; related?: string[] } = {},
): Diagnostic {
  return {
    code,
    title,
    label,
    note: opts.note ?? null,
    help: opts.help ?? null,
    related: opts.related ?? [],
  };
}

function fail(d: Diagnostic): ExecResult {
  return {
    ok: false,
    log: [],
    diagnostic: d,
    effects: [{ kind: 'error_focus', names: d.related }],
  };
}

function ok(log: string[] = [], effects: ExecResult['effects'] = []): ExecResult {
  return { ok: true, log, diagnostic: null, effects };
}

function requireUsable(
  state: MemoryState,
  name: string,
): { binding: Binding } | ExecResult {
  const b = findBinding(state, name);
  if (!b) {
    return fail(
      diag(
        'E0425',
        `cannot find value \`${name}\` in this scope`,
        'not found in this scope',
        { help: `declare it with \`let ${name} = ...\` first` },
      ),
    );
  }
  if (b.isMoved) {
    return fail(
      diag(
        'E0382',
        `use of moved value: \`${name}\``,
        'value used here after move',
        {
          note: `\`${name}\` is a non-Copy type and its value was moved`,
          help: 'clone it before the move, or use the new owner',
          related: [name],
        },
      ),
    );
  }
  if (b.isDropped) {
    return fail(
      diag('E0382', `use of dropped value: \`${name}\``, 'value used after drop', {
        related: [name],
      }),
    );
  }
  return { binding: b };
}

function describeRefs(refs: Binding[]): string[] {
  return refs.map((r) => `${r.name} (${r.role === 'ref_mut' ? '&mut' : '&'})`);
}

function borrowConflict(
  state: MemoryState,
  ownerName: string,
  heapId: string | null,
  wantMut: boolean,
  verb: string,
): ExecResult | null {
  const refs = heapId ? liveRefsTo(state, heapId) : liveRefsToName(state, ownerName);
  const blocking = wantMut ? refs : refs.filter((r) => r.role === 'ref_mut');
  if (blocking.length === 0) return null;
  const names = describeRefs(blocking);
  if (wantMut) {
    return fail(
      diag(
        'E0502',
        `cannot ${verb} \`${ownerName}\` because it is borrowed`,
        `cannot ${verb} as mutable because it is also borrowed`,
        {
          note: `borrow${blocking.length > 1 ? 's' : ''} active: ${names.join(', ')}`,
          help: 'end the borrow(s) first (drop the reference or stop using it)',
          related: [ownerName, ...blocking.map((b) => b.name)],
        },
      ),
    );
  }
  return fail(
    diag(
      'E0502',
      `cannot ${verb} \`${ownerName}\` because it is mutably borrowed`,
      `cannot ${verb} while \`&mut\` is live`,
      {
        note: `mutable borrow active: ${names.join(', ')}`,
        help: 'end the mutable borrow first',
        related: [ownerName, ...blocking.map((b) => b.name)],
      },
    ),
  );
}

type EvalOk =
  | { kind: 'copy'; value: number | boolean; type: ValueType }
  | { kind: 'heap'; heapId: string; type: ValueType; moveFrom: string | null; cloned: boolean }
  | {
      kind: 'borrow';
      originName: string;
      targetHeapId: string | null;
      mutable: boolean;
      type: ValueType;
    };

type EvalResult = EvalOk | ExecResult;

function isExecResult(r: EvalResult): r is ExecResult {
  return 'ok' in r;
}

function evalExpr(state: MemoryState, expr: Expr): EvalResult {
  switch (expr.kind) {
    case 'int':
      return { kind: 'copy', value: expr.value, type: 'i32' };
    case 'bool':
      return { kind: 'copy', value: expr.value, type: 'bool' };
    case 'str':
    case 'string_from': {
      const h = allocHeap(state, 'String', expr.value);
      return {
        kind: 'heap',
        heapId: h.id,
        type: 'String',
        moveFrom: null,
        cloned: false,
      };
    }
    case 'vec': {
      const h = allocHeap(state, 'Vec<i32>', [...expr.items]);
      return {
        kind: 'heap',
        heapId: h.id,
        type: 'Vec<i32>',
        moveFrom: null,
        cloned: false,
      };
    }
    case 'ident': {
      const check = requireUsable(state, expr.name);
      if ('diagnostic' in check) return check;
      const b = check.binding;
      touch(state, b.name);
      if (b.role !== 'owner') {
        return {
          kind: 'borrow',
          originName: b.originName ?? b.name,
          targetHeapId: b.targetHeapId,
          mutable: b.role === 'ref_mut',
          type: b.valueType,
        };
      }
      if (isCopyType(b.valueType)) {
        const v = b.copy;
        if (v === null) {
          return fail(
            diag('E0382', `use of moved value: \`${b.name}\``, 'moved', {
              related: [b.name],
            }),
          );
        }
        return { kind: 'copy', value: v, type: b.valueType };
      }
      const heapId = b.heapId;
      const blockers = borrowConflict(state, b.name, heapId, true, 'move out of');
      if (blockers) return blockers;
      if (!heapId) {
        return fail(
          diag(null, 'internal: missing heap for move', b.name),
        );
      }
      b.isMoved = true;
      touch(state, b.name);
      return {
        kind: 'heap',
        heapId,
        type: b.valueType,
        moveFrom: b.name,
        cloned: false,
      };
    }
    case 'clone': {
      const check = requireUsable(state, expr.name);
      if ('diagnostic' in check) return check;
      const b = check.binding;
      touch(state, b.name);
      if (b.role !== 'owner') {
        return fail(
          diag(
            'E0507',
            'cannot clone a reference to move out the referent',
            'call clone on the owner',
            { related: [b.name] },
          ),
        );
      }
      if (isCopyType(b.valueType)) {
        const v = b.copy;
        if (v === null) {
          return fail(
            diag('E0382', `use of moved value: \`${b.name}\``, 'moved', {
              related: [b.name],
            }),
          );
        }
        return { kind: 'copy', value: v, type: b.valueType };
      }
      const h = findHeap(state, b.heapId ?? '');
      if (!h || !h.alive) {
        return fail(
          diag('E0382', `use of dropped value: \`${b.name}\``, 'dropped', {
            related: [b.name],
          }),
        );
      }
      const copy = allocHeap(
        state,
        h.type,
        Array.isArray(h.payload) ? [...h.payload] : h.payload,
      );
      return {
        kind: 'heap',
        heapId: copy.id,
        type: h.type,
        moveFrom: null,
        cloned: true,
      };
    }
    case 'ref': {
      const check = requireUsable(state, expr.name);
      if ('diagnostic' in check) return check;
      const b = check.binding;
      if (b.role !== 'owner') {
        if (expr.mutable && b.role !== 'ref_mut') {
          return fail(
            diag(
              'E0596',
              `cannot borrow \`${b.name}\` as mutable, as it is not declared as mutable`,
              'cannot mutably reborrow',
              { related: [b.name] },
            ),
          );
        }
        touch(state, b.name);
        return {
          kind: 'borrow',
          originName: b.originName ?? b.name,
          targetHeapId: b.targetHeapId,
          mutable: expr.mutable,
          type: b.valueType,
        };
      }
      const others = b.heapId
        ? liveRefsTo(state, b.heapId)
        : liveRefsToName(state, b.name);
      if (expr.mutable) {
        if (others.length > 0) {
          return fail(
            diag(
              'E0502',
              `cannot borrow \`${b.name}\` as mutable because it is also borrowed`,
              'mutable borrow occurs here',
              {
                note: `existing: ${describeRefs(others).join(', ')}`,
                help: 'wait until the other borrows end (last use of those refs)',
                related: [b.name, ...others.map((o) => o.name)],
              },
            ),
          );
        }
      } else {
        const muts = others.filter((o) => o.role === 'ref_mut');
        if (muts.length > 0) {
          return fail(
            diag(
              'E0502',
              `cannot borrow \`${b.name}\` as immutable because it is also borrowed as mutable`,
              'immutable borrow occurs here',
              {
                note: `existing: ${describeRefs(muts).join(', ')}`,
                help: 'end the mutable borrow first',
                related: [b.name, ...muts.map((o) => o.name)],
              },
            ),
          );
        }
      }
      touch(state, b.name);
      return {
        kind: 'borrow',
        originName: b.name,
        targetHeapId: b.heapId,
        mutable: expr.mutable,
        type: b.valueType,
      };
    }
    default:
      return fail(diag(null, 'unsupported expression', ''));
  }
}

function bindResult(
  state: MemoryState,
  name: string,
  result: EvalOk,
  createdIndex: number,
): ExecResult {
  if (result.kind === 'copy') {
    pushBinding(state, {
      name,
      role: 'owner',
      valueType: result.type,
      heapId: null,
      copy: result.value,
      targetHeapId: null,
      originName: null,
      isMoved: false,
      isDropped: false,
      lastUseIndex: createdIndex,
      createdIndex,
    });
    return ok([`bound ${name} = ${String(result.value)}`], [
      { kind: 'bind', name, heapId: null },
    ]);
  }

  if (result.kind === 'heap') {
    pushBinding(state, {
      name,
      role: 'owner',
      valueType: result.type,
      heapId: result.heapId,
      copy: null,
      targetHeapId: null,
      originName: null,
      isMoved: false,
      isDropped: false,
      lastUseIndex: createdIndex,
      createdIndex,
    });
    const effects: ExecResult['effects'] = [
      { kind: 'bind', name, heapId: result.heapId },
    ];
    if (result.moveFrom) {
      effects.push({
        kind: 'move',
        heapId: result.heapId,
        from: result.moveFrom,
        to: name,
      });
    }
    const payload = findHeap(state, result.heapId);
    const shown = payload ? formatPayload(payload.payload) : '?';
    return ok([`bound ${name} = ${shown}`], effects);
  }

  pushBinding(state, {
    name,
    role: result.mutable ? 'ref_mut' : 'ref',
    valueType: result.type,
    heapId: null,
    copy: null,
    targetHeapId: result.targetHeapId,
    originName: result.originName,
    isMoved: false,
    isDropped: false,
    // null = not used yet → borrow stays live under simplified NLL
    lastUseIndex: null,
    createdIndex,
  });
  return ok(
    [`bound ${name} = &${result.mutable ? 'mut ' : ''}${result.originName}`],
    [
      {
        kind: 'borrow',
        from: result.originName,
        to: name,
        mutable: result.mutable,
        heapId: result.targetHeapId,
      },
    ],
  );
}

function executeStmt(state: MemoryState, stmt: Stmt): ExecResult {
  switch (stmt.kind) {
    case 'block': {
      pushFrame(state, 'block');
      const logs: string[] = [];
      const effects: ExecResult['effects'] = [];
      for (const inner of stmt.body) {
        const r = executeStmt(state, inner);
        logs.push(...r.log);
        effects.push(...r.effects);
        if (!r.ok) {
          popFrame(state);
          return {
            ok: false,
            log: logs,
            diagnostic: r.diagnostic,
            effects,
          };
        }
      }
      const dropped = popFrame(state);
      for (const n of dropped) {
        effects.push({ kind: 'drop', name: n, heapId: null });
      }
      if (dropped.length) {
        logs.push(`end of block: dropped ${dropped.join(', ')}`);
      }
      return ok(logs, effects);
    }
    case 'let': {
      const r = evalExpr(state, stmt.expr);
      if (isExecResult(r)) return r;
      return bindResult(state, stmt.name, r, state.stmtIndex);
    }
    case 'assign': {
      const existing = findBinding(state, stmt.name);
      if (!existing || existing.role !== 'owner' || existing.isDropped || existing.isMoved) {
        // Allow re-creating via assign only on live owner; otherwise treat as shadow let.
        if (existing && (existing.isMoved || existing.isDropped || existing.role !== 'owner')) {
          const r = evalExpr(state, stmt.expr);
          if (isExecResult(r)) return r;
          return bindResult(state, stmt.name, r, state.stmtIndex);
        }
        return fail(
          diag(
            'E0384',
            `cannot assign to \`${stmt.name}\``,
            'assignment target missing or not an owner',
            {
              help: `declare it with \`let ${stmt.name} = ...\` first`,
              related: [stmt.name],
            },
          ),
        );
      }
      const blockers = borrowConflict(
        state,
        stmt.name,
        existing.heapId,
        true,
        'assign to',
      );
      if (blockers) return blockers;
      if (existing.heapId) dropHeap(state, existing.heapId);
      existing.isDropped = true;
      existing.isMoved = true;
      const r = evalExpr(state, stmt.expr);
      if (isExecResult(r)) return r;
      return bindResult(state, stmt.name, r, state.stmtIndex);
    }
    case 'drop': {
      const check = requireUsable(state, stmt.name);
      if ('diagnostic' in check) return check;
      const b = check.binding;
      if (b.role !== 'owner') {
        b.isDropped = true;
        touch(state, b.name);
        return ok([`ended borrow ${b.name}`], [{ kind: 'borrow_end', name: b.name }]);
      }
      const blockers = borrowConflict(state, b.name, b.heapId, true, 'drop');
      if (blockers) return blockers;
      if (b.heapId) dropHeap(state, b.heapId);
      b.isDropped = true;
      touch(state, b.name);
      return ok([`dropped ${b.name}`], [
        { kind: 'drop', name: b.name, heapId: b.heapId },
      ]);
    }
    case 'use': {
      const check = requireUsable(state, stmt.name);
      if ('diagnostic' in check) return check;
      const b = check.binding;
      touch(state, b.name);
      if (b.role === 'owner') {
        const refs = b.heapId
          ? liveRefsTo(state, b.heapId)
          : liveRefsToName(state, b.name);
        const activeMuts = refs.filter((m) => m.role === 'ref_mut');
        if (activeMuts.length > 0) {
          return fail(
            diag(
              'E0502',
              `cannot use \`${b.name}\` because it was mutably borrowed`,
              'use of borrowed value',
              {
                note: `mutable borrow: ${describeRefs(activeMuts).join(', ')}`,
                help: 'use the reference instead, or end the mutable borrow',
                related: [b.name, ...activeMuts.map((m) => m.name)],
              },
            ),
          );
        }
      }
      let shown: string;
      if (b.role !== 'owner') {
        const h = b.targetHeapId ? findHeap(state, b.targetHeapId) : null;
        shown = h
          ? formatPayload(h.payload)
          : `via &${b.role === 'ref_mut' ? 'mut ' : ''}${b.originName ?? '?'}`;
        return ok([`${stmt.flavor}(${b.name}) → ${shown}`]);
      }
      if (b.copy !== null) shown = String(b.copy);
      else if (b.heapId) {
        const h = findHeap(state, b.heapId);
        shown = h ? formatPayload(h.payload) : '?';
      } else shown = '?';
      return ok([`${stmt.flavor}(${b.name}) → ${shown}`]);
    }
    case 'push': {
      const check = requireUsable(state, stmt.name);
      if ('diagnostic' in check) return check;
      const b = check.binding;
      let targetHeap = b.heapId;
      let targetName = b.name;
      if (b.role === 'ref_mut') {
        targetHeap = b.targetHeapId;
        targetName = b.originName ?? b.name;
        touch(state, b.name);
      } else if (b.role === 'ref') {
        return fail(
          diag(
            'E0596',
            `cannot borrow \`${b.name}\` as mutable, as it is not declared as mutable`,
            'cannot mutate through a shared reference',
            {
              note: `\`${b.name}\` is a shared reference`,
              help: 'take `&mut` instead',
              related: [b.name],
            },
          ),
        );
      } else {
        const blockers = borrowConflict(state, b.name, b.heapId, true, 'mutate');
        if (blockers) return blockers;
        touch(state, b.name);
      }
      if (!targetHeap) {
        return fail(
          diag('E0599', `cannot call \`push\` on \`${targetName}\``, 'not a Vec', {
            related: [targetName],
          }),
        );
      }
      const h = findHeap(state, targetHeap);
      if (!h || !h.alive) {
        return fail(
          diag('E0382', `use of dropped value: \`${targetName}\``, 'dropped', {
            related: [targetName],
          }),
        );
      }
      if (h.type !== 'Vec<i32>') {
        return fail(
          diag(
            'E0599',
            `no method named \`push\` found for type \`${h.type}\``,
            'unknown method',
            { related: [targetName] },
          ),
        );
      }
      const arr = h.payload;
      if (!Array.isArray(arr)) {
        return fail(diag(null, 'internal: bad vec payload', ''));
      }
      arr.push(stmt.value);
      return ok([`push → ${formatPayload(arr)}`]);
    }
    default:
      return fail(diag(null, 'unsupported statement', ''));
  }
}

/**
 * Run one or more statements against a memory state.
 * Advances `stmtIndex` per top-level statement (NLL clock).
 */
export function execute(state: MemoryState, source: string): ExecResult {
  let stmts: Stmt[];
  try {
    stmts = parse(source);
  } catch (e) {
    if (e instanceof ParseError) {
      return fail(
        diag('E0001', `parse error: ${e.message}`, e.span || 'here', {
          help: 'see `help syntax` for the supported subset',
        }),
      );
    }
    throw e;
  }
  const logs: string[] = [];
  const effects: ExecResult['effects'] = [];
  for (const stmt of stmts) {
    state.stmtIndex += 1;
    const r = executeStmt(state, stmt);
    logs.push(...r.log);
    effects.push(...r.effects);
    if (!r.ok) {
      return { ok: false, log: logs, diagnostic: r.diagnostic, effects };
    }
  }
  return ok(logs, effects);
}

/** Seed a fresh memory and run source. */
export function runProgram(source: string): {
  state: MemoryState;
  result: ExecResult;
} {
  const state = createMemory();
  const result = execute(state, source);
  return { state, result };
}

export { cloneMemory, createMemory };
