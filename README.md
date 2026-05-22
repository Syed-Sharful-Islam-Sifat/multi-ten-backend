# 🗒️ Workspace Notes — Multi-Tenant SaaS Notes System

> A production-grade, multi-tenant SaaS notes platform built for companies to manage workspaces, collaborate on notes, and publish content publicly.

---

## 📑 Table of Contents

- [Project Overview](#project-overview)
- [Why MongoDB](#why-mongodb)
- [MongoDB Free Tier (512MB) — Optimization Strategy](#mongodb-free-tier-512mb--optimization-strategy)
- [System Architecture](#system-architecture)
- [Database Design](#database-design)
- [API Design](#api-design)
- [Core Features](#core-features)
  - [Multi-Tenancy](#multi-tenancy)
  - [Draft Mode](#draft-mode)
  - [History System](#history-system)
  - [Note Voting](#note-voting)
  - [Public Directory](#public-directory)
- [History Cleanup Strategy (7-Day Retention)](#history-cleanup-strategy-7-day-retention)
- [Large Data Seeder](#large-data-seeder)
- [Security Considerations](#security-considerations)
- [Performance & Scalability](#performance--scalability)
- [UI Pages & Flows](#ui-pages--flows)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Known Limitations & Future Work](#known-limitations--future-work)

---

## Project Overview

**Workspace Notes** is a multi-tenant SaaS application where multiple companies can sign up, create workspaces, and manage notes within those workspaces. Notes can be private (visible only to workspace members) or public (listed in a public directory accessible by anyone).

**Key design goals:**
- Multi-tenancy with strict data isolation between companies
- Fast read performance on large datasets (~500K+ notes)
- Secure by default (auth, authorization, input sanitization)
- Offloaded background jobs for maintenance tasks (e.g., history cleanup)
- Simple but functional UI
- Storage-efficient schema design to run within MongoDB Atlas Free Tier (512MB)

**What was scoped for design (not full implementation due to time constraints):**
- Full system design, database schema, API contract, background job strategy, and UI wireflow are documented here
- Partial implementation covers: `[list what was actually implemented]`

---

## Why MongoDB

> **Honest engineering decision:** PostgreSQL would be the ideal choice for a multi-tenant system of this kind — it provides strong relational integrity, row-level security for tenant isolation, and mature full-text search. However, given the **strict time constraint** of a single workday, I chose MongoDB for the following practical reasons:

### 1. Familiarity = Speed
I have significantly more hands-on experience with MongoDB and Mongoose. In a time-boxed assessment, choosing a familiar tool means less time fighting the database and more time building features. A well-designed MongoDB schema with proper indexes performs excellently for this use case.

### 2. Flexible Document Model Fits Notes Well
Notes are naturally document-shaped. Tags, vote counts, and metadata live comfortably inside a single document without JOINs. This reduces query complexity for common read paths like "get note with its tags and vote counts".

```js
// One document — no joins needed for common reads
{
  _id: ObjectId,
  companyId: ObjectId,
  workspaceId: ObjectId,
  title: "My Note",
  content: "...",
  tags: ["productivity", "backend"],
  type: "public",
  status: "published",
  voteCount: { up: 42, down: 3 },
  createdBy: ObjectId,
  createdAt: ISODate,
  updatedAt: ISODate
}
```

### 3. Atlas Free Tier Available Immediately
MongoDB Atlas M0 (free tier) spins up in under 2 minutes with no credit card. This meant I could start building immediately without any local Docker/Postgres setup overhead during the assessment.

### 4. Mongoose ODM is Productive
Mongoose provides schema validation, middleware hooks (for auto-creating history on save), and a clean API — all things that would take longer to wire up manually with a raw SQL client under time pressure.

### Trade-offs Acknowledged
| Concern | How it's mitigated |
|---|---|
| No true foreign key constraints | Application-layer validation + Mongoose references |
| No multi-document ACID transactions by default | Used MongoDB sessions for history write + note update atomicity |
| Harder to enforce tenant isolation at DB level | Enforced strictly at service layer — every query includes `companyId` |
| No native full-text index as powerful as pg_trgm | MongoDB Atlas Search (Lucene-based) or text indexes used for title search |

---

## MongoDB Free Tier (512MB) — Optimization Strategy

MongoDB Atlas M0 gives **512MB of storage**. With 1,000 workspaces and 500,000 notes, storage efficiency is critical. Here is exactly how the system is designed to fit and perform within that constraint.

### Storage Estimate

| Collection | Avg Doc Size | Count | Estimated Size |
|---|---|---|---|
| `notes` | ~600 bytes | 500,000 | ~300MB |
| `noteHistories` | ~650 bytes | ~500,000 (capped, 7-day rolling) | ~325MB *(before cleanup)* |
| `workspaces` | ~200 bytes | 1,000 | ~0.2MB |
| `companies` | ~150 bytes | ~50 | negligible |
| `users` | ~200 bytes | ~500 | ~0.1MB |
| Indexes | — | — | ~30–50MB |

> **⚠️ The math:** Notes alone take ~300MB. History entries are the danger zone. The 7-day cleanup job is **not optional** — it is essential to survival on the free tier.

### Optimization Techniques Applied

#### 1. Short Field Names in Documents
MongoDB stores field names in every document. Shortening field names saves real bytes at 500K documents:

```js
// ❌ Verbose — wastes ~50 bytes per document × 500K = 25MB wasted
{ companyId, workspaceId, createdAt, updatedAt, voteCount }

// ✅ Abbreviated field names — saves significant space
{ cId, wId, cat, uat, vc }
```
> In code, Mongoose virtuals or a transform layer maps short names back to readable names in API responses.

#### 2. Embedded Vote Counts (not a separate votes collection)
Instead of storing one document per vote (which at 500K notes with avg 20 votes each = 10M documents), vote counts are embedded directly in the note as a counter:

```js
// Embedded in note — no separate votes collection
voteCount: { up: Number, down: Number }

// Atomic increment — no race conditions
await Note.updateOne(
  { _id: noteId, 'voters': { $ne: userId } }, // prevent double vote
  {
    $inc: { 'voteCount.up': 1 },
    $push: { voters: userId }
  }
);
```

The `voters` array (list of user IDs who voted) is kept on the note to enforce one-vote-per-user. For very popular notes this array is capped or replaced with a separate lean `votes` collection only when needed.

#### 3. History Stored Separately with Aggressive TTL Cleanup
History is **not embedded** in the note document (that would make note documents huge). It lives in a separate `noteHistories` collection with a MongoDB TTL index that auto-expires documents — no cron job needed at the DB level:

```js
// TTL index — MongoDB automatically deletes docs after 7 days
noteHistoriesSchema.index({ changedAt: 1 }, { expireAfterSeconds: 604800 });
```

This is the most storage-safe approach — expired history is deleted automatically by MongoDB's background TTL monitor, with zero server load.

#### 4. Content Trimming — No Bloated History
History entries store only `prevTitle` and `prevContent` (the diff snapshot). They do **not** duplicate tags, votes, or metadata — only what changed.

#### 5. Selective Projection in Queries
List endpoints never fetch `content` (the large field). Only the detail/edit view fetches full content:

```js
// List query — excludes content field
Note.find({ companyId }).select('title tags type status createdAt voteCount').lean();

// Detail query — fetches everything
Note.findById(id).lean();
```

`.lean()` is always used for read-only queries — returns plain JS objects instead of Mongoose documents, ~3x faster and less memory.

#### 6. Pagination — Never Load All 500K Notes
All list endpoints use cursor-based pagination. `skip()` is never used on large collections — it scans and discards documents, which is catastrophic at 500K records:

```js
// ❌ Never do this at scale
Note.find({}).skip(50000).limit(20)

// ✅ Cursor-based — uses the index directly
Note.find({ _id: { $gt: lastSeenId }, type: 'public', status: 'published' })
    .sort({ _id: 1 })
    .limit(20)
    .lean()
```

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          Client (Browser)                        │
│                    Express-rendered views / React                │
└────────────────────────────┬─────────────────────────────────────┘
                             │ HTTP/REST
┌────────────────────────────▼─────────────────────────────────────┐
│                  API Server (Node.js + Express)                  │
│                                                                  │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│   │  Auth Layer  │  │  Note Router │  │  Public Dir Router   │  │
│   │  (JWT)       │  │  (CRUD, Vote)│  │  (Public Listings)   │  │
│   └──────────────┘  └──────────────┘  └──────────────────────┘  │
└────────────────────────────┬─────────────────────────────────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
┌─────────▼──────┐  ┌────────▼───────┐  ┌──────▼──────────────┐
│    MongoDB     │  │  node-cron     │  │  In-process cache   │
│  Atlas M0      │  │  (cleanup job  │  │  (node-cache /      │
│  (Free Tier)   │  │   + TTL index) │  │   simple Map TTL)   │
└────────────────┘  └────────────────┘  └─────────────────────┘
```

**Architecture decisions:**
- **Node.js + Express:** Familiar, minimal setup time, excellent MongoDB ecosystem (Mongoose)
- **MongoDB Atlas M0:** Zero-infra, free, instant setup — practical for time-boxed development
- **No Redis:** Avoided to reduce infra complexity. In-process caching (node-cache) used for hot public directory pages. Redis would be the correct next step for production
- **node-cron for cleanup:** Lightweight scheduler built into the Node process. MongoDB TTL indexes handle the actual deletion — node-cron is only needed for any application-level cleanup tasks

---

## Database Design

> 📎 **Full Schema Diagram Link:** `[Insert link — use MongoDB Compass schema view export, or draw at dbdiagram.io]`

### Collection Overview

```
companies
  └── workspaces        (companyId ref)
        └── notes       (companyId + workspaceId ref)
              └── noteHistories  (noteId ref, TTL indexed)
users             (companyId ref)
```

### Collections & Schemas

#### `companies`
```js
{
  _id: ObjectId,
  name: String,          // "Acme Corp"
  slug: String,          // "acme-corp" — unique, URL-safe
  createdAt: Date
}
```

#### `users`
```js
{
  _id: ObjectId,
  companyId: ObjectId,   // Tenant key — ALWAYS present
  email: String,         // unique index
  passwordHash: String,
  role: String,          // "owner" | "member"
  createdAt: Date
}
// Index: { email: 1 } unique
// Index: { companyId: 1 }
```

#### `workspaces`
```js
{
  _id: ObjectId,
  companyId: ObjectId,   // Tenant key
  name: String,
  createdAt: Date
}
// Index: { companyId: 1 }
```

#### `notes`
```js
{
  _id: ObjectId,
  companyId: ObjectId,   // Tenant key — denormalized for fast scoping
  workspaceId: ObjectId,
  title: String,
  content: String,
  tags: [String],        // ["productivity", "backend"] — embedded array
  type: String,          // "public" | "private"
  status: String,        // "draft" | "published"
  voteCount: {
    up: Number,          // Embedded counter — no separate votes collection
    down: Number
  },
  voters: [ObjectId],    // User IDs who voted — enforces one-vote-per-user
                         // (capped at high scale; see optimization notes)
  createdBy: ObjectId,
  updatedBy: ObjectId,
  createdAt: Date,
  updatedAt: Date
}
```

**Indexes on `notes`:**
```js
// Tenant-scoped workspace listing
{ companyId: 1, workspaceId: 1 }

// Public directory listing (partial index — only indexes public+published docs)
{ type: 1, status: 1, createdAt: -1 }

// Title search
{ title: "text" }  // MongoDB text index for $text search
                   // Or Atlas Search for better relevance

// Sorting by votes in public directory
{ type: 1, status: 1, "voteCount.up": -1 }
{ type: 1, status: 1, "voteCount.down": -1 }

// Cursor-based pagination anchor
{ _id: 1 }  // default, already exists
```

#### `noteHistories`
```js
{
  _id: ObjectId,
  noteId: ObjectId,
  prevTitle: String,     // Snapshot of title before this edit
  prevContent: String,   // Snapshot of content before this edit
  changedBy: ObjectId,   // User who made the change
  changedAt: Date        // ← TTL index on this field
}
```

**Indexes on `noteHistories`:**
```js
// Fast history lookup per note
{ noteId: 1, changedAt: -1 }

// TTL index — MongoDB auto-deletes documents after 7 days
// This is the primary cleanup mechanism — no application code needed
{ changedAt: 1 }  // expireAfterSeconds: 604800 (7 days)
```

> **Why a separate collection for history (not embedded array in note)?**
> Embedding history in the note document would make the note document grow unboundedly — a document with 50 history entries could be 30KB+. At 500K notes, that's ~15GB just for bloated note documents. A separate collection with a TTL index is the correct MongoDB pattern here.

---

## API Design

> All endpoints are prefixed with `/api/v1`

### Auth
| Method | Endpoint            | Description                    |
|--------|---------------------|--------------------------------|
| POST   | `/auth/register`    | Register company + owner user  |
| POST   | `/auth/login`       | Login, returns JWT             |
| POST   | `/auth/logout`      | Client-side token discard      |

### Workspaces *(authenticated, tenant-scoped)*
| Method | Endpoint             | Description                      |
|--------|----------------------|----------------------------------|
| GET    | `/workspaces`        | List my company's workspaces     |
| POST   | `/workspaces`        | Create workspace                 |
| GET    | `/workspaces/:id`    | Get single workspace             |
| PUT    | `/workspaces/:id`    | Update workspace                 |
| DELETE | `/workspaces/:id`    | Delete workspace                 |

### Notes *(authenticated)*
| Method | Endpoint                              | Description                        |
|--------|---------------------------------------|------------------------------------|
| GET    | `/workspaces/:wid/notes`              | List notes in workspace (no content field) |
| POST   | `/workspaces/:wid/notes`              | Create note                        |
| GET    | `/workspaces/:wid/notes/:id`          | Get note detail (with content)     |
| PUT    | `/workspaces/:wid/notes/:id`          | Update note (auto-creates history) |
| DELETE | `/workspaces/:wid/notes/:id`          | Delete note + its histories        |
| POST   | `/workspaces/:wid/notes/:id/publish`  | Publish a draft note               |

### Note History *(authenticated)*
| Method | Endpoint                              | Description               |
|--------|---------------------------------------|---------------------------|
| GET    | `/notes/:id/history`                  | List history entries      |
| POST   | `/notes/:id/history/:hid/restore`     | Restore a history entry   |

### Public Directory *(unauthenticated)*
| Method | Endpoint                    | Description                                              |
|--------|-----------------------------|----------------------------------------------------------|
| GET    | `/public/notes`             | List all public published notes (sortable, searchable)   |
| GET    | `/public/notes/:id`         | Single public note detail                                |
| POST   | `/public/notes/:id/vote`    | Upvote or downvote a public note                         |

**Query params for `/public/notes`:**
- `search=` — title search using MongoDB `$text` index
- `sort=` — `newest` | `oldest` | `most_upvotes` | `most_downvotes`
- `cursor=` — last seen `_id` for cursor-based pagination
- `limit=` — default 20, max 50

---

## Core Features

### Multi-Tenancy

Every MongoDB query is scoped with `companyId`. This is enforced at the **service layer** — not just the route level — so it's impossible to accidentally return cross-tenant data.

```js
// Every note query — companyId is always the first filter
const notes = await Note
  .find({ companyId: req.user.companyId, workspaceId })
  .select('title tags type status createdAt voteCount')
  .lean();
```

There is no database-level row security (MongoDB doesn't have PostgreSQL-style RLS), so discipline at the service layer is critical. A middleware helper `tenantScope(req)` returns `{ companyId: req.user.companyId }` and is spread into every query filter.

### Draft Mode

- Notes have a `status` field: `"draft"` | `"published"`
- Drafts are **never** included in public directory queries: `{ type: 'public', status: 'published' }`
- Draft notes appear only in the private workspace view with an orange **DRAFT** badge
- Publishing: `POST /notes/:id/publish` sets `status = 'published'` and `updatedAt = now()`
- A draft note can still be `type: 'private'` or `type: 'public'` — the `type` determines where it goes once published; `status` controls whether it's live

### History System

Every `PUT /notes/:id` triggers a Mongoose **pre-save middleware** that:

1. Reads the current `title` and `content` from the document before applying changes
2. Inserts a `NoteHistory` document with the previous values
3. Both operations run inside a **MongoDB session (transaction)** so they succeed or fail together

```js
// Mongoose pre-save hook on Note schema
NoteSchema.pre('save', async function (next) {
  if (!this.isNew && (this.isModified('title') || this.isModified('content'))) {
    const session = this.$session();
    await NoteHistory.create([{
      noteId: this._id,
      prevTitle: this.get('title', null, { getters: false }),
      prevContent: this.get('content', null, { getters: false }),
      changedBy: this._updatedBy,  // set by controller before save
      changedAt: new Date()
    }], { session });
  }
  next();
});
```

**Restore flow:**
1. `POST /notes/:id/history/:hid/restore`
2. Load the history entry
3. Save current state as a new history entry (so restore is itself undoable)
4. Apply `prevTitle` and `prevContent` to the note → triggers the pre-save hook again

### Note Voting

- Vote counts are **embedded** in the note as `voteCount: { up, down }`
- The `voters` array on the note prevents double-voting via an atomic query:

```js
const result = await Note.updateOne(
  {
    _id: noteId,
    type: 'public',
    voters: { $ne: userId }   // Only update if user hasn't voted
  },
  {
    $inc: { [`voteCount.${voteType}`]: 1 },
    $push: { voters: userId }
  }
);

if (result.matchedCount === 0) {
  throw new Error('Already voted or note not found');
}
```

- **Changing a vote:** Allowed — decrements the old vote type, increments the new one, using `$set` + `$inc` in one atomic operation
- **Cross-company voting:** Any authenticated user from any company can vote on public notes

### Public Directory

- Queries: `{ type: 'public', status: 'published' }`
- Includes workspace name (populated via `workspaceId` ref or pre-joined in aggregation)
- Cursor-based pagination using `_id` as cursor
- Sort options map to MongoDB sort objects:

```js
const sortMap = {
  newest:        { createdAt: -1 },
  oldest:        { createdAt: 1  },
  most_upvotes:  { 'voteCount.up': -1 },
  most_downvotes:{ 'voteCount.down': -1 }
};
```

---

## History Cleanup Strategy (7-Day Retention)

### Primary Mechanism: MongoDB TTL Index

The **first line of defense** is MongoDB's native TTL index on `noteHistories.changedAt`:

```js
// In the Mongoose schema definition
NoteHistorySchema.index(
  { changedAt: 1 },
  { expireAfterSeconds: 604800 }  // 60 × 60 × 24 × 7 = 604,800 seconds
);
```

MongoDB's background TTL monitor runs every **60 seconds** and automatically deletes documents where `changedAt < now - 7 days`. This is:

- **Zero application code** — no cron job needed for this task
- **Non-blocking** — the TTL monitor is a background thread in mongod, entirely separate from query execution
- **Index-driven** — deletion uses the BTrie index on `changedAt`, not a collection scan
- **Storage-safe** — critical for the 512MB free tier

### Secondary Mechanism: node-cron Safety Net

As a belt-and-suspenders measure, a `node-cron` job runs daily at 2:00 AM UTC to catch any documents the TTL monitor may have missed (e.g., after an Atlas maintenance window):

```js
import cron from 'node-cron';
import NoteHistory from '../models/NoteHistory.js';

// Runs at 2:00 AM UTC every day
cron.schedule('0 2 * * *', async () => {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  try {
    const result = await NoteHistory.deleteMany({
      changedAt: { $lt: sevenDaysAgo }
    });
    console.log(`[Cleanup] Deleted ${result.deletedCount} expired history entries`);
  } catch (err) {
    console.error('[Cleanup] History cleanup failed:', err.message);
  }
}, {
  timezone: 'UTC'
});
```

### Why This Doesn't Stress the Server

1. **MongoDB TTL index does the real work** — no application CPU involved
2. **node-cron runs at 2 AM UTC** — lowest traffic window
3. **`deleteMany` with an indexed field** — MongoDB uses the `changedAt` index, so it's not a collection scan; it's a targeted range delete
4. **Async, non-blocking** — runs outside the HTTP request lifecycle entirely; Express continues serving requests normally
5. **No batching needed at this scale** — with 7-day rolling history and the TTL index doing daily cleanup, the safety-net job will almost never find anything to delete

### Storage Impact of History

Assuming each note is edited ~2× per week on average, and history entries are cleaned after 7 days:

```
500,000 notes × 2 edits/week × 1 history entry/edit
= ~1,000,000 history entries at peak (before first cleanup)
= ~1,000,000 × 650 bytes avg = ~650MB
```

> ⚠️ **This exceeds the 512MB free tier if all 500K notes are edited frequently.** For the free tier, the TTL cleanup must run correctly and history is the most volatile collection. In practice, not all notes are edited every week — a realistic average across the dataset is far lower. The seeder generates realistic sparse edit history.

**Mitigation if storage gets tight:**
- Store only `title` diffs if content hasn't changed (and vice versa)
- Reduce retention to 3 days for the free tier (7 days is configurable via env var)
- Upgrade to Atlas M2 ($9/month, 2GB) for production use

---

## Large Data Seeder

The seeder populates:
- **50 companies**, each with ~20 workspaces = **~1,000 workspaces**
- **~500 notes per workspace** = **~500,000 notes**
- Realistic titles from a mixed vocabulary pool (tech, business, personal productivity)
- 2–8 tags per note from a pool of 80 predefined tags
- Random `type` (70% private, 30% public) and `status` (80% published, 20% draft)
- Random vote counts on public notes
- 1–3 history entries per note (sparse, realistic)

**Run seeder:**
```bash
npm run seed
```

**Performance approach:**
```js
// Bulk insert in batches of 1,000 — much faster than individual .save() calls
const BATCH_SIZE = 1000;
for (let i = 0; i < notes.length; i += BATCH_SIZE) {
  await Note.insertMany(notes.slice(i, i + BATCH_SIZE), { ordered: false });
}
```

Using `insertMany` with `ordered: false` allows MongoDB to parallelize inserts and skip duplicate-key errors without aborting the whole batch. Seeding 500K notes with this approach takes approximately **3–8 minutes** depending on Atlas network latency.

> **Note:** Indexes are NOT dropped before seeding (unlike PostgreSQL's common "drop index → bulk insert → rebuild" trick) because MongoDB builds indexes incrementally. For this dataset size it is acceptable.

---

## Security Considerations

| Concern | Approach |
|---|---|
| Authentication | JWT (access token 15m + refresh token 7d stored in httpOnly cookie) |
| Authorization | `companyId` from verified JWT injected into every DB query via `tenantScope()` middleware |
| NoSQL Injection | Mongoose schemas with strict typing reject unexpected operator keys; `express-mongo-sanitize` strips `$` and `.` from request bodies |
| Password Storage | bcrypt with cost factor 12 |
| Rate Limiting | `express-rate-limit` on vote endpoint (10 votes/min per IP) and auth endpoints |
| HTTPS | Enforced in production via reverse proxy (Nginx) |
| Tenant Isolation | `companyId` filter mandatory in all service functions — no query runs without it |
| Input Validation | Zod schema validation on all request bodies before hitting the DB |
| CORS | Strict origin whitelist via `cors` package |
| Secrets | Environment variables only — `.env` is gitignored |
| Sensitive fields | `passwordHash` excluded from all API responses via Mongoose `select: false` |

---

## Performance & Scalability

### Index Summary

```js
// users
{ email: 1 }            // unique — login lookup
{ companyId: 1 }        // tenant scoping

// workspaces
{ companyId: 1 }        // list workspaces per company

// notes
{ companyId: 1, workspaceId: 1 }        // private workspace listing
{ type: 1, status: 1, createdAt: -1 }  // public directory — newest sort
{ type: 1, status: 1, 'voteCount.up': -1 }   // most upvotes sort
{ type: 1, status: 1, 'voteCount.down': -1 } // most downvotes sort
{ title: 'text' }                       // title search

// noteHistories
{ noteId: 1, changedAt: -1 }            // history list per note
{ changedAt: 1 } (TTL, expireAfterSeconds: 604800) // auto-cleanup
```

### Query Projection (Always Select Minimal Fields)

```js
// ✅ List view — never fetch content
Note.find(filter)
    .select('title tags type status voteCount createdAt workspaceId')
    .lean()

// ✅ Edit/detail view — fetch everything
Note.findById(id).lean()
```

### Caching (In-Process)

Redis is not used to avoid extra infrastructure. Instead, `node-cache` provides in-process TTL caching for the most expensive query — the public directory first page:

```js
import NodeCache from 'node-cache';
const cache = new NodeCache({ stdTTL: 60 }); // 60 second TTL

// Cache key encodes the full query signature
const cacheKey = `public:${sort}:${search}:${cursor}`;
const cached = cache.get(cacheKey);
if (cached) return res.json(cached);

const results = await Note.find(...).lean();
cache.set(cacheKey, results);
res.json(results);
```

Cache is invalidated on new publish or vote change by calling `cache.flushAll()` — acceptable at this scale.

### Cursor-Based Pagination

```js
// ✅ Correct — uses index, O(1) seek
const notes = await Note.find({
  type: 'public',
  status: 'published',
  _id: { $gt: new mongoose.Types.ObjectId(cursor) }  // cursor = last seen _id
}).sort({ _id: 1 }).limit(20).lean();

// ❌ Never — O(n) scan discards 50,000 docs
Note.find({}).skip(50000).limit(20)
```

### Scalability Path

| Scale Trigger | Action |
|---|---|
| 512MB Atlas limit hit | Upgrade to Atlas M2 (2GB, $9/mo) or M5 (5GB) |
| Read latency increases | Add Atlas read replica (M10+) |
| Title search too slow | Enable Atlas Search (Lucene-based, free on M0) |
| Vote counter contention | Move `voters` array to separate lean `votes` collection |
| History storage bloat | Reduce TTL to 3 days or store content diffs only |
| 5M+ notes | Shard by `companyId` using MongoDB Atlas sharded clusters |

---

## UI Pages & Flows

### Page Map

```
/login                    — Login page
/register                 — Company registration
/dashboard                — Workspace list (private, owner only)
/workspaces/:id/notes     — Note list in workspace + title search
/workspaces/:id/notes/new — Create note
/notes/:id/edit           — Edit note (with DRAFT badge if unpublished)
/notes/:id/history        — History timeline + restore button
/public                   — Public notes directory (search, sort, vote)
/public/:id               — Single public note view
```

### Key UI Behaviors

- **Draft indicator:** Orange "DRAFT" badge on unpublished notes in list and editor header
- **History view:** Reverse-chronological list; each entry shows who changed it, when, and a "Restore this version" button
- **Public directory sort:** Dropdown — Newest / Oldest / Most Upvoted / Most Downvoted
- **Search:** Debounced (300ms) title search on both private workspace list and public directory, using MongoDB `$text` search
- **Voting:** Upvote / downvote buttons on public note cards; authenticated users only; current user's vote is highlighted; switching vote is allowed

---

## Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| Backend | Node.js + Express | Familiar, fast to set up, great MongoDB ecosystem |
| Database | MongoDB Atlas M0 (Free) | Zero infra setup, familiar, document model suits notes |
| ODM | Mongoose | Schema validation, middleware hooks, clean API |
| Auth | JWT + bcrypt | Stateless, no session store needed |
| Scheduler | node-cron | Lightweight, in-process, no extra infra |
| In-process Cache | node-cache | Avoids Redis infra complexity for this scale |
| Input Validation | Zod | Schema-first, TypeScript-friendly |
| Security | express-mongo-sanitize, express-rate-limit, helmet | Standard Express security stack |
| Frontend | `[Express + EJS templates / React / Plain HTML]` | `[Your reason]` |
| Seeder | Custom script with insertMany batching | Fast bulk inserts |

---

## Project Structure

```
/
├── src/
│   ├── config/
│   │   ├── db.js              # Mongoose connection
│   │   └── env.js             # Env var validation
│   ├── middleware/
│   │   ├── auth.js            # JWT verify, attach req.user
│   │   ├── tenantScope.js     # Injects companyId into queries
│   │   ├── rateLimiter.js     # Vote + auth rate limits
│   │   └── errorHandler.js    # Global error handler
│   ├── models/
│   │   ├── Company.js
│   │   ├── User.js
│   │   ├── Workspace.js
│   │   ├── Note.js            # Includes pre-save history hook
│   │   └── NoteHistory.js     # TTL index defined here
│   ├── modules/
│   │   ├── auth/
│   │   ├── workspaces/
│   │   ├── notes/
│   │   ├── history/
│   │   ├── votes/
│   │   └── public/
│   ├── jobs/
│   │   └── cleanupHistory.js  # node-cron safety-net job
│   └── scripts/
│       └── seed.js            # 500K note seeder
├── frontend/
│   ├── pages/
│   └── components/
├── .env.example
├── .gitignore
└── README.md
```

---

## Getting Started

### Prerequisites
- Node.js ≥ 18
- A MongoDB Atlas account (free — [atlas.mongodb.com](https://www.mongodb.com/atlas))

### Installation

```bash
git clone [repo-url]
cd workspace-notes
npm install
cp .env.example .env
# Add your MongoDB Atlas connection string to .env
```

### Database Setup

MongoDB Atlas creates collections automatically on first insert. Indexes are created via Mongoose schema definitions on app startup — no manual migration step needed.

```bash
# (Optional) Seed with large dataset — takes 3–8 minutes
npm run seed
```

### Run Development Server

```bash
npm run dev
```

The server starts, connects to Atlas, and registers all Mongoose indexes (including the TTL index on `noteHistories`) automatically.

---

## Environment Variables

```env
# MongoDB
MONGODB_URI=mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/workspace_notes?retryWrites=true&w=majority

# Auth
JWT_SECRET=your-very-long-random-secret-min-32-chars
JWT_EXPIRY=15m
REFRESH_TOKEN_SECRET=another-long-random-secret
REFRESH_TOKEN_EXPIRY=7d

# App
PORT=3000
NODE_ENV=development

# History Retention (seconds) — default 7 days
HISTORY_TTL_SECONDS=604800

# Rate Limiting
VOTE_RATE_LIMIT_WINDOW_MS=60000
VOTE_RATE_LIMIT_MAX=10
AUTH_RATE_LIMIT_MAX=5
```

---

## Known Limitations & Future Work

| Item | Status | Notes |
|---|---|---|
| Full implementation | Scoped to design | Time constraint — full implementation would take ~3-4 days |
| Redis caching | Replaced with node-cache | For production, Redis is the correct choice for distributed caching |
| PostgreSQL | Replaced with MongoDB | PostgreSQL with RLS would be stronger for multi-tenant isolation at scale |
| Atlas Search | Not configured | Would replace `$text` index for better search relevance (free on Atlas) |
| Email verification | Not implemented | Would add on next iteration |
| Real-time collaboration | Not in scope | Would use WebSockets |
| File attachments | Not in scope | Would use S3 + signed URLs |
| Content search | Title only | Full content search would use Atlas Search |
| Anonymous voting | Not implemented | Would use browser fingerprinting + IP |
| 512MB storage ceiling | Active constraint | History TTL and projection are critical; upgrade to M2 for production |

---

## Author

`[Your Name]`  
Built as part of a Full-Stack Developer assessment task  
Date: `[Date]`