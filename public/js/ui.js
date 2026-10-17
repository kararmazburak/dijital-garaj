// Arayüz araç takımı: DOM oluşturma, biçimlendirme, bildirim, pencere, form, tablo.
import { api, fileUrl } from './api.js';
import { C } from './state.js';

// ---------------------------------------------------------------- DOM
const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'htmlFor', 'readOnly', 'multiple', 'indeterminate', 'hidden']);

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (PROPS.has(k)) el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of [children].flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === '') continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// ---------------------------------------------------------------- Simgeler (statik, güvenilir SVG yolları)
const ICONS = {
  dashboard: 'M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z',
  garage: 'M3 21V9l9-6 9 6v12M7 21v-7h10v7M7 17h10',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  key: 'M15 7a4 4 0 1 1-3.9 5H8v3H5v3H2v-3l7.1-7.1A4 4 0 0 1 15 7zM16 7h.01',
  car: 'M5 17h14M6 17v2M18 17v2M3 13l2-6a2 2 0 0 1 2-1h10a2 2 0 0 1 2 1l2 6v4H3zM7 13h.01M17 13h.01M3 13h18',
  doc: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5',
  wrench: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z',
  tire: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 3v5M12 16v5M3 12h5M16 12h5',
  box: 'M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  money: 'M2 6h20v12H2zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM6 12h.01M18 12h.01',
  warning: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  chart: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15.1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3',
  menu: 'M3 6h18M3 12h18M3 18h18',
  x: 'M18 6 6 18M6 6l12 12',
  check: 'M20 6 9 17l-5-5',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  trash: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  cube: 'M21 16V8l-9-5-9 5v8l9 5zM3.3 7 12 12l8.7-5M12 22V12',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  arrow: 'M5 12h14M12 5l7 7-7 7',
  back: 'M19 12H5M12 19l-7-7 7-7',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15',
  exit: 'M10 17l5-5-5-5M15 12H3M21 3v18',
  enter: 'M14 7l-5 5 5 5M9 12h12M3 3v18',
  file: 'M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM13 2v7h7',
  info: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 16v-4M12 8h.01',
  pin: 'M12 22s-8-7.5-8-13a8 8 0 0 1 16 0c0 5.5-8 13-8 13zM12 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  fuel: 'M3 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18M3 22h12M15 10h2a2 2 0 0 1 2 2v5a2 2 0 0 0 4 0V8l-4-4M7 6h4v4H7z',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
};

export function icon(name, size = 18) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('ic');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', ICONS[name] || ICONS.info);
  svg.append(p);
  return svg;
}

