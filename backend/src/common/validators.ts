import { isURL, ValidateBy, ValidationOptions } from 'class-validator';

const URL_OPTIONS = { protocols: ['http', 'https'], require_protocol: false, require_tld: false };
// isURL reads `javascript:1` as host "javascript" and port 1, so these schemes are refused by name as well.
const SCRIPT_SCHEME = /^\s*(javascript|vbscript|data|file):/i;

/**
 * A link shown to visitors (website, order link, logo): an http(s) URL, or one without a scheme, never
 * `javascript:` and the like. An empty string is allowed, since forms send one for a field left blank.
 */
export function IsWebUrl(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isWebUrl',
      validator: {
        validate: (value: unknown) =>
          value === '' ||
          (typeof value === 'string' && value.length <= 2048 && !SCRIPT_SCHEME.test(value) && isURL(value, URL_OPTIONS)),
        defaultMessage: () => '$property must be a web address (http or https)',
      },
    },
    options,
  );
}
