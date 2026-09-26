/**
 * SVG memory schematic: stack frames, heap cells, ownership arrows, borrow arcs.
 */

import { allBindings, findHeap, formatPayload, isRefLive } from '../core/memory';
import type { Binding, MemoryState } from '../core/types';

const W = 960;
const H = 420;
const FRAME_X = 40;
const FRAME_W = 280;
const HEAP_X = 560;
const HEAP_W = 340;

function bindingLabel(b: Binding): string {
  if (b.role === 'owner') {
    if (b.isMoved) return `${b.name} · moved`;
    if (b.isDropped) return `${b.name} · dropped`;
    return b.name;
  }
  const kind = b.role === 'ref_mut' ? '&mut' : '&';
  return `${b.name}: ${kind}${b.valueType}`;
}

function bindingColor(b: Binding): string {
  if (b.isMoved || b.isDropped) return '#5a6270';
  if (b.role === 'ref_mut') return '#c4a35a';
  if (b.role === 'ref') return '#6ba3a0';
  return '#e07a3d';
}

function payloadText(state: MemoryState, b: Binding): string {
  if (b.role !== 'owner') {
    const origin = b.originName ?? '?';
    return `→ ${origin}`;
  }
  if (b.copy !== null) return String(b.copy);
  if (b.isMoved) return '—';
  if (b.heapId) {
    const h = findHeap(state, b.heapId);
    return h ? formatPayload(h.payload) : '—';
  }
  return '—';
}

