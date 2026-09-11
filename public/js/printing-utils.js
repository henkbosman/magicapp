import { escapeHtml } from './utils.js';

const LANGUAGE_LABELS = {
  en: 'Engels', nl: 'Nederlands', de: 'Duits', fr: 'Frans', es: 'Spaans', it: 'Italiaans',
  pt: 'Portugees', ja: 'Japans', ko: 'Koreaans', ru: 'Russisch', zhs: 'Chinees (vereenvoudigd)',
  zht: 'Chinees (traditioneel)', he: 'Hebreeuws', la: 'Latijn', grc: 'Oudgrieks', ar: 'Arabisch',
  sa: 'Sanskriet', ph: 'Phyrexiaans', qya: 'Quenya'
};

const FINISH_LABELS = {
  nonfoil: 'Non-foil',
  foil: 'Foil',
  etched: 'Etched foil'
};

export function languageLabel(language) {
  const code = String(language || 'en').toLowerCase();
  return LANGUAGE_LABELS[code] || code.toUpperCase();
}

export function finishLabel(finish) {
  return FINISH_LABELS[finish] || String(finish || '');
}

export function printingVariants(printing, card = null) {
  if (printing?.variants?.length) return printing.variants;
  if (!card) return [];
  return [{
    language: card.language || 'en',
    scryfallId: card.scryfallId,
    cardId: card.id || null,
    finishes: card.finishes?.length ? card.finishes : ['nonfoil'],
    prices: card.prices || {},
    image: card.images?.small || card.images?.normal || null,
    imageNormal: card.images?.normal || card.images?.small || null,
    cached: Boolean(card.id)
  }];
}

export function variantForLanguage(printing, language, card = null) {
  const variants = printingVariants(printing, card);
  return variants.find((variant) => variant.language === language)
    || variants.find((variant) => variant.language === 'en')
    || variants[0]
    || null;
}

export function defaultLanguage(printing, card = null) {
  const variants = printingVariants(printing, card);
  const preferred = card?.language && variants.find((variant) => variant.language === card.language);
  return preferred?.language || variants.find((variant) => variant.language === 'en')?.language || variants[0]?.language || 'en';
}

export function languageOptions(printing, selectedLanguage, card = null) {
  const variants = printingVariants(printing, card);
  const languages = variants.length ? variants.map((variant) => variant.language) : [selectedLanguage || card?.language || 'en'];
  return [...new Set(languages)].map((language) =>
    `<option value="${escapeHtml(language)}" ${language === selectedLanguage ? 'selected' : ''}>${escapeHtml(languageLabel(language))}</option>`
  ).join('');
}

export function finishOptions(finishes, selectedFinish = '') {
  const available = finishes?.length ? [...new Set(finishes)] : ['nonfoil'];
  const selected = available.includes(selectedFinish)
    ? selectedFinish
    : (available.includes('nonfoil') ? 'nonfoil' : available[0]);
  return available.map((finish) =>
    `<option value="${escapeHtml(finish)}" ${finish === selected ? 'selected' : ''}>${escapeHtml(finishLabel(finish))}</option>`
  ).join('');
}

export function findPrintingForCard(printings, card) {
  return (printings || []).find((printing) =>
    String(printing.setCode || '').toLowerCase() === String(card.setCode || '').toLowerCase()
    && String(printing.collectorNumber || '') === String(card.collectorNumber || '')
  ) || null;
}
