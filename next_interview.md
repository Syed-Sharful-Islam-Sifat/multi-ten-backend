# Appifylab Onsite Interview — Full Preparation Guide

**Position:** Mid-Senior Full Stack Engineer  
**Company:** Appifylab (EzyCourse, EzyStudio, EzyCommunity)  
**Interview day:** Friday  
**Travel:** Thursday night → Sylhet (Modina Market, Akther Shopping City 4th/5th Floor)

---

## Part 1 — Your Task: Architecture Defense Guide

This is where the interview will almost certainly start. Two or three senior engineers will open your repository and ask you to walk them through it. They will probe your decisions, not just read them. Be ready to explain every choice and its trade-off.

---

### The Overall Architecture Choice

**What you'll be asked:** Why monolith? Why not microservices?

**How to answer:**

> "The timeline didn't justify the operational overhead of microservices — separate deployments, inter-service communication, distributed tracing. A well-structured monolith with clear internal boundaries is the right tradeoff at this stage. I separated concerns strictly into routes, controllers, and services so that if I needed to extract a service later, it would be a refactor, not a rewrite. The boundaries are already there — they just live in one process."

The key phrase: **"a refactor, not a rewrite."** It shows you understand both paths.

---

### Why MongoDB Over a Relational Database

**What you'll be asked:** Why MongoDB? Would you use it again?

**How to answer:**

> "The document model fits the data naturally. A post with its author reference and metadata is one document, not a join across tables. MongoDB also handles schema flexibility well during early product development. That said, I'd be honest that for a multi-tenant SaaS product with complex relational queries — like EzyCourse — PostgreSQL with proper indexing would likely be a better long-term choice. MongoDB made sense for this assignment given the timeline and data shape."

Do not oversell MongoDB. Appifylab uses MySQL/PostgreSQL. Showing you understand MongoDB's limits is stronger than defending it unconditionally.

---

### Layered Architecture: Routes → Controllers → Services

**What you'll be asked:** Why no repository layer?

**How to answer:**

> "Mongoose models already provide the abstraction a repository layer gives you — `Post.findById()`, `Post.create()`, `Post.updateOne()` are a clean enough interface. Adding a repository on top would mean writing wrappers that do nothing except call Mongoose. I kept the split that actually mattered: controllers know about HTTP, services know about the domain. Services receive plain arguments and throw typed errors. That means I can test the entire business logic layer without spinning up an HTTP server."

---

### Cursor Pagination vs Offset Pagination

**What you'll be asked:** Why cursor? How does it work?

**How to answer:**

> "Offset pagination — `SKIP 20 LIMIT 20` — has two problems. First, it gets slow on deep pages because the database still scans and discards the skipped rows. Second, it breaks when new content arrives between page loads: if five new posts appear, your second page of 20 repeats four you already saw. Cursor pagination is a range query on an indexed field — `_id: { $lt: lastSeenId }`. It's always O(log n) because it uses the index directly. And it's stable: new posts appearing at the top don't shift what's on the next page."

---

### Why a Separate Like Collection Instead of an Embedded Array

**What you'll be asked:** Why not `likes: [userId]` on the post?

**How to answer:**

> "Two problems with embedding. First, MongoDB documents have a 16MB size limit. An unbounded array of user IDs on a viral post will eventually hit it. Second, checking `likedByMe` on an embedded array is O(n) — you scan every user ID in the array. With a separate Like collection and a unique compound index on `{ userId, targetId, targetType }`, the duplicate-like prevention is at the database level, not application level, and the lookup is O(log n). The index also prevents a race condition — two simultaneous like requests can't both insert."

---

### The Single Comment Collection (Comments + Replies)

**What you'll be asked:** Why not a separate replies collection?

**How to answer:**

> "Comments and replies are structurally identical — same fields, same author reference, same like behavior. A separate collection would mean two sets of routes, controllers, service functions, and indexes for data that differs by exactly one field: `parentId`. One collection, one schema, one index strategy. The depth cap — no replies to replies — is enforced in the service layer. When `createReply` is called, I fetch the parent and check if its own `parentId` is non-null. If it is, I reject with 400. It's a code constraint, not just a convention."

