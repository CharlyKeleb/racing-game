/** 1 → "1ST", 2 → "2ND", 11 → "11TH": a race place as shown on the finish. */
export function ordinal(n: number): string {
  const tens = n % 100
  const suffix = tens >= 11 && tens <= 13 ? 'TH' : (['TH', 'ST', 'ND', 'RD'][n % 10] ?? 'TH')
  return `${n}${suffix}`
}
