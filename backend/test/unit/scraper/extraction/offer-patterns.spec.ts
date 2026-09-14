import {
  findBogof,
  findChannel,
  findDates,
  findFixedAmount,
  findFreeDelivery,
  findFreeItem,
  findMealDeal,
  findMinimumOrder,
  findMultiBuy,
  findNewCustomers,
  findPercentage,
  findPricePoint,
  findProducts,
  findPromoCode,
  findRequiredSpend,
  findTimeWindow,
  findWasNow,
  findWeekdays,
} from '../../../../src/scraper/extraction/offer-patterns';

// Monday, 14 September 2026, 11:00 in London.
const CHECKED_AT = new Date('2026-09-14T10:00:00Z');

describe('offer patterns', () => {
  describe('percentage discounts', () => {
    it.each([
      ['Get 20% off all orders', 20, false],
      ['15% discount on collection orders', 15, false],
      ['Save up to 30% this week', 30, true],
      ['Half price pizzas on Tuesdays', 50, false],
      ['Enjoy 12.5% off', 12.5, false],
    ])('%s', (text, percent, upTo) => {
      expect(findPercentage(text)?.value).toEqual({ percent, upTo });
    });

    it.each(['100% fresh ingredients', 'Beer 4.5% ABV', 'Prices include 20% VAT', 'Rated 98% by customers'])(
      'ignores %s',
      (text) => {
        expect(findPercentage(text)).toBeNull();
      },
    );
  });

  describe('fixed discounts', () => {
    it.each([
      ['£5 off your first order', 5],
      ['Save £3.50 when you spend £20', 3.5],
      ['Get £10 off orders over £40', 10],
    ])('%s', (text, amount) => {
      expect(findFixedAmount(text)?.value).toBe(amount);
    });

    it.each(['Orders over £15', 'Large Margherita £12.99', 'Spend £20 or more', 'Delivery charge £2.50'])('ignores %s', (text) => {
      expect(findFixedAmount(text)).toBeNull();
    });

    it('reads was/now pricing', () => {
      expect(findWasNow('Family box was £29.99, now only £22.99')?.value).toEqual({ original: 29.99, promotional: 22.99 });
      expect(findWasNow('was £9 now £10')).toBeNull();
    });
  });

  describe('buy-one-get-one and multi-buy', () => {
    it.each(['Buy one get one free on large pizzas', '2 for 1 Tuesdays', 'BOGOF on burgers', '2-4-1 on kebabs', '241 deal every Monday', 'Two for one wings'])(
      'recognises BOGOF in "%s"',
      (text) => {
        expect(findBogof(text)).not.toBeNull();
      },
    );

    it.each(['241 High Street, Leeds', 'Serves 2 for 10 minutes', '12 for 1 hour'])('does not see BOGOF in "%s"', (text) => {
      expect(findBogof(text)).toBeNull();
    });

    it.each([
      ['Buy 2 get 1 free on all sides', { buy: 2, free: 1 }],
      ['Any 2 large pizzas for £20', { quantity: 2, price: 20, product: 'large pizzas' }],
      ['3 for £10 on dips', { quantity: 3, price: 10, product: undefined }],
      ['Buy one get one half price', { buy: 1, secondItemPercent: 50 }],
    ])('%s', (text, expected) => {
      expect(findMultiBuy(text)?.value).toEqual(expected);
    });

    it('leaves plain BOGOF to the BOGOF detector', () => {
      expect(findMultiBuy('Buy one get one free')).toBeNull();
    });
  });

  describe('free items and free delivery', () => {
    it.each([
      ['Free garlic bread with every order over £20', 'garlic bread'],
      ['Get a free 1.5L bottle of Coke with any large pizza', '1.5L bottle of Coke'],
      ['Complimentary poppadoms on orders over £25', 'poppadoms'],
      ['Spend £30 and get a free portion of chips.', 'portion of chips'],
    ])('%s', (text, item) => {
      expect(findFreeItem(text)?.value).toBe(item);
    });

    it.each(['Gluten free bases available', 'Free delivery on orders over £20', 'Our sauces are free from nuts', 'Call free on 0800 123 456', 'Dairy-free options'])(
      'finds no free item in "%s"',
      (text) => {
        expect(findFreeItem(text)).toBeNull();
      },
    );

    it.each(['Free delivery on orders over £20', 'No delivery charge this weekend', 'Delivery is free after 9pm'])(
      'recognises free delivery in "%s"',
      (text) => {
        expect(findFreeDelivery(text)).not.toBeNull();
      },
    );

    it('does not mistake a delivery charge for free delivery', () => {
      expect(findFreeDelivery('Delivery charge £2.50')).toBeNull();
    });
  });

  describe('meal deals and price points', () => {
    it.each([
      ['Family Feast £34.99 – 2 large pizzas, 2 sides and a drink', 'Family Feast', 34.99],
      ['Meal deal: any burger, fries and a drink for £8.99', 'Meal deal', 8.99],
      ['Deal for two £22', 'Deal for two', 22],
    ])('%s', (text, name, price) => {
      expect(findMealDeal(text)?.value).toEqual({ name, price });
    });

    it.each([
      ['Any large pizza £9.99', 'large pizza', 9.99],
      ['All kebabs just £6 today', 'kebabs', 6],
    ])('%s', (text, product, price) => {
      expect(findPricePoint(text)?.value).toEqual({ product, price });
    });
  });

  describe('terms', () => {
    it.each([
      ['Collection only', 'collection'],
      ['10% off collection orders', 'collection'],
      ['Valid for delivery and collection', 'both'],
      ['Delivery orders only', 'delivery'],
    ])('channel in "%s"', (text, channel) => {
      expect(findChannel(text)?.value).toBe(channel);
    });

    it.each(['10% off your first online order', 'New customers only', 'Welcome offer for first-time customers'])(
      'new customers in "%s"',
      (text) => {
        expect(findNewCustomers(text)).not.toBeNull();
      },
    );

    it.each([
      ['on orders over £15', 15],
      ['Minimum order £12', 12],
      ['min. spend: £20', 20],
      ['on £25 or more', 25],
    ])('minimum order in "%s"', (text, value) => {
      expect(findMinimumOrder(text)?.value).toBe(value);
    });

    it('required spend', () => {
      expect(findRequiredSpend('Free dessert when you spend £30')?.value).toBe(30);
    });

    it.each([
      ['Use code PIZZA20 at checkout', 'PIZZA20'],
      ['Promo code: welcome10', 'WELCOME10'],
      ['Enter code SAVE at checkout', 'SAVE'],
      ['Quote “TRU15” when you call', 'TRU15'],
    ])('promo code in "%s"', (text, code) => {
      expect(findPromoCode(text)?.value).toBe(code);
    });

    it.each(['Use code at checkout', 'code: save', 'Enter your postcode LS1 1AA', 'Discount code applies'])('no promo code in "%s"', (text) => {
      expect(findPromoCode(text)).toBeNull();
    });
  });

  describe('weekdays and times', () => {
    it.each([
      ['Every Tuesday', ['tue']],
      ['Mon-Thu only', ['mon', 'tue', 'wed', 'thu']],
      ['Friday to Sunday', ['fri', 'sat', 'sun']],
      ['Tuesdays & Wednesdays', ['tue', 'wed']],
      ['Weekends only', ['sat', 'sun']],
      ['Weekdays 5pm-7pm', ['mon', 'tue', 'wed', 'thu', 'fri']],
      ['Sat - Mon', ['sat', 'sun', 'mon']],
      ['Valid Mon, Tue & Wed', ['mon', 'tue', 'wed']],
    ])('%s', (text, days) => {
      expect(findWeekdays(text)?.value).toEqual(days);
    });

    it.each(['Sun-dried tomato pizza', 'Our chefs sat down to create this'])('no weekdays in "%s"', (text) => {
      expect(findWeekdays(text)).toBeNull();
    });

    it.each([
      ['5-7pm', { start: '17:00', end: '19:00' }],
      ['from 5pm to 7pm', { start: '17:00', end: '19:00' }],
      ['12:00-15:00', { start: '12:00', end: '15:00' }],
      ['before 6pm', { end: '18:00' }],
      ['after 9pm', { start: '21:00' }],
      ['11am-2pm', { start: '11:00', end: '14:00' }],
      ['11-2pm', { start: '11:00', end: '14:00' }],
      ['12pm – 3pm', { start: '12:00', end: '15:00' }],
    ])('%s', (text, window) => {
      expect(findTimeWindow(text)?.value).toEqual(window);
    });

    it('ignores bare number ranges', () => {
      expect(findTimeWindow('Serves 5-7 people')).toBeNull();
    });
  });

  describe('dates (Europe/London, relative to the check date)', () => {
    const dates = (text: string) => {
      const found = findDates(text, CHECKED_AT);
      return { start: found.startDate?.value, end: found.endDate?.value, flags: found.flags };
    };

    it.each([
      ['Offer ends 31st October', undefined, '2026-10-31', ['year_inferred']],
      ['Valid until 31/12/2026', undefined, '2026-12-31', []],
      ['Valid from 1 October 2026 until 31 October 2026', '2026-10-01', '2026-10-31', []],
      ['1st - 14th February', '2027-02-01', '2027-02-14', ['year_inferred']],
      ['Throughout November', '2026-11-01', '2026-11-30', ['year_inferred']],
      ['Ends Sunday', undefined, '2026-09-20', ['relative_date']],
      ['Today only!', '2026-09-14', '2026-09-14', ['relative_date']],
      ['Offer ended 31 March 2025', undefined, '2025-03-31', []],
      ['Until October 5th', undefined, '2026-10-05', ['year_inferred']],
      ['Expires 2026-11-30', undefined, '2026-11-30', []],
    ])('%s', (text, start, end, flags) => {
      expect(dates(text)).toEqual({ start, end, flags });
    });

    it('flags dates it cannot place', () => {
      expect(dates('Updated 3 September')).toEqual({ start: undefined, end: undefined, flags: ['unlabelled_date'] });
    });

    it('notices references to past years, but not founding dates', () => {
      expect(findDates('Christmas 2024 menu deal', CHECKED_AT).oldYearReference?.value).toBe(2024);
      expect(findDates('Family run since 2019', CHECKED_AT).oldYearReference).toBeUndefined();
      expect(findDates('© 2023 Pizza Palace', CHECKED_AT).oldYearReference).toBeUndefined();
    });
  });

  describe('products', () => {
    it.each([
      ['2 for 1 on large pizzas every Tuesday', ['large pizzas']],
      ['Half price on all kebabs', ['kebabs']],
      ['20% off your order', null],
      ['10% off orders over £20', null],
    ])('%s', (text, products) => {
      expect(findProducts(text)?.value ?? null).toEqual(products);
    });
  });
});
