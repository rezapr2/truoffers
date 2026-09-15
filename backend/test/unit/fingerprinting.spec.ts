import * as cheerio from 'cheerio';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { FingerprintMatchCategory, MarkerCategory } from '../../src/common/scraper.enums';
import { suggestFingerprint } from '../../src/scraper/fingerprinting/builder';
import { extractMarkers, markerKey, mergeMarkers, normaliseAssetPath, routePattern, SiteMarker, stableClass } from '../../src/scraper/fingerprinting/markers';
import { classRarity, ScoringFingerprint, ScoringMarker, scoreFingerprint } from '../../src/scraper/fingerprinting/scoring';

const SITES = path.join(__dirname, '..', 'fixtures', 'sites');

function markersOf(host: string, page = 'index.html'): SiteMarker[] {
  const html = readFileSync(path.join(SITES, host, page), 'utf8').replaceAll('{{origin}}', `http://${host}`);
  return extractMarkers({ $: cheerio.load(html), html, finalUrl: `http://${host}/` });
}

function siteMarkers(host: string): SiteMarker[] {
  return mergeMarkers(markersOf(host), ...(host.startsWith('panda') || host.startsWith('dragon') ? [] : [markersOf(host, 'offers.html')]));
}

const has = (markers: SiteMarker[], category: MarkerCategory, value: string) => markers.some((m) => m.category === category && m.value === value);

describe('marker extraction', () => {
  it('normalises bundle hashes, versions, routes and classes', () => {
    expect(normaliseAssetPath('/static/js/main.3f2a9c1b.js')).toBe('/static/js/main.*.js');
    expect(normaliseAssetPath('/themes/4.2.1/app.js')).toBe('/themes/*/app.js');
    expect(normaliseAssetPath('/assets/pp-bundle.91be3a7f.css')).toBe('/assets/pp-bundle.*.css');
    expect(routePattern('/menu/1234')).toBe('/menu/:n');
    expect(routePattern('/branches/leeds-city-centre')).toBe('/branches/:slug');
    expect(stableClass('sf-offer-card')).toBe('sf-offer-card');
    expect(stableClass('Header_title__3fA2b')).toBe('Header_title');
    for (const noise of ['css-1x2y3z', 'md:flex', 'px-4', 'flex', 'col-md-6', 'mt-3', 'jsx-238912']) {
      expect(stableClass(noise)).toBeNull();
    }
  });

  it('reads template traits, not content, from a page', () => {
    const markers = markersOf('saffron-spice.test');
    expect(has(markers, MarkerCategory.GENERATOR, 'saffron theme')).toBe(true);
    expect(has(markers, MarkerCategory.FOOTER_ATTRIBUTION, 'by saffron web studio')).toBe(true);
    expect(has(markers, MarkerCategory.STYLESHEET, '/assets/saffron/theme.*.css')).toBe(true);
    expect(has(markers, MarkerCategory.SCRIPT, '/assets/saffron/app.*.js')).toBe(true);
    expect(has(markers, MarkerCategory.ASSET_HOST, 'cdn.saffronweb.test')).toBe(true);
    expect(has(markers, MarkerCategory.CSS_CLASS, 'sf-header')).toBe(true);
    expect(has(markers, MarkerCategory.ROUTE_PATTERN, '/menu/starters')).toBe(true);
    expect(markers.some((m) => m.category === MarkerCategory.DOM_SKELETON && m.value.startsWith('header:'))).toBe(true);
    expect(markers.some((m) => m.category === MarkerCategory.JSONLD_SHAPE && m.value.startsWith('Restaurant{'))).toBe(true);
    // Business content is never a marker.
    expect(markers.some((m) => /saffron spice|0113/i.test(m.value))).toBe(false);
  });

  it('ignores shared public CDNs', () => {
    const html = '<html><head><script src="https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js"></script><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter"></head><body></body></html>';
    const markers = extractMarkers({ $: cheerio.load(html), html, finalUrl: 'https://example.test/' });
    expect(markers.filter((m) => [MarkerCategory.ASSET_HOST, MarkerCategory.SCRIPT, MarkerCategory.STYLESHEET].includes(m.category))).toEqual([]);
  });
});

// Three categories: generator and script always present, 80 class markers of which `k` are present.
// With category weights 10/10/80 the score is exactly 20 + k.
function boundaryFingerprint(extra: ScoringMarker[] = []): ScoringFingerprint {
  return {
    categoryWeights: { [MarkerCategory.GENERATOR]: 10, [MarkerCategory.SCRIPT]: 10, [MarkerCategory.CSS_CLASS]: 80 },
    markers: [
      { category: MarkerCategory.GENERATOR, value: 'saffron theme', required: true },
      { category: MarkerCategory.SCRIPT, value: '/assets/app.*.js' },
      ...Array.from({ length: 80 }, (_, i) => ({ category: MarkerCategory.CSS_CLASS, value: `sf-c${i}` })),
      ...extra,
    ],
  };
}

function siteWithClasses(k: number, extra: SiteMarker[] = []): SiteMarker[] {
  return [
    { category: MarkerCategory.GENERATOR, value: 'saffron theme' },
    { category: MarkerCategory.SCRIPT, value: '/assets/app.*.js' },
    ...Array.from({ length: k }, (_, i) => ({ category: MarkerCategory.CSS_CLASS, value: `sf-c${i}` })),
    ...extra,
  ];
}

