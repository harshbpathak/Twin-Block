// Personal-data guard. Runs on every user-typed field before anything is sent to Qloo.
// Twin Block only needs business names, places, cities and vibe words.
const RULES = [
  ['an email address', /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i],
  ['a social handle', /(^|\s)@[A-Za-z0-9_]{2,}/],
  ['an ID number', /\b\d{3}-\d{2}-\d{4}\b/],
  ['a card or account number', /\b(?:\d[ -]?){13,19}\b/],
  ['a phone number', /(?:\+?\d[\s().-]*){9,}/],
  ['personal details', /\b(my name is|date of birth|d\.o\.b|passport|social security|home address|customer list|my (wife|husband|son|daughter|mom|dad|customers?)\b)/i],
];

export class InputError extends Error {
  constructor(field, message) { super(message); this.field = field; this.status = 'needs_input'; }
}

export function findPersonalData(value) {
  for (const [label, re] of RULES) if (re.test(value)) return label;
  return null;
}

export function cleanText(field, value, { required = false, max = 120 } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new InputError(field, `Please fill in ${field}.`);
    return '';
  }
  if (typeof value !== 'string') throw new InputError(field, `${field} must be text.`);
  const text = value.replace(/\s+/g, ' ').trim();
  if (required && !text) throw new InputError(field, `Please fill in ${field}.`);
  if (text.length > max) throw new InputError(field, `${field} must be ${max} characters or fewer.`);
  if (/[\x00-\x1f<>]/.test(text)) throw new InputError(field, `${field} contains characters we can't use.`);
  const found = findPersonalData(text);
  if (found) throw new InputError(field, `${field} looks like it contains ${found}. Twin Block only needs business names, places and vibe words, so nothing personal is sent to Qloo.`);
  return text;
}
