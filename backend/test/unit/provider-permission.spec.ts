import { ProviderPolicyStatus } from '../../src/common/scraper.enums';
import { providerPermitsCrawling } from '../../src/scraper/safety/provider-permission';

describe('providerPermitsCrawling', () => {
  it.each([
    [ProviderPolicyStatus.ALLOWED, false, true],
    [ProviderPolicyStatus.ALLOWED, true, true],
    [ProviderPolicyStatus.UNKNOWN, false, true],
    [ProviderPolicyStatus.UNKNOWN, true, false],
    [ProviderPolicyStatus.BLOCKED, false, false],
    [ProviderPolicyStatus.BLOCKED, true, false],
    [undefined, false, true],
    [undefined, true, false],
  ])('%s with review required %s: %s', (status, reviewRequired, permitted) => {
    expect(providerPermitsCrawling(status, reviewRequired)).toBe(permitted);
  });
});
