# Multitenant — Backend

This is a detailed explanation of Secure SaaS notes system. I have tried to explain how I have thought about the system by the time of implementation I found this is a complex system that can't be implemented with that much of time so I decided rather implementing the system it will be feasible to sketch the whole system design if the design is crystal clear then implementation will not take much time

# 🗒️ Workspace Notes — Multi-Tenant SaaS Notes System

> A production-grade, multi-tenant SaaS notes platform built for companies to manage workspaces, collaborate on notes, and publish content publicly.

---

## 📑 Table of Contents

- [Project Overview](#project-overview)
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

**What was scoped for design (not full implementation due to time constraints):**
- Full system design, database schema, API contract, background job strategy, and UI wireflow are documented here
- Partial implementation covers: `[list what was actually implemented]`

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                          Client (Browser)                        │
│              Next.js / React SPA / Plain HTML+JS                 │
└────────────────────────────┬─────────────────────────────────────┘
                             │ HTTP/REST (or tRPC)
┌────────────────────────────▼─────────────────────────────────────┐
│                        API Server (Node.js)                      │
│              Express / Fastify / Next.js API Routes              │
│                                                                  │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│   │  Auth Layer  │  │  Note Router │  │  Public Dir Router   │  │
│   │  (JWT/Session│  │  (CRUD, Vote)│  │  (Public Listings)   │  │
│   └──────────────┘  └──────────────┘  └──────────────────────┘  │
└────────────────────────────┬─────────────────────────────────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
┌─────────▼──────┐  ┌────────▼───────┐  ┌──────▼──────────┐
│   PostgreSQL   │  │     Redis      │  │  Job Queue       │
│  (Primary DB)  │  │  (Cache/Rate   │  │  (BullMQ /       │
│                │  │   Limiting)    │  │   pg-boss /      │
│                │  │                │  │   cron offload)  │
└────────────────┘  └────────────────┘  └─────────────────┘
```

**Architecture decisions:**
- `[Explain why you chose your framework — e.g., Next.js for SSR + API routes in one repo]`
- `[Explain why PostgreSQL — relational integrity, JSONB for tags, full-text search]`
- `[Explain why Redis — caching hot public note listings, rate limiting votes]`
- `[Explain job queue choice — pg-boss keeps it in Postgres, no extra infra; BullMQ needs Redis but more robust]`

---

## Database Design

> 📎 **Full ERD Link:** `[Insert link to your DB diagram — dbdiagram.io, Lucidchart, DrawSQL, etc.]`

### Entity Overview

```
companies
  └── workspaces
        └── notes
              ├── note_tags  →  tags
              ├── note_votes
              └── note_histories
users
  └── (belongs to a company)
```

### Tables

#### `companies`
| Column       | Type        | Notes                        |
|--------------|-------------|------------------------------|
| id           | UUID (PK)   | Primary key                  |
| name         | VARCHAR     | Company name                 |
| slug         | VARCHAR     | Unique URL-safe identifier   |
| created_at   | TIMESTAMPTZ |                              |

#### `users`
| Column       | Type        | Notes                                  |
|--------------|-------------|----------------------------------------|
| id           | UUID (PK)   |                                        |
| company_id   | UUID (FK)   | Tenant isolation — scoped to company   |
| email        | VARCHAR     | Unique                                 |
| password_hash| VARCHAR     |                                        |
| role         | ENUM        | `owner`, `member`                      |
| created_at   | TIMESTAMPTZ |                                        |

#### `workspaces`
| Column       | Type        | Notes                              |
|--------------|-------------|-------------------------------------|
| id           | UUID (PK)   |                                     |
| company_id   | UUID (FK)   | Tenant scoping                      |
| name         | VARCHAR     |                                     |
| created_at   | TIMESTAMPTZ |                                     |

#### `notes`
| Column         | Type        | Notes                                             |
|----------------|-------------|---------------------------------------------------|
| id             | UUID (PK)   |                                                   |
| workspace_id   | UUID (FK)   |                                                   |
| company_id     | UUID (FK)   | Denormalized for faster tenant-scoped queries     |
| title          | VARCHAR     | Indexed for search                                |
| content        | TEXT        |                                                   |
| type           | ENUM        | `public`, `private`                               |
| status         | ENUM        | `draft`, `published`                              |
| created_by     | UUID (FK → users) |                                             |
| updated_by     | UUID (FK → users) |                                             |
| created_at     | TIMESTAMPTZ |                                                   |
| updated_at     | TIMESTAMPTZ |                                                   |

> **Index strategy:**
> - `(company_id, workspace_id)` — tenant-scoped workspace queries
> - `(type, status)` — public published note listings
> - `title` with `pg_trgm` GIN index — fast ILIKE / full-text title search
> - `(type, status, created_at DESC)` — public directory sorted by newest

#### `tags`
| Column | Type      | Notes          |
|--------|-----------|----------------|
| id     | UUID (PK) |                |
| name   | VARCHAR   | Unique per tag |

#### `note_tags` *(junction table)*
| Column  | Type      |
|---------|-----------|
| note_id | UUID (FK) |
| tag_id  | UUID (FK) |

> Composite PK on `(note_id, tag_id)`

#### `note_votes`
| Column      | Type      | Notes                                        |
|-------------|-----------|----------------------------------------------|
| id          | UUID (PK) |                                              |
| note_id     | UUID (FK) |                                              |
| voter_id    | UUID (FK) | Can be user or anonymous fingerprint         |
| company_id  | UUID (FK) | The voter's company (for cross-company votes)|
| vote_type   | ENUM      | `upvote`, `downvote`                         |
| created_at  | TIMESTAMPTZ |                                            |

> Unique constraint on `(note_id, voter_id)` — one vote per user per note.

#### `note_histories`
| Column       | Type        | Notes                                      |
|--------------|-------------|--------------------------------------------|
| id           | UUID (PK)   |                                            |
| note_id      | UUID (FK)   |                                            |
| prev_title   | VARCHAR     | Snapshot of title before change            |
| prev_content | TEXT        | Snapshot of content before change          |
| changed_by   | UUID (FK → users) |                                      |
| changed_at   | TIMESTAMPTZ | Indexed — used for 7-day TTL cleanup       |

> **Index:** `(note_id, changed_at DESC)` — fast history retrieval per note  
> **Cleanup index:** `changed_at` — used by background job to delete old records

---

## API Design

> All endpoints are prefixed with `/api/v1`

### Auth
| Method | Endpoint            | Description          |
|--------|---------------------|----------------------|
| POST   | `/auth/register`    | Register company + owner user |
| POST   | `/auth/login`       | Login, returns JWT   |
| POST   | `/auth/logout`      | Invalidate session   |

### Workspaces *(authenticated, tenant-scoped)*
| Method | Endpoint                     | Description            |
|--------|------------------------------|------------------------|
| GET    | `/workspaces`                | List my company's workspaces |
| POST   | `/workspaces`                | Create workspace       |
| GET    | `/workspaces/:id`            | Get single workspace   |
| PUT    | `/workspaces/:id`            | Update workspace       |
| DELETE | `/workspaces/:id`            | Delete workspace       |

### Notes *(authenticated)*
| Method | Endpoint                            | Description                        |
|--------|-------------------------------------|------------------------------------|
| GET    | `/workspaces/:wid/notes`            | List notes in workspace (private)  |
| POST   | `/workspaces/:wid/notes`            | Create note                        |
| GET    | `/workspaces/:wid/notes/:id`        | Get note detail                    |
| PUT    | `/workspaces/:wid/notes/:id`        | Update note (triggers history)     |
| DELETE | `/workspaces/:wid/notes/:id`        | Delete note                        |
| POST   | `/workspaces/:wid/notes/:id/publish`| Publish a draft note               |

### Note History *(authenticated)*
| Method | Endpoint                                     | Description               |
|--------|----------------------------------------------|---------------------------|
| GET    | `/notes/:id/history`                         | List history entries      |
| POST   | `/notes/:id/history/:hid/restore`            | Restore a history entry   |

### Public Directory *(unauthenticated)*
| Method | Endpoint                       | Description                                            |
|--------|--------------------------------|--------------------------------------------------------|
| GET    | `/public/notes`                | List all public published notes (sortable, searchable) |
| GET    | `/public/notes/:id`            | Single public note detail                              |
| POST   | `/public/notes/:id/vote`       | Upvote or downvote a public note                       |

**Query params for `/public/notes`:**
- `search=` — title search (ILIKE with trigram index)
- `sort=` — `newest`, `oldest`, `most_upvotes`, `most_downvotes`
- `page=`, `limit=` — pagination (cursor-based preferred at scale)

---

## Core Features

### Multi-Tenancy

Every database query is scoped by `company_id`. This is enforced at the service layer, not just the route level.

**Strategy:**
- `company_id` is extracted from the authenticated JWT on every request
- All queries include `WHERE company_id = $company_id` — no exceptions
- Row-Level Security (RLS) in PostgreSQL can be used as an additional backstop

```
// Pseudocode — every note query is tenant-scoped
getNotes(companyId, workspaceId) {
  SELECT * FROM notes
  WHERE company_id = $companyId
    AND workspace_id = $workspaceId
}
```

### Draft Mode

- Notes have a `status` field: `draft` | `published`
- Drafts are **never** included in public directory listings
- Draft notes are only visible to the owning workspace members
- Publishing a draft: `POST /notes/:id/publish` — sets `status = 'published'`
- UI shows a "DRAFT" badge on unpublished notes in the private workspace view

### History System

- On every `PUT /notes/:id` request, before applying the update:
  1. Read current `title` + `content` from DB
  2. Insert a row into `note_histories` with the previous values + `changed_by` + `changed_at = NOW()`
  3. Apply the new update to `notes`
- Users can view history via the history page and click "Restore" to revert

**Restore flow:**
1. `POST /notes/:id/history/:hid/restore`
2. Server reads `prev_title` and `prev_content` from the history entry
3. Server saves current state as a new history entry (so restore is itself undoable)
4. Applies the historical values to the current note

### Note Voting

- Any authenticated user (including from other companies) can vote on public notes
- Unique constraint prevents double voting: `(note_id, voter_id)`
- Vote counts are aggregated with `COUNT(CASE WHEN vote_type = 'upvote' THEN 1 END)` — or maintained as a denormalized counter column updated via trigger/service for performance
- `[Explain your chosen vote count strategy — real-time aggregate vs. cached counter]`

### Public Directory

- Lists all notes where `type = 'public' AND status = 'published'`
- Includes workspace name and tags in the response
- Supports sorting and title search
- No authentication required

---

## History Cleanup Strategy (7-Day Retention)

### The Problem
With ~500K notes and frequent edits, the `note_histories` table can grow very large. We need to delete entries older than 7 days reliably without impacting server performance.

### The Solution: Offloaded Background Job

**Approach: Database-native scheduled job using `pg-boss` (or equivalent)**

The cleanup is handled as an **asynchronous background job**, completely decoupled from the web server request cycle.

#### Why `pg-boss`?
- Uses PostgreSQL as its own queue — no extra infrastructure (no Redis, no separate worker service needed)
- Jobs are persisted and survive server restarts
- Supports cron-style scheduling
- Transactional — job state changes are ACID-safe

#### Job Definition

```js
// Scheduled once on server startup
boss.schedule('cleanup-note-history', '0 2 * * *', {}); 
// Runs every day at 2:00 AM UTC

boss.work('cleanup-note-history', async () => {
  await db.query(`
    DELETE FROM note_histories
    WHERE changed_at < NOW() - INTERVAL '7 days'
  `);
});
```

#### Why this doesn't stress the server:
1. **Runs at off-peak hours** — scheduled at 2 AM UTC when traffic is lowest
2. **Async / non-blocking** — runs in a separate worker process, not in the HTTP request thread
3. **Single DELETE with index** — `changed_at` is indexed, so the DELETE is fast and doesn't do a full table scan
4. **Batched deletion (optional for very large tables):**

```js
// Delete in chunks of 10,000 to avoid long lock holds
async function cleanupInBatches() {
  let deleted = 0;
  do {
    const result = await db.query(`
      DELETE FROM note_histories
      WHERE id IN (
        SELECT id FROM note_histories
        WHERE changed_at < NOW() - INTERVAL '7 days'
        LIMIT 10000
      )
    `);
    deleted = result.rowCount;
    await sleep(500); // Brief pause between batches
  } while (deleted > 0);
}
```

5. **PostgreSQL autovacuum** will reclaim space after deletion automatically

#### Alternative: PostgreSQL Native Partitioning
For extremely high-volume history, partition the `note_histories` table by week. Dropping an old partition is near-instant and zero-cost vs. row-level DELETEs.

```sql
-- Partition by changed_at (weekly)
CREATE TABLE note_histories (...)
PARTITION BY RANGE (changed_at);

-- Drop old partitions instead of DELETE
DROP TABLE note_histories_week_2024_01_01; -- instant
```

**`[Explain which approach you chose and why]`**

---

## Large Data Seeder

The seeder populates:
- ~1,000 workspaces (spread across ~50 fake companies, ~20 workspaces each)
- ~500,000 notes (500 per workspace on average)
- Realistic titles, content (lorem + tech/business vocabulary mix)
- Random tags (5–15 unique tags per note from a pool of ~100 tags)
- Random vote distributions on public notes
- History entries (2–5 per note)
- Mix of draft/published, public/private

**Run seeder:**
```bash
npm run seed
# or
node scripts/seed.js
```

**Performance considerations for seeding:**
- Uses `COPY` or bulk `INSERT ... VALUES` with batches of 1,000 rows — much faster than individual inserts
- Disables indexes during seed, re-enables after (for large tables)
- Runs in a transaction per batch

`[Explain estimated seed time and how you optimized it]`

---

## Security Considerations

| Concern | Approach |
|---|---|
| Authentication | JWT with short expiry (15m access + refresh token) |
| Authorization | Every query scoped to `company_id` from verified JWT |
| SQL Injection | Parameterized queries only — no string concatenation |
| Rate Limiting | Redis-based rate limiting on vote endpoint (prevent vote stuffing) |
| Password Storage | bcrypt with cost factor ≥ 12 |
| HTTPS | Enforced in production via reverse proxy (Nginx / Caddy) |
| Tenant Isolation | `company_id` enforced in every service-layer query, not just routes |
| Input Validation | Zod / Joi schema validation on all request bodies |
| CORS | Strict origin whitelist |
| Secrets | Env vars only — never hardcoded |

---

## Performance & Scalability

### Database Indexes (summary)

```sql
-- Note search
CREATE INDEX idx_notes_title_trgm ON notes USING GIN (title gin_trgm_ops);

-- Tenant-scoped workspace queries
CREATE INDEX idx_notes_company_workspace ON notes (company_id, workspace_id);

-- Public directory sorted listings
CREATE INDEX idx_notes_public_created ON notes (type, status, created_at DESC)
  WHERE type = 'public' AND status = 'published';

-- History cleanup
CREATE INDEX idx_note_histories_changed_at ON note_histories (changed_at);

-- Vote aggregation
CREATE INDEX idx_votes_note ON note_votes (note_id, vote_type);
```

### Caching Strategy

- Public note listing (top page of public directory) cached in Redis with 60s TTL
- Cache invalidated on new public note published or vote change
- `[Describe cache key structure]`

### Pagination

- Public directory uses **cursor-based pagination** (keyset pagination on `created_at + id`) to avoid OFFSET performance degradation at large page numbers
- Private workspace note list uses offset pagination (smaller dataset, acceptable)

### Scalability Path

| Scale Trigger | Action |
|---|---|
| DB reads bottleneck | Add read replica, route reads there |
| Vote table too hot | Use Redis counter + async DB sync |
| History table huge | Switch to range partitioning by week |
| Search too slow | Migrate to Elasticsearch / Typesense |
| 10M+ notes | Horizontal DB sharding by `company_id` |

---

## UI Pages & Flows

### Page Map

```
/login                    — Login page
/register                 — Company registration
/dashboard                — Workspace list (private, owner only)
/workspaces/:id/notes     — Note list in workspace (search by title)
/workspaces/:id/notes/new — Create note
/notes/:id/edit           — Edit note (with draft indicator)
/notes/:id/history        — History list + restore
/public                   — Public notes directory (search, sort, vote)
/public/:id               — Single public note view
```

### Key UI Behaviors

- **Draft indicator:** Orange "DRAFT" badge shown on unpublished notes in workspace view and editor
- **History view:** Timeline list of previous versions; each entry shows changed timestamp, changed by, and a "Restore" button
- **Public directory sort:** Dropdown — Newest / Oldest / Most Upvoted / Most Downvoted
- **Search:** Debounced title search input (300ms delay) on both private list and public directory
- **Voting:** Upvote/downvote buttons on public note cards; user's current vote is highlighted; one vote per note

---

## Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| Backend | `[Node.js + Express / Fastify / Next.js API]` | `[Your reason]` |
| Database | PostgreSQL | Relational integrity, JSONB, full-text search, RLS |
| Cache | Redis | Fast read cache, rate limiting |
| Job Queue | `[pg-boss / BullMQ / node-cron]` | `[Your reason]` |
| ORM / Query | `[Prisma / Drizzle / Knex / raw pg]` | `[Your reason]` |
| Auth | JWT + bcrypt | Stateless, scalable |
| Frontend | `[Next.js / React / Plain HTML]` | `[Your reason]` |
| Validation | `[Zod / Joi]` | Schema-first validation |
| Seeder | Custom script | Bulk insert with realistic data |

---

## Project Structure

```
/
├── src/
│   ├── config/           # DB, Redis, env config
│   ├── middleware/        # Auth, rate limit, error handler
│   ├── modules/
│   │   ├── auth/          # Login, register, JWT
│   │   ├── workspaces/    # Workspace CRUD
│   │   ├── notes/         # Note CRUD, publish, draft
│   │   ├── history/       # History list, restore
│   │   ├── votes/         # Vote endpoint
│   │   └── public/        # Public directory
│   ├── jobs/              # Background job definitions
│   │   └── cleanupHistory.js
│   ├── db/
│   │   ├── migrations/    # SQL migration files
│   │   └── schema.sql     # Full schema reference
│   └── scripts/
│       └── seed.js        # Large data seeder
├── frontend/              # UI (if separate)
│   ├── pages/
│   └── components/
├── .env.example
├── docker-compose.yml
└── README.md
```

---

## Getting Started

### Prerequisites
- Node.js ≥ 18
- PostgreSQL ≥ 15
- Redis ≥ 7

### Installation

```bash
git clone [repo-url]
cd workspace-notes
npm install
cp .env.example .env
# Edit .env with your DB credentials
```

### Database Setup

```bash
# Run migrations
npm run migrate

# (Optional) Seed with large dataset
npm run seed
```

### Run Development Server

```bash
npm run dev
```

### Run Background Job Worker

```bash
npm run worker
# This starts the pg-boss / BullMQ worker that handles scheduled cleanup
```

---

## Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/workspace_notes

# Redis
REDIS_URL=redis://localhost:6379

# Auth
JWT_SECRET=your-very-long-random-secret
JWT_EXPIRY=15m
REFRESH_TOKEN_SECRET=another-long-secret
REFRESH_TOKEN_EXPIRY=7d

# App
PORT=3000
NODE_ENV=development

# Rate Limiting
VOTE_RATE_LIMIT_WINDOW_MS=60000
VOTE_RATE_LIMIT_MAX=10
```

---

## Known Limitations & Future Work

| Item | Status | Notes |
|---|---|---|
| Full implementation | Scoped to design | Time constraint — full implementation would require ~3-4 days |
| Email verification | Not implemented | Would add on next iteration |
| Real-time collaboration | Not in scope | Would use WebSockets / CRDTs |
| File attachments in notes | Not in scope | Would use S3 + signed URLs |
| Admin panel | Not in scope | For managing companies/users |
| Full-text content search | Title only | Content search would need Elasticsearch |
| Anonymous voting | Not implemented | Would use browser fingerprinting |

---

## Author

`[Your Name]`  
Built as part of a Full-Stack Developer assessment task  
Date: `[Date]`