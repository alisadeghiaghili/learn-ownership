/**
 * Interactive session: command history, undo/reset, golf counter, meta commands.
 */

import { checkGoal, formatCheck, type GoalReport } from './goal';
import { getLevel, LEVELS, levelIndex, registerLevel } from './levels';
import { cloneMemory, createMemory } from './memory';
import { execute } from './interpreter';
import type {
  Diagnostic,
  Effect,
  ExecResult,
  Level,
  MemoryState,
  SessionCommand,
} from './types';

export type MetaAction =
  | { kind: 'noop'; message: string[] }
  | { kind: 'help'; message: string[] }
  | { kind: 'levels'; message: string[] }
  | { kind: 'show_level'; levelId: string }
  | { kind: 'hint'; message: string[] }
  | { kind: 'solution'; message: string[] }
  | { kind: 'goal'; report: GoalReport; message: string[] }
  | { kind: 'reset' }
  | { kind: 'undo' }
  | { kind: 'sandbox' }
  | { kind: 'build_level'; message: string[] }
  | { kind: 'import_level'; message: string[] }
  | { kind: 'unknown'; message: string[] };

export interface Snapshot {
  state: MemoryState;
  commandCount: number;
  codeLog: string[];
}

export interface Session {
  mode: 'sandbox' | 'level';
  level: Level | null;
  state: MemoryState;
  commandCount: number;
  codeLog: string[];
  history: string[];
  undoStack: Snapshot[];
  solved: Set<string>;
  lastDiagnostic: Diagnostic | null;
  lastEffects: Effect[];
  lastReport: GoalReport | null;
  justSolved: boolean;
}

export function createSession(mode: 'sandbox' | 'level' = 'sandbox', level: Level | null = null): Session {
  const state = createMemory();
  const codeLog: string[] = [];
  if (level) {
    for (const line of level.start) {
      const r = execute(state, line);
      codeLog.push(line);
      if (!r.ok) {
        // broken level seed — keep going for viz
        break;
      }
    }
  }
  return {
    mode: level ? 'level' : mode,
    level,
    state,
    commandCount: 0,
    codeLog,
    history: [],
    undoStack: [],
    solved: loadSolved(),
    lastDiagnostic: null,
    lastEffects: [],
    lastReport: null,
    justSolved: false,
  };
}

export function loadLevel(id: string): Session {
  const level = getLevel(id);
  return createSession('level', level);
}

export function loadSandbox(): Session {
  return createSession('sandbox', null);
}

