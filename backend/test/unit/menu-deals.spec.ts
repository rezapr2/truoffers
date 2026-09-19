import { dealBenefitText, dealTitle, OFFER_CATEGORY } from '../../src/scraper/extraction/adapters/menu-deals';

describe('menu deals', () => {
  it.each([
    ['8" Double Saver', 'Any 2 X 8" Pizzas', 13.99, '2 for £13.99'],
    ['2 x Large Pizzas', '', 20, '2 for £20'],
    ['Meal Deal 3', 'Any 2 X 10" Pizzas, 2x Fries & 2x Cans of Drink', 19.99, 'Meal deal for £19.99'],
    ['Pizza Offer 1', 'Buy Any 16" Pizza & Get Any 8" Pizza', 20.99, 'Meal deal for £20.99'],
    ['Offer 1', 'Any 8" pizza', 5.99, 'Any 8" pizza only £5.99'],
    ['Large Doner', '', 7.5, 'Any Large Doner only £7.50'],
  ])('%s (%s) at £%s: %s', (name, description, price, expected) => {
    expect(dealBenefitText(name, description, price)).toBe(expected);
  });

  it('titles a deal with what the customer gets', () => {
    expect(dealTitle('Meal Deal 3', 'Any 2 X 10" Pizzas, 2x Fries')).toBe('Meal Deal 3: Any 2 X 10" Pizzas, 2x Fries');
    expect(dealTitle('Family Feast', '')).toBe('Family Feast');
    expect(dealTitle('Any 8" pizza', 'any 8" pizza')).toBe('Any 8" pizza');
  });

  it('recognises offer categories, not ordinary ones', () => {
    for (const name of ['Meal Deals', 'Collection Offers', 'Double Saver', 'Special Offer', 'Promotions']) expect(OFFER_CATEGORY.test(name)).toBe(true);
    for (const name of ['Pizzas', 'Chocolate Pizza Deal', 'Kebabs', 'Drinks']) expect(OFFER_CATEGORY.test(name)).toBe(false);
  });
});
