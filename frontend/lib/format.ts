const UK = 'Europe/London';

export function money(value: number | undefined | null, options: { pence?: boolean } = {}): string {
  const n = value ?? 0;
  return `£${n.toLocaleString('en-GB', { minimumFractionDigits: options.pence === false && Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export function date(value: string | Date | undefined | null, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-GB', { timeZone: UK, ...options });
}

export function dateTime(value: string | Date | undefined | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-GB', { timeZone: UK, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** "5 minutes ago", "3 hours ago", "2 days ago". */
export function timeAgo(value: string | Date | undefined | null): string {
  if (!value) return '—';
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 0) return 'just now';
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} days ago`;
}

/** "26 h" / "3 d" for queue ages. */
export function age(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return '—';
  if (hours < 1) return '<1 h';
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

export function humanise(value: string | undefined | null): string {
  if (!value) return '';
  const text = value.replace(/[_.]/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function plural(n: number, word: string, many = `${word}s`): string {
  return `${n} ${n === 1 ? word : many}`;
}
