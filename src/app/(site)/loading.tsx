import { SkeletonLine, StoryListSkeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <div role="status" aria-label="Loading stories">
      <p className="label mb-6 cursor-blink">Loading</p>
      <div className="panel p-6 md:p-8 mb-8 grid gap-4">
        <SkeletonLine w="20%" h="0.9rem" />
        <SkeletonLine w="80%" h="2.2rem" />
        <SkeletonLine w="60%" h="2.2rem" />
        <SkeletonLine w="70%" h="1rem" />
      </div>
      <div className="panel px-5 py-2"><StoryListSkeleton /></div>
    </div>
  );
}
