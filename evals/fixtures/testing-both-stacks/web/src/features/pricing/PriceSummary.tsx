export interface PriceLine {
  sku: string;
  quantity: number;
  unitPrice: number;
}

export const MAX_DISCOUNT_RATE = 0.3;
export const GST_RATE = 0.1;

export function discountRate(loyaltyYears: number): number {
  if (loyaltyYears <= 0) {
    return 0;
  }
  return Math.min(loyaltyYears * 0.05, MAX_DISCOUNT_RATE);
}

export function subtotalOf(lines: PriceLine[]): number {
  return lines.reduce((total, line) => total + line.quantity * line.unitPrice, 0);
}

export function PriceSummary({
  lines,
  loyaltyYears,
}: {
  lines: PriceLine[];
  loyaltyYears: number;
}) {
  const subtotal = subtotalOf(lines);
  const discount = subtotal * discountRate(loyaltyYears);
  const taxed = (subtotal - discount) * (1 + GST_RATE);

  return (
    <dl>
      <dt>Subtotal</dt>
      <dd data-testid="subtotal">{subtotal.toFixed(2)}</dd>
      <dt>Discount</dt>
      <dd data-testid="discount">{discount.toFixed(2)}</dd>
      <dt>Total</dt>
      <dd data-testid="total">{taxed.toFixed(2)}</dd>
    </dl>
  );
}
