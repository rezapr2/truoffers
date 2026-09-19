import { deflateSync } from 'node:zlib';

// A fictional Foodhub store and menu, shaped like what a Foodhub site's app loads in the browser.
const EVERY_DAY = { monday: 1, tuesday: 1, wednesday: 1, thursday: 1, friday: 1, saturday: 1, sunday: 1 };
const AVAILABLE = { show_online: 1, collection: 1, delivery: 1, ...EVERY_DAY };

const item = (id: number, name: string, description: string, price: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  description,
  price,
  offer: 'NONE',
  ...AVAILABLE,
  ...extra,
});
const category = (id: number, name: string, items: ReturnType<typeof item>[], extra: Record<string, unknown> = {}) => ({
  id,
  name,
  hidden: '0',
  ...AVAILABLE,
  ...extra,
  subcat: [{ id: id * 10, name, ...AVAILABLE, ...extra, item: items }],
});

export const FOODHUB_MENU = [
  category(1, 'Pizzas', [item(11, 'Margherita', 'Tomato and mozzarella', '8.99')]),
  category(2, 'Anytime Offers', [
    item(21, 'Meal Deal 1', 'Any 10" Pizza, Fries & Can of Drink', '11.99'),
    item(22, 'Weekday Saver', 'Any 12" Pizza', '8.99', { saturday: 0, sunday: 0 }),
    item(23, 'Old Deal', 'Any 16" Pizza', '9.99', { show_online: 0 }),
  ]),
  category(3, 'Double Saver', [item(31, '10" Double Saver', 'Any 2 X 10" Pizzas', '15.99')]),
  category(4, 'Collection Offers', [item(41, 'Offer 1', 'Any 8" pizza', '4.99', { delivery: 0 })], { delivery: 0 }),
  category(5, 'Staff Deals', [item(51, 'Staff Deal', 'Any pizza and a drink', '5.00')], { hidden: '1' }),
];

export const FOODHUB_DISCOUNT = {
  value: 10,
  min_order: '15.00',
  service_type: 1,
  days: '1,2,3,4,5,6,7',
  type: 'PERCENTAGE',
  amount: '0.00',
  first_time_user: 'NO',
  start_date: null,
  end_date: null,
  menu_item_id: null,
  maximum_discount_value: '20.00',
};

// The menu as Foodhub serves it: zlib-compressed JSON, base64-encoded, inside { data: [...] }.
export const foodhubMenuResponse = (menu: unknown = FOODHUB_MENU) => ({ data: [deflateSync(Buffer.from(JSON.stringify(menu))).toString('base64')] });

export const foodhubStoreResponse = (discounts: unknown[] = [FOODHUB_DISCOUNT]) => ({
  id: 9002,
  name: 'Marco Pizza (fictional)',
  offer_status: 'INACTIVE',
  advanced_discounts: discounts,
});
