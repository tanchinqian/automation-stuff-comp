export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function elHTML<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, html: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.innerHTML = html;
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function panel(title: string, hint = '', ...body: HTMLElement[]): HTMLElement {
  const p = el('section', 'panel');
  const head = el('div', 'panel-head');
  head.appendChild(el('span', 'panel-mark'));
  const titleEl = document.createElement('h2');
  titleEl.className = 'title';
  titleEl.textContent = title;
  head.appendChild(titleEl);
  if (hint) head.appendChild(el('span', 'hint', hint));
  const b = el('div', 'panel-body');
  body.forEach((n) => b.appendChild(n));
  p.appendChild(head);
  p.appendChild(b);
  return p;
}

export function button(label: string, className = 'btn', onClick?: () => void): HTMLButtonElement {
  const b = el('button', className, label) as HTMLButtonElement;
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

export function emptyState(title: string, sub = ''): HTMLElement {
  const e = el('div', 'empty-state');

  // Magnifier-over-circuit-grid: pure geometry, no picture paths.
  // Uses currentColor so it inherits --ink-faint without extra CSS overrides.
  const iconWrap = el('div', 'big');
  iconWrap.innerHTML = `<svg width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true" style="display:block;margin:0 auto;">
    <!-- grid lines: 3x3 circuit layout -->
    <line x1="8"  y1="4"  x2="8"  y2="28" stroke="currentColor" stroke-width="1" opacity="0.35"/>
    <line x1="16" y1="4"  x2="16" y2="28" stroke="currentColor" stroke-width="1" opacity="0.35"/>
    <line x1="24" y1="4"  x2="24" y2="28" stroke="currentColor" stroke-width="1" opacity="0.35"/>
    <line x1="4"  y1="8"  x2="28" y2="8"  stroke="currentColor" stroke-width="1" opacity="0.35"/>
    <line x1="4"  y1="16" x2="28" y2="16" stroke="currentColor" stroke-width="1" opacity="0.35"/>
    <line x1="4"  y1="24" x2="28" y2="24" stroke="currentColor" stroke-width="1" opacity="0.35"/>
    <!-- pad dots at intersections -->
    <circle cx="8"  cy="8"  r="2" fill="currentColor" opacity="0.4"/>
    <circle cx="16" cy="8"  r="2" fill="currentColor" opacity="0.4"/>
    <circle cx="24" cy="8"  r="2" fill="currentColor" opacity="0.4"/>
    <circle cx="8"  cy="16" r="2" fill="currentColor" opacity="0.4"/>
    <circle cx="16" cy="16" r="2" fill="currentColor" opacity="0.6"/>
    <circle cx="24" cy="16" r="2" fill="currentColor" opacity="0.4"/>
    <circle cx="8"  cy="24" r="2" fill="currentColor" opacity="0.4"/>
    <circle cx="16" cy="24" r="2" fill="currentColor" opacity="0.4"/>
    <circle cx="24" cy="24" r="2" fill="currentColor" opacity="0.4"/>
    <!-- magnifier lens ring -->
    <circle cx="16" cy="16" r="13" stroke="currentColor" stroke-width="1.5"/>
    <!-- magnifier handle -->
    <line x1="26" y1="26" x2="40" y2="40" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`;
  e.appendChild(iconWrap);
  e.appendChild(el('div', '', title));
  if (sub) {
    const s = el('div', '', sub);
    s.style.marginTop = '6px';
    s.style.fontSize = '12px';
    e.appendChild(s);
  }
  return e;
}


export function stars(n: number): string {
  const full = Math.round(n);
  let s = '';
  for (let i = 0; i < 5; i++) s += i < full ? '★' : '☆';
  return s;
}