/**
 * Core domain types for the learnOwnership memory model and interpreter.
 */

/** Owned value types in the teaching subset. */
export type ValueType = 'i32' | 'bool' | 'String' | 'Vec<i32>';

/** How a binding participates in ownership. */
export type BindingRole = 'owner' | 'ref' | 'ref_mut';

/** A heap-allocated owned payload (String / Vec). */
export interface HeapObject {
  /** Stable id, e.g. `h1`. */
  id: string;
  type: ValueType;
  /** Display / semantic payload. */
  payload: string | number | boolean | number[];
  alive: boolean;
}

/** A stack binding in a frame. */
export interface Binding {
  name: string;
  role: BindingRole;
  /** Owned type for owners; referent type for references. */
  valueType: ValueType;
  /** Heap object id for non-Copy owners. */
  heapId: string | null;
  /** Inline payload for Copy owners (`i32` / `bool`). */
  copy: number | boolean | null;
  /** For references: heap object being borrowed (Copy refs use originName only). */
  targetHeapId: string | null;
  /** For references: the place borrowed from (binding name). */
  originName: string | null;
  /** True when a non-Copy owner has been moved out. */
  isMoved: boolean;
  /** True when the binding's value has been dropped. */
  isDropped: boolean;
  /** Statement index of the last time this binding was mentioned. */
  lastUseIndex: number | null;
  /** Statement index when this binding was created. */
  createdIndex: number;
}

/** One call stack frame (we only teach `main` + blocks). */
export interface Frame {
  name: string;
  depth: number;
  bindings: Binding[];
}

/** Full observable memory. */
export interface MemoryState {
  heap: HeapObject[];
  frames: Frame[];
  /** Next heap id as integer. */
  heapSeq: number;
  /** Current statement index (for NLL). */
  stmtIndex: number;
}

/** A parsed type expression, including references. */
export type TypeExpr =
  | { kind: 'named'; name: ValueType }
  | { kind: 'ref'; mutable: boolean; inner: ValueType };

/** Result of running one statement. */
export interface ExecResult {
  ok: boolean;
  /** Terminal-facing log lines. */
  log: string[];
  /** Structured diagnostic when `ok` is false. */
  diagnostic: Diagnostic | null;
  /** Animation hints for the UI. */
  effects: Effect[];
}

/** rustc-shaped diagnostic. */
export interface Diagnostic {
  code: string | null;
  title: string;
  /** Place description, e.g. `value moved here`. */
  label: string;
  note: string | null;
  help: string | null;
  related: string[];
}

/** Visual side-effects after a successful statement. */
export type Effect =
  | { kind: 'move'; heapId: string; from: string; to: string }
  | { kind: 'drop'; name: string; heapId: string | null }
  | { kind: 'borrow'; from: string; to: string; mutable: boolean; heapId: string | null }
  | { kind: 'borrow_end'; name: string }
  | { kind: 'bind'; name: string; heapId: string | null }
  | { kind: 'error_focus'; names: string[] };

/** Win-condition check (data-driven). */
export type GoalCheck =
  | { type: 'owned_by'; var: string; valueType?: ValueType; value?: string }
  | { type: 'dropped'; var: string }
  | { type: 'moved'; var: string }
  | { type: 'not_moved'; var: string }
  | { type: 'var_exists'; var: string }
  | { type: 'type_is'; var: string; valueType: ValueType }
  | { type: 'borrow_live'; var: string; mutable?: boolean }
  | { type: 'no_borrow_on'; var: string }
  | { type: 'value_is'; var: string; value: string }
  | { type: 'commands_lte'; count: number };

export interface Goal {
  checks: GoalCheck[];
  /** Free-form success toast lines. */
  success?: string[];
}

export interface Level {
  id: string;
  name: string;
  series: 'moves' | 'borrowing' | 'lifetimes' | 'sandbox';
  intro: string[];
  hint: string;
  /** Seed statements run before the learner starts. */
  start: string[];
  goal: Goal;
  /** Par for golf; omitted means golf is not scored. */
  par?: number;
  solution: string[];
}

export interface SeriesMeta {
  id: Level['series'];
  title: string;
  blurb: string;
}

/** A single interactive session command (meta or code). */
export type SessionCommand =
  | { kind: 'meta'; name: string; args: string[]; raw: string }
  | { kind: 'code'; raw: string };
