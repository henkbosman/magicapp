const state = {
  available: null
};

function isFormControl(element) {
  return element instanceof HTMLButtonElement
    || element instanceof HTMLInputElement
    || element instanceof HTMLSelectElement
    || element instanceof HTMLTextAreaElement;
}

export function applyWriteAvailability(root = document) {
  const unavailable = state.available !== true;

  const writeOnly = [];
  if (root instanceof Element && root.matches('[data-write-only]')) writeOnly.push(root);
  if (root.querySelectorAll) writeOnly.push(...root.querySelectorAll('[data-write-only]'));
  for (const element of writeOnly) {
    element.hidden = unavailable;
    element.setAttribute('aria-hidden', unavailable ? 'true' : 'false');
  }

  const elements = [];
  if (root instanceof Element && root.matches('[data-write-action]')) elements.push(root);
  if (root.querySelectorAll) elements.push(...root.querySelectorAll('[data-write-action]'));

  for (const element of elements) {
    element.classList.toggle('write-disabled', unavailable);
    element.setAttribute('aria-disabled', unavailable ? 'true' : 'false');

    if (isFormControl(element)) {
      if (element.dataset.writeInitiallyDisabled === undefined) {
        element.dataset.writeInitiallyDisabled = element.disabled ? 'true' : 'false';
      }
      element.disabled = unavailable || element.dataset.writeInitiallyDisabled === 'true';
      continue;
    }

    if (element.dataset.writeTabindex === undefined) {
      element.dataset.writeTabindex = element.getAttribute('tabindex') ?? '';
    }
    if (unavailable) element.setAttribute('tabindex', '-1');
    else if (element.dataset.writeTabindex) element.setAttribute('tabindex', element.dataset.writeTabindex);
    else element.removeAttribute('tabindex');
  }
}

export function setWriteAvailability(available) {
  state.available = Boolean(available);
  applyWriteAvailability(document);
}

export async function probeWriteAccess() {
  try {
    const response = await fetch('/api/write/health', {
      method: 'POST',
      cache: 'no-store',
      headers: { Accept: 'application/json' }
    });
    setWriteAvailability(response.ok);
    return response.ok;
  } catch {
    setWriteAvailability(false);
    return false;
  }
}

export function initializeWriteAccess() {
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
