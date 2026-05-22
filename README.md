# 🗒️ Workspace Notes — Multi-Tenant SaaS Notes System

> A production-grade, multi-tenant SaaS notes platform built for companies to manage workspaces, collaborate on notes, and publish content publicly.

I have decided to explain the system design rather than implementing it in this short period of time as implementing this kind of system need times. I have tried to elaborate my thought process and documented it.

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

**What is implemented:**
- All Mongoose models with indexes: `Company`, `User`, `Workspace`, `Note`, `NoteHistory`, `NoteVote`, `LoginOtp`
- OTP-based passwordless authentication with bcrypt-hashed OTP, TTL auto-expiry, brute-force protection
- Full note schema with dual-axis visibility (`noteType` × `isDraft`), denormalized `votesCache`, and `publishedAt` timestamp
- Background job strategy and seeder design documented below

**What is scoped to design (not yet implemented):**
- API route handlers, service layer, frontend UI

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
  companyId:   ObjectId,       // denormalized — tenant isolation without $lookup
  workspaceId: ObjectId,
  createdBy:   ObjectId,
  title:       "My Note",
  content:     "...",
  tags:        ["productivity", "backend"],
  noteType:    "public",       // 'public' | 'private'
  isDraft:     false,          // dual-axis with noteType controls visibility
  publishedAt: ISODate,        // set once on first publish — never updated
  votesCache:  39,             // denormalized SUM — no aggregation on listing pages
  createdAt:   ISODate,
  updatedAt:   ISODate
}
```


### 4. Mongoose ODM is Productive
Mongoose provides schema validation, middleware hooks (for auto-creating history on save), TTL index declarations, and a clean API — all things that would take longer to wire up manually with a raw SQL client under time pressure. The `LoginOtp` model is a good example: TTL index, bcrypt hash storage, and brute-force `attempts` counter are all declared declaratively in one schema file.

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
| `notes` | ~550 bytes | 500,000 | ~275MB |
| `notehistories` | ~600 bytes | ~300,000 (7-day rolling) | ~180MB *(before TTL cleanup)* |
| `notevotes` | ~100 bytes | ~1,000,000 (est.) | ~100MB |
| `workspaces` | ~220 bytes | 1,000 | ~0.2MB |
| `companies` | ~150 bytes | ~50 | negligible |
| `users` | ~200 bytes | ~500 | ~0.1MB |
| `loginotps` | ~180 bytes | transient (TTL auto-deletes) | negligible |
| Indexes | — | — | ~30–50MB |

> **⚠️ The math:** Notes + history + votes approach the 512MB ceiling. The TTL index on `notehistories` is **not optional** — it is essential to survival on the free tier. Vote documents must also stay lean (see NoteVote schema below).

### Optimization Techniques Applied

#### 1. Lean Field Design — No Redundant Data in Documents
The actual schemas avoid storing anything that can be derived. For example, `votesCache` on `Note` is a single integer (the net vote sum), not an object with `up`/`down` breakdown — a separate `NoteVote` collection holds the per-user vote records for audit and change purposes. This keeps the hot `notes` collection documents small.

```ts
// votesCache: single Number — not { up: N, down: N }
// Updated atomically via $inc on every vote write
votesCache: { type: Number, default: 0 }
```

#### 2. Denormalized `votesCache` + Separate `NoteVote` Collection
Rather than a pure embedded counter (which loses per-user vote history) or a pure aggregate query (which is expensive at scale), a hybrid approach is used:

- `notes.votesCache` — a single `Number` (net sum: upvotes minus downvotes). Updated atomically with `$inc` on every vote write. Used for sorting on the public directory — no aggregation pipeline needed.
- `NoteVote` collection — one document per user per note. Enforces one-vote-per-user via a unique compound index `{ noteId, voterId }`. Stores the vote direction (`+1` / `-1`) so votes can be changed or retracted.

```ts
// On upvote — atomic, no read-modify-write race
await Note.updateOne({ _id: noteId }, { $inc: { votesCache: +1 } });
await NoteVote.create({ noteId, voterId, value: 1 });
```

This avoids a `voters: [ObjectId]` array growing unboundedly inside the note document, which at popular notes would make documents balloon in size.

#### 3. History Stored Separately with Aggressive TTL Cleanup
History is **not embedded** in the note document (that would make note documents huge). It lives in a separate `noteHistories` collection with a MongoDB TTL index that auto-expires documents — no cron job needed at the DB level:

```ts
// TTL index — MongoDB automatically deletes docs after 7 days
// expireAfterSeconds: 0 means "delete exactly when changedAt + 7d is reached"
noteHistorySchema.index({ changedAt: 1 }, { expireAfterSeconds: 604800 });
```

This is the most storage-safe approach — expired history is deleted automatically by MongoDB's background TTL monitor, with zero server load.

#### 4. Content Trimming — No Bloated History
History entries store only `prevTitle` and `prevContent` (the diff snapshot). They do **not** duplicate tags, votes, or metadata — only what changed.

#### 5. Selective Projection in Queries
List endpoints never fetch `content` (the large field). Only the detail/edit view fetches full content:

```ts
// List query — excludes content (largest field)
Note.find({ companyId, workspaceId })
    .select('title tags noteType isDraft votesCache publishedAt createdAt')
    .lean();

