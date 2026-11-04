// Display names for parties. A reservation in the fixtures has only an id ("F12"), so the screen shows a
// fictional guest name derived from that id; a request shows its contact's surname. Ids stay the internal keys.
import requestsJson from "../../../fixtures/requests/requests.json";

const SURNAMES = [
  "Alvarez",
  "Brennan",
  "Castillo",
  "Dubois",
  "Eriksen",
  "Fontaine",
  "Gallagher",
  "Herrera",
  "Ibarra",
  "Jensen",
  "Kowalski",
  "Lindqvist",
  "Moreau",
  "Nakamura",
  "Oduya",
  "Petrov",
  "Quinlan",
  "Rossi",
  "Sandoval",
  "Tanaka",
  "Ueda",
  "Varga",
  "Wexler",
  "Xiong",
  "Yilmaz",
  "Zamora",
  "Abbott",
  "Bianchi",
  "Cho",
  "Delgado",
  "Esposito",
  "Farrell",
  "Greco",
  "Hale",
  "Iqbal",
  "Jovanovic",
  "Kerr",
  "Lam",
  "Mendes",
  "Novak",
  "O'Neill",
  "Park",
  "Quiroga",
  "Reyes",
  "Sato",
  "Thorne",
  "Underwood",
  "Vance",
  "Walsh",
  "Young",
  "Adeyemi",
  "Byrne",
  "Costa",
  "Diaz",
  "Engel",
  "Fischer",
  "Grant",
  "Holm",
  "Ito",
  "Keane",
] as const;
const INITIALS = "ABCDEGHJKLMNPRSTW";

/** Letters the fixtures use for reservation ids, one per night ("F" = Friday's book…). */
const PREFIXES = "DEFHNPRQ";
/** Small bookings use a lower-case letter; it maps to its night's large-party letter (Thursday: "t" → "E"). */
const NIGHT_OF: Record<string, string> = { d: "D", e: "E", f: "F", h: "H", p: "P", r: "R", t: "E" };

interface RequestContact {
  id: string;
  contact: string;
}
const CONTACTS = new Map(
  (requestsJson as { requests: RequestContact[] }).requests.map((r) => [r.id, r.contact]),
);

/** "Sam Whitaker" → "Whitaker"; a contact that isn't a person's name ("free dinner") is kept whole. */
export function surname(contact: string): string {
  const last = contact.trim().split(/\s+/).pop() ?? contact;
  return /^[A-Z]/.test(last) ? last : contact.trim();
}

/**
 * The name a manager reads for a party: a request id → its contact's surname ("Whitaker"); a reservation id →
 * a fictional "Alvarez, M." (stable per id, distinct within a night). Anything else passes through.
 */
export function partyName(id: string): string {
  const contact = CONTACTS.get(id);
  if (contact) return surname(contact);
  const m = /^([DEFHNPQRdefhpt])(\d{1,4})$/.exec(id);
  if (!m) return id;
  const [, letter, digits] = m as unknown as [string, string, string];
  // large parties use capitals (≤13 a night), small bookings lower case: lower case starts 15 names later
  const small = letter === letter.toLowerCase();
  const night = small ? (NIGHT_OF[letter] ?? letter.toUpperCase()) : letter;
  const offset = Math.max(0, PREFIXES.indexOf(night)) * 7 + (small ? 15 : 0);
  const n = Number(digits);
  const name = SURNAMES[(n - 1 + offset + SURNAMES.length) % SURNAMES.length] as string;
  const initial = INITIALS[(n * 5 + offset) % INITIALS.length] as string;
  return `${name}, ${initial}.`;
}

/** Party ids inside a display sentence ("Split P6's tables") → names ("Split Alvarez, M.'s tables"). */
export function namesIn(text: string): string {
  return text.replace(/\b([DEFHNPQRdefhpt]\d{1,4})\b/g, (id: string) => partyName(id));
}
