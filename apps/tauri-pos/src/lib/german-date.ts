/**
 * german-date — robust conversion between the German date the operator types
 * (TT.MM.JJJJ, e.g. "15.06.1990") and the ISO `format: 'date'` the API enforces
 * (YYYY-MM-DD). The customer/KYC forms label the field "TT.MM.JJJJ" but sent the
 * raw string straight to the server, which rejected it with a cryptic AJV 400.
 * This is the single source of truth for that conversion.
 */

/**
 * Convert an operator-typed date to a canonical ISO `YYYY-MM-DD`, or `null` if
 * it is not a real calendar date. Accepts `.`, `/` or `-` separators and
 * single-digit day/month ("1.6.1990"). An already-ISO string passes through.
 */
export function germanDateToIso(raw: string): string | null {
  const s = (raw ?? '').trim();
  if (s === '') return null;

  // Already ISO (YYYY-MM-DD)?
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) {
    const [, y, m, d] = iso;
    return isRealDate(+y!, +m!, +d!) ? s : null;
  }

  // German TT.MM.JJJJ (tolerate / and - and single digits).
  const de = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(s);
  if (!de) return null;
  const day = +de[1]!;
  const month = +de[2]!;
  const year = +de[3]!;
  if (!isRealDate(year, month, day)) return null;
  return `${year.toString().padStart(4, '0')}-${month
    .toString()
    .padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

/** ISO `YYYY-MM-DD` → display `TT.MM.JJJJ`. Empty/invalid → "". */
export function isoToGermanDate(iso: string | null | undefined): string {
  const s = (iso ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return '';
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/** True iff (year, month, day) is a real calendar date (rejects 31.02, month 13, …). */
function isRealDate(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2200) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const dim = [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= dim[month - 1]!;
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}
