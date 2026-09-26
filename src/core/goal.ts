/**
 * Goal checks and level completion evaluation.
 */

import {
  allBindings,
  canonicalValue,
  findBinding,
  isRefLive,
  findHeap,
} from './memory';
import type { Goal, GoalCheck, MemoryState } from './types';

export interface CheckOutcome {
  check: GoalCheck;
  passed: boolean;
  detail: string;
}

export interface GoalReport {
  passed: boolean;
  outcomes: CheckOutcome[];
}

function evaluateCheck(state: MemoryState, check: GoalCheck): CheckOutcome {
  switch (check.type) {
    case 'var_exists': {
      const b = findBinding(state, check.var);
      const live = !!b && !b.isDropped && !b.isMoved;
      return {
        check,
        passed: live,
        detail: live ? `\`${check.var}\` is live` : `\`${check.var}\` is missing, moved, or dropped`,
      };
    }
    case 'owned_by': {
      const b = findBinding(state, check.var);
      if (!b || b.role !== 'owner' || b.isMoved || b.isDropped) {
        return {
          check,
          passed: false,
          detail: `\`${check.var}\` does not own a value`,
        };
      }
      if (check.valueType && b.valueType !== check.valueType) {
        return {
          check,
          passed: false,
          detail: `\`${check.var}\` is ${b.valueType}, expected ${check.valueType}`,
        };
      }
      if (check.value !== undefined) {
        const v = canonicalValue(b, state);
        const want = normalizeWant(check.value);
        const got = normalizeWant(v ?? '');
        if (got !== want) {
          return {
            check,
            passed: false,
            detail: `\`${check.var}\` = ${v ?? '∅'}, expected ${check.value}`,
          };
        }
      }
      return { check, passed: true, detail: `\`${check.var}\` owns the expected value` };
    }
    case 'dropped': {
      const b = findBinding(state, check.var);
      const heapGone =
        !b?.heapId || !findHeap(state, b.heapId)?.alive;
      const passed = !b || b.isDropped || b.isMoved || heapGone;
      return {
        check,
        passed,
        detail: passed
          ? `\`${check.var}\` is dropped / moved away`
          : `\`${check.var}\` still owns a value`,
      };
    }
    case 'moved': {
      const b = findBinding(state, check.var);
      const passed = !!b && b.isMoved;
      return {
        check,
        passed,
        detail: passed ? `\`${check.var}\` was moved` : `\`${check.var}\` was not moved`,
      };
    }
    case 'not_moved': {
      const b = findBinding(state, check.var);
      const passed = !!b && !b.isMoved;
      return {
        check,
        passed,
        detail: passed ? `\`${check.var}\` is still valid` : `\`${check.var}\` is moved`,
      };
    }
    case 'type_is': {
      const b = findBinding(state, check.var);
      const passed = !!b && b.valueType === check.valueType && !b.isDropped;
      return {
        check,
        passed,
        detail: passed
          ? `\`${check.var}\`: ${check.valueType}`
          : `\`${check.var}\` is not a live ${check.valueType}`,
      };
    }
    case 'borrow_live': {
      const b = findBinding(state, check.var);
      const live = !!b && b.role !== 'owner' && isRefLive(state, b);
      const mutOk = check.mutable === undefined || (b?.role === 'ref_mut') === check.mutable;
      const passed = live && mutOk;
      return {
        check,
        passed,
        detail: passed
          ? `live ${check.mutable ? '&mut' : check.mutable === false ? '&' : 'ref'} \`${check.var}\``
          : `\`${check.var}\` is not a matching live borrow`,
      };
    }
    case 'no_borrow_on': {
      const refs = allBindings(state).filter(
        (r) => r.role !== 'owner' && isRefLive(state, r) && r.originName === check.var,
      );
      const passed = refs.length === 0;
      return {
        check,
        passed,
        detail: passed
          ? `no live borrows of \`${check.var}\``
          : `still borrowed by ${refs.map((r) => r.name).join(', ')}`,
      };
    }
    case 'value_is': {
      const b = findBinding(state, check.var);
      const v = b ? canonicalValue(b, state) : null;
      const passed = normalizeWant(v ?? '') === normalizeWant(check.value);
      return {
        check,
        passed,
        detail: passed
          ? `\`${check.var}\` = ${check.value}`
          : `\`${check.var}\` = ${v ?? '∅'}, expected ${check.value}`,
      };
    }
    case 'commands_lte': {
      // filled by engine via extra state field — treated as always true here
      return { check, passed: true, detail: `golf par ≤ ${check.count}` };
    }
    default:
      return { check, passed: false, detail: 'unknown check' };
  }
}

function normalizeWant(s: string): string {
  return s.trim().replace(/^"|"$/g, '');
}

export function checkGoal(
  state: MemoryState,
  goal: Goal,
  commandCount?: number,
): GoalReport {
  const outcomes = goal.checks.map((c) => {
    if (c.type === 'commands_lte') {
      const n = commandCount ?? 0;
      const passed = n > 0 && n <= c.count;
      return {
        check: c,
        passed,
        detail: passed
          ? `${n} commands (par ${c.count})`
          : `${n} commands, par is ${c.count}`,
      };
    }
    return evaluateCheck(state, c);
  });
  return {
    passed: outcomes.every((o) => o.passed),
    outcomes,
  };
}

export function formatCheck(check: GoalCheck): string {
  switch (check.type) {
    case 'var_exists':
      return `live \`${check.var}\``;
    case 'owned_by':
      return `\`${check.var}\` owns ${check.valueType ?? 'a value'}${check.value ? ` = ${check.value}` : ''}`;
    case 'dropped':
      return `\`${check.var}\` dropped`;
    case 'moved':
      return `\`${check.var}\` moved`;
    case 'not_moved':
      return `\`${check.var}\` still valid`;
    case 'type_is':
      return `\`${check.var}\`: ${check.valueType}`;
    case 'borrow_live':
      return `${check.mutable ? '&mut' : 'ref'} \`${check.var}\` live`;
    case 'no_borrow_on':
      return `no live borrows of \`${check.var}\``;
    case 'value_is':
      return `\`${check.var}\` = ${check.value}`;
    case 'commands_lte':
      return `≤ ${check.count} commands`;
    default:
      return 'check';
  }
}

/** Snapshot helper for debugging goals. */
export function debugPayload(state: MemoryState, name: string): string {
  const b = findBinding(state, name);
  if (!b) return '∅';
  return formatPayloadFromBinding(b, state);
}

function formatPayloadFromBinding(
  b: ReturnType<typeof findBinding> & object,
  state: MemoryState,
): string {
  const v = canonicalValue(b, state);
  if (v !== null) return v;
  if (b.isMoved) return '<moved>';
  if (b.isDropped) return '<dropped>';
  return b.role === 'owner' ? '<owner>' : `<${b.role}>`;
}

void findHeap;