// Detail/edit query — fetches everything including content
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

> 📎 **Full Schema Diagram Link:** `[https://dbdiagram.io/d/multi-tenant-backend-db-design-6a0ff43fb62396d22c448205]`

### Collection Overview

```
companies
  └── workspaces        (companyId ref)
        └── notes       (companyId + workspaceId ref — companyId denormalized)
              ├── notehistories  (noteId ref — TTL index auto-deletes after 7 days)
              └── notevotes      (noteId + voterId ref — unique per user per note)
users             (companyId ref)
loginotps         (userId ref — TTL index auto-deletes on expiresAt)
```

---

### `companies`

```ts
{
  _id:        ObjectId,
  name:       String,    // required, trim, 2–255 chars
  email:      String,    // required, unique, lowercase
  isVerified: Boolean,   // default: false
  createdAt:  Date,
  updatedAt:  Date
}
```

**Indexes:**
```
{ email: 1 }  unique
```

> `isVerified` gates certain actions (e.g., publishing) until the company email is confirmed.

---

### `users`

```ts
{
  _id:       ObjectId,
  companyId: ObjectId,   // ref: Company — tenant key, always present
  name:      String,     // required, 1–255 chars
  email:     String,     // required, lowercase
  role:      String,     // 'owner' | 'member'
  isActive:  Boolean,    // default: true — soft-disable without deleting
  createdAt: Date
  // no updatedAt — user profile updates not tracked at this stage
}
```

**Indexes:**
```
{ companyId: 1, email: 1 }  unique   ← login lookup + prevents duplicate email per tenant
{ companyId: 1 }                     ← list all users in a company
```

> Email uniqueness is **per-tenant** — the same email can exist across two different companies. The compound unique index enforces this correctly.

---

### `workspaces`

```ts
{
  _id:         ObjectId,
  companyId:   ObjectId,  // ref: Company
  createdBy:   ObjectId,  // ref: User
  name:        String,    // required, 1–255 chars
  description: String,    // optional, max 1000 chars, default ''
  createdAt:   Date,
  updatedAt:   Date
}
```

**Indexes:**
```
{ companyId: 1 }          ← list workspaces for a company
{ companyId: 1, name: 1 } ← uniqueness check + sorted listing by name
```

---

### `notes`

This is the most carefully designed collection. Two independent axes control visibility:

```
noteType : 'private' | 'public'
  private → visible to company members only
  public  → streams into global public directory once published

isDraft : true | false
  true  → visible to author only (never in any listing)
  false → visible per noteType rules above
```

**Visibility matrix:**

| `noteType` | `isDraft` | Who can see it |
|---|---|---|
| `private` | `true` | Author only |
| `private` | `false` | All company members |
| `public` | `true` | Author only — never in public directory |
| `public` | `false` | Global public directory |

