// Matches OverallHealth.tsx's real markup dimension-for-dimension —
// the whole point of a skeleton is zero layout shift when real data
// replaces it, not just "some gray boxes."
export default function SkeletonHealth() {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 overflow-hidden animate-pulse">
      <div className="h-1.5 w-full bg-zinc-800" aria-hidden="true" />
      <div className="px-6 py-5 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="h-6 w-24 bg-zinc-800 rounded-full" />
          <div className="h-4 w-40 bg-zinc-800 rounded" />
        </div>
        <div className="flex items-center gap-6">
          <div className="h-3 w-28 bg-zinc-800 rounded" />
          <div className="h-3 w-24 bg-zinc-800 rounded" />
        </div>
      </div>
    </div>
  )
}