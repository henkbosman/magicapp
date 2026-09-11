import { debounce } from './utils.js';

export function formFilters(form, defaults = {}) {
  const params = new URLSearchParams(new FormData(form));
  for (const [key, value] of [...params.entries()]) {
    if (!value || String(defaults[key] ?? '') === value) params.delete(key);
  }
  return params;
}


export function resetFilterForm(form, defaults = {}) {
  for (const control of form?.elements || []) {
    if (!control.name) continue;
    const value = Object.hasOwn(defaults, control.name) ? defaults[control.name] : '';
    if (control.type === 'checkbox' || control.type === 'radio') {
      control.checked = Boolean(value);
    } else {
      control.value = String(value ?? '');
    }
  }
}

export function replaceRouteQuery(routePath, params) {
  const query = params.toString();
  const hash = `#${routePath}${query ? `?${query}` : ''}`;
  history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
}

export function bindLiveFilters({
  form,
  routePath,
  defaults = {},
  delay = 220,
  onApply,
  onError = () => {}
}) {
  let controller = null;
  let sequence = 0;

  const apply = async () => {
    const params = formFilters(form, defaults);
    replaceRouteQuery(routePath, params);
    controller?.abort();
    controller = new AbortController();
    const current = ++sequence;
    form.classList.add('filters-loading');
    form.setAttribute('aria-busy', 'true');
    try {
      await onApply(params, controller.signal);
    } catch (error) {
      if (error?.name !== 'AbortError') onError(error);
    } finally {
      if (current === sequence) {
        form.classList.remove('filters-loading');
        form.removeAttribute('aria-busy');
      }
    }
  };

  const applyDebounced = debounce(apply, delay);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    apply();
  });
  form.addEventListener('input', (event) => {
    if (event.target.matches('input[type="search"], input[type="text"], input:not([type])')) applyDebounced();
  });
  form.addEventListener('change', (event) => {
    if (!event.target.matches('input[type="search"], input[type="text"], input:not([type])')) apply();
  });

  return { apply, getParams: () => formFilters(form, defaults) };
}
