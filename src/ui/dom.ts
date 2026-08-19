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
  head.appendChild(el('span', 'tick'));
  head.appendChild(el('span', 'title', title));
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
  e.appendChild(el('div', 'big', '▚'));
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