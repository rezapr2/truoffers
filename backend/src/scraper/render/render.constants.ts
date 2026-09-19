// Spec §3: Chromium is limited, identified and kept away from anything that isn't page content.
export const RENDER = {
  maxContexts: 2,
  navigationTimeoutMs: 30_000,
  // How long a page may keep loading after its HTML arrives. Most go quiet within a second; client-side
  // ordering apps can take 15 seconds or more to fetch their store and menu.
  settleMs: 20_000,
  // A page counts as loaded once nothing has been in flight for this long: apps often start fetching their
  // data a moment after the page itself goes quiet.
  quietMs: 3_000,
  // A platform app can spend 20 seconds or more loading its script bundles before it asks for its data. When the
  // adapter names that data (BuiltinAdapter.renderExpects), the page gets this long to load it...
  patientMs: 75_000,
  // ...but if the page goes quiet for this long without it, the data isn't coming.
  giveUpQuietMs: 10_000,
  // JSON the page's own scripts load from the website (a client-side app's store and menu), kept for the
  // adapters in memory only.
  maxDataResponses: 40,
  maxDataResponseBytes: 2 * 1024 * 1024,
  maxDataBytesPerPage: 8 * 1024 * 1024,
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