function loadSolved(): Set<string> {
  try {
    const raw = localStorage.getItem('learnOwnership.solved');
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveSolved(solved: Set<string>): void {
  try {
    localStorage.setItem('learnOwnership.solved', JSON.stringify([...solved]));
  } catch {
    // ignore quota / private mode
  }
}

function snapshot(session: Session): Snapshot {
  return {
    state: cloneMemory(session.state),
    commandCount: session.commandCount,
    codeLog: [...session.codeLog],
  };
}

export function parseInput(raw: string): SessionCommand {
  const trimmed = raw.trim();
  if (!trimmed) return { kind: 'meta', name: 'noop', args: [], raw };
  if (trimmed.startsWith('!')) {
    const parts = trimmed.slice(1).split(/\s+/);
    const name = parts[0] ?? '';
    return { kind: 'meta', name, args: parts.slice(1), raw };
  }
  // bare meta commands without bang (LGB style)
  const metaNames = new Set([
    'help',
    'levels',
    'level',
    'hint',
    'solution',
    'goal',
    'reset',
    'undo',
    'sandbox',
    'build',
    'import',
    'show',
  ]);
  const first = trimmed.split(/\s+/)[0] ?? '';
  if (metaNames.has(first) && !trimmed.includes('=') && !trimmed.includes(';')) {
    const parts = trimmed.split(/\s+/);
    let name = parts[0] ?? '';
    if (name === 'build' && parts[1] === 'level') {
      return { kind: 'meta', name: 'build_level', args: parts.slice(2), raw };
    }
    if (name === 'import' && parts[1] === 'level') {
      return { kind: 'meta', name: 'import_level', args: parts.slice(2), raw };
    }
    if (name === 'show' && parts[1] === 'level') {
      name = 'show_level';
    }
    return { kind: 'meta', name, args: parts.slice(1), raw };
  }
  // code if it looks like rust subset
  return { kind: 'code', raw };
}

function helpText(): string[] {
  return [
    'learnOwnership — supported commands',
    '',
    '  code       let / assign / drop(x) / use|print|read(x) / x.push(n) / { }',
    '  levels     list level packs',
    '  show level <id>   open a level',
    '  goal       inspect win conditions',
    '  hint       one nudge for the current level',
    '  solution   reveal the reference solution',
    '  undo       revert the last statement',
    '  reset      restore the level seed (or empty sandbox)',
    '  sandbox    free-play memory lab',
    '  build level      JSON level builder (wizard)',
    '  import level     paste a level JSON',
    '',
    '  Prefix with ! to force a meta command: !levels',
  ];
}

function levelsText(session: Session): string[] {
  const lines: string[] = ['levels', ''];
  for (const s of ['moves', 'borrowing', 'lifetimes'] as const) {
    lines.push(`  ${s}`);
    for (const l of LEVELS.filter((x) => x.series === s)) {
      const mark = session.solved.has(l.id) ? '✓' : ' ';
      const idx = levelIndex(l.id) + 1;
      lines.push(`  [${mark}] ${String(idx).padStart(2, ' ')}. ${l.id}  ${l.name}`);
    }
    lines.push('');
  }
  lines.push('  open with: show level moves-1');
  return lines;
}

function goalLines(report: GoalReport): string[] {
  const lines = ['goal'];
  for (const o of report.outcomes) {
    const mark = o.passed ? '✓' : '·';
    lines.push(`  ${mark} ${formatCheck(o.check)}`);
  }
  lines.push(report.passed ? '  all checks passed' : '  not solved yet');
  return lines;
}

function runMeta(session: Session, name: string, args: string[]): MetaAction {
  switch (name) {
    case 'noop':
      return { kind: 'noop', message: [] };
    case 'help':
      return { kind: 'help', message: helpText() };
    case 'levels':
      return { kind: 'levels', message: levelsText(session) };
    case 'show_level': {
      const id = args[0] ?? '';
      if (!getLevel(id)) {
        return {
          kind: 'unknown',
          message: [`unknown level '${id}' — try !levels`],
        };
      }
      return { kind: 'show_level', levelId: id };
    }
    case 'hint': {
      if (!session.level) {
        return { kind: 'hint', message: ['hint — only in level mode. Try `show level moves-1`.'] };
      }
      return { kind: 'hint', message: [`hint — ${session.level.hint}`] };
    }
    case 'solution': {
      if (!session.level) {
        return { kind: 'solution', message: ['solution — only in level mode.'] };
      }
      return {
        kind: 'solution',
        message: ['solution', ...session.level.solution.map((s) => `  ${s}`)],
      };
    }
    case 'goal': {
      if (!session.level) {
        return {
          kind: 'goal',
          report: { passed: false, outcomes: [] },
          message: ['goal — sandbox has no win condition. Play freely.'],
        };
      }
      const report = checkGoal(session.state, session.level.goal, session.commandCount);
      return { kind: 'goal', report, message: goalLines(report) };
    }
    case 'reset':
      return { kind: 'reset' };
    case 'undo':
      return { kind: 'undo' };
    case 'sandbox':
      return { kind: 'sandbox' };
    case 'build_level':
      return {
        kind: 'build_level',
        message: [
          'build level — describe the level as JSON',
          '  { "id", "name", "series", "intro": [], "hint", "start": [],',
          '    "goal": { "checks": [...] }, "par"?, "solution": [] }',
          '  then: import level <json>',
        ],
      };
    case 'import_level': {
      const json = args.join(' ');
      try {
        const parsed = JSON.parse(json) as Level;
        if (!parsed.id || !parsed.goal || !Array.isArray(parsed.goal.checks)) {
          throw new Error('missing id/goal.checks');
        }
        const level: Level = {
          id: parsed.id,
          name: parsed.name || parsed.id,
          series: parsed.series || 'sandbox',
          intro: parsed.intro ?? [],
          hint: parsed.hint ?? 'no hint recorded',
          start: parsed.start ?? [],
          goal: parsed.goal,
          par: parsed.par,
          solution: parsed.solution ?? [],
        };
        registerLevel(level);
        return {
          kind: 'import_level',
          message: [
            `imported level ${level.id} (${level.name})`,
            `  run: show level ${level.id}`,
          ],
        };
      } catch {
        return {
          kind: 'import_level',
          message: [
            'could not parse level JSON — paste a single-line object with id and goal.checks',
          ],
        };
      }
    }
    default:
      return {
        kind: 'unknown',
        message: [`unknown command '${name}' — try !help`],
      };
  }
}

export interface SubmitResult {
  session: Session;
  log: string[];
  diagnostic: Diagnostic | null;
  effects: Effect[];
  meta: MetaAction | null;
  exec: ExecResult | null;
}

export function submit(session: Session, raw: string): SubmitResult {
  session.history.push(raw);
  session.justSolved = false;
  session.lastDiagnostic = null;
  session.lastEffects = [];
  const cmd = parseInput(raw);

  if (cmd.kind === 'meta') {
    const meta = runMeta(session, cmd.name, cmd.args);
    return { session, log: [], diagnostic: null, effects: [], meta, exec: null };
  }

  session.undoStack.push(snapshot(session));
  const result = execute(session.state, cmd.raw);
  session.lastEffects = result.effects;
  if (result.ok) {
    session.commandCount += 1;
    session.codeLog.push(cmd.raw.trim());
    if (session.level && session.mode === 'level') {
      const report = checkGoal(session.state, session.level.goal, session.commandCount);
      session.lastReport = report;
      if (report.passed) {
        session.justSolved = true;
        session.solved.add(session.level.id);
        saveSolved(session.solved);
      }
    }
    return {
      session,
      log: result.log,
      diagnostic: null,
      effects: result.effects,
      meta: null,
      exec: result,
    };
  }

  session.lastDiagnostic = result.diagnostic;
  return {
    session,
    log: result.log,
    diagnostic: result.diagnostic,
    effects: result.effects,
    meta: null,
    exec: result,
  };
}

export function undo(session: Session): Session {
  const snap = session.undoStack.pop();
  if (!snap) return session;
  session.state = snap.state;
  session.commandCount = snap.commandCount;
  session.codeLog = snap.codeLog;
  session.lastDiagnostic = null;
  session.justSolved = false;
  return session;
}

export function reset(session: Session): Session {
  if (session.level) return loadLevel(session.level.id);
  return loadSandbox();
}
