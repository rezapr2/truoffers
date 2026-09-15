// Offers start and end on UK calendar days, so dates are shown in UK time wherever the viewer is.
const UK = 'Europe/London';

export function ukDate(value: string | Date, options: Intl.DateTimeFormatOptions = {}): string {
  return new Date(value).toLocaleDateString('en-GB', { timeZone: UK, ...options });
}

// The UK calendar day of a timestamp, as YYYY-MM-DD for <input type="date">.
export function ukDateInputValue(value: string | Date): string {
  return new Date(value).toLocaleDateString('en-CA', { timeZone: UK });
}

// "Ends Friday" within the coming week, "Ends 31 Dec" further out.
export function endsLabel(endsAt: string | Date, now = new Date()): string {
  const days = (new Date(endsAt).getTime() - now.getTime()) / 86_400_000;
  return days < 6 ? `Ends ${ukDate(endsAt, { weekday: 'long' })}` : `Ends ${ukDate(endsAt, { day: 'numeric', month: 'short' })}`;
}

// A calendar day stored as YYYY-MM-DD, formatted without any timezone shift.
export function calendarDate(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}/${month}/${year}`;
}
