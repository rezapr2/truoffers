// Suppliers keep their own badge scheme until supplier plans arrive (phase 2).
const LABELS: Record<string, string> = {
  verified: 'verified',
  trusted_partner: 'trusted partner',
};

export default function SupplierBadge({ status, className = '' }: { status?: string; className?: string }) {
  if (!status || !LABELS[status]) return null;
  return <span className={`text-verified font-bold whitespace-nowrap ${className}`}>✓ {LABELS[status]}</span>;
}