// ---------------------------------------------------------------- Biçimlendirme
export const fmtDate = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('.') : '—');
export const fmtDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export const fmtNum = (n, d = 0) => (n === null || n === undefined || n === '' || Number.isNaN(Number(n)) ? '—' : Number(n).toLocaleString('tr-TR', { maximumFractionDigits: d }));
export const fmtKm = (n) => (n === null || n === undefined ? '—' : `${fmtNum(n)} km`);
export const fmtMoney = (n) =>
  n === null || n === undefined ? '—' : Number(n).toLocaleString('tr-TR', { style: 'currency', currency: 'TRY', minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtSize = (b) => (b > 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.ceil(b / 1024)} KB`);

export function relTime(iso) {
  if (!iso) return '—';
  const diff = (Date.now() - Date.parse(iso)) / 1000;
  if (diff < 60) return 'az önce';
  if (diff < 3600) return `${Math.floor(diff / 60)} dk önce`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} sa önce`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} gün önce`;
  return fmtDate(new Date(iso).toISOString());
}

export function durationText(fromIso, toIso) {
  const ms = (toIso ? Date.parse(toIso) : Date.now()) - Date.parse(fromIso);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 48) return `${Math.floor(h / 24)} gün ${h % 24} sa`;
  return h ? `${h} sa ${m} dk` : `${m} dk`;
}

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- Rozetler
export function badge(text, tone = 'gray', title) {
  return h('span', { class: `badge badge-${tone}`, title }, text);
}

export const STATUS_TONE = { available: 'green', on_trip: 'blue', maintenance: 'orange', broken: 'red', passive: 'gray' };
export const statusBadge = (s) => badge(C().statuses?.[s] || s, STATUS_TONE[s] || 'gray');
export const LEVEL_TONE = { critical: 'red', warning: 'orange', info: 'blue' };
export const LEVEL_LABEL = { critical: 'Kritik', warning: 'Uyarı', info: 'Bilgi' };
export const levelBadge = (l) => badge(LEVEL_LABEL[l] || l, LEVEL_TONE[l] || 'gray');

export function daysBadge(days, { expired = 'Süresi doldu' } = {}) {
  if (days === null || days === undefined) return badge('Süresiz', 'gray');
  if (days < 0) return badge(`${expired} (${-days} gün)`, 'red');
  if (days === 0) return badge('Bugün bitiyor', 'red');
  const w = (window.__dg_warn || [30, 15, 7]);
  if (days <= w[2]) return badge(`${days} gün kaldı`, 'red');
  if (days <= w[0]) return badge(`${days} gün kaldı`, 'orange');
  return badge(`${days} gün`, 'green');
}

// ---------------------------------------------------------------- Bildirim (toast)
let toastHost;
export function toast(message, tone = 'ok', ms = 3800) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const t = h('div', { class: `toast toast-${tone}` }, icon(tone === 'error' ? 'warning' : tone === 'info' ? 'info' : 'check', 16), h('span', null, message));
  toastHost.append(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 300);
  }, ms);
}

export function errorToast(e) {
  toast(e?.message || 'Bir hata oluştu', 'error', 6000);
}

// ---------------------------------------------------------------- Pencere (modal)
const modalStack = [];
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalStack.length) {
    const top = modalStack[modalStack.length - 1];
    if (!top.busy) top.close();
  }
});

export function modal({ title, subtitle, content, actions = [], width = 560, onClose, className = '' }) {
  const prevFocus = document.activeElement;
  const body = h('div', { class: 'modal-body' }, content);
  const foot = h('div', { class: 'modal-foot' });
  const box = h('div', { class: `modal ${className}`, role: 'dialog', 'aria-modal': 'true', style: { maxWidth: width + 'px' } },
    h('div', { class: 'modal-head' },
      h('div', null, h('h2', null, title), subtitle ? h('p', { class: 'muted' }, subtitle) : null),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Kapat', onclick: () => ctl.close() }, icon('x'))),
    body, foot);
  const overlay = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === overlay && !ctl.busy) ctl.close(); } }, box);
  const ctl = {
    el: box,
    body,
    foot,
    busy: false,
    closed: false,
    close() {
      if (ctl.closed) return;
      ctl.closed = true;
      overlay.classList.add('out');
      setTimeout(() => overlay.remove(), 150);
      const i = modalStack.indexOf(ctl);
      if (i >= 0) modalStack.splice(i, 1);
      if (!modalStack.length) document.body.classList.remove('modal-open');
      prevFocus?.focus?.();
      onClose?.();
    },
    setActions(list) {
      clear(foot);
      for (const a of list) {
        const btn = h('button', { type: a.submit ? 'submit' : 'button', class: `btn ${a.kind ? 'btn-' + a.kind : ''}`, form: a.form },
          a.icon ? icon(a.icon, 16) : null, a.label);
        if (a.onClick) {
          btn.addEventListener('click', async () => {
            if (ctl.busy) return;
            ctl.busy = true;
            btn.disabled = true;
            try {
              await a.onClick(ctl);
            } catch (e) {
              errorToast(e);
            } finally {
              ctl.busy = false;
              btn.disabled = false;
            }
          });
        }
        foot.append(btn);
      }
      foot.hidden = !list.length;
    },
  };
  ctl.setActions(actions);
  document.body.append(overlay);
  document.body.classList.add('modal-open');
  modalStack.push(ctl);
  setTimeout(() => (box.querySelector('input:not([type=hidden]):not([disabled]), select, textarea') || box.querySelector('.modal-foot .btn-primary') || box).focus?.(), 30);
  return ctl;
}

/** Onay penceresi. input verilirse girilen metni döndürür. */
export function confirmDialog({ title = 'Emin misiniz?', message, confirmLabel = 'Onayla', danger = false, input = null }) {
  return new Promise((resolve) => {
    let result = false;
    const field = input ? h('textarea', { class: 'input', rows: 3, placeholder: input.placeholder || '', maxlength: 500 }) : null;
    const err = h('div', { class: 'field-error' });
    const m = modal({
      title,
      width: 460,
      content: [message ? h('p', { class: 'confirm-msg' }, message) : null, field ? h('label', { class: 'field' }, h('span', { class: 'label' }, input.label), field, err) : null],
      actions: [
        { label: 'Vazgeç', kind: 'ghost', onClick: () => m.close() },
        {
          label: confirmLabel,
          kind: danger ? 'danger' : 'primary',
          onClick: () => {
            if (field && input.required && !field.value.trim()) {
              err.textContent = `${input.label} zorunludur`;
              field.focus();
              return;
            }
            result = field ? field.value.trim() || true : true;
            m.close();
          },
        },
      ],
      onClose: () => resolve(result),
    });
  });
}

// ---------------------------------------------------------------- Form
/**
 * Alan tanımı: { name, label, type, options, required, hint, placeholder, min, max, step, full, show(values), numeric, accept, render }
 * type: text | number | date | datetime | select | textarea | checkbox | color | file | password | email | tel | custom | heading
 */
export function buildForm(fields, values = {}, { onChange } = {}) {
  const form = h('form', { class: 'form-grid', novalidate: true });
  const controls = new Map();
  const wrappers = new Map();
  const data = { ...values };
  let ready = false;

  const fire = () => {
    if (!ready) return; // alanlar kurulurken (özel alan setter'ı) tetiklenmez
    for (const f of fields) {
      const w = wrappers.get(f.name);
      if (w && f.show) w.hidden = !f.show(data);
    }
    onChange?.(data, api_);
  };

  for (const f of fields) {
    if (f.type === 'heading') {
      form.append(h('div', { class: 'form-heading full' }, h('h3', null, f.label), f.hint ? h('p', { class: 'muted' }, f.hint) : null));
      continue;
    }
    let ctl;
    const val = data[f.name];
    const common = { name: f.name, id: `f_${f.name}_${Math.random().toString(36).slice(2, 7)}`, required: f.required, disabled: f.disabled, placeholder: f.placeholder };
    switch (f.type) {
      case 'select': {
        ctl = h('select', { ...common, class: 'input' });
        if (!f.required || f.placeholder || val === null || val === undefined || val === '') ctl.append(h('option', { value: '', disabled: !!f.required }, f.placeholder || '— Seçiniz —'));
        for (const o of typeof f.options === 'function' ? f.options(data) : f.options || []) {
          const [v, label, extra] = Array.isArray(o) ? o : [o.value, o.label, o];
          ctl.append(h('option', { value: String(v), disabled: extra?.disabled }, label));
        }
        ctl.value = val === null || val === undefined ? '' : String(val);
        break;
      }
      case 'textarea':
        ctl = h('textarea', { ...common, class: 'input', rows: f.rows || 3, maxlength: f.max || 4000 });
        ctl.value = val ?? '';
        break;
      case 'checkbox':
        ctl = h('input', { ...common, type: 'checkbox', checked: !!val });
        break;
      case 'file':
        ctl = fileInput(f, val, data, fire);
        break;
      case 'custom':
        ctl = f.render(data, (v) => {
          data[f.name] = v;
          fire();
        });
        break;
      default: {
        const type = { number: 'number', date: 'date', datetime: 'datetime-local', color: 'color', password: 'password', email: 'email', tel: 'tel' }[f.type] || 'text';
        ctl = h('input', { ...common, class: 'input', type, min: f.min, max: f.max, step: f.step ?? (f.type === 'number' ? 'any' : undefined), maxlength: f.maxlength, autocomplete: f.autocomplete || 'off', inputmode: f.inputmode });
        if (type === 'color') ctl.className = 'input input-color';
        ctl.value = val === null || val === undefined ? (type === 'color' ? '#9aa3ad' : '') : String(val);
      }
    }
    if (f.type !== 'custom' && f.type !== 'file') {
      ctl.addEventListener(f.type === 'checkbox' || f.type === 'select' ? 'change' : 'input', () => {
        data[f.name] = readControl(f, ctl);
        const w = wrappers.get(f.name);
        w?.classList.remove('has-error');
        fire();
      });
    }
    controls.set(f.name, ctl);
    const err = h('div', { class: 'field-error' });
    const wrap = f.type === 'checkbox'
      ? h('div', { class: `field field-check ${f.full ? 'full' : ''}` }, h('label', { class: 'check' }, ctl, h('span', null, f.label)), f.hint ? h('div', { class: 'hint' }, f.hint) : null, err)
      : h('div', { class: `field ${f.full ? 'full' : ''}` },
        h('label', { class: 'label', for: ctl.id }, f.label, f.required ? h('span', { class: 'req' }, ' *') : null),
        ctl, f.hint ? h('div', { class: 'hint' }, typeof f.hint === 'function' ? f.hint(data) : f.hint) : null, err);
    wrap._err = err;
    wrappers.set(f.name, wrap);
    form.append(wrap);
  }

  const api_ = {
    form,
    data,
    controls,
    set(name, v) {
      data[name] = v;
      const c = controls.get(name);
      const f = fields.find((x) => x.name === name);
      if (c && f && f.type !== 'custom' && f.type !== 'file') {
        if (f.type === 'checkbox') c.checked = !!v;
        else c.value = v === null || v === undefined ? '' : String(v);
      }
      fire();
    },
    setHint(name, content) {
      const w = wrappers.get(name);
      if (!w) return;
      let hint = w.querySelector('.hint.dyn');
      if (!hint) {
        hint = h('div', { class: 'hint dyn' });
        w.insertBefore(hint, w._err);
      }
      clear(hint);
      append(hint, content);
    },
    setError(name, msg) {
      const w = wrappers.get(name);
      if (!w) return false;
      w.classList.add('has-error');
      w._err.textContent = msg;
      controls.get(name)?.focus?.();
      return true;
    },
    clearErrors() {
      for (const w of wrappers.values()) {
        w.classList.remove('has-error');
        w._err.textContent = '';
      }
    },
    validate() {
      api_.clearErrors();
      for (const f of fields) {
        if (f.type === 'heading') continue;
        const w = wrappers.get(f.name);
        if (w?.hidden) continue;
        const v = data[f.name];
        if (f.required && (v === null || v === undefined || v === '' || (f.type === 'checkbox' && !v))) {
          api_.setError(f.name, `${f.label} zorunludur`);
          return false;
        }
        if (f.type === 'number' && v !== null && v !== undefined && v !== '') {
          if (f.min !== undefined && v < f.min) return !api_.setError(f.name, `En az ${f.min} olmalıdır`);
          if (f.max !== undefined && v > f.max) return !api_.setError(f.name, `En fazla ${f.max} olabilir`);
        }
        if (f.validate) {
          const msg = f.validate(v, data);
          if (msg) return !api_.setError(f.name, msg);
        }
      }
      return true;
    },
    /** Görünen alanların değerleri. */
    values() {
      const out = {};
      for (const f of fields) {
        if (f.type === 'heading' || f.virtual) continue;
        if (wrappers.get(f.name)?.hidden) continue;
        let v = data[f.name];
        if (v === '' || v === undefined) v = null;
        out[f.name] = v;
      }
      return out;
    },
  };
  // İlk değerleri normalize et
  for (const f of fields) if (f.type === 'checkbox') data[f.name] = !!data[f.name];
  ready = true;
  setTimeout(fire, 0);
  return api_;
}

function readControl(f, ctl) {
  if (f.type === 'checkbox') return ctl.checked;
  const v = ctl.value;
  if (v === '') return null;
  if (f.type === 'number') {
    const n = Number(v.replace(',', '.'));
    return Number.isFinite(n) ? n : v;
  }
  if (f.type === 'select' && f.numeric) return Number(v);
  return v;
}

function fileInput(f, val, data, fire) {
  const nameKey = f.nameField || f.name.replace(/_id$/, '_name');
  const wrap = h('div', { class: 'file-input' });
  const input = h('input', { type: 'file', accept: f.accept || 'application/pdf,image/*', hidden: true, capture: f.capture });
  const render = () => {
    clear(wrap);
    wrap.append(input);
    if (data[f.name]) {
      wrap.append(
        h('a', { class: 'file-chip', href: fileUrl(data[f.name]), target: '_blank', rel: 'noopener' }, icon('file', 15), data[nameKey] || 'Ekli dosya'),
        h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => { data[f.name] = null; data[nameKey] = null; render(); fire(); } }, 'Kaldır'),
      );
    }
    wrap.append(h('button', { type: 'button', class: 'btn btn-sm', onclick: () => input.click() }, icon('upload', 15), data[f.name] ? 'Değiştir' : 'Dosya seç'));
    wrap.append(h('span', { class: 'hint' }, 'PDF veya görsel, en fazla 10 MB'));
  };
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    const status = h('span', { class: 'hint' }, 'Yükleniyor…');
    wrap.append(status);
    try {
      const up = await api.upload(file);
      data[f.name] = up.id;
      data[nameKey] = up.name;
      render();
      fire();
    } catch (e) {
      status.remove();
      errorToast(e);
    }
    input.value = '';
  });
  render();
  return wrap;
}

/**
 * Form penceresi. onSubmit(values, ctx) bir değer döndürür; pencere kapanır ve promise o değerle çözülür.
 * Sunucu hatası alan adı içeriyorsa (err.data.field) ilgili alanda gösterilir.
 */
export function openForm({ title, subtitle, fields, values = {}, submitLabel = 'Kaydet', onSubmit, width = 640, intro, onChange, extraActions = [], danger }) {
  return new Promise((resolve) => {
    let result = null;
    const formErr = h('div', { class: 'form-alert', hidden: true });
    const f = buildForm(fields, values, { onChange: (d, a) => onChange?.(d, a, ctx) });
    const ctx = { form: f, showError: (msg) => { formErr.hidden = !msg; clear(formErr); if (msg) append(formErr, [icon('warning', 16), h('span', null, msg)]); }, extra: h('div', { class: 'form-extra' }) };
    const fid = 'frm' + Math.random().toString(36).slice(2, 8);
    f.form.id = fid;
    const submit = async (m) => {
      ctx.showError(null);
      if (!f.validate()) return;
      try {
        result = await onSubmit(f.values(), ctx);
        if (result === false) return; // onSubmit pencereyi açık tutmak istedi
        m.close();
      } catch (e) {
        const field = e?.data?.field;
        if (!(field && f.setError(field, e.message))) ctx.showError(e.message);
        if (e.data?.blocks) ctx.onBlocked?.(e);
      }
    };
    const m = modal({
      title,
      subtitle,
      width,
      content: [intro ? h('div', { class: 'form-intro' }, intro) : null, formErr, f.form, ctx.extra],
      actions: [
        ...extraActions.map((a) => ({ ...a, onClick: () => a.onClick(m, f, ctx) })),
        { label: 'Vazgeç', kind: 'ghost', onClick: () => m.close() },
        { label: submitLabel, kind: danger ? 'danger' : 'primary', onClick: () => submit(m) },
      ],
      onClose: () => resolve(result),
    });
    f.form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!m.busy) m.foot.querySelector('.btn-primary, .btn-danger:last-child')?.click();
    });
    ctx.modal = m;
  });
}

// ---------------------------------------------------------------- Tablo
/**
 * dataTable({ columns, rows, searchPlaceholder, filters, onRowClick, rowClass, csvName, actions, selectable, sort, empty, pageSize })
 * column: { key, label, render(row), text(row), sortValue(row), align, csv(row) | false, width, nowrap, hideSm }
 * filter: { key, label, options: [[v, label]], match(row, v), value }
 */
export function dataTable(opts) {
  const columns = opts.columns.filter(Boolean);
  let rows = opts.rows || [];
  let sort = opts.sort || null;
  let q = '';
  let limit = opts.pageSize || 150;
  const filterVals = {};
  const selected = new Set();
  const root = h('div', { class: 'dt' });

  const textOf = (c, r) => {
    if (c.text) return c.text(r);
    const v = r[c.key];
    return v === null || v === undefined ? '' : String(v);
  };
  const searchText = (r) => (opts.searchText ? opts.searchText(r) : columns.map((c) => textOf(c, r)).join(' ')).toLocaleLowerCase('tr-TR');

  const search = h('div', { class: 'search' }, icon('search', 16),
    h('input', { class: 'input', type: 'search', placeholder: opts.searchPlaceholder || 'Ara…', oninput: (e) => { q = e.target.value.trim().toLocaleLowerCase('tr-TR'); limit = opts.pageSize || 150; render(); } }));
  const filterEls = (opts.filters || []).map((flt) => {
    filterVals[flt.key] = flt.value ?? '';
    const sel = h('select', { class: 'input input-sm', 'aria-label': flt.label, onchange: (e) => { filterVals[flt.key] = e.target.value; render(); } },
      h('option', { value: '' }, flt.label + ': Tümü'),
      flt.options.map(([v, l]) => h('option', { value: String(v) }, l)));
    sel.value = String(filterVals[flt.key] ?? '');
    return sel;
  });
  const count = h('span', { class: 'dt-count muted' });
  const bulkBar = h('div', { class: 'dt-bulk', hidden: true });
  const csvBtn = opts.csvName === false ? null : h('button', { class: 'btn btn-sm btn-ghost', type: 'button', title: 'Görünen satırları CSV olarak indir', onclick: () => exportCsv() }, icon('download', 15), 'CSV');
  const toolbar = h('div', { class: 'dt-toolbar' }, opts.search === false ? null : search, filterEls, h('div', { class: 'spacer' }), count, opts.actions || null, csvBtn);
  const thead = h('thead');
  const tbody = h('tbody');
  const table = h('table', { class: 'table' }, thead, tbody);
  const more = h('div', { class: 'dt-more' });
  root.append(toolbar, bulkBar, h('div', { class: 'table-wrap' }, table), more);

  function visible() {
    let list = rows;
    if (q) list = list.filter((r) => searchText(r).includes(q));
    for (const flt of opts.filters || []) {
      const v = filterVals[flt.key];
      if (v !== '' && v !== undefined && v !== null) list = list.filter((r) => (flt.match ? flt.match(r, v) : String(r[flt.key] ?? '') === String(v)));
    }
    if (sort) {
      const c = columns.find((x) => x.key === sort.key);
      if (c) {
        const val = (r) => (c.sortValue ? c.sortValue(r) : r[c.key]);
        const dir = sort.dir === 'desc' ? -1 : 1;
        list = [...list].sort((a, b) => {
          const x = val(a);
          const y = val(b);
          if (x === y) return 0;
          if (x === null || x === undefined || x === '') return 1;
          if (y === null || y === undefined || y === '') return -1;
          if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
          return String(x).localeCompare(String(y), 'tr', { numeric: true }) * dir;
        });
      }
    }
    return list;
  }

  function renderHead() {
    clear(thead);
    const tr = h('tr');
    if (opts.selectable) {
      const all = h('input', { type: 'checkbox', 'aria-label': 'Tümünü seç', onchange: (e) => { for (const r of visible()) if (!opts.selectable(r)) continue; else e.target.checked ? selected.add(r.id) : selected.delete(r.id); render(); } });
      tr.append(h('th', { class: 'col-check' }, all));
    }
    for (const c of columns) {
      const sortable = c.sortable !== false && (c.key || c.sortValue);
      const th = h('th', { class: [c.align === 'right' ? 'right' : '', sortable ? 'sortable' : '', c.hideSm ? 'hide-sm' : ''].join(' '), style: c.width ? { width: c.width } : null },
        c.label, sortable && sort?.key === c.key ? h('span', { class: 'sort-ind' }, sort.dir === 'desc' ? ' ▼' : ' ▲') : null);
      if (sortable) {
        th.tabIndex = 0;
        const toggle = () => {
          sort = sort?.key === c.key ? { key: c.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: c.defaultDir || 'asc' };
          renderHead();
          render();
        };
        th.addEventListener('click', toggle);
        th.addEventListener('keydown', (e) => { if (e.key === 'Enter') toggle(); });
      }
      tr.append(th);
    }
    thead.append(tr);
  }

  function render() {
    const list = visible();
    clear(tbody);
    count.textContent = list.length === rows.length ? `${rows.length} kayıt` : `${list.length} / ${rows.length} kayıt`;
    if (!list.length) {
      tbody.append(h('tr', { class: 'empty-row' }, h('td', { colspan: columns.length + (opts.selectable ? 1 : 0) },
        emptyState(rows.length ? 'search' : opts.emptyIcon || 'list', rows.length ? 'Eşleşen kayıt yok' : opts.empty || 'Henüz kayıt yok', rows.length ? 'Arama veya filtreleri değiştirin.' : opts.emptyHint || ''))));
    }
    for (const r of list.slice(0, limit)) {
      const tr = h('tr', { class: [opts.onRowClick ? 'clickable' : '', opts.rowClass?.(r) || ''].join(' ') });
      if (opts.onRowClick) tr.addEventListener('click', (e) => { if (!e.target.closest('button, a, input, select, label')) opts.onRowClick(r); });
      if (opts.selectable) {
        const ok = opts.selectable(r);
        tr.append(h('td', { class: 'col-check' }, ok ? h('input', { type: 'checkbox', checked: selected.has(r.id), 'aria-label': 'Seç', onchange: (e) => { e.target.checked ? selected.add(r.id) : selected.delete(r.id); renderBulk(); } }) : null));
      }
      for (const c of columns) {
        const content = c.render ? c.render(r) : textOf(c, r) || '—';
        tr.append(h('td', { class: [c.align === 'right' ? 'right' : '', c.nowrap ? 'nowrap' : '', c.hideSm ? 'hide-sm' : ''].join(' '), 'data-label': c.label }, content));
      }
      tbody.append(tr);
    }
    clear(more);
    if (list.length > limit) more.append(h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => { limit += 300; render(); } }, `Daha fazla göster (${list.length - limit} kayıt daha)`));
    renderBulk();
  }

  function renderBulk() {
    if (!opts.selectable || !opts.bulkActions) return;
    for (const id of [...selected]) if (!rows.some((r) => r.id === id)) selected.delete(id);
    bulkBar.hidden = selected.size === 0;
    clear(bulkBar);
    if (!selected.size) return;
    bulkBar.append(h('span', null, `${selected.size} kayıt seçildi`), ...opts.bulkActions([...selected], () => { selected.clear(); render(); }));
  }

  function exportCsv() {
    const cols = columns.filter((c) => c.csv !== false && c.label);
    const esc = (v) => {
      let s = v === null || v === undefined ? '' : String(v);
      if (/^[=+\-@]/.test(s) && !/^-?\d/.test(s)) s = "'" + s;
      return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.map((c) => esc(c.label)).join(';')];
    for (const r of visible()) lines.push(cols.map((c) => esc(c.csv ? c.csv(r) : textOf(c, r))).join(';'));
    downloadBlob(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `${opts.csvName || 'liste'}-${todayStr()}.csv`);
  }

  root.update = (newRows) => {
    rows = newRows || [];
    render();
  };
  root.selected = () => [...selected];
  renderHead();
  render();
  return root;
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ---------------------------------------------------------------- Sayfa parçaları
export function pageHeader(title, subtitle, actions = []) {
  return h('div', { class: 'page-head' },
    h('div', null, h('h1', null, title), subtitle ? h('p', { class: 'muted' }, subtitle) : null),
    h('div', { class: 'page-actions' }, actions));
}

export function emptyState(ic, title, text, action) {
  return h('div', { class: 'empty' }, h('div', { class: 'empty-ic' }, icon(ic, 26)), h('strong', null, title), text ? h('p', { class: 'muted' }, text) : null, action || null);
}

export function card(title, content, { actions, className = '', subtitle } = {}) {
  return h('section', { class: `card ${className}` },
    title ? h('div', { class: 'card-head' }, h('div', null, h('h3', null, title), subtitle ? h('p', { class: 'muted small' }, subtitle) : null), actions ? h('div', { class: 'card-actions' }, actions) : null) : null,
    h('div', { class: 'card-body' }, content));
}

export function stat(label, value, { tone, sub, href, ic } = {}) {
  const inner = [h('div', { class: 'stat-top' }, ic ? h('span', { class: `stat-ic tone-${tone || 'gray'}` }, icon(ic, 16)) : null, h('span', { class: 'stat-label' }, label)),
    h('div', { class: 'stat-value' }, value), sub ? h('div', { class: 'stat-sub muted' }, sub) : null];
  return href ? h('a', { class: `stat ${tone ? 'stat-' + tone : ''}`, href }, inner) : h('div', { class: `stat ${tone ? 'stat-' + tone : ''}` }, inner);
}

export function btn(label, { kind, ic, onClick, href, title, size, disabled } = {}) {
  const cls = `btn ${kind ? 'btn-' + kind : ''} ${size ? 'btn-' + size : ''}`;
  const content = [ic ? icon(ic, size === 'sm' ? 15 : 16) : null, label];
  if (href) return h('a', { class: cls, href, title }, content);
  const b = h('button', { class: cls, type: 'button', title, disabled }, content);
  if (onClick) {
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (b.disabled) return;
      b.disabled = true;
      try {
        await onClick(e);
      } catch (err) {
        errorToast(err);
      } finally {
        b.disabled = false;
      }
    });
  }
  return b;
}

export function tabs(items, active, onChange) {
  const bar = h('div', { class: 'tabs', role: 'tablist' });
  for (const it of items) {
    bar.append(h('button', { type: 'button', role: 'tab', class: `tab ${it.key === active ? 'active' : ''}`, 'aria-selected': it.key === active ? 'true' : 'false', onclick: () => onChange(it.key) },
      it.label, it.count ? h('span', { class: `tab-count ${it.tone ? 'tone-' + it.tone : ''}` }, it.count) : null));
  }
  return bar;
}

export function kv(pairs) {
  return h('dl', { class: 'kv' }, pairs.filter(Boolean).map(([k, v]) => [h('dt', null, k), h('dd', null, v === null || v === undefined || v === '' ? '—' : v)]));
}

export function loading(text = 'Yükleniyor…') {
  return h('div', { class: 'loading' }, h('span', { class: 'spinner' }), text);
}

export function fileLink(id, name) {
  if (!id) return '—';
  return h('a', { class: 'file-chip', href: fileUrl(id), target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() }, icon('file', 14), name || 'Dosya');
}

export function plate(text) {
  return h('span', { class: 'plate' }, h('span', { class: 'plate-tr' }, 'TR'), h('span', null, text));
}

export function colorDot(color) {
  return h('span', { class: 'color-dot', style: { background: color || '#9aa3ad' } });
}

/** Basit çubuk grafik (CSS). rows: [{label, value, sub}] */
export function barList(rows, { format = fmtNum, tone = 'accent' } = {}) {
  const max = Math.max(1, ...rows.map((r) => r.value || 0));
  return h('div', { class: 'bars' }, rows.map((r) => h('div', { class: 'bar-row' },
    h('div', { class: 'bar-label', title: r.label }, r.label),
    h('div', { class: 'bar-track' }, h('div', { class: `bar-fill tone-${r.tone || tone}`, style: { width: `${Math.max(2, ((r.value || 0) / max) * 100)}%` } })),
    h('div', { class: 'bar-value' }, format(r.value), r.sub ? h('span', { class: 'muted small' }, ' ', r.sub) : null))));
}
