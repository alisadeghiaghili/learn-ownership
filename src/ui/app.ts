/**
 * App shell: top bar, memory canvas, terminal, dialogs.
 */

import {
  createSession,
  loadLevel,
  loadSandbox,
  parseInput,
  reset as resetSession,
  submit,
  undo as undoSession,
  type MetaAction,
  type Session,
} from '../core/engine';
import { checkGoal, formatCheck } from '../core/goal';
import { LEVELS, SERIES, getLevel, levelIndex } from '../core/levels';
import type { Diagnostic, Level } from '../core/types';
import { renderMemorySvg } from './canvas';
import { appendLines, formatDiagnostic } from './terminal';

const STORAGE_INTRO = 'learnOwnership.introSeen';

export function mountApp(root: HTMLElement): void {
  let session: Session = bootstrapSession();
  let historyIdx = -1;
  const cmdHistory: string[] = [];

  root.innerHTML = '';
  root.append(buildTopbar(), buildCanvas(), buildTerminal());
  const topbar = root.querySelector('.topbar') as HTMLElement;
  const canvasWrap = root.querySelector('.canvas-wrap') as HTMLElement;
  const termLog = root.querySelector('.term-log') as HTMLElement;
  const termInput = root.querySelector('.term-input') as HTMLInputElement;

  function buildTopbar(): HTMLElement {
    const bar = document.createElement('header');
    bar.className = 'topbar';
    bar.innerHTML = `
      <div class="brand">
        <span class="brand-mark">ownership</span>
        <span class="brand-sub">learnOwnership</span>
      </div>
      <nav class="topnav" aria-label="Primary">
        <button type="button" data-act="sandbox">sandbox</button>
        <button type="button" data-act="levels">levels</button>
        <button type="button" data-act="help">help</button>
      </nav>
      <div class="level-meta">
        <div class="level-title"></div>
        <div class="level-progress"></div>
        <div class="golf"></div>
      </div>
    `;
    bar.querySelector('[data-act="sandbox"]')?.addEventListener('click', () => {
      session = loadSandbox();
      refresh();
      printMeta(['sandbox — free-play memory lab', 'type `help` for the command set']);
    });
    bar.querySelector('[data-act="levels"]')?.addEventListener('click', () => {
      openLevelsDialog();
    });
    bar.querySelector('[data-act="help"]')?.addEventListener('click', () => {
      openHelpDialog();
    });
    return bar;
  }

  function buildCanvas(): HTMLElement {
    const wrap = document.createElement('main');
    wrap.className = 'canvas-wrap';
    wrap.innerHTML = `<div class="legend">
      <span><i class="sw-oxide"></i>owner</span>
      <span><i class="sw-flux"></i>&amp;</span>
      <span><i class="sw-weld"></i>&amp;mut</span>
      <span><i class="sw-fault"></i>error</span>
    </div>`;
    return wrap;
  }

  function buildTerminal(): HTMLElement {
    const term = document.createElement('section');
    term.className = 'terminal';
    term.innerHTML = `
      <div class="term-log" role="log" aria-live="polite"></div>
      <div class="term-input-row">
        <span class="term-prompt" aria-hidden="true">$</span>
        <input class="term-input" type="text" spellcheck="false" autocomplete="off"
          aria-label="Command input"
          placeholder="let s = String::from(&quot;hello&quot;);   ·   help   ·   levels" />
      </div>
    `;
    return term;
  }

  function refreshChrome(): void {
    const title = topbar.querySelector('.level-title') as HTMLElement;
    const progress = topbar.querySelector('.level-progress') as HTMLElement;
    const golf = topbar.querySelector('.golf') as HTMLElement;
    const navButtons = topbar.querySelectorAll('.topnav button');
    navButtons.forEach((b) => {
      const act = (b as HTMLElement).dataset.act;
      const current =
        (act === 'sandbox' && session.mode === 'sandbox') ||
        (act === 'levels' && session.mode === 'level');
      b.setAttribute('aria-current', current ? 'true' : 'false');
    });

    if (session.level) {
      const idx = levelIndex(session.level.id) + 1;
      title.innerHTML = `<strong>${session.level.id}</strong> ${escapeHtml(session.level.name)}`;
      progress.textContent = `${idx} / ${LEVELS.length} · ${session.level.series}`;
      const par = session.level.par;
      golf.innerHTML =
        par !== undefined
          ? `golf <b>${session.commandCount}</b> / par ${par}`
          : `cmds <b>${session.commandCount}</b>`;
    } else {
      title.innerHTML = `<strong>sandbox</strong> free-play`;
      progress.textContent = SERIES.map((s) => s.title).join(' · ');
      golf.innerHTML = `cmds <b>${session.commandCount}</b>`;
    }
  }

  function refreshCanvas(): void {
    const old = canvasWrap.querySelector('svg');
    if (old) old.remove();
    const legend = canvasWrap.querySelector('.legend');
    const flash = new Set<string>();
    for (const e of session.lastEffects) {
      if (e.kind === 'move') flash.add(e.to);
      if (e.kind === 'bind') flash.add(e.name);
      if (e.kind === 'error_focus') for (const n of e.names) flash.add(n);
    }
    const svg = renderMemorySvg(session.state, flash);
    canvasWrap.insertBefore(svg, legend);
  }

  function refresh(): void {
    refreshChrome();
    refreshCanvas();
  }

  function printMeta(lines: string[]): void {
    appendLines(
      termLog,
      lines.map((text) => ({ kind: 'meta' as const, text })),
    );
  }

  function printDiag(d: Diagnostic): void {
    appendLines(termLog, [{ kind: 'err', text: formatDiagnostic(d) }]);
  }

  function openHelpDialog(): void {
    openDialog(
      `
      <h2>How this lab <span class="accent">works</span></h2>
      <p>Type a Rust-subset statement and watch stack, heap, and borrows update.
      Levels teach one rule at a time — same posture as learnGitBranching.</p>
      <ul>
        <li><code>let s = String::from("hi");</code> — bind a heap owner</li>
        <li><code>let b = a;</code> — move (or copy for <code>i32</code>/<code>bool</code>)</li>
        <li><code>let r = &s;</code> · <code>let m = &mut s;</code> — borrow</li>
        <li><code>drop(x);</code> · <code>print(x);</code> · <code>v.push(1);</code></li>
        <li><code>undo</code> · <code>reset</code> · <code>levels</code> · <code>hint</code> · <code>solution</code> · <code>goal</code></li>
      </ul>
      <p>Errors are shaped like <code>rustc</code>: code, label, note, help.</p>
      <div class="dialog-actions">
        <button class="btn btn-primary" data-close>Start typing</button>
      </div>
    `,
    );
  }

  function openLevelsDialog(): void {
    const rows = LEVELS.map((l, i) => {
      const solved = session.solved.has(l.id) ? 'solved' : '';
      return `
        <button type="button" class="level-row ${solved}" data-level="${l.id}">
          <span class="idx">${String(i + 1).padStart(2, '0')}</span>
          <span class="name">${escapeHtml(l.name)}</span>
          <span class="series">${escapeHtml(l.series)}</span>
        </button>`;
    }).join('');
    openDialog(
      `
      <h2>Level <span class="accent">packs</span></h2>
      <p>${SERIES.map((s) => `<strong>${escapeHtml(s.title)}</strong> — ${escapeHtml(s.blurb)}`).join('<br>')}</p>
      <div class="level-list">${rows}</div>
      <div class="dialog-actions">
        <button class="btn" data-close>Close</button>
      </div>
    `,
      (dialog) => {
        dialog.querySelectorAll<HTMLElement>('[data-level]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const id = btn.dataset.level;
            if (!id) return;
            closeDialog();
            openLevel(id);
          });
        });
      },
    );
  }

  function openLevelIntro(level: Level): void {
    const goal = checkGoal(session.state, level.goal, 0);
    openDialog(
      `
      <h2>${escapeHtml(level.name)}</h2>
      <p class="mono" style="color:var(--ink-dim);font-size:12px">${escapeHtml(level.id)}</p>
      ${level.intro.map((p) => `<p>${escapeHtml(p)}</p>`).join('')}
      <p><strong>Goal</strong></p>
      <ul class="goal-list">
        ${goal.outcomes.map((o) => `<li>${escapeHtml(formatCheck(o.check))}</li>`).join('')}
      </ul>
      <div class="dialog-actions">
        <button class="btn btn-primary" data-close>Begin</button>
        <button class="btn" data-hint>Hint</button>
      </div>
    `,
      (dialog) => {
        dialog.querySelector('[data-hint]')?.addEventListener('click', () => {
          printMeta([`hint — ${level.hint}`]);
        });
      },
    );
  }

  function openSolvedDialog(level: Level, commandCount: number): void {
    const par = level.par;
    const golfLine =
      par !== undefined
        ? commandCount <= par
          ? `par met — ${commandCount} / ${par}`
          : `solved in ${commandCount} (par ${par})`
        : `solved in ${commandCount} commands`;
    openDialog(
      `
      <h2><span class="accent">Solved</span> ${escapeHtml(level.name)}</h2>
      <p>${escapeHtml(golfLine)}</p>
      <p>${(level.goal.success ?? ['Level complete.']).map(escapeHtml).join(' ')}</p>
      <div class="dialog-actions">
        <button class="btn btn-primary" data-next>Next level</button>
        <button class="btn" data-close>Stay here</button>
      </div>
    `,
      (dialog) => {
        dialog.querySelector('[data-next]')?.addEventListener('click', () => {
          closeDialog();
          const idx = levelIndex(level.id);
          const next = LEVELS[idx + 1];
          if (next) openLevel(next.id);
          else {
            session = loadSandbox();
            refresh();
            printMeta(['All built-in levels finished. Sandbox is open.']);
          }
        });
      },
    );
  }

  function openLevel(id: string): void {
    session = loadLevel(id);
    refresh();
    termLog.innerHTML = '';
    if (session.level) openLevelIntro(session.level);
    printMeta([
      `level ${session.level?.id ?? id}`,
      ...session.codeLog.map((s) => `  seed: ${s}`),
      'type `goal` to re-read the win condition',
    ]);
  }

  function handleMeta(action: MetaAction): void {
    switch (action.kind) {
      case 'noop':
        return;
      case 'help':
      case 'levels':
      case 'hint':
      case 'solution':
      case 'build_level':
      case 'import_level':
      case 'unknown':
        printMeta(action.message);
        return;
      case 'goal':
        printMeta(action.message);
        return;
      case 'show_level':
        openLevel(action.levelId);
        return;
      case 'reset':
        session = resetSession(session);
        termLog.innerHTML = '';
        refresh();
        printMeta(['reset']);
        return;
      case 'undo': {
        const before = session.commandCount;
        session = undoSession(session);
        refresh();
        printMeta([before === session.commandCount ? 'nothing to undo' : 'undid last statement']);
        return;
      }
      case 'sandbox':
        session = loadSandbox();
        termLog.innerHTML = '';
        refresh();
        printMeta(['sandbox']);
        return;
      default:
        return;
    }
  }

  function runInput(raw: string): void {
    const trimmed = raw.trim();
    if (!trimmed) return;
    cmdHistory.push(trimmed);
    historyIdx = cmdHistory.length;
    appendLines(termLog, [{ kind: 'cmd', text: trimmed }]);

    // Prefer explicit meta via parseInput; also allow undo/reset as bare words
    const result = submit(session, trimmed);
    session = result.session;

    if (result.meta) {
      handleMeta(result.meta);
      refresh();
      return;
    }

    if (result.exec?.ok) {
      if (result.log.length) {
        appendLines(
          termLog,
          result.log.map((text) => ({ kind: 'out' as const, text })),
        );
      }
      refresh();
      if (session.justSolved && session.level) {
        openSolvedDialog(session.level, session.commandCount);
      }
      return;
    }

    if (result.diagnostic) printDiag(result.diagnostic);
    refresh();
  }

  termInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const v = termInput.value;
      termInput.value = '';
      runInput(v);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!cmdHistory.length) return;
      historyIdx = Math.max(0, historyIdx - 1);
      termInput.value = cmdHistory[historyIdx] ?? '';
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      historyIdx = Math.min(cmdHistory.length, historyIdx + 1);
      termInput.value = cmdHistory[historyIdx] ?? '';
    }
  });

  // Global keys: focus terminal with `/` or typing
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '/' || e.key.length === 1) {
      termInput.focus();
    }
  });

  refresh();
  printMeta([
    'learnOwnership — interactive Rust memory lab',
    'moves · borrowing · lifetimes',
    'type `help` or `levels` to begin',
  ]);

  if (!localStorage.getItem(STORAGE_INTRO)) {
    openDialog(
      `
      <h2>learn<span class="accent">Ownership</span></h2>
      <p>An interactive memory visualizer for Rust ownership — sandbox first, levels when you want a scoreboard.</p>
      <p>Type statements on the left-to-bottom terminal. The schematic shows stack bindings, heap cells, and live borrows.</p>
      <div class="dialog-actions">
        <button class="btn btn-primary" data-close>Open sandbox</button>
        <button class="btn" data-open-levels>Browse levels</button>
      </div>
    `,
      (dialog) => {
        dialog.querySelector('[data-open-levels]')?.addEventListener('click', () => {
          closeDialog();
          openLevelsDialog();
        });
      },
    );
    try {
      localStorage.setItem(STORAGE_INTRO, '1');
    } catch {
      /* ignore */
    }
  }

  // URL: ?level=moves-1&cmd=let%20s=...
  const params = new URLSearchParams(location.search);
  const levelParam = params.get('level');
  const cmdParam = params.get('cmd') ?? params.get('command');
  if (levelParam && getLevel(levelParam)) {
    openLevel(levelParam);
  }
  if (cmdParam) {
    for (const part of cmdParam.split(';')) {
      const c = part.trim();
      if (c) runInput(c);
    }
  }
}

function bootstrapSession(): Session {
  return loadSandbox();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function openDialog(html: string, onOpen?: (dialog: HTMLElement) => void): void {
  closeDialog();
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="dialog" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(overlay);
  const dialog = overlay.querySelector('.dialog') as HTMLElement;
  dialog.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', closeDialog);
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeDialog();
  });
  onOpen?.(dialog);
  (dialog.querySelector('button') as HTMLElement | null)?.focus();
}

function closeDialog(): void {
  document.querySelectorAll('.overlay').forEach((n) => n.remove());
}

// re-export for tests / debugging
export { createSession, parseInput };
