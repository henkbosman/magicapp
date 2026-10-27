import { pageHeader } from '../components.js';
import { hypergeometricOdds, multivariateIntersectOdds, MAX_DECK_SIZE } from '../draw-odds.js';
import { escapeHtml } from '../utils.js';

const percentFormat = new Intl.NumberFormat('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const numberFormat = new Intl.NumberFormat('nl-NL', { maximumFractionDigits: 4 });

function percentage(probability) {
  // Do not display a tiny possible outcome as impossible (or almost certain as certain).
  if (probability > 0 && probability < 0.0001) return '< 0,01%';
  if (probability < 1 && probability > 0.9999) return '> 99,99%';
  return `${percentFormat.format(probability * 100)}%`;
}

const calculators = [
  {
    id: 'hypergeometric',
    title: 'Hypergeometric Calculator',
    description: 'Bereken hoe vaak je een kaart of kaartgroep trekt, bijvoorbeeld minstens één tutor of precies drie lands.',
    fields: [
      { name: 'deckSize', label: 'Kaarten in library', value: 60, min: 1 },
      { name: 'copies', label: 'Gewenste exemplaren in library', value: 4 },
      { name: 'draws', label: 'Aantal kaarten trekken', value: 7 },
      { name: 'target', label: 'Gewenst aantal in de getrokken kaarten', value: 1 }
    ],
    calculate: hypergeometricOdds,
    resultHtml(result, values) {
      const rows = [
        ['Minder dan', '<', 'lessThan'],
        ['Hoogstens', '≤', 'atMost'],
        ['Precies', '=', 'exact'],
        ['Minstens', '≥', 'atLeast'],
        ['Meer dan', '>', 'greaterThan']
      ];
      return `<dl class="draw-odds-results">${rows.map(([label, symbol, key]) => `
        <div class="draw-odds-result ${key === 'atLeast' ? 'draw-odds-result-emphasis' : ''}">
          <dt>${label} ${values.target} <span aria-hidden="true">(${escapeHtml(symbol)} ${values.target})</span></dt>
          <dd data-odds-result="${key}">${escapeHtml(percentage(result[key]))}</dd>
        </div>`).join('')}
        <div class="draw-odds-result">
          <dt>Verwacht aantal</dt>
          <dd data-odds-result="expected">${numberFormat.format(result.expected)}</dd>
        </div>
      </dl><p class="draw-odds-note">Het verwachte aantal is het gemiddelde over veel trekkingen.</p>`;
    }
  },
  {
    id: 'multivariate',
    title: 'Multivariate Intersect',
    description: 'Bereken de kans om zowel kaart A als kaart B te trekken, bijvoorbeeld de twee onderdelen van een combo.',
    fields: [
      { name: 'deckSize', label: 'Kaarten in library', value: 60, min: 1 },
      { name: 'copiesA', label: 'Exemplaren van A in library', value: 4 },
      { name: 'copiesB', label: 'Exemplaren van B in library', value: 4 },
      { name: 'draws', label: 'Aantal kaarten trekken', value: 7 }
    ],
    note: 'A en B zijn verschillende kaarten of groepen zonder overlap. Tel elk fysiek exemplaar in hoogstens één groep mee.',
    calculate: multivariateIntersectOdds,
    resultHtml(probability) {
      return `<dl class="draw-odds-results draw-odds-results-single">
        <div class="draw-odds-result draw-odds-result-emphasis">
          <dt>Minstens één A én minstens één B</dt>
          <dd data-odds-result="intersect">${escapeHtml(percentage(probability))}</dd>
        </div>
      </dl>`;
    }
  }
];

function calculatorHtml(calculator) {
  const values = Object.fromEntries(calculator.fields.map((field) => [field.name, field.value]));
  const descriptionId = `draw-odds-${calculator.id}-description`;
  const errorId = `draw-odds-${calculator.id}-error`;
  return `<section class="panel draw-odds-calculator" aria-labelledby="draw-odds-${calculator.id}-title">
    <header class="panel-header"><h2 id="draw-odds-${calculator.id}-title">${calculator.title}</h2></header>
    <div class="panel-body">
      <p id="${descriptionId}" class="draw-odds-description">${calculator.description}</p>
      <form id="draw-odds-${calculator.id}" novalidate aria-describedby="${descriptionId}">
        <div class="draw-odds-fields">${calculator.fields.map((field) => {
          const inputId = `draw-odds-${calculator.id}-${field.name}`;
          return `<div class="field">
            <label for="${inputId}">${field.label}</label>
            <input id="${inputId}" name="${field.name}" type="number" inputmode="numeric" min="${field.min ?? 0}" max="${MAX_DECK_SIZE}" step="1" value="${field.value}" required aria-describedby="${errorId}">
          </div>`;
        }).join('')}</div>
        ${calculator.note ? `<p class="draw-odds-note">${calculator.note}</p>` : ''}
        <div class="draw-odds-feedback" aria-live="polite" aria-atomic="true">
          <p id="${errorId}" class="draw-odds-error" hidden></p>
          <div data-odds-results>${calculator.resultHtml(calculator.calculate(values), values)}</div>
        </div>
      </form>
    </div>
  </section>`;
}

function mountCalculator(calculator) {
  const form = document.getElementById(`draw-odds-${calculator.id}`);
  if (!form) return () => {};
  const inputs = calculator.fields.map((field) => ({ ...field, input: form.querySelector(`[name="${field.name}"]`) }));
  const error = form.querySelector('.draw-odds-error');
  const results = form.querySelector('[data-odds-results]');

  const update = () => {
    try {
      const values = {};
      let inputError = '';
      for (const field of inputs) {
        const raw = field.input.value.trim();
        const numeric = /^\d+$/.test(raw) ? Number(raw) : NaN;
        const valid = Number.isSafeInteger(numeric) && numeric >= (field.min ?? 0) && numeric <= MAX_DECK_SIZE;
        field.input.setAttribute('aria-invalid', valid ? 'false' : 'true');
        if (!valid && !inputError) {
          inputError = `${field.label}: vul een heel getal van ${field.min ?? 0} t/m ${MAX_DECK_SIZE} in.`;
        }
        values[field.name] = numeric;
      }
      if (inputError) throw new RangeError(inputError);
      const result = calculator.calculate(values);
      error.hidden = true;
      error.textContent = '';
      results.innerHTML = calculator.resultHtml(result, values);
      results.hidden = false;
    } catch (failure) {
      results.innerHTML = '';
      results.hidden = true;
      error.textContent = failure.message;
      error.hidden = false;
    }
  };
  const submit = (event) => { event.preventDefault(); update(); };
  form.addEventListener('input', update);
  form.addEventListener('change', update);
  form.addEventListener('submit', submit);
  update();
  return () => {
    form.removeEventListener('input', update);
    form.removeEventListener('change', update);
    form.removeEventListener('submit', submit);
  };
}

export function renderTools() {
  return {
    html: `${pageHeader({
      eyebrow: 'Deckbuilding',
      title: 'Tools',
      description: 'Bereken de kans op je openingshand of op de kaarten die je in de volgende beurten wilt trekken.'
    })}
    <div class="tools-page">
      <p class="tools-explanation">Vul het aantal kaarten in waaruit je daadwerkelijk trekt, dus zonder kaarten in de command zone of sideboard. De berekeningen gaan uit van willekeurig trekken zonder terugleggen en zonder mulligans. Resultaten worden direct bijgewerkt.</p>
      <div class="tools-calculators">${calculators.map(calculatorHtml).join('')}</div>
      <p class="tools-reference">Dezelfde soorten berekeningen als de <a href="https://www.mtgnexus.com/tools/drawodds/" target="_blank" rel="noopener noreferrer">Draw Odds Calculator van MTGNexus</a>.</p>
    </div>`,
    mount() {
      const cleanups = calculators.map(mountCalculator);
      return () => cleanups.forEach((cleanup) => cleanup());
    }
  };
}
