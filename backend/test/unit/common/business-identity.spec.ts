import {
  canonicalUkPostcode,
  deriveBusinessIdentity,
  normaliseBusinessName,
  normaliseUkPhone,
  normaliseWebsiteHost,
} from '../../../src/common/business-identity';

describe('business identity normalisation', () => {
  it.each([
    ['0113 496 0101', '+441134960101'],
    ['+44 (0)113 496 0101', '+441134960101'],
    ['0044 113 496 0101', '+441134960101'],
    ['020 7946 0958', '+442079460958'],
  ])('normalises phone %s to E.164', (raw, expected) => {
    expect(normaliseUkPhone(raw)).toBe(expected);
  });

  // 07700 900xxx is Ofcom's reserved drama range for mobiles: not a diallable number.
  it.each(['call us', '123', '', undefined, '07700 900123'])('rejects invalid phone %p', (raw) => {
    expect(normaliseUkPhone(raw)).toBeNull();
  });

  it.each([
    ['ls11aa', 'LS1 1AA'],
    ['M14 5TQ', 'M14 5TQ'],
    ['sw1a  1aa', 'SW1A 1AA'],
    ['ec1a1bb', 'EC1A 1BB'],
    ['gir0aa', 'GIR 0AA'],
  ])('canonicalises postcode %s', (raw, expected) => {
    expect(canonicalUkPostcode(raw)).toBe(expected);
  });

  it.each(['not a postcode', 'LS1', '12345'])('rejects non-postcode %s', (raw) => {
    expect(canonicalUkPostcode(raw)).toBeNull();
  });

  it.each([
    ['Bella Napoli Ltd.', 'bella napoli'],
    ["Domino's Pizza", 'dominos pizza'],
    ['Café Rouge & Co', 'cafe rouge'],
    ['ACME CO. LTD', 'acme'],
    ['The Curry House Limited', 'the curry house'],
    ['Kebab King LLP', 'kebab king'],
  ])('normalises name %s', (raw, expected) => {
    expect(normaliseBusinessName(raw)).toBe(expected);
  });

  it.each([
    ['https://www.BellaNapoli.co.uk/menu', 'bellanapoli.co.uk'],
    ['bellanapoli.co.uk', 'bellanapoli.co.uk'],
    ['http://order.pizza-palace.test:8080/x', 'order.pizza-palace.test'],
    ['localhost', null],
    ['ftp://files.example.com', null],
    ['', null],
  ])('normalises website %s to host %p', (raw, expected) => {
    expect(normaliseWebsiteHost(raw)).toBe(expected);
  });

  it('derives every identity field at once', () => {
    expect(
      deriveBusinessIdentity({
        name: 'Bella Napoli Ltd',
        phone: '0113 496 0101',
        postcode: 'ls11aa',
        website: 'https://www.bellanapoli.co.uk',
      }),
    ).toEqual({
      nameNormalized: 'bella napoli',
      phoneE164: '+441134960101',
      postcodeCanonical: 'LS1 1AA',
      websiteHost: 'bellanapoli.co.uk',
    });
  });
});
