const LABELS: Record<string, string> = {
  verified: 'verified',
  foodbell_verified: 'Foodbell verified',
  trusted_partner: 'trusted partner',
  franchise_verified: 'franchise verified',
};

export default function VerifiedBadge({
  status,
  className = '',
}: {
  status?: string;
  className?: string;
}) {
  if (!status || !LABELS[status]) return null;
  return (
    <span className={`text-verified font-bold whitespace-nowrap ${className}`}>
      ✓ {LABELS[status]}
    </span>
  );
}
