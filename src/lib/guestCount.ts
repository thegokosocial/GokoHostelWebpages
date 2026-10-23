export function guestCount(value: unknown): number {
  const persons = Number(value);
  return Number.isInteger(persons) && persons > 0 ? persons : 1;
}
