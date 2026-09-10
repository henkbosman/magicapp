const state = {
  checked: false,
  available: null,
  message: 'Schrijftoegang wordt gecontroleerd…'
};

function isFormControl(element) {
  return element instanceof HTMLButtonElement
    || element instanceof HTMLInputElement
    || element instanceof HTMLSelectElement
    || element instanceof HTMLTextAreaElement;
}

function updateStatusUi() {
  document.body.classList.toggle('write-unavailable', state.checked && !state.available);
  document.body.classList.toggle('write-available', state.checked && state.available);
  document.body.classList.toggle('write-checking', !state.checked);

  const status = document.getElementById('write-access-status');
  if (status) {
    status.className = `write-access-status ${!state.checked ? 'checking' : state.available ? 'available' : 'unavailable'}`;
    const title = !state.checked ? 'Schrijftoegang' : state.available ? 'Bewerken toegestaan' : 'Alleen-lezen';
    const detail = !state.checked ? 'Toegang controleren…' : state.available ? 'Wijzigingen kunnen worden opgeslagen' : 'Wijzigen is op dit netwerk geblokkeerd';
    status.innerHTML = `<span class="status-dot"></span><span class="write-status-copy"><strong>${title}</strong><small>${detail}</small></span>`;
    status.title = state.message;
  }

  const banner = document.getElementById('read-only-banner');
  if (banner) {
    banner.hidden = !state.checked || state.available;
    banner.querySelector('[data-read-only-message]')?.replaceChildren(document.createTextNode(state.message));
  }
}

export function applyWriteAvailability(root = document) {
  const unavailable = state.available !== true;
  const elements = [];
  if (root instanceof Element && root.matches('[data-write-action]')) elements.push(root);
  if (root.querySelectorAll) elements.push(...root.querySelectorAll('[data-write-action]'));

  for (const element of elements) {
    element.classList.toggle('write-disabled', unavailable);
    element.setAttribute('aria-disabled', unavailable ? 'true' : 'false');
    if (!element.dataset.writeTitle) element.dataset.writeTitle = element.getAttribute('title') || '';

    if (isFormControl(element)) {
      if (element.dataset.writeInitiallyDisabled === undefined) {
        element.dataset.writeInitiallyDisabled = element.disabled ? 'true' : 'false';
      }
      element.disabled = unavailable || element.dataset.writeInitiallyDisabled === 'true';
    } else {
      if (element.dataset.writeTabindex === undefined) {
        element.dataset.writeTabindex = element.getAttribute('tabindex') ?? '';
      }
      if (unavailable) element.setAttribute('tabindex', '-1');
      else if (element.dataset.writeTabindex) element.setAttribute('tabindex', element.dataset.writeTabindex);
      else element.removeAttribute('tabindex');
    }

    if (unavailable) {
      element.title = state.checked
        ? 'Niet beschikbaar: de schrijf-API is vanaf dit netwerk geblokkeerd.'
        : 'Even wachten: schrijftoegang wordt gecontroleerd.';
    } else if (element.dataset.writeTitle) {
      element.title = element.dataset.writeTitle;
    } else {
      element.removeAttribute('title');
    }
  }
}

export function setWriteAvailability(available, message = '') {
  state.checked = true;
  state.available = Boolean(available);
  state.message = message || (state.available
    ? 'De schrijf-API is bereikbaar.'
    : 'De schrijf-API is vanaf dit netwerk niet bereikbaar. Je kunt de gegevens wel bekijken, maar niet wijzigen.');
  updateStatusUi();
  applyWriteAvailability(document);
  window.dispatchEvent(new CustomEvent('app:write-access', { detail: { ...state } }));
}


export async function probeWriteAccess() {
  try {
    const response = await fetch('/api/write/health', {
      method: 'POST',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) {
      setWriteAvailability(false);
      return false;
    }
    setWriteAvailability(true);
    return true;
  } catch {
    setWriteAvailability(false);
    return false;
  }
}

export function initializeWriteAccess() {
  updateStatusUi();
  applyWriteAvailability(document);

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof Element) applyWriteAvailability(node);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const blockWriteEvent = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    window.dispatchEvent(new CustomEvent('app:write-blocked', { detail: { ...state } }));
  };

  document.addEventListener('click', (event) => {
    const blocked = event.target.closest?.('[data-write-action][aria-disabled="true"]');
    if (blocked) blockWriteEvent(event);
  }, true);

  document.addEventListener('submit', (event) => {
    const blocked = event.target.querySelector?.('[data-write-action][aria-disabled="true"]');
    if (blocked) blockWriteEvent(event);
  }, true);

  probeWriteAccess();
}
