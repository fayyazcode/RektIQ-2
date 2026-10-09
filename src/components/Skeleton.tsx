export function SkeletonLine({ w = "100%", h = "1rem" }: { w?: string; h?: string }) {
  return <div className="rounded bg-panel-2 animate-pulse motion-reduce:animate-none" style={{ width: w, height: h }} />;
}

export function StoryListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="py-4 border-b border-line last:border-0 grid gap-2">
          <SkeletonLine w="30%" h="0.8rem" />
          <SkeletonLine w={`${70 + ((i * 13) % 25)}%`} h="1.2rem" />
          <SkeletonLine w="85%" h="0.8rem" />
        </div>
      ))}
    </div>
  );
}
