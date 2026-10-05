export default function Loading() {
  return (
    <div aria-busy="true" aria-label="読み込み中" className="animate-pulse space-y-3">
      <div className="h-8 w-48 rounded bg-slate-200" />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (<div key={i} className="h-20 rounded-xl bg-slate-200" />))}
      </div>
      <div className="h-40 rounded-xl bg-slate-200" />
    </div>
  );
}
