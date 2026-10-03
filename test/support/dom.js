// A deliberately small DOM adapter: mount the real markup and exercise its event
// handlers without adding a browser dependency to the application's test suite.
const decode = (value) => String(value).replace(/&quot;/g, '"').replace(/&#039;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const voidTags = new Set(['INPUT', 'BR', 'HR', 'IMG', 'META', 'LINK', 'WBR']);

export class Element {
  constructor(tagName, attributes = {}) {
    this.tagName = tagName.toUpperCase();
    this.attributes = attributes;
    this.children = [];
    this.listeners = new Map();
    this.dataset = Object.fromEntries(Object.entries(attributes)
      .filter(([name]) => name.startsWith('data-'))
      .map(([name, value]) => [name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
    for (const name of ['checked', 'disabled', 'hidden', 'selected']) this[name] = Object.hasOwn(attributes, name);
    this.classList = {
      add: (name) => { attributes.class = [...new Set([...(attributes.class || '').split(' '), name])].join(' '); },
      remove: (name) => { attributes.class = (attributes.class || '').split(' ').filter((value) => value !== name).join(' '); },
      contains: (name) => (attributes.class || '').split(' ').includes(name),
      toggle: (name, force) => {
        const present = force ?? !this.classList.contains(name);
        this.classList[present ? 'add' : 'remove'](name);
        return present;
      }
    };
  }

  get name() { return this.attributes.name || ''; }
  get type() { return this.attributes.type || (this.tagName === 'INPUT' ? 'text' : ''); }
  get elements() { return this.querySelectorAll('input, select, button, textarea'); }
  get options() { return this.querySelectorAll('option'); }
  get value() {
    if (this.tagName === 'SELECT') return this.options.find((option) => option.selected)?.value ?? this.options[0]?.value ?? '';
    return this.attributes.value ?? '';
  }
  set value(value) {
    if (this.tagName === 'SELECT') {
      this.options.forEach((option) => { option.selected = option.value === String(value); });
    } else this.attributes.value = String(value);
  }
  get textContent() { return this._text ?? this.children.map((child) => typeof child === 'string' ? child : child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get innerHTML() { return this._html || ''; }
  set innerHTML(html) {
    this._html = String(html);
    this._text = undefined;
    this.children = [];
    parseHtml(this._html, this);
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  removeAttribute(name) { delete this.attributes[name]; }
  matches(selector) {
    return selector.split(',').some((part) => {
      let value = part.trim();
      const not = value.match(/:not\(([^)]+)\)/);
      if (not && this.matches(not[1])) return false;
      value = value.replace(/:not\([^)]+\)/g, '');
      const tag = value.match(/^[a-z]+/i)?.[0];
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      const id = value.match(/#([\w-]+)/)?.[1];
      if (id && this.attributes.id !== id) return false;
      const className = value.match(/\.([\w-]+)/)?.[1];
      if (className && !this.classList.contains(className)) return false;
      for (const [, name, expected] of value.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
        if (!Object.hasOwn(this.attributes, name)) return false;
        if (expected !== undefined && this.attributes[name] !== expected) return false;
      }
      return true;
    });
  }
  querySelectorAll(selector) {
    return this.children.filter((child) => child instanceof Element).flatMap((child) => [
      ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  dispatch(type, details = {}) {
    const event = { type, target: this, preventDefault() {}, ...details };
    for (let node = this; node; node = node.parentElement) {
      for (const listener of node.listeners.get(type) || []) listener(event);
    }
  }
  click() { this.dispatch('click'); }
  scrollIntoView() {}
}

export function parseHtml(html, root = new Element('document')) {
  const stack = [root];
  for (const [token] of html.matchAll(/<[^>]+>|[^<]+/g)) {
    if (token.startsWith('</')) { stack.pop(); continue; }
    if (token.startsWith('<!')) continue;
    const parent = stack.at(-1);
    if (!token.startsWith('<')) { parent.children.push(decode(token)); continue; }
    const tagName = token.match(/^<([\w-]+)/)?.[1];
    if (!tagName) continue;
    const attributes = {};
    const attributeText = token.slice(tagName.length + 1, token.endsWith('/>') ? -2 : -1);
    for (const [, name, doubleQuoted, singleQuoted, unquoted] of attributeText.matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g)) {
      attributes[name] = decode(doubleQuoted ?? singleQuoted ?? unquoted ?? '');
    }
    const element = new Element(tagName, attributes);
    element.parentElement = parent;
    parent.children.push(element);
    if (!voidTags.has(element.tagName) && !token.endsWith('/>')) stack.push(element);
  }
  return root;
}