---

### Denormalized Counters (`likeCount`, `commentCount`, `replyCount`)

**What you'll be asked:** Why store counts instead of counting at query time?

**How to answer:**

> "Counting from the Like or Comment collection on every feed request means a join-equivalent aggregation on every page load. At scale that's expensive. I maintain atomic counters using MongoDB's `$inc` operator, which is atomic at the document level. Concurrent writes cannot produce an incorrect count. The trade-off is that if a crash happens mid-operation — between creating the comment and incrementing the counter — the counter can drift by one. At this scale that's an acceptable trade-off. At larger scale I'd use a background reconciliation job to periodically recount and correct drift."

---

### Cascade Delete Design

**What you'll be asked:** How does deleting a post clean up its data?

**How to answer:**

> "Deleting a post runs three operations in parallel via `Promise.all`: delete the post, delete all its comments, and delete all likes where `postId` matches. That last part is the key design decision. The Like document stores a denormalized `postId` field. Without it, to find all likes on a post's comments, I'd have to load all comment IDs into memory first, then query likes with `$in`. That's two queries and potentially a large in-memory list. With `postId` on Like, it's one query. The same pattern applies for deleting a comment — `parentCommentId` on Like documents enables one-query cleanup of all reply likes without loading reply IDs."

---

### Authentication: JWT in httpOnly Cookie

**What you'll be asked:** Why cookie instead of localStorage?

**How to answer:**

> "A JWT in localStorage is accessible to JavaScript running on the page — meaning any XSS vulnerability can steal the token. An httpOnly cookie is completely inaccessible to JavaScript. The browser sends it automatically with every same-origin request. Combined with the `SameSite=None; Secure` flag for cross-origin setups, this is the more secure pattern. The trade-off is that cookies require CSRF protection for state-changing requests, but my API is stateless and JWT-verified, so CSRF is not a practical risk here."

---

### Timing-Safe Login

**What you'll be asked (if they read the code closely):** What is this line doing?

```ts
const passwordHash = user?.passwordHash ?? '$2b$12$invalidhashpaddingtomaintaintiming0000000000000';
```

**How to answer:**

> "This is a timing attack prevention. If the user doesn't exist, I don't want to skip the bcrypt compare and return immediately. An attacker could measure the response time difference and use it to enumerate valid email addresses — a fast response means the email doesn't exist. By always running bcrypt.compare, even with a dummy hash when the user isn't found, both paths take approximately the same amount of time."

---

### `requireAuth` Database Hit on Every Request

**What you'll be asked:** Your auth middleware hits the database on every request. Is that a problem?

**How to answer honestly:**

> "Yes, it's a known trade-off. I fetch the user from the database on every authenticated request to ensure the user still exists and hasn't been deleted or suspended. The alternative is to store the full user payload in the JWT itself and skip the database lookup — that's faster, but then a deleted or banned user can keep making requests until their token expires. For this project, the database hit is acceptable. At scale I'd use Redis to cache the user record with a short TTL — say 30 seconds — so the first request hits the database and subsequent requests hit the cache."

This is a real gap. Acknowledging it and knowing the fix is better than pretending it doesn't exist.

---

## Part 2 — Real Gaps in Your Implementation

These are things that are genuinely missing. Know them before they find them.

---

### 1. No Redis Caching Layer

**Gap:** Every feed request hits MongoDB. Hot posts and popular users are fetched from disk on every request.

**What you'd add:**
- Cache the feed in Redis with a short TTL (30–60 seconds). Feed staleness of 30 seconds is acceptable for a social product.
- Cache `likeCount` and `commentCount` in Redis and flush to MongoDB on a schedule (write-behind caching).
- Cache `requireAuth` user lookups with a 30-second TTL.

**Pattern:** Cache-aside — try Redis first, fall back to MongoDB, write result to Redis.

---

### 2. No Tests

