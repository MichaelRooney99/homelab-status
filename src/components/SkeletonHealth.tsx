// Matches OverallHealth.tsx's real markup dimension-for-dimension —
// the whole point of a skeleton is zero layout shift when real data
// replaces it, not just "some gray boxes." Uses the theme-aware
// capstone-* tokens rather than static zinc-* classes, so the loading
// state doesn't look broken if someone reloads with light theme active.
export default function SkeletonHealth() {
  return (
    <div className="rounded-lg border border-capstone-border bg-capstone-bg-raised overflow-hidden animate-pulse">
      <div className="h-1.5 w-full bg-capstone-subtle" aria-hidden="true" />
      <div className="px-6 py-5 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="h-6 w-24 bg-capstone-subtle rounded-full" />
          <div className="h-4 w-40 bg-capstone-subtle rounded" />
        </div>
        <div className="flex items-center gap-6">
          <div className="h-3 w-28 bg-capstone-subtle rounded" />
          <div className="h-3 w-24 bg-capstone-subtle rounded" />
        </div>
      </div>
    </div>
  )
}