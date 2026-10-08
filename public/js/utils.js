export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function formatNumber(value, maximumFractionDigits = 0) {
  return new Intl.NumberFormat('nl-NL', { maximumFractionDigits }).format(Number(value || 0));
}

export function formatEuro(value) {
  if (value === null || value === undefined || value === '') return '—';
  return new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(Number(value));
}

export function formatDate(value, includeTime = false) {
  if (!value) return '—';
  const normalized = /Z$|[+-]\d\d:\d\d$/.test(value) ? value : `${String(value).replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('nl-NL', includeTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' }).format(date);
}

export function debounce(fn, delay = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

export function toast(message, type = 'success', { position = 'bottom' } = {}) {
  const regionId = position === 'top' ? 'toast-region-top' : 'toast-region';
  const region = document.getElementById(regionId) || document.getElementById('toast-region');
  if (!region) return;
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  element.innerHTML = `<span class="toast-icon">${type === 'error' ? '!' : type === 'warning' ? '△' : '✓'}</span><span>${escapeHtml(message)}</span>`;
  region.append(element);
  requestAnimationFrame(() => element.classList.add('visible'));
  setTimeout(() => {
    element.classList.remove('visible');
    setTimeout(() => element.remove(), 220);
  }, 4200);
}

export function loadingBlock(label = 'Gegevens laden…') {
  return `<div class="page-loading"><span class="spinner"></span><p>${escapeHtml(label)}</p></div>`;
}

export function emptyState(title, text, actionHtml = '') {
  return `<div class="empty-state"><div class="empty-icon">◇</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p>${actionHtml}</div>`;
}

export function parseTags(value) {
  return [...new Set(String(value || '').split(',').map((item) => item.trim()).filter(Boolean))];
}


let dialogSequence = 0;

export function openDialog({ title, content, submitLabel = 'Opslaan', cancelLabel = 'Annuleren', destructive = false, wide = false, writeAction = true, initialFocus = '', onSubmit }) {
  const dialog = document.createElement('dialog');
  const titleId = `dialog-title-${++dialogSequence}`;
  dialog.className = `modal ${wide ? 'modal-wide' : ''}`;
  dialog.setAttribute('aria-labelledby', titleId);
  dialog.innerHTML = `
    <form class="modal-card" method="dialog">
      <header><h2 id="${titleId}">${escapeHtml(title)}</h2><button type="button" class="icon-button close-dialog" aria-label="Sluiten">×</button></header>
      <div class="modal-body">${content}</div>
      <footer>
        <button type="button" class="button secondary close-dialog">${escapeHtml(cancelLabel)}</button>
        ${onSubmit ? `<button type="submit" ${writeAction ? 'data-write-action' : ''} class="button ${destructive ? 'danger' : 'primary'}">${escapeHtml(submitLabel)}</button>` : ''}
      </footer>
    </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form');
  let submitting = false;
  const close = () => {
    if (submitting || dialog.dataset.preventClose === 'true') return;
    dialog.close();
  };
  dialog.querySelectorAll('.close-dialog').forEach((button) => button.addEventListener('click', close));
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  dialog.addEventListener('cancel', (event) => {
    if (submitting || dialog.dataset.preventClose === 'true') event.preventDefault();
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  if (onSubmit) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('[type="submit"]');
      // Disabling a button does not guard submit events, and an API response can
      // update write availability while the callback is still processing.
      if (submitting || !dialog.open || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
      submitting = true;
      if (writeAction && button.dataset.writeInitiallyDisabled === undefined) {
        button.dataset.writeInitiallyDisabled = 'false';
      }
      button.disabled = true;
      form.setAttribute('aria-busy', 'true');
      const original = button.textContent;
      button.textContent = 'Bezig…';
      try {
        const shouldClose = await onSubmit(new FormData(form), dialog);
        if (shouldClose !== false) dialog.close();
      } catch (error) {
        toast(error.message || 'Actie mislukt.', 'error');
      } finally {
        submitting = false;
        form.removeAttribute('aria-busy');
        if (dialog.open) {
          button.disabled = button.getAttribute('aria-disabled') === 'true'
            || button.dataset.writeInitiallyDisabled === 'true';
          button.textContent = original;
        }
      }
    });
  }
  dialog.showModal();
  setTimeout(() => (
    (initialFocus ? dialog.querySelector(initialFocus) : null)
    || dialog.querySelector('.modal-body input, .modal-body select, .modal-body textarea, .modal-body button, footer button, header button')
  )?.focus(), 0);
  return dialog;
}

export function confirmDialog({ title, message, confirmLabel = 'Verwijderen', destructive = true, writeAction = true }) {
  return new Promise((resolve) => {
    const dialog = openDialog({
      title,
      content: `<p class="dialog-message">${escapeHtml(message)}</p>`,
      submitLabel: confirmLabel,
      destructive,
      writeAction,
      onSubmit: async () => {
        resolve(true);
        return true;
      }
    });
    dialog.addEventListener('close', () => resolve(false), { once: true });
  });
}

export function formValue(formData, name, fallback = '') {
  const value = formData.get(name);
  return value === null ? fallback : String(value);
}


export function refreshView() {
  window.dispatchEvent(new Event('app:refresh'));
}