**Gap:** Zero test coverage.

**What you'd add:**
- Unit tests for every service function using a test database or an in-memory MongoDB (Mongo Memory Server).
- Integration tests for the HTTP layer using supertest — POST a post, GET the feed, verify the post appears.
- No mocking the database. Real integration tests on a test collection are more trustworthy than mocked ones.

---

### 3. IP-Based Rate Limiting Only

**Gap:** `express-rate-limit` keys by IP address. In corporate or mobile NAT environments, hundreds of users share one IP. One aggressive user can trigger the limit for everyone.

**What you'd add:**
- For authenticated routes, rate-limit by `userId` from `req.currentUser._id` instead of IP.
- Keep IP-based limits for unauthenticated routes (login, register) where you don't have a user ID.

---

### 4. No Refresh Token

**Gap:** The JWT is a single long-lived token. When it expires, the user is logged out with no way to silently refresh.

**What you'd add:**
- Issue two tokens at login: a short-lived access token (15 minutes) and a long-lived refresh token (7 days) stored in a separate httpOnly cookie.
- A `/auth/refresh` endpoint accepts the refresh token and issues a new access token.
- Store refresh tokens in the database (or Redis) so they can be revoked on logout.

---

### 5. Hard Deletes Everywhere

**Gap:** `deletePost`, `deleteComment`, `deleteReply` are permanent. Data cannot be recovered. There is no audit trail.

**What you'd add:**
- Add a `deletedAt` field to Post and Comment. Soft delete sets the timestamp, never removes the document.
- Filter out `{ deletedAt: null }` in all queries.
- A background cleanup job hard-deletes soft-deleted records older than 30 days.
- Hard-delete the cascade (replies, likes) is still fine — those are derived data.

---

### 6. Memory Storage for Multer

**Gap:** File uploads live as a Buffer in RAM for the duration of the request. A server handling 50 concurrent 5MB uploads holds 250MB in RAM simultaneously.

**What you'd add:** In production, stream directly from the request to Cloudinary without buffering the entire file in memory, using Cloudinary's upload stream API with a pipe from `req`. Or use a queue: accept the file, write it to S3, queue a processing job, return immediately.

---

### 7. No Graceful Shutdown

**Gap:** When the process receives `SIGTERM` (a deploy, a crash, a restart), in-flight requests are dropped immediately.

**What you'd add:**
```ts
process.on('SIGTERM', () => {
  server.close(() => {  // stop accepting new connections
    mongoose.connection.close(false, () => {  // drain the connection pool
      process.exit(0);
    });
  });
});
```

---

### 8. No Health Check Endpoint

**Gap:** No `/health` or `/ping` route. Load balancers and container orchestrators (ECS, Kubernetes) need a health endpoint to know whether to route traffic to this instance.

**What you'd add:** `GET /health` returns `{ status: 'ok', uptime: process.uptime() }` with a 200. If the database connection is down, return 503.

---

### 9. Race Condition in Like Toggle

**Gap:** The like toggle pattern is: find existing Like → if found, delete and decrement → if not, create and increment. Two concurrent unlike requests can both find the like, both delete it, and both decrement the counter — resulting in a count of -2 (protected by `min: 0` but still wrong).

**What you'd add:** Use a MongoDB transaction or a findOneAndDelete pattern that checks the result before decrementing:

```ts
const deleted = await Like.findOneAndDelete({ userId, targetId, targetType });
if (deleted) {
  await Post.updateOne({ _id: targetId }, { $inc: { likeCount: -1 } });
}
```

`findOneAndDelete` is atomic — exactly one concurrent request will get the document back, the other will get `null`.

---

### 10. No Correlation ID in Logs

**Gap:** If three requests fail at the same time, the log lines are interleaved with no way to trace which lines belong to which request.

**What you'd add:** Generate a UUID at the start of each request, attach it to `req.requestId`, and include it in every log line for that request. In Pino this is done with `pino-http` which handles it automatically.

---

### 11. Cloudinary URL Stored, Not Public ID

