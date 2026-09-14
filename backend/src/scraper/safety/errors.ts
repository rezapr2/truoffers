// Permanent: the request must not be made (policy). Retrying cannot help.
export class FetchDeniedError extends Error {
  readonly retryable = false;
  constructor(
    readonly code:
      | 'never_crawl'
      | 'blocked_address'
      | 'port_not_allowed'
      | 'too_many_redirects'
      | 'invalid_url'
      | 'gate',
    message: string,
  ) {
    super(message);
    this.name = 'FetchDeniedError';
  }
}

// The request was made but failed. Network-level failures are retryable; limit breaches are not.
export class FetchFailedError extends Error {
  constructor(
    readonly code:
      | 'dns'
      | 'connection'
      | 'timeout'
      | 'too_large'
      | 'decompression_ratio'
      | 'unsupported_encoding'
      | 'bad_encoding'
      | 'content_type'
      | 'http_status',
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'FetchFailedError';
  }
}

// Cancelled by the caller (run cancelled or emergency stop). Not a failure of the site.
export class FetchAbortedError extends Error {
  readonly retryable = false;
  constructor(message = 'Request aborted') {
    super(message);
    this.name = 'FetchAbortedError';
  }
}
