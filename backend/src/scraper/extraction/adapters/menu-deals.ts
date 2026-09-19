import { collapse } from '../text';

// Menu categories that hold deals rather than ordinary dishes ("Meal Deals", "Collection Offers", "Double Saver").
export const OFFER_CATEGORY = /\b(special offers?|offers|deals|meal deals|promotions?|savers?)\b/i;
const BUNDLE = /\b(deal|special|family|treat|combo|meal|bundle|feast|box|platter)\b/i;
// Names that only number a deal ("Offer 1", "Pizza Deal 2A"); the description says what it is.
const NUMBERED = /^[a-z ]*\b(?:offer|deal)\s*\d+[a-z]?$/i;
const QUANTITY = /\b(\d)\s*x\b/i;

export const pounds = (price: number) => `£${Number.isInteger(price) ? price : price.toFixed(2)}`;

// "Any 2 x 10" Pizzas, 2x Fries & 2 Cans" has three parts; "Any 2 X 8" Pizzas" has one.
function parts(description: string): number {
  return description.split(/,|&|\+|\bwith\b|\band\b/i).filter((part) => part.trim()).length;
}

// "Meal Deal 3" or "8" Double Saver" alone doesn't say what the customer gets; the menu's description does.
export function dealTitle(rawName: string, rawDescription: string): string {
  const name = collapse(rawName);
  const description = collapse(rawDescription);
  return description && !name.toLowerCase().includes(description.toLowerCase()) ? `${name}: ${description}` : name;
}

/**
 * The benefit of a deal that a menu states only as a price: a multi-buy ("Any 2 x 8" Pizzas" for £13.99), a
 * bundle ("Meal Deal 3"), or a single item at a deal price ("Any 8" pizza" for £5.99).
 */
export function dealBenefitText(rawName: string, rawDescription: string, price: number): string {
  const name = collapse(rawName);
  const description = collapse(rawDescription);
  const quantity = QUANTITY.exec(name)?.[1] ?? (parts(description) === 1 ? QUANTITY.exec(description)?.[1] : undefined);
  if (quantity && Number(quantity) >= 2) return `${quantity} for ${pounds(price)}`;
  if (BUNDLE.test(name) || parts(description) >= 2) return `Meal deal for ${pounds(price)}`;
  const subject = NUMBERED.test(name) && description ? description : name;
  return `${/^(any|all|every)\b/i.test(subject) ? '' : 'Any '}${subject} only ${pounds(price)}`;
}