**Gap:** The Post document stores the full Cloudinary delivery URL as a string. If you ever need to delete the image from Cloudinary (on post delete), you don't have the `public_id` to call the Cloudinary delete API.

**What you'd add:** Store both `imageUrl` and `imagePublicId`. On post delete, call `cloudinary.uploader.destroy(post.imagePublicId)` alongside the database cleanup.

---

## Part 3 — Scaling Questions (What They'll Ask)

**"This works for 100 users. How would you make it work for 100,000 concurrent users?"**

Answer this in layers. Start with what breaks first.

---

### Layer 1 — The Database is the First Bottleneck

MongoDB Atlas free tier: 512MB storage, shared compute, limited connections. At 100,000 users this breaks in multiple ways:

- **Too many connections.** MongoDB has a connection limit. With 100,000 users, you need connection pooling — multiple server instances sharing a pool of connections rather than each instance holding its own.
- **Read volume.** The feed is read-heavy. Every user refreshing their feed is a MongoDB query. Add a **read replica** — a copy of the database that handles all reads. Write operations go to the primary, reads go to the replica.
- **Hot data.** The top 1% of posts get 80% of the traffic. A Redis cache in front of MongoDB means those hot posts are served from memory, not disk.

---

### Layer 2 — The Server is Stateless (That's Good)

Your server is already horizontally scalable because it's stateless — no session stored on the server, authentication is in the JWT cookie. You can run 10 identical server instances behind a load balancer and any instance can handle any request. This is the right design.

