import {
  hostMatchesDomain,
  normaliseUrl,
  pageKey,
  parseCrawlUrl,
  registrableDomainOf,
  siteDomainOf,
  UrlRejectedError,
} from '../../../../src/scraper/safety/url';

describe('crawl URL rules', () => {
  it.each([
    ['ftp://pizza-palace.test/', 'protocol'],
    ['file:///etc/passwd', 'protocol'],
    ['javascript:alert(1)', 'protocol'],
    ['https://user:pass@pizza-palace.test/', 'credentials'],
    ['http://127.0.0.1/', 'ip_literal'],
    ['http://[::1]/', 'ip_literal'],
    ['http://2130706433/', 'ip_literal'],
    ['http://localhost:3000/', 'single_label'],
    ['not a url', 'invalid'],
  ])('rejects %s (%s)', (input, reason) => {
    expect(() => parseCrawlUrl(input)).toThrow(UrlRejectedError);
    try {
      parseCrawlUrl(input);
    } catch (err) {
      expect((err as UrlRejectedError).reason).toBe(reason);
    }
  });

  it('normalises tracking parameters, fragments and query order', () => {
    expect(
      normaliseUrl('HTTPS://Pizza-Palace.TEST:443/offers?utm_source=x&b=2&gclid=abc&a=1&fbclid=z#top'),
    ).toBe('https://pizza-palace.test/offers?a=1&b=2');
  });

  it('keeps meaningful parameters and default path', () => {
    expect(normaliseUrl('http://pizza-palace.test')).toBe('http://pizza-palace.test/');
    expect(normaliseUrl('http://pizza-palace.test:80/menu?page=2')).toBe('http://pizza-palace.test/menu?page=2');
  });

  it('resolves relative links against a base', () => {
    expect(normaliseUrl('../deals?utm_campaign=x', 'https://curry-house.test/menu/starters')).toBe(
      'https://curry-house.test/deals',
    );
  });

  it('treats www and bare hosts as one site', () => {
    expect(siteDomainOf('WWW.Bella.co.uk.')).toBe('bella.co.uk');
    expect(pageKey('http://www.bella.co.uk/offers#x')).toBe(pageKey('https://bella.co.uk/offers'));
  });

  it('derives registrable domains', () => {
    expect(registrableDomainOf('client.foodhub.co.uk')).toBe('foodhub.co.uk');
    expect(registrableDomainOf('www.pizza-palace.test')).toBe('pizza-palace.test');
  });

  it('matches subdomains on label boundaries only', () => {
    expect(hostMatchesDomain('order.bella.co.uk', 'bella.co.uk')).toBe(true);
    expect(hostMatchesDomain('bella.co.uk', 'bella.co.uk')).toBe(true);
    expect(hostMatchesDomain('notbella.co.uk', 'bella.co.uk')).toBe(false);
    expect(hostMatchesDomain('bella.co.uk', 'client.bella.co.uk')).toBe(false);
  });
});
