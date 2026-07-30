// Matches ServiceRow.tsx's real markup dimension-for-dimension,
// including a block sized to match where UptimeBars sits once real
// history loads in.
export default function SkeletonServiceRow() {
  return (
    <div className="py-4 border-b border-zinc-800 last:border-0 animate-pulse">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <div className="h-4 w-28 bg-zinc-800 rounded" />
            <div className="h-3 w-20 bg-zinc-800 rounded" />
          </div>
          <div className="flex gap-4">
            <div className="h-3 w-16 bg-zinc-800 rounded" />
            <div className="h-3 w-16 bg-zinc-800 rounded" />
          </div>
        </div>
        <div className="shrink-0">
          <div className="h-6 w-24 bg-zinc-800 rounded-full" />
        </div>
      </div>
      <div className="mt-3">
        <div className="h-8 bg-zinc-800 rounded-sm" />
        <div className="flex justify-between mt-1.5">
          <div className="h-3 w-16 bg-zinc-800 rounded" />
          <div className="h-3 w-20 bg-zinc-800 rounded" />
          <div className="h-3 w-12 bg-zinc-800 rounded" />
        </div>
      </div>
    </div>
  )
}