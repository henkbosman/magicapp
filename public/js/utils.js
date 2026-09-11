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

export function toast(message, type = 'success') {
  const region = document.getElementById('toast-region');
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


export function openDialog({ title, content, submitLabel = 'Opslaan', cancelLabel = 'Annuleren', destructive = false, wide = false, writeAction = true, onSubmit }) {
  const dialog = document.createElement('dialog');
  dialog.className = `modal ${wide ? 'modal-wide' : ''}`;
  dialog.innerHTML = `
    <form class="modal-card" method="dialog">
      <header><h2>${escapeHtml(title)}</h2><button type="button" class="icon-button close-dialog" aria-label="Sluiten">×</button></header>
      <div class="modal-body">${content}</div>
      <footer>
        <button type="button" class="button secondary close-dialog">${escapeHtml(cancelLabel)}</button>
        ${onSubmit ? `<button type="submit" ${writeAction ? 'data-write-action' : ''} class="button ${destructive ? 'danger' : 'primary'}">${escapeHtml(submitLabel)}</button>` : ''}
      </footer>
    </form>`;
  document.body.append(dialog);
  const form = dialog.querySelector('form');
  const close = () => dialog.close();
  dialog.querySelectorAll('.close-dialog').forEach((button) => button.addEventListener('click', close));
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) close();
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  if (onSubmit) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('[type="submit"]');
      button.disabled = true;
      const original = button.textContent;
      button.textContent = 'Bezig…';
      try {
        const shouldClose = await onSubmit(new FormData(form), dialog);
        if (shouldClose !== false) dialog.close();
      } catch (error) {
        toast(error.message || 'Actie mislukt.', 'error');
      } finally {
        if (dialog.open) {
          button.disabled = false;
          button.textContent = original;
        }
      }
    });
  }
  dialog.showModal();
  setTimeout(() => dialog.querySelector('input, select, textarea, button')?.focus(), 0);
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