```ts
{
  _id:         ObjectId,
  workspaceId: ObjectId,  // ref: Workspace
  companyId:   ObjectId,  // ref: Company — DENORMALIZED (no $lookup for tenant checks)
  createdBy:   ObjectId,  // ref: User
  title:       String,    // required, 1–500 chars
  content:     String,    // default ''
  tags:        [String],  // default [] — multikey indexed for tag filtering
  noteType:    String,    // 'private' | 'public' — default 'private'
  isDraft:     Boolean,   // default true
  publishedAt: Date,      // null until first publish — SET ONCE, never updated again
  votesCache:  Number,    // default 0 — denormalized net vote sum (+1/-1 per vote)
  createdAt:   Date,
  updatedAt:   Date
}
```

**Indexes:**
```
{ companyId: 1, workspaceId: 1, isDraft: 1 }    ← private workspace note listing
{ companyId: 1, workspaceId: 1, title: 1 }       ← title prefix search within workspace
{ noteType: 1, isDraft: 1, publishedAt: -1 }     ← public directory, sort by newest
{ noteType: 1, isDraft: 1, votesCache: -1 }      ← public directory, sort by most votes
{ noteType: 1, isDraft: 1, title: 1 }            ← public directory, title prefix search
{ noteType: 1, isDraft: 1, tags: 1 }             ← public directory, filter by tag (multikey)
```

> **Why `publishedAt` instead of `createdAt` for the "newest" sort?**  
> Using `createdAt` would allow gaming the ranking — a note created days ago could be published later and appear at the top. `publishedAt` is set exactly once on the first `isDraft: false` transition and is immutable after that.

> **Why `companyId` denormalized on notes?**  
> Every tenant isolation check hits `notes` directly. Without denormalization, every query would need a `$lookup` to `workspaces` just to get the `companyId` — expensive at 500K documents. Denormalization eliminates that join entirely.

---

### `notehistories`

```ts
{
  _id:         ObjectId,
  noteId:      ObjectId,  // ref: Note
  prevTitle:   String,    // snapshot of title before this edit
  prevContent: String,    // snapshot of content before this edit
  changedBy:   ObjectId,  // ref: User — who made the change
  changedAt:   Date       // ← TTL index lives here
}
```

**Indexes:**
```
{ noteId: 1, changedAt: -1 }                      ← list history for a note, newest first
{ changedAt: 1 }  expireAfterSeconds: 604800       ← TTL: auto-delete after exactly 7 days
```

> History stores only `prevTitle` + `prevContent` snapshots — not tags, votes, or metadata. Only what the user edits gets versioned, keeping history documents lean.

> **Why a separate collection (not an embedded array in note)?**  
> Embedding history would make note documents grow unboundedly. A note with 50 edits could be 30KB+. At 500K notes that becomes a storage catastrophe. A separate TTL-indexed collection is the correct MongoDB pattern.

---

### `notevotes`

```ts
{
  _id:       ObjectId,
  noteId:    ObjectId,  // ref: Note
  voterId:   ObjectId,  // ref: User — the voter
  value:     Number,    // +1 (upvote) or -1 (downvote)
  createdAt: Date
}
```

**Indexes:**
```
{ noteId: 1, voterId: 1 }  unique    ← one vote per user per note; prevents double-voting
{ noteId: 1 }                        ← fetch all votes for a note (for change/retract)
```

> `notes.votesCache` is the fast read path for sorting. `NoteVote` is the source of truth — used for vote changes, retractions, and audit. On every vote write, `votesCache` is updated atomically with `$inc`.

---

### `loginotps`

OTP-based passwordless authentication. The raw 6-digit code is **never persisted** — only its bcrypt hash.

```ts
{
  _id:       ObjectId,
  userId:    ObjectId,  // ref: User
  email:     String,    // lowercase — avoids a join during OTP verification
  otpHash:   String,    // bcrypt hash of the 6-digit OTP
  expiresAt: Date,      // now + 10 minutes — absolute expiry timestamp
  isUsed:    Boolean,   // default false — burned after first successful verify
  attempts:  Number,    // default 0, max 5 — brute-force protection
  createdAt: Date
}
```

**Indexes:**
```
{ userId: 1, isUsed: 1 }              ← OTP lookup — filters to active (unused) tokens only
{ expiresAt: 1 }  expireAfterSeconds: 0  ← TTL: delete exactly when expiresAt is reached
```

> `expireAfterSeconds: 0` on a `Date` field means MongoDB deletes the document at the exact moment stored in `expiresAt`, not N seconds after creation. This is the correct pattern for an absolute expiry timestamp.

