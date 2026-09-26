/**
 * Memory model: stack frames, heap objects, and borrow bookkeeping.
 */

import type {
  Binding,
  Frame,
  HeapObject,
  MemoryState,
  ValueType,
} from './types';

/** Types that copy on assignment (`Copy`). */
export const COPY_TYPES: ReadonlySet<ValueType> = new Set(['i32', 'bool']);

/** Heap-allocating owned types (`Clone`, move semantics). */
export const HEAP_TYPES: ReadonlySet<ValueType> = new Set(['String', 'Vec<i32>']);

export function isCopyType(t: ValueType): boolean {
  return COPY_TYPES.has(t);
}

export function isHeapType(t: ValueType): boolean {
  return HEAP_TYPES.has(t);
}

export function createMemory(): MemoryState {
  return {
    heap: [],
    frames: [{ name: 'main', depth: 0, bindings: [] }],
    heapSeq: 1,
    stmtIndex: 0,
  };
}

export function cloneMemory(state: MemoryState): MemoryState {
  return {
    heap: state.heap.map((h) => ({ ...h, payload: clonePayload(h.payload) })),
    frames: state.frames.map((f) => ({
      ...f,
      bindings: f.bindings.map((b) => ({ ...b })),
    })),
    heapSeq: state.heapSeq,
    stmtIndex: state.stmtIndex,
  };
}

function clonePayload(p: string | number | boolean | number[]): string | number | boolean | number[] {
  return Array.isArray(p) ? [...p] : p;
}

/** Current (innermost) frame. */
export function currentFrame(state: MemoryState): Frame {
  const frame = state.frames[state.frames.length - 1];
  if (!frame) {
    throw new Error('memory has no frames');
  }
  return frame;
}

/** Find the most recent binding by name (shadowing), innermost frame first. */
export function findBinding(state: MemoryState, name: string): Binding | null {
  for (let i = state.frames.length - 1; i >= 0; i -= 1) {
    const frame = state.frames[i];
    if (!frame) continue;
    for (let j = frame.bindings.length - 1; j >= 0; j -= 1) {
      const b = frame.bindings[j];
      if (b && b.name === name) return b;
    }
  }
  return null;
}

/** All live bindings across frames (for visualization). */
export function allBindings(state: MemoryState): Binding[] {
  return state.frames.flatMap((f) => f.bindings);
}

export function findHeap(state: MemoryState, id: string): HeapObject | null {
  return state.heap.find((h) => h.id === id) ?? null;
}

export function allocHeap(
  state: MemoryState,
  type: ValueType,
  payload: string | number | boolean | number[],
): HeapObject {
  const obj: HeapObject = {
    id: `h${state.heapSeq}`,
    type,
    payload: clonePayload(payload),
    alive: true,
  };
  state.heapSeq += 1;
  state.heap.push(obj);
  return obj;
}

export function dropHeap(state: MemoryState, id: string): void {
  const obj = findHeap(state, id);
  if (obj) obj.alive = false;
}

export function pushBinding(state: MemoryState, binding: Binding): Binding {
  const frame = currentFrame(state);
  const existing = frame.bindings.find((b) => b.name === binding.name);
  if (existing) {
    // Shadow: keep the old binding for history visualization but mark dropped if owned.
    if (existing.role === 'owner' && existing.heapId && !existing.isMoved) {
      dropHeap(state, existing.heapId);
    }
    existing.isDropped = true;
  }
  frame.bindings.push(binding);
  return binding;
}

export function pushFrame(state: MemoryState, name: string): Frame {
  const parent = currentFrame(state);
  const frame: Frame = {
    name,
    depth: parent.depth + 1,
    bindings: [],
  };
  state.frames.push(frame);
  return frame;
}

/**
 * Pop the innermost frame, dropping its owned values and ending its borrows.
 * Returns names that were dropped.
 */
export function popFrame(state: MemoryState): string[] {
  if (state.frames.length <= 1) return [];
  const frame = state.frames.pop();
  if (!frame) return [];
  const dropped: string[] = [];
  // Drop in reverse declaration order (RAII).
  for (let i = frame.bindings.length - 1; i >= 0; i -= 1) {
    const b = frame.bindings[i];
    if (!b) continue;
    if (b.role === 'owner' && !b.isDropped && !b.isMoved) {
      if (b.heapId) dropHeap(state, b.heapId);
      b.isDropped = true;
    }
    if (b.role !== 'owner') {
      b.isDropped = true;
    }
    dropped.push(b.name);
  }
  return dropped;
}

/** Mark a binding as used at the current statement index. */
export function touch(state: MemoryState, name: string): void {
  const b = findBinding(state, name);
  if (b) b.lastUseIndex = state.stmtIndex;
}

/**
 * Simplified NLL: a reference expires after its last use, once that use is
 * strictly in the past (`lastUseIndex < stmtIndex`). Never-used references
 * (`lastUseIndex === null`) stay live — the learner may still need them.
 */
export function isRefLive(state: MemoryState, b: Binding): boolean {
  if (b.role === 'owner') return false;
  if (b.isDropped || b.isMoved) return false;
  if (b.lastUseIndex === null) return true;
  return b.lastUseIndex >= state.stmtIndex;
}

/** Live references that point at a heap object. */
export function liveRefsTo(state: MemoryState, heapId: string): Binding[] {
  return allBindings(state).filter(
    (b) => b.role !== 'owner' && b.targetHeapId === heapId && isRefLive(state, b),
  );
}

/** Live references whose origin is the given binding name. */
export function liveRefsToName(state: MemoryState, name: string): Binding[] {
  return allBindings(state).filter(
    (b) => b.role !== 'owner' && b.originName === name && isRefLive(state, b),
  );
}

/** Display payload for UI / goals. */
export function formatPayload(payload: string | number | boolean | number[]): string {
  if (typeof payload === 'string') return JSON.stringify(payload);
  if (typeof payload === 'boolean') return payload ? 'true' : 'false';
  if (Array.isArray(payload)) return `vec![${payload.join(', ')}]`;
  return String(payload);
}

/** Canonical string form used by `value_is` goals. */
export function canonicalValue(binding: Binding, state: MemoryState): string | null {
  if (binding.role !== 'owner') return null;
  if (binding.isMoved || binding.isDropped) return null;
  if (binding.copy !== null) return String(binding.copy);
  if (binding.heapId) {
    const h = findHeap(state, binding.heapId);
    if (!h || !h.alive) return null;
    return formatPayload(h.payload);
  }
  return null;
}