What would break horizontal scaling:
- Server-side sessions (you don't have them — good)
- In-memory rate limiting state (you have this — `express-rate-limit` defaults to in-memory storage, which means each instance has its own counter. A user can make 300 requests per minute *per instance*). Fix: use a Redis store for rate limiting so all instances share the counter.

---

### Layer 3 — Async Operations Should Be Queued

Right now, if Cloudinary is slow, the entire `POST /posts` request is slow. The user waits.

At scale, upload operations, email notifications, and any non-critical write should go into a job queue:

1. User submits post with image
2. Server saves the post immediately (without image) and returns `201` to the user
3. A background job picks up the image, uploads to Cloudinary, updates the post with the URL
4. Frontend polls or receives a WebSocket push when the image is ready

**Tools:** Redis + Bull (Node.js), or AWS SQS for a managed queue.

---

### Layer 4 — Feed Generation at Scale

The current feed is generated on every request: query MongoDB, populate author, resolve likedByMe. For a user with 1,000 followers this is fine. For a celebrity with 10 million followers who creates a post, pushing that post into 10 million feeds on demand is not.

**Two approaches:**

**Fan-out on read (pull model):** What you have now. The feed is computed at read time. Simple, works at moderate scale.

**Fan-out on write (push model):** When a post is created, push its ID into each follower's feed queue (stored in Redis as a sorted set). At read time, just read the user's pre-computed feed list. Fast reads, expensive writes. At true scale (Twitter-scale), you combine both: fan-out on write for normal users, fan-out on read for celebrity accounts.

For Appifylab's interview, knowing both terms and the trade-off is enough.

---

## Part 4 — System Design Topics (Appifylab SaaS Context)

Appifylab builds EzyCourse — a multi-tenant LMS. These topics are directly relevant.

---

### Multi-Tenancy (Most Important for Appifylab)

EzyCourse is a white-label platform — each school or course creator is a "tenant" with their own students, courses, and branding.

**Three models, know all three:**

| Model | Description | Pros | Cons |
|---|---|---|---|
| Database per tenant | Each tenant gets their own database | Full isolation, easy per-tenant backup | Expensive, hard to manage at 10,000 tenants |
| Schema per tenant | PostgreSQL: each tenant gets its own schema | Good isolation, same database instance | Complex migrations (run per schema) |
| Shared database, `tenant_id` column | All tenants in one table, every query filtered by tenant_id | Cheapest, simplest migrations | Risk of data leakage if a WHERE clause is missed |

**What Appifylab most likely uses:** Shared database with `tenant_id`, possibly with Row-Level Security (RLS) in PostgreSQL to enforce tenant isolation at the database engine level rather than the application level. RLS means even if the application forgets the `WHERE tenant_id = ?`, the database enforces it.

**The critical risk to mention:** Data leakage. If any query forgets the `tenant_id` filter, one tenant can see another's data. The fix is RLS or a repository layer that automatically appends the tenant filter to every query.

---

### Redis — Core Patterns

**Cache-aside (most common):**
1. Check Redis
2. If miss, query the database
3. Write result to Redis with a TTL
4. Return result

**Write-through:** Write to cache and database simultaneously. Cache is always warm. Higher write latency.

**Write-behind:** Write to cache immediately, flush to database asynchronously. Fastest writes, risk of data loss if cache crashes before flush.

**Redis data structures you should know:**
- `String` — simple key-value, good for cached JSON blobs
- `Hash` — like a mini document, good for user session data
- `Sorted Set` — ordered by score, perfect for a feed (score = timestamp), leaderboards, rate limiting sliding windows
- `Set` — membership check, good for "who liked this post"

---

### Message Queues — When and Why

**When to use a queue instead of synchronous processing:**
- Email sending (slow, can fail, retry-able)
- Video processing (long-running, should not block HTTP)
- Webhook delivery to third parties (external dependency)
- Push notifications (fan-out to many devices)
- Any operation that is not critical to the immediate response

**Key concepts:**
- **At-least-once delivery:** The queue guarantees the message will be delivered, but may deliver it more than once. Your consumer must be idempotent — processing the same message twice must have the same effect as once.
- **Dead Letter Queue (DLQ):** Messages that fail after N retries go to a DLQ for manual inspection. Always configure one.
- **Idempotency key:** A unique ID on each message so the consumer can detect and ignore duplicate delivery.

**AWS SQS specifics:** Standard queues guarantee at-least-once, FIFO queues guarantee exactly-once and order. Standard queues are cheaper and fine for most use cases.

---

### N+1 Query Problem

**What it is:** You fetch a list of posts (1 query), then for each post you fetch the author (N queries). Total: N+1 queries.

**In your code:** You solved this correctly with `populate('author', 'firstName lastName avatar')` — Mongoose issues one query for all authors using `$in`.

**In SQL/TypeORM/Prisma context:** Use eager loading or `JOIN`. Never do `for (const post of posts) { await post.getAuthor() }`.

**DataLoader pattern:** Batch individual lookups into a single query. Used heavily in GraphQL resolvers to avoid N+1 across nested fields.

---

### Database Indexing

**Composite index field order matters:** `{ visibility: 1, _id: -1 }` on your Post model serves `WHERE visibility = 'public' ORDER BY _id DESC`. The leftmost field is used first. If your query only filters by `_id`, this index won't be used.

**Covering index:** An index that contains all the fields a query needs. The query can be answered entirely from the index without touching the actual documents. Much faster.

**Partial index:** An index with a filter condition. `{ parentId: 1 }` WHERE `parentId IS NOT NULL` — only indexes reply documents, not top-level comments. Smaller index, faster inserts.

**When to use `EXPLAIN`:** Always run `EXPLAIN (ANALYZE, BUFFERS)` in PostgreSQL or `.explain('executionStats')` in MongoDB when a query is slow. Look for `SEQSCAN` (bad) vs `Index Scan` (good).

---

### AWS Services — Minimum Viable Knowledge

| Service | What it does | When you'd use it |
|---|---|---|
| **S3** | Object storage (files, images, videos) | Store user uploads, course videos, exports |
| **CloudFront** | CDN in front of S3 | Deliver static assets and videos fast globally |
| **Lambda** | Run code without a server (serverless) | Image resizing on upload, webhook processing, scheduled jobs |
| **SQS** | Managed message queue | Email sending, video processing, notification fan-out |
| **EventBridge** | Event bus between services | "User enrolled in course" → trigger email + analytics + notification |
| **RDS** | Managed relational database (MySQL/PostgreSQL) | Main application database |
| **ElastiCache** | Managed Redis/Memcached | Caching, session storage, rate limiting |

**EventBridge in a SaaS context:** When a student enrolls in a course, EventBridge can route that event simultaneously to: the email service (send confirmation), the analytics service (track conversion), the course service (update enrollment count), and the notification service (alert the instructor). Decoupled — none of these services need to know about each other.

---

### CQRS — Command Query Responsibility Segregation

**The concept:** Separate the models you use for writing data (commands) from the models you use for reading data (queries).

**Why it matters at scale:** Write operations (create post, update profile) are infrequent and need strong consistency. Read operations (feed, post detail) are frequent and can tolerate slight staleness. Separating them lets you optimize each independently — a read-optimized database replica for reads, a write-optimized primary for writes.

**Simple version (enough for the interview):** Read from a replica, write to the primary.

**Advanced version:** Maintain a separate read model (a pre-computed, denormalized view of the data) optimized for a specific query pattern. Your feed pre-computation idea is exactly this.

---

## Part 5 — Core Tech Concepts to Review

### Node.js Event Loop

**What they'll ask:** "What happens when your server receives 1000 concurrent requests?"

**The answer:**
> "Node.js is single-threaded but non-blocking. It uses an event loop and delegates I/O operations — database queries, file reads, network requests — to the OS or libuv thread pool. While waiting for a database response, the thread processes other requests. So 1000 concurrent requests don't mean 1000 threads. They all share one thread, and the event loop multiplexes them. The danger is CPU-heavy synchronous work — bcrypt hashing, image processing — which blocks the event loop for all other requests. That's why bcrypt.hash is async and heavy CPU work should go to worker threads or a separate service."

**bcrypt rounds in your code:** You use 12 rounds. Each login call blocks the event loop for ~100–300ms while hashing. At moderate concurrency this is acceptable; at high concurrency you'd move bcrypt to a worker thread.

---

### TypeScript Patterns Used in Your Code

- **Interface over type alias** for object shapes (IPost, IComment, ILike)
- **Discriminated unions** for `PostVisibility = 'public' | 'private'`
- **Generic returns** — `Promise<object | null>` — this is actually a gap. In production you'd return typed interfaces, not `object`.
- **Type narrowing** — `isMongoDuplicateKeyError` function in auth.service.ts is a type guard pattern

---

### React / Frontend (Be Ready Even If the Task Was Backend)

For a full-stack role they may ask about the frontend side even if your task was backend-only.

**Key concepts:**
- `useCallback` / `useMemo` — memoization to prevent unnecessary re-renders. Use when: a function is passed as a prop to a child component, or a computed value is expensive.
- `useRef` — escape hatch for values that don't trigger re-renders (timers, DOM elements, previous values).
- `React.memo` — memoize a component so it doesn't re-render unless its props change.
- State management: Redux Toolkit for complex global state, Zustand for simpler cases, React Query / TanStack Query for server state (this is the correct choice for a feed — it handles caching, refetching, and pagination).
- Infinite scroll with cursor pagination: TanStack Query's `useInfiniteQuery` is built for exactly the cursor pattern you implemented.

---

## Part 6 — Soft Skills & Leadership

At Mid-Senior level they will ask about more than code.

---

### "How do you approach a code review?"

> "I look for three things in order: correctness first (does this do what it says?), then security (is there a path that leaks data or allows unauthorized access?), then maintainability (will someone else understand this in six months?). I never comment on style unless it's configured in the linter — linters enforce style so humans don't have to argue about it. When I give feedback I try to explain the why, not just the what. And I distinguish between blocking issues — things that must change — and suggestions — things worth considering."

---

### "If you had 5 more hours on this task, what would you improve?"

Prepare three specific, credible answers. Suggested:

1. **Add a Redis caching layer for the feed.** Hot posts are fetched from MongoDB on every request. A 60-second Redis cache would cut database load by 80% on a popular feed.
2. **Add a refresh token flow.** The current single-token setup forces re-login on expiry. A short-lived access token + long-lived refresh token is the production standard.
3. **Write integration tests for the service layer.** Every service function is testable without HTTP — I'd add test coverage using Mongo Memory Server so tests don't need a live database.

---

### "How do you handle disagreement with a senior engineer's technical decision?"

> "I make sure I understand their reasoning first — sometimes what looks like a bad decision has context I'm missing. If I still disagree after understanding their reasoning, I lay out the specific trade-off: 'I see why you chose X, but in scenario Y, it will cause Z. Would you consider A instead?' I write it up clearly so it's concrete. If they still disagree, I accept the decision and move on — I'd rather work in a codebase with one consistent wrong decision than one with inconsistent decisions made by committee."

---

### "How do you approach mentoring junior developers?"

> "I try to explain the why, not just the what. Telling someone to 'use a separate Like collection' is less useful than showing them what happens to the post document when you embed an array of millions of IDs. I also try to make reviews a learning loop — if I catch the same pattern three times, I'll schedule a short pairing session rather than leaving another comment. The goal is to make them not need my review on that pattern again."

---

## Part 7 — Questions to Ask Them

Asking good questions signals product thinking and seniority. Prepare at least three.

1. **"How do you handle data isolation between tenants in EzyCourse? Is it row-level with tenant_id, or schema-per-tenant?"** — Shows you understand multi-tenancy and are thinking about how their actual system works.

2. **"What does the deployment pipeline look like? Is the team on a monorepo, and how are database migrations handled across services?"** — Shows you care about operational realities, not just feature code.

3. **"Where is the team currently feeling the most pain with scalability? Is it the database layer, the job queue, or somewhere else?"** — Shows product thinking and curiosity about real problems.

---

## Part 8 — Thursday Night Travel Plan

The Dhaka → Sylhet journey is 5–7 hours. Use the time in order of importance:

**First 90 minutes — Review your task repo from memory**
- Can you explain `deleteComment` without reading it? The cascade delete, the `Promise.all`, the `parentCommentId` reason?
- Can you explain cursor pagination in one clear sentence?
- Can you name the three gaps you'd fix with 5 more hours?

**Next 60 minutes — Multi-tenancy**
- Read about shared-database vs schema-per-tenant. This is the most Appifylab-specific topic.
- Think about: if EzyCourse adds a new course type, how does the schema migration work across 10,000 tenants?

**Next 45 minutes — Redis patterns**
- Cache-aside. Write-through. TTL strategy.
- Sorted sets for feed generation.

**Remaining time — Rest**
- A rested brain on Friday is worth more than cramming until 2am. Sleep.

**Friday morning — 30 minutes before interview**
- Reread Part 1 of this document (your task defense).
- Recall the three gaps and three questions to ask them.

---

## Quick Reference — One-Line Answers

| Question | Answer |
|---|---|
| Why monolith? | "Operational overhead of microservices wasn't justified by the timeline; boundaries are clean enough for extraction later." |
| Why cursor pagination? | "Stable under concurrent writes, O(log n) always, no page drift when new content arrives." |
| Why separate Like collection? | "16MB document limit, O(n) scan for likedByMe — separate collection with unique index solves both." |
| Why single Comment collection? | "Comments and replies are structurally identical — one collection, one schema, one index strategy." |
| What breaks at 100k users? | "Rate limiting state is per-instance (fix: Redis store), requireAuth hits DB every request (fix: Redis cache), feed is computed per-request (fix: Redis cache with TTL)." |
| What is N+1? | "Fetching N related records one query at a time instead of one batch query. Fix: populate/JOIN/DataLoader." |
| What is multi-tenancy? | "One application serving multiple customers (tenants), with their data isolated from each other." |
| What is cache-aside? | "Check cache first, on miss query DB, write result to cache, return result." |
| What is a DLQ? | "Dead Letter Queue — messages that fail after N retries are moved here for manual inspection." |
| What is CQRS? | "Separate read and write models — optimize each for its specific access pattern." |
