/** Avatar initials: "Anna Svensson" → "AS", "Kaffe & Kaka AB" → "KK". */
export function initials(name: string): string {
  const words = name.split(/\s+/).filter((w) => /^\p{L}/u.test(w))
  return words
    .slice(0, 2)
    .map((w) => w[0]?.toLocaleUpperCase('sv-SE'))
    .join('')
}
