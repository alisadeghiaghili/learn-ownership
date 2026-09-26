/**
 * Terminal log rendering and input handling.
 */

import type { Diagnostic } from '../core/types';

export function formatDiagnostic(d: Diagnostic): string {
  const lines: string[] = [];
  if (d.code) lines.push(`error[${d.code}]: ${d.title}`);
  else lines.push(`error: ${d.title}`);
  if (d.label) lines.push(`  ${d.label}`);
  if (d.note) lines.push(`  note: ${d.note}`);
  if (d.help) lines.push(`  help: ${d.help}`);
  return lines.join('\n');
}

export function appendLines(
  log: HTMLElement,
  entries: Array<{ kind: 'cmd' | 'out' | 'err' | 'ok' | 'meta'; text: string }>,
): void {
  for (const e of entries) {
    const div = document.createElement('div');
    div.className = `line-${e.kind}`;
    div.textContent = e.text;
    log.appendChild(div);
  }
  log.scrollTop = log.scrollHeight;
}
