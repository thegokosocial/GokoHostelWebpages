/** Keep number inputs as text while editing; normalize only at a calculation/save boundary. */
export function numericDraftValue(value: string, emptyValue = 0): number {
  if (value.trim() === "") return emptyValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : emptyValue;
}