export function renderMemorySvg(
  state: MemoryState,
  flash: Set<string> = new Set(),
): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'memory-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Memory schematic with stack bindings and heap cells');

  const ns = 'http://www.w3.org/2000/svg';
  const el = (name: string, attrs: Record<string, string | number>, text?: string) => {
    const node = document.createElementNS(ns, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    if (text !== undefined) node.textContent = text;
    svg.appendChild(node);
    return node;
  };

  // Region labels
  el('text', { x: FRAME_X, y: 28, class: 'label' }, 'STACK');
  el('text', { x: HEAP_X, y: 28, class: 'label' }, 'HEAP');

  // Stack frame box
  const bindings = allBindings(state).filter((b) => !b.name.startsWith('_'));
  const rowH = 36;
  const frameH = Math.max(80, 40 + bindings.length * rowH);
  el('rect', {
    x: String(FRAME_X),
    y: '40',
    width: String(FRAME_W),
    height: String(frameH),
    fill: '#242830',
    stroke: '#3a4150',
    'stroke-width': '1',
    rx: '4',
  });
  el(
    'text',
    { x: String(FRAME_X + 12), y: '58', class: 'label' },
    `frame · ${state.frames.map((f) => f.name).join(' / ')}`,
  );

  // Binding rows
  const positions = new Map<string, { x: number; y: number }>();
  bindings.forEach((b, i) => {
    const y = 78 + i * rowH;
    const x = FRAME_X + 16;
    positions.set(b.name, { x: x + 8, y: y + 10 });
    const isFlash = flash.has(b.name);
    el('rect', {
      x: String(x),
      y: String(y),
      width: String(FRAME_W - 32),
      height: String(rowH - 8),
      fill: '#1a1d24',
      stroke: bindingColor(b),
      'stroke-width': b.role === 'ref_mut' ? '1.5' : '1',
      rx: '3',
      opacity: b.isMoved || b.isDropped ? '0.55' : '1',
      class: isFlash ? 'flash-move' : '',
    });
    el(
      'text',
      {
        x: String(x + 10),
        y: String(y + 18),
        fill: bindingColor(b),
        'font-size': '13',
        'font-weight': '500',
      },
      bindingLabel(b),
    );
    el(
      'text',
      {
        x: String(x + FRAME_W - 52),
        y: String(y + 18),
        class: 'dim',
        'font-size': '12',
        'text-anchor': 'end',
      },
      payloadText(state, b),
    );
  });

  // Heap cells
  const alive = state.heap.filter((h) => h.alive);
  const dead = state.heap.filter((h) => !h.alive);
  const cells = [...alive, ...dead];
  const heapPos = new Map<string, { x: number; y: number }>();
  cells.forEach((h, i) => {
    const y = 48 + i * 52;
    heapPos.set(h.id, { x: HEAP_X + 12, y: y + 20 });
    el('rect', {
      x: String(HEAP_X),
      y: String(y),
      width: String(HEAP_W),
      height: '44',
      fill: h.alive ? '#242830' : '#1f2229',
      stroke: h.alive ? '#3a4150' : '#2a303c',
      'stroke-width': '1',
      rx: '4',
      opacity: h.alive ? '1' : '0.4',
    });
    el(
      'text',
      {
        x: String(HEAP_X + 12),
        y: String(y + 18),
        'font-size': '12',
        fill: '#9aa3b2',
      },
      `${h.id} · ${h.type}${h.alive ? '' : ' · dropped'}`,
    );
    el(
      'text',
      {
        x: String(HEAP_X + 12),
        y: String(y + 34),
        'font-size': '13',
        fill: h.alive ? '#e8e4d9' : '#5a6270',
      },
      formatPayload(h.payload),
    );
  });

  // Ownership arrows (owner → heap)
  for (const b of bindings) {
    if (b.role !== 'owner' || !b.heapId || b.isMoved) continue;
    const from = positions.get(b.name);
    const to = heapPos.get(b.heapId);
    if (!from || !to) continue;
    el('path', {
      d: `M ${from.x + 200} ${from.y} C ${from.x + 260} ${from.y}, ${to.x - 40} ${to.y}, ${to.x} ${to.y}`,
      fill: 'none',
      stroke: '#e07a3d',
      'stroke-width': '1.5',
      'marker-end': 'url(#arrow-oxide)',
      opacity: '0.9',
    });
  }

  // Borrow arcs
  for (const b of bindings) {
    if (b.role === 'owner' || !isRefLive(state, b)) continue;
    const from = positions.get(b.name);
    const originPos = b.originName ? positions.get(b.originName) : null;
    const heapTarget = b.targetHeapId ? heapPos.get(b.targetHeapId) : null;
    const to = heapTarget ?? originPos;
    if (!from || !to) continue;
    const color = b.role === 'ref_mut' ? '#c4a35a' : '#6ba3a0';
    el('path', {
      d: `M ${from.x + 200} ${from.y} C ${from.x + 280} ${from.y + 20}, ${to.x - 30} ${to.y + 20}, ${to.x} ${to.y}`,
      fill: 'none',
      stroke: color,
      'stroke-width': b.role === 'ref_mut' ? '2.5' : '1.5',
      'stroke-dasharray': b.role === 'ref_mut' ? '' : '4 3',
      'marker-end': b.role === 'ref_mut' ? 'url(#arrow-weld)' : 'url(#arrow-flux)',
    });
    // exclusive lock ring on heap cell
    if (b.role === 'ref_mut' && b.targetHeapId) {
      const hp = heapPos.get(b.targetHeapId);
      if (hp) {
        el('rect', {
          x: String(HEAP_X - 4),
          y: String(hp.y - 24),
          width: String(HEAP_W + 8),
          height: '48',
          fill: 'none',
          stroke: '#c4a35a',
          'stroke-width': '1.5',
          rx: '4',
          opacity: '0.85',
        });
      }
    }
  }

  // markers
  const defs = document.createElementNS(ns, 'defs');
  defs.innerHTML = `
    <marker id="arrow-oxide" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6" fill="none" stroke="#e07a3d" stroke-width="1"/>
    </marker>
    <marker id="arrow-flux" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6" fill="none" stroke="#6ba3a0" stroke-width="1"/>
    </marker>
    <marker id="arrow-weld" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6" fill="none" stroke="#c4a35a" stroke-width="1"/>
    </marker>
  `;
  svg.insertBefore(defs, svg.firstChild);

  if (bindings.length === 0 && cells.length === 0) {
    el(
      'text',
      {
        x: String(W / 2),
        y: String(H / 2),
        class: 'dim',
        'text-anchor': 'middle',
        'font-size': '14',
      },
      'empty memory — type a statement below',
    );
  }

  return svg;
}
