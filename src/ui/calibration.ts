import { el, clear, panel, button } from './dom';
import {
  starThresholds,
  applyStarThresholds,
  resetStarThresholds,
  starThresholdsAscend,
  type StarThresholds,
} from './vision';

/** Deep copy of the plain-number threshold tree. */
const clone = (t: StarThresholds): StarThresholds => JSON.parse(JSON.stringify(t)) as StarThresholds;

/**
 * Workbench > Calibration sub-tab. Exposes ONLY the star-rating severity
 * thresholds that map raw defect ratios to the 1-5 star sub-scores on the
 * Image Inspection panel. Sliders edit a local draft; Apply writes the live
 * `starThresholds` (and localStorage) so the next analysis picks it up.
 */
export function renderCalibrationTab(host: HTMLElement): void {
  clear(host);
  const layout = el('div', 'layout');
  host.appendChild(layout);

  const p = panel('Calibration Settings');
  const body = p.querySelector('.panel-body')! as HTMLElement;
  layout.appendChild(p);

  const draft = clone(starThresholds);
  const bindings: { input: HTMLInputElement; value: HTMLElement; get: () => number }[] = [];

  body.appendChild(el('div', 'cal-note',
    'These settings affect how new board analyses are scored for display. They do not affect the AI\'s defect/cause diagnosis or historical case data.'));

  const group = (title: string, desc: string): HTMLElement => {
    const g = el('div', 'cal-group');
    const head = el('div', 'cal-group-head');
    head.appendChild(el('div', 'cal-title', title));
    head.appendChild(el('div', 'cal-desc', desc));
    g.appendChild(head);
    body.appendChild(g);
    return g;
  };

  const row = (
    parent: HTMLElement,
    label: string,
    min: number,
    max: number,
    step: number,
    get: () => number,
    set: (v: number) => void,
  ): void => {
    const r = el('label', 'cal-row');
    r.appendChild(el('span', 'cal-label', label));
    const input = el('input', 'cal-range') as HTMLInputElement;
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(get());
    const value = el('span', 'cal-value', get().toFixed(2));
    input.addEventListener('input', () => {
      set(Number(input.value));
      value.textContent = get().toFixed(2);
    });
    r.appendChild(input);
    r.appendChild(value);
    parent.appendChild(r);
    bindings.push({ input, value, get });
  };

  const bandRows = (parent: HTMLElement, bands: { t4: number; t3: number; t2: number }) => {
    row(parent, '4-star band max', 0.01, 0.5, 0.01, () => bands.t4, (v) => { bands.t4 = v; });
    row(parent, '3-star band max', 0.01, 0.5, 0.01, () => bands.t3, (v) => { bands.t3 = v; });
    row(parent, '2-star band max', 0.01, 0.5, 0.01, () => bands.t2, (v) => { bands.t2 = v; });
  };

  const shape = group('Shape / fill', 'Ratio of bridging legs to total legs. At or below each band the rating keeps one more star.');
  bandRows(shape, draft.shape);

  const volume = group('Volume', 'Ratio of less-paste legs to total legs.');
  bandRows(volume, draft.volume);

  const position = group('Position', 'Ratio of flagged legs (non-Good or low confidence) to total legs.');
  bandRows(position, draft.position);

  const risk = group('Defect risk', 'Weighted blend of the three ratios above, then compared against its own bands.');
  bandRows(risk, draft.risk.bands);
  row(risk, 'Bridging weight', 0, 1, 0.05, () => draft.risk.weights.bridging, (v) => { draft.risk.weights.bridging = v; });
  row(risk, 'Flagged weight', 0, 1, 0.05, () => draft.risk.weights.flagged, (v) => { draft.risk.weights.flagged = v; });
  row(risk, 'Less-paste weight', 0, 1, 0.05, () => draft.risk.weights.lessPaste, (v) => { draft.risk.weights.lessPaste = v; });

  const status = el('div', 'cal-status');
  status.hidden = true;
  let timer: number | undefined;
  const setStatus = (text: string, warn = false): void => {
    status.textContent = text;
    status.classList.toggle('warn', warn);
    status.hidden = false;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => { status.hidden = true; }, 3000);
  };

  const actions = el('div', 'cal-actions');
  actions.appendChild(button('Apply', 'btn primary', () => {
    if (!starThresholdsAscend(draft)) {
      setStatus('Bands must ascend: 4-star max <= 3-star max <= 2-star max.', true);
      return;
    }
    applyStarThresholds(draft);
    setStatus('Applied. New board analyses will use these thresholds.');
  }));
  actions.appendChild(button('Reset to defaults', 'btn ghost', () => {
    resetStarThresholds();
    const fresh = clone(starThresholds);
    // mutate in place so the slider closures keep pointing at the same objects
    Object.assign(draft.shape, fresh.shape);
    Object.assign(draft.volume, fresh.volume);
    Object.assign(draft.position, fresh.position);
    Object.assign(draft.risk.bands, fresh.risk.bands);
    Object.assign(draft.risk.weights, fresh.risk.weights);
    for (const b of bindings) {
      const v = b.get();
      b.input.value = String(v);
      b.value.textContent = v.toFixed(2);
    }
    setStatus('Reset to defaults.');
  }));
  actions.appendChild(status);
  body.appendChild(actions);
}
