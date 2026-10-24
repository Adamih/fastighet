/** JSON storage for server results must preserve dates when a request is replayed. */
export function encodeSubmissionResult(value: unknown): string {
  return JSON.stringify({ value }, function (key, entry) {
    const original = this[key]
    return original instanceof Date ? { $submissionDate: original.toISOString() } : entry
  })
}

export function decodeSubmissionResult<T>(value: string): T {
  return JSON.parse(value, (_key, entry) =>
    typeof entry === 'object' && entry !== null && '$submissionDate' in entry
      ? new Date(entry.$submissionDate)
      : entry,
  ).value as T
}
