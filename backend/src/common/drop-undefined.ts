const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/**
 * A copy of `value` without keys whose value is `undefined`, at any depth. MongoDB stores an explicit `undefined`
 * in a free-form field as `null`, which then reads back as a value ("no percentage" becomes a percentage of null).
 * Dates, ObjectIds and other class instances are kept as they are.
 */
export function dropUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => dropUndefined(item)) as unknown as T;
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, dropUndefined(v)])) as T;
  }
  return value;
}
