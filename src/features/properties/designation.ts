// Fastighetsbeteckning: municipality and tract name(s) followed by block and unit, e.g.
// "Uppsala Kungsängen 12:3", or "s:2" for a joint property (samfällighet). Older designations
// without a block ("Ronneby Kalleberga 4") are accepted too.
const DESIGNATION = /^\p{L}[\p{L}\- ]*\s(?:(?:\d+|s):\d+|\d+)$/iu

export function normalizeDesignation(input: string): string {
  return input.trim().replace(/\s+/g, ' ')
}

export function isValidDesignation(input: string): boolean {
  return DESIGNATION.test(normalizeDesignation(input))
}