**OTP authentication flow:**
```
1. POST /auth/otp/request  → generate 6-digit code → bcrypt hash → save LoginOtp doc → email code
2. POST /auth/otp/verify   → find { userId, isUsed: false } → bcrypt.compare(submitted, otpHash)
3.   Match    → set isUsed: true → issue JWT access + refresh tokens
4.   No match → $inc attempts → if attempts ≥ 5 → set isUsed: true (token burned)
5. TTL index auto-deletes expired OTP docs — no cron, no cleanup code needed
```

---

## API Design

> All endpoints are prefixed with `/api/v1`

### Auth
| Method | Endpoint               | Description                                               |
|--------|------------------------|-----------------------------------------------------------|
| POST   | `/auth/register`       | Register company + owner user                             |
| POST   | `/auth/otp/request`    | Send OTP to email (bcrypt-hashed before storing)          |
| POST   | `/auth/otp/verify`     | Verify OTP → issue JWT access + refresh tokens            |
| POST   | `/auth/token/refresh`  | Refresh access token using refresh token                  |
| POST   | `/auth/logout`         | Client-side token discard                                 |

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

```ts
// Every note query — companyId always first, workspaceId second
const notes = await Note
  .find({ companyId: req.user.companyId, workspaceId })
  .select('title tags noteType isDraft votesCache publishedAt createdAt')
  .lean();
```

