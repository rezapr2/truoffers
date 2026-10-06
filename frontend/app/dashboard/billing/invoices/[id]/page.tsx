'use client';

import { use } from 'react';
import { useBusiness } from '@/lib/business-context';
import { useApi } from '@/lib/hooks';
import { date, money } from '@/lib/format';
import type { Payment } from '@/lib/types';
import { btn, Spinner } from '@/components/ui';

interface Invoice {
  payment: Payment;
  business: { name: string; address?: string; town?: string; postcode?: string };
  seller: { name: string; email?: string; address?: string };
}

/** A printable invoice for payments without a Stripe PDF (demo mode). */
export default function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { business } = useBusiness();
  const { data } = useApi<Invoice>(business ? `/businesses/${business._id}/billing/invoices/${id}` : null);
  if (!data) return <Spinner />;
  const { payment, business: to, seller } = data;
  return (
    <div className="px-5 md:px-10 py-8 max-w-3xl">
      <div className="flex justify-end mb-4 print:hidden">
        <button className={btn.secondary} onClick={() => window.print()}>
          Print or save as PDF
        </button>
      </div>
      <div className="bg-card border border-line rounded-3xl p-8 print:border-0 print:p-0">
        <div className="flex justify-between gap-6 flex-wrap mb-8">
          <div>
            <div className="font-display text-2xl font-extrabold text-primary">{seller.name}</div>
            {seller.address && <div className="text-sm text-muted whitespace-pre-line">{seller.address}</div>}
            {seller.email && <div className="text-sm text-muted">{seller.email}</div>}
          </div>
          <div className="text-right">
            <div className="font-display text-xl font-extrabold">Invoice</div>
            <div className="text-sm">{payment.number}</div>
            <div className="text-sm text-muted">{date(payment.paidAt ?? payment.createdAt)}</div>
          </div>
        </div>
        <div className="mb-8">
          <div className="text-[12px] font-extrabold uppercase text-muted">Billed to</div>
          <div className="font-bold">{to.name}</div>
          <div className="text-sm text-muted">{[to.address, to.town, to.postcode].filter(Boolean).join(', ')}</div>
        </div>
        <table className="w-full text-sm">
          <tbody>
            <tr className="border-b border-line">
              <td className="py-3">
                {payment.description}
                {payment.periodEnd && <div className="text-muted text-[12px]">Until {date(payment.periodEnd)}</div>}
              </td>
              <td className="py-3 text-right font-bold">{money(payment.amount)}</td>
            </tr>
            <tr>
              <td className="py-2 text-muted">VAT</td>
              <td className="py-2 text-right">{money(payment.vat)}</td>
            </tr>
            <tr className="border-t border-line">
              <td className="py-3 font-extrabold">Total</td>
              <td className="py-3 text-right font-extrabold">{money(payment.total)}</td>
            </tr>
            {payment.refundedAmount > 0 && (
              <tr>
                <td className="py-2 text-muted">Refunded</td>
                <td className="py-2 text-right">−{money(payment.refundedAmount)}</td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="text-[12px] text-muted mt-8">Status: {payment.status}{payment.mock ? ' · demo payment' : ''}</div>
      </div>
    </div>
  );
}
