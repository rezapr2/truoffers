export default function Loading() {
  return (
    <div className="py-32 flex flex-col items-center gap-4">
      <div className="w-10 h-10 border-[3px] border-line border-t-primary rounded-full animate-spin" />
      <span className="text-sm font-bold text-muted">Loading…</span>
    </div>
  );
}
