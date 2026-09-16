// Spec §3: Chromium is limited, identified and kept away from anything that isn't page content.
export const RENDER = {
  maxContexts: 2,
  navigationTimeoutMs: 30_000,
  settleMs: 1_500,
  // SCRAPER_RENDER_MEMORY_MB lowers the ceiling for tests; production keeps the spec's 512 MB.
  memoryCeilingMb: Number(process.env.SCRAPER_RENDER_MEMORY_MB ?? 512),
  memorySampleMs: 2_000,
  pagesPerRun: 3,
  // A site that answers with a challenge or login wall is left alone for a week.
  blockedBackoffHours: 7 * 24,
} as const;

// Never fetched while rendering: they cost memory and bandwidth and are never offer content.
export const BLOCKED_RESOURCE_TYPES = ['image', 'media', 'font', 'websocket', 'manifest'] as const;

// Analytics, advertising and tag managers. Matched on the registrable domain.
export const TRACKER_HOSTS = [
  'google-analytics.com',
  'googletagmanager.com',
  'googlesyndication.com',
  'googleadservices.com',
  'doubleclick.net',
  'facebook.net',
  'facebook.com',
  'connect.facebook.net',
  'hotjar.com',
  'hotjar.io',
  'clarity.ms',
  'segment.com',
  'segment.io',
  'mixpanel.com',
  'amplitude.com',
  'sentry.io',
  'intercom.io',
  'crisp.chat',
  'tawk.to',
  'newrelic.com',
  'nr-data.net',
  'optimizely.com',
  'criteo.com',
  'taboola.com',
  'outbrain.com',
  'hubspot.com',
  'hs-scripts.com',
  'tiktok.com',
  'snapchat.com',
  'bing.com',
  'clarity.microsoft.com',
];

// Text that means the page is a challenge, CAPTCHA or login wall rather than the takeaway's own content.
export const CHALLENGE_MARKERS = [
  /just a moment/i,
  /attention required/i,
  /checking your browser/i,
  /enable javascript and cookies to continue/i,
  /verify you are (?:a )?human/i,
  /cf-challenge|cf_chl_|turnstile/i,
  /g-recaptcha|recaptcha\/api|hcaptcha/i,
  /access denied/i,
  /are you a robot/i,
];

export const LOGIN_MARKERS = [/<input[^>]+type=["']password["']/i, /sign in to continue/i, /please log ?in to view/i];
