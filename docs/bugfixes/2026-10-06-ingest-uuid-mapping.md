# Critical Bug Fix: Ingest UUID Mapping Issue

**Date:** 2026-10-06  
**Severity:** Critical  
**Status:** Fixed  
**Affected File:** `src/lib/jobs/ingest.ts`

## Problem

The ingest job had a critical bug when working with post-migration data in PostgreSQL. The code was incorrectly trying to use `legacyMongoId` to look up UUIDs for new articles and stories created after the MongoDB import.

### Root Cause

In `plan.ts`, new articles and stories are assigned temporary UUIDs using `randomUUID()`:
- Line 80: `const articleId = randomUUID();`
- Line 99: `storyId = randomUUID();`

The old `ingest.ts` code then tried to:
1. Store these temporary UUIDs as `legacyMongoId` (lines 184, 210)
2. Look up existing stories by `legacyMongoId` when merging articles (line 236, 251)

**This approach fails for post-migration records because:**
- Only imported MongoDB records have `legacyMongoId` set
- New records created post-migration have `legacyMongoId = NULL`
- Lookups by `legacyMongoId` would fail, breaking story merging

### Data Flow Analysis

**Correct Data Flow:**
1. `ingest.ts` queries recent stories → gets **real DB UUIDs**
2. Passes to `plan.ts` as `candidates` and `storyByTitleHash` → **real DB UUIDs**
3. `plan.ts` matches new articles to existing stories → returns **real DB UUIDs**
4. `plan.ts` creates new stories → assigns **temporary UUIDs**

**The Fix:**
- New stories: Map temporary UUID → actual DB UUID via `storyIdMap`
- Existing stories: Already have real DB UUIDs, use them directly
- New articles: Map temporary UUID → actual DB UUID via `articleIdMap`

## Changes Made

### 1. Fixed Story Insertion (Lines 178-202)
**Before:**
```typescript
legacyMongoId: story._id,  // ❌ Storing temporary UUID as legacy ID
```

**After:**
```typescript
legacyMongoId: null,  // ✅ Only for imported data
```

### 2. Fixed Article Insertion (Lines 204-246)
**Before:**
```typescript
legacyMongoId: article._id,  // ❌ Storing temporary UUID as legacy ID

// ❌ Fallback lookup by legacyMongoId fails for post-migration stories
const actualStoryId = storyIdMap.get(article.storyId) ?? 
  (await tx.select({ id: stories.id }).from(stories)
    .where(eq(stories.legacyMongoId, article.storyId)).limit(1))[0]?.id;
```

**After:**
```typescript
legacyMongoId: null,  // ✅ Only for imported data
const articleIdMap = new Map<string, string>();  // ✅ Track article UUID mapping
articleIdMap.set(article._id, articleId);

// ✅ Use map only (new stories already in map, existing stories are real IDs)
const actualStoryId = storyIdMap.get(article.storyId);
```

### 3. Fixed Story Push Updates (Lines 248-286)
**Before:**
```typescript
// ❌ Fallback lookup by legacyMongoId fails
const actualStoryId = storyIdMap.get(storyId) ?? 
  (await tx.select({ id: stories.id }).from(stories)
    .where(eq(stories.legacyMongoId, storyId)).limit(1))[0]?.id;
if (!actualStoryId) continue;  // ❌ Silently skips failed lookups

const newArticleIds = push.articleIds.filter(...);  // ❌ Uses plan IDs directly
```

**After:**
```typescript
// ✅ New stories use map, existing stories are already real DB UUIDs
const actualStoryId = storyIdMap.get(planStoryId) ?? planStoryId;

// ✅ Map article IDs: new articles from map, existing articles are real IDs
const actualArticleIds = push.articleIds.map(planId => 
  articleIdMap.get(planId) ?? planId);
const newArticleIds = actualArticleIds.filter(...);
```

## Why This Works

### For Newly Created Stories (in this run)
- `plan.ts` generates temporary UUID: `"abc-123-temp"`
- `ingest.ts` inserts story → gets real DB UUID: `"def-456-real"`
- Stores mapping: `storyIdMap.set("abc-123-temp", "def-456-real")`
- When inserting articles, looks up: `storyIdMap.get("abc-123-temp")` → `"def-456-real"` ✅

### For Existing Stories (from previous runs)
- `ingest.ts` queries recent stories → gets real DB UUID: `"xyz-789-real"`
- `plan.ts` matches article → returns `"xyz-789-real"` (already real)
- When inserting articles, looks up: `storyIdMap.get("xyz-789-real")` → `undefined`
- Falls back to using the ID directly: `storyIdMap.get(id) ?? id` → `"xyz-789-real"` ✅

### For Imported Stories (from MongoDB)
- Have `legacyMongoId` set to original MongoDB ObjectId
- Queried as recent stories → returns real DB UUID: `"old-123-real"`
- Same flow as "Existing Stories" above ✅

## Testing

All 134 tests pass, including:
- `tests/hourly.test.ts` - Tests the exact ingest flow with clustering
- `tests/breaking.test.ts` - Tests story scoring
- `tests/posts.test.ts` - Tests content validation

## Impact

**Before Fix:**
- ❌ New articles couldn't merge into existing stories (post-migration)
- ❌ Story clustering would fail silently
- ❌ Each article would create a duplicate story
- ❌ Data integrity severely compromised

**After Fix:**
- ✅ New articles correctly merge into existing stories
- ✅ Story clustering works for all scenarios
- ✅ Clean data model with proper UUID relationships
- ✅ `legacyMongoId` reserved for its intended purpose

## Related Files

- `src/lib/jobs/ingest.ts` - Fixed (this file)
- `src/lib/jobs/plan.ts` - No changes needed (correctly generates temp UUIDs)
- `src/lib/db/schema/editorial.ts` - Schema unchanged (`legacyMongoId` nullable)
- `supabase/migrations/20261005120000_initial_schema.sql` - Migration unchanged

## Deployment Notes

This fix must be deployed **before** the first post-migration ingest run, otherwise:
1. First ingest after migration will create duplicate stories
2. Data cleanup would be required to merge duplicates
3. Story IDs in analytics would be inconsistent

**Status:** ✅ Fixed and tested before production deployment