describe('fingerprint scoring', () => {
  it.each([
    [34, 54, FingerprintMatchCategory.NONE],
    [35, 55, FingerprintMatchCategory.POSSIBLE],
    [59, 79, FingerprintMatchCategory.POSSIBLE],
    [60, 80, FingerprintMatchCategory.HIGH_CONFIDENCE],
    [74, 94, FingerprintMatchCategory.HIGH_CONFIDENCE],
    [75, 95, FingerprintMatchCategory.EXACT],
  ])('with %i of 80 classes the score is %i: %s', (k, score, category) => {
    const result = scoreFingerprint(boundaryFingerprint(), siteWithClasses(k));
    expect(result.score).toBe(score);
    expect(result.category).toBe(category);
  });

  it('needs every required marker for exact and high-confidence matches', () => {
    const fingerprint = boundaryFingerprint([{ category: MarkerCategory.CSS_CLASS, value: 'sf-required', required: true }]);
    const result = scoreFingerprint(fingerprint, siteWithClasses(80));
    expect(result.score).toBeGreaterThanOrEqual(95);
    expect(result.missingRequired).toEqual(['css_class|sf-required']);
    expect(result.category).toBe(FingerprintMatchCategory.POSSIBLE);
  });

  it('never matches a site carrying a negative marker', () => {
    const fingerprint = boundaryFingerprint([{ category: MarkerCategory.FRAMEWORK, value: 'wordpress', negative: true }]);
    const result = scoreFingerprint(fingerprint, siteWithClasses(80, [{ category: MarkerCategory.FRAMEWORK, value: 'wordpress' }]));
    expect(result.negativeHits).toEqual(['framework|wordpress']);
    expect(result.category).toBe(FingerprintMatchCategory.NONE);
  });

  it('caps evidence from one or two categories, so a shared CDN host alone never matches', () => {
    const fingerprint: ScoringFingerprint = {
      categoryWeights: { [MarkerCategory.ASSET_HOST]: 90, [MarkerCategory.GENERATOR]: 5, [MarkerCategory.CSS_CLASS]: 5 },
      markers: [
        { category: MarkerCategory.ASSET_HOST, value: 'cdn.saffronweb.test' },
        { category: MarkerCategory.GENERATOR, value: 'saffron theme' },
        { category: MarkerCategory.CSS_CLASS, value: 'sf-header' },
      ],
    };
    const oneCategory = scoreFingerprint(fingerprint, [{ category: MarkerCategory.ASSET_HOST, value: 'cdn.saffronweb.test' }]);
    expect(oneCategory.score).toBe(30);
    expect(oneCategory.category).toBe(FingerprintMatchCategory.NONE);
    const twoCategories = scoreFingerprint(fingerprint, [
      { category: MarkerCategory.ASSET_HOST, value: 'cdn.saffronweb.test' },
      { category: MarkerCategory.CSS_CLASS, value: 'sf-header' },
    ]);
    expect(twoCategories.score).toBe(54);
    expect(twoCategories.category).toBe(FingerprintMatchCategory.NONE);
  });

  it('weights rare classes above classes every site has', () => {
    const corpus = [
      [{ category: MarkerCategory.CSS_CLASS, value: 'menu' }, { category: MarkerCategory.CSS_CLASS, value: 'sf-offer-card' }],
      [{ category: MarkerCategory.CSS_CLASS, value: 'menu' }],
      [{ category: MarkerCategory.CSS_CLASS, value: 'menu' }],
    ];
    const weight = classRarity(corpus);
    expect(weight({ category: MarkerCategory.CSS_CLASS, value: 'sf-offer-card' })).toBeGreaterThan(weight({ category: MarkerCategory.CSS_CLASS, value: 'menu' }));
  });
});

describe('fingerprints built from fixture templates', () => {
  const saffron = suggestFingerprint([siteMarkers('saffron-spice.test'), siteMarkers('lotus-garden.test')]);

  it('suggests shared traits, with generator and attribution required', () => {
    const required = saffron.markers.filter((m) => m.required).map(markerKey);
    expect(required).toEqual(expect.arrayContaining(['generator|saffron theme', 'footer_attribution|by saffron web studio']));
    expect(saffron.markers.some((m) => m.category === MarkerCategory.CSS_CLASS && m.value === 'sf-offer-card')).toBe(true);
    expect(() => suggestFingerprint([siteMarkers('saffron-spice.test')])).toThrow(/at least two/);
  });

  it('matches a third site on the same template and rejects other templates and the near-miss decoy', () => {
    const third = scoreFingerprint(saffron, siteMarkers('kings-grill.test'));
    expect([FingerprintMatchCategory.EXACT, FingerprintMatchCategory.HIGH_CONFIDENCE]).toContain(third.category);

    const panda = scoreFingerprint(saffron, siteMarkers('panda-noodles.test'));
    expect(panda.category).toBe(FingerprintMatchCategory.NONE);

    const decoy = scoreFingerprint(saffron, siteMarkers('dragon-wok.test'));
    expect(decoy.score).toBeGreaterThan(panda.score);
    expect([FingerprintMatchCategory.NONE, FingerprintMatchCategory.POSSIBLE]).toContain(decoy.category);
    expect(decoy.missingRequired.length).toBeGreaterThan(0);

    const ordernest = scoreFingerprint(saffron, markersOf('ordernest-bella.test'));
    expect(ordernest.category).toBe(FingerprintMatchCategory.NONE);
  });

  it('turns other templates’ required traits into negative markers', () => {
    const pandaFingerprint = { markers: [{ category: MarkerCategory.GENERATOR, value: 'pixel panda builder', required: true }] };
    const suggestion = suggestFingerprint([siteMarkers('saffron-spice.test'), siteMarkers('lotus-garden.test')], [pandaFingerprint]);
    expect(suggestion.markers.filter((m) => m.negative).map(markerKey)).toEqual(['generator|pixel panda builder']);
    expect(scoreFingerprint(suggestion, siteMarkers('panda-noodles.test')).negativeHits).toEqual(['generator|pixel panda builder']);
  });
});
