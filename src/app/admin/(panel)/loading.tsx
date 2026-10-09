import { SkeletonLine } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="grid gap-6">
      <p className="label m-0 cursor-blink">Loading from the database</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => <div key={i} className="panel p-4 grid gap-3"><SkeletonLine w="60%" h="0.8rem" /><SkeletonLine w="30%" h="1.8rem" /></div>)}
      </div>
      <div className="panel p-5 grid gap-3">{Array.from({ length: 5 }, (_, i) => <SkeletonLine key={i} />)}</div>
    </div>
  );
}
