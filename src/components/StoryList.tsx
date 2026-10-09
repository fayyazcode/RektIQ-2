import Link from "next/link";
import type { StoryView } from "@/lib/types";
import { CATEGORY_LABELS } from "@/lib/normalize/categories";
import { getFeedSourceById } from "@/lib/feeds/registry";
import SourceGlyph from "./SourceGlyph";
import Time from "./Time";

export async function StoryRow({ story, showSummary = true }: { story: StoryView; showSummary?: boolean }) {
  const multi = story.sources.length > 1;
  const sourceNames = await Promise.all(story.sources.map(async (id) => (await getFeedSourceById(id))?.name ?? id));
  return (
    <article className="story-row grid gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted font-mono">
        <Time iso={story.lastPublishedAt} mode="time" />
        {story.sources.slice(0, 3).map((s) => (
          <SourceGlyph key={s} source={s} withName={!multi} />
        ))}
        {multi && (
          <span className="text-amber" title={sourceNames.join(", ")}>
            {story.sources.length} newsrooms
          </span>
        )}
      </div>
      <h3 className="text-lg leading-snug m-0">
        <Link href={`/story/${story.slug}`} className="story-title">
          {story.title}
        </Link>
      </h3>
      {showSummary && (story.aiSummary?.whatHappened || story.summary) && (
        <p className="m-0 text-muted text-[0.95rem] leading-relaxed line-clamp-3 max-w-[70ch]">{story.aiSummary?.whatHappened ?? story.summary}</p>
      )}
      {story.categories.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {story.categories.slice(0, 3).map((c) => (
            <Link key={c} href={`/category/${c}`} className="chip-link">
              {CATEGORY_LABELS[c]}
            </Link>
          ))}
        </div>
      )}
    </article>
  );
}

export default async function StoryList({ stories, empty }: { stories: StoryView[]; empty?: React.ReactNode }) {
  if (!stories.length) return <div className="py-10 text-muted">{empty ?? "No stories match yet."}</div>;
  return (
    <div>
      {stories.map((s) => (
        <StoryRow key={s.id} story={s} />
      ))}
    </div>
  );
}