There is no database-level row security (MongoDB doesn't have PostgreSQL-style RLS), so discipline at the service layer is critical. A middleware helper `tenantScope(req)` returns `{ companyId: req.user.companyId }` and is spread into every query filter.

### Draft Mode

- Notes have an `isDraft` boolean field (default `true`) separate from `noteType`
- Drafts are **never** included in public directory queries: `{ noteType: 'public', isDraft: false }`
- Draft notes appear only in the private workspace view with an orange **DRAFT** badge
- Publishing: `POST /notes/:id/publish` sets `isDraft: false` and — if `publishedAt` is null — sets `publishedAt: new Date()` exactly once
- A note can be `noteType: 'public'` while still being a draft — `isDraft` controls whether it's live, `noteType` determines where it goes once live

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

Votes are stored in a dedicated `NoteVote` collection — one document per user per note. The `notes.votesCache` field holds the net sum and is used for fast sorting without aggregation.

```ts
// Cast a vote — two atomic operations in a MongoDB session
const session = await mongoose.startSession();
session.startTransaction();

// 1. Upsert the vote record — unique index prevents double voting
await NoteVote.create([{ noteId, voterId: userId, value: +1 }], { session });

// 2. Increment the cache on the note atomically
await Note.updateOne(
  { _id: noteId, noteType: 'public', isDraft: false },
  { $inc: { votesCache: +1 } },
  { session }
);

await session.commitTransaction();
```

- **Changing a vote:** Load the existing `NoteVote`, decrement the old value from `votesCache`, update the vote doc, increment the new value — all in one session
- **Cross-company voting:** Any authenticated user from any company can vote on public notes
- **Double-vote prevention:** The unique index `{ noteId: 1, voterId: 1 }` on `NoteVote` is the hard guard — not an application-layer check

### Public Directory

- Queries: `{ noteType: 'public', isDraft: false }` — covered by the compound indexes defined in the `Note` schema
- Includes workspace name (populated via `workspaceId` ref — single `populate` on listing)
- Cursor-based pagination using `_id` as cursor
- Sort options map directly to existing indexes:

```ts
const sortMap: Record<string, object> = {
  newest:        { publishedAt: -1 },   // uses { noteType, isDraft, publishedAt } index
  oldest:        { publishedAt: 1  },
  most_votes:    { votesCache: -1  },   // uses { noteType, isDraft, votesCache } index
  least_votes:   { votesCache: 1   }
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
- Random `noteType` (70% `private`, 30% `public`) and `isDraft` (80% false, 20% true)
- `publishedAt` set for all non-draft notes, null for drafts
- Random `votesCache` values on public non-draft notes, with corresponding `NoteVote` documents
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
| Authentication | OTP-based passwordless — raw code never stored, only bcrypt hash (`LoginOtp` model) |
| OTP Brute Force | `attempts` counter on `LoginOtp`, max 5 — token burned on breach |
| OTP Expiry | TTL index auto-deletes `LoginOtp` docs at `expiresAt` — no cleanup code needed |
| Token Issuance | JWT access token (15m) + refresh token (7d) issued after OTP verify |
| Authorization | `companyId` from verified JWT injected into every DB query via `tenantScope()` middleware |
| NoSQL Injection | Mongoose strict schemas reject unexpected operator keys; `express-mongo-sanitize` strips `$` and `.` from all request bodies |
| Rate Limiting | `express-rate-limit` on OTP request endpoint (prevents OTP spam) and vote endpoint |
| HTTPS | Enforced in production via reverse proxy (Nginx) |
| Tenant Isolation | `companyId` filter mandatory in all service functions — no query runs without it |
| Input Validation | Zod schema validation on all request bodies before hitting the DB |
| CORS | Strict origin whitelist via `cors` package |
| Secrets | Environment variables only — `.env` is gitignored |
| Sensitive fields | `otpHash` never returned in API responses via Mongoose `select: false` |

---

## Performance & Scalability

### Index Summary

```ts
// companies
{ email: 1 }  unique

// users
{ companyId: 1, email: 1 }  unique
{ companyId: 1 }

// workspaces
{ companyId: 1 }
{ companyId: 1, name: 1 }

// notes
{ companyId: 1, workspaceId: 1, isDraft: 1 }    // private workspace listing
{ companyId: 1, workspaceId: 1, title: 1 }       // title search within workspace
{ noteType: 1, isDraft: 1, publishedAt: -1 }     // public directory — newest
{ noteType: 1, isDraft: 1, votesCache: -1 }      // public directory — most votes
{ noteType: 1, isDraft: 1, title: 1 }            // public directory — title search
{ noteType: 1, isDraft: 1, tags: 1 }             // public directory — tag filter (multikey)

// notehistories
{ noteId: 1, changedAt: -1 }
{ changedAt: 1 }  expireAfterSeconds: 604800     // TTL — 7 days

// notevotes
{ noteId: 1, voterId: 1 }  unique
{ noteId: 1 }

// loginotps
{ userId: 1, isUsed: 1 }
{ expiresAt: 1 }  expireAfterSeconds: 0          // TTL — absolute expiry
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

```ts
// ✅ Correct — uses index, O(1) seek
const notes = await Note.find({
  noteType: 'public',
  isDraft: false,
  _id: { $gt: new mongoose.Types.ObjectId(cursor) }
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
| `NoteVote` collection too large | Archive old votes; only keep last 90 days for audit |
| History storage bloat | Reduce TTL env var to 3 days; store title-only diffs when content unchanged |
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
| Language | TypeScript | Type-safe Mongoose schemas, interface-driven models |
| Backend | Node.js + Express | Familiar, fast to set up, great MongoDB ecosystem |
| Database | MongoDB Atlas M0 (Free) | Zero infra setup, document model suits notes, instant Atlas spin-up |
| ODM | Mongoose | Schema validation, TTL index declarations, pre-save hooks for history |
| Auth | OTP + JWT + bcrypt | Passwordless — no password storage risk; bcrypt hashes OTP before persist |
| Scheduler | node-cron | Lightweight, in-process safety-net for history cleanup |
| In-process Cache | node-cache | Avoids Redis infra complexity for this scale |
| Input Validation | Zod | Schema-first, TypeScript-friendly |
| Security | express-mongo-sanitize, express-rate-limit, helmet | Standard Express security stack |
| Frontend | `[Express + EJS templates / React / Plain HTML]` | `[Your reason]` |
| Seeder | Custom script with insertMany batching | Fast bulk inserts, `ordered: false` for parallelism |

---

## Project Structure

```
/
├── src/
│   ├── config/
│   │   ├── db.ts              # Mongoose connection
│   │   └── env.ts             # Env var validation (Zod)
│   ├── middleware/
│   │   ├── auth.ts            # JWT verify, attach req.user
│   │   ├── tenantScope.ts     # Injects companyId into all queries
│   │   ├── rateLimiter.ts     # OTP, vote, auth rate limits
│   │   └── errorHandler.ts    # Global error handler
│   ├── models/
│   │   ├── Company.ts         # isVerified, email unique index
│   │   ├── User.ts            # companyId+email compound unique, isActive
│   │   ├── Workspace.ts       # companyId + name indexes
│   │   ├── Note.ts            # isDraft + noteType dual-axis, votesCache, publishedAt
│   │   ├── NoteHistory.ts     # changedAt TTL index (7 days)
│   │   ├── NoteVote.ts        # noteId+voterId unique index, value +1/-1
│   │   └── LoginOtp.ts        # otpHash (bcrypt), attempts, expiresAt TTL index
│   ├── modules/
│   │   ├── auth/              # OTP request, OTP verify, token refresh
│   │   ├── workspaces/        # Workspace CRUD
│   │   ├── notes/             # Note CRUD, publish
│   │   ├── history/           # History list, restore
│   │   ├── votes/             # Vote cast, change, retract
│   │   └── public/            # Public directory listing
│   ├── jobs/
│   │   └── cleanupHistory.ts  # node-cron safety-net (TTL index is primary)
│   └── scripts/
│       └── seed.ts            # 500K note seeder with insertMany batching
├── frontend/
│   ├── pages/
│   └── components/
├── .env.example
├── .gitignore
├── tsconfig.json
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
# Add your MongoDB Atlas connection string and SMTP config to .env
```

### Database Setup

MongoDB Atlas creates collections automatically on first insert. All indexes (including the TTL indexes on `loginotps.expiresAt` and `notehistories.changedAt`) are declared in Mongoose schemas and registered automatically on app startup — no manual migration step needed.

```bash
# (Optional) Seed with large dataset — takes 3–8 minutes
npm run seed
```

### Run Development Server

```bash
npm run dev
```

The server starts, connects to Atlas, and registers all Mongoose indexes automatically. Check the console for `[MongoDB] Connected` and `[Indexes] All ensured` confirmation logs.

---

## Environment Variables

```env
# MongoDB
MONGODB_URI=mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/workspace_notes?retryWrites=true&w=majority

# JWT
JWT_SECRET=your-very-long-random-secret-min-32-chars
JWT_EXPIRY=15m
REFRESH_TOKEN_SECRET=another-long-random-secret-min-32-chars
REFRESH_TOKEN_EXPIRY=7d

# OTP
OTP_EXPIRY_MINUTES=10         # How long before an OTP link expires
OTP_BCRYPT_ROUNDS=10          # bcrypt cost factor for OTP hashing
SMTP_HOST=smtp.example.com    # Email delivery for OTP codes
SMTP_PORT=587
SMTP_USER=your@email.com
SMTP_PASS=yourpassword

# App
PORT=3000
NODE_ENV=development

# History Retention
HISTORY_TTL_SECONDS=604800    # 7 days — also set in TTL index on model

# Rate Limiting
VOTE_RATE_LIMIT_WINDOW_MS=60000
VOTE_RATE_LIMIT_MAX=10
OTP_RATE_LIMIT_MAX=5          # Max OTP requests per window per IP
AUTH_RATE_LIMIT_MAX=10
```

---

## Known Limitations & Future Work

| Item | Status | Notes |
|---|---|---|
| API route handlers + service layer | Not yet implemented | Models + schema design complete; routes are next |
| Frontend UI | Not yet implemented | Page map and behaviors documented above |
| Redis caching | Replaced with node-cache | For production, Redis is the correct choice for distributed caching |
| PostgreSQL | Replaced with MongoDB | PostgreSQL with RLS would be stronger for multi-tenant isolation at scale |
| Atlas Search | Using compound indexes for title sort | Atlas Search (Lucene) would give better relevance; free on Atlas M0 |
| Real-time collaboration | Not in scope | Would use WebSockets / CRDTs |
| File attachments in notes | Not in scope | Would use S3 + signed URLs |
| Content search | Title-prefix only | Full content search would need Atlas Search |
| 512MB storage ceiling | Active constraint | History TTL and `NoteVote` lean documents are critical; upgrade to M2 for production |
| SMTP for OTP delivery | Env var configured, not wired | SMTP client (Nodemailer) needs to be connected to OTP request handler |

---

## Author

`Syed Sharful Islam Sifat`  
Built as part of a Full-Stack Developer assessment task  
Date: `22 May 2026`