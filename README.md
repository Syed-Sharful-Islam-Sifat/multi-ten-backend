# BuddyScript — Backend

BuddyScript is a social networking platform built to handle posts, comments, replies, and a like system at scale. This document covers the backend architecture, design decisions, and how to run the project.

## Table of Contents

1. [Project Overview](#project-overview)
2. [Tech Stack](#tech-stack)
3. [Data Models](#data-models)
4. [Application Architecture](#application-architecture)
5. [Request Flow](#request-flow)
6. [Core Modules](#core-modules)
7. [Running the Project](#running-the-project)
8. [Environment Variables](#environment-variables)

---

## Project Overview

A social media backend needs to handle high read volume, concurrent writes, and relationships between users, posts, comments, and likes. At true scale this calls for independent services — a dedicated post service, user service, and feed service — so that each can be scaled, deployed, and failed independently.

For this project, a monolithic architecture was chosen deliberately. The timeline did not justify the operational overhead of microservices (separate deployments, inter-service communication, distributed tracing), and a well-structured monolith with clear internal boundaries is the right tradeoff at this stage. The internal separation between routes, controllers, and services means extraction into independent services later is a refactor, not a rewrite.

MongoDB was chosen for two reasons: the document model fits the data naturally — a post with an author reference and metadata is one document, not a join across tables — and it is where familiarity sits. Using a tool you know well under a deadline produces better code than learning a new one under pressure.

---

## Tech Stack

| | |
|---|---|
| **Express + TypeScript** | HTTP server and middleware pipeline with static typing |
| **MongoDB Atlas (Free Tier)** | Cloud-hosted document database |
| **Mongoose** | Schema definition, validation, and query interface |
| **Zod** | Runtime request validation with TypeScript type inference |
| **bcrypt** | Password hashing |
| **jsonwebtoken** | JWT signing and verification |
| **Multer** | Multipart file handling in memory |
| **Cloudinary** | Image storage and CDN delivery |
| **pino** | Structured JSON logger |
| **express-rate-limit** | Request throttling |
| **helmet + cors** | Security headers and origin policy |

---

## Data Models

### User

Straightforward — stores the fields required by the task: `firstName`, `lastName`, `email`, `passwordHash`, and `avatar`. The `passwordHash` field is marked `select: false` so Mongoose excludes it from every query result by default. It cannot be accidentally returned to a client.

### Post

`author` is stored as an `ObjectId` reference to the User collection rather than embedding user data. Embedding would mean every post update that touches author data (name change, avatar change) requires updating every post document. A reference keeps the data in one place and a `populate` call resolves it at read time.

Post carries denormalized `likeCount` and `commentCount` fields. Counting from the Like and Comment collections on every feed request is expensive at scale. These counters are maintained with atomic `$inc` operations to stay consistent under concurrent writes.

### Comment & Reply

Comments and replies share the same collection, distinguished by a single field: `parentId`. A top-level comment has `parentId: null`. A reply has `parentId` set to the `_id` of its parent comment. Two separate collections (e.g. `comments` and `replies`) were considered and rejected — they would require two sets of routes, controllers, service functions, and indexes for data that is structurally identical. One collection, one schema, one index strategy.

**Nesting is capped at one level**, enforced in the service layer. When `createReply` is called, the parent comment is fetched and checked: if `parent.parentId !== null`, the request is rejected with a 400. Replies cannot have replies. This is a product decision as much as a technical one — threaded depth beyond one level adds UI complexity and moderation burden with little benefit at this scale.

**Fetch strategy** — comments and replies are fetched through separate endpoints and separate queries. The comments endpoint (`GET /posts/:id/comments`) queries `{ postId, parentId: null }` to return only top-level comments. Replies for a given comment are loaded on demand via `GET /comments/:id/replies`, querying `{ parentId: commentId }`. This lazy loading means a post with 200 comments does not also load all reply threads — only the replies the user expands are fetched.

Both queries use cursor-based pagination on `_id` and sort ascending (`{ _id: 1 }`). Comments in a thread are read oldest-first, top to bottom — the opposite of the feed. The cursor is the last seen `_id`; subsequent pages use `{ _id: { $gt: cursor } }`.

**Index strategy** — two compound indexes serve the two query patterns:

| Index | Query it serves |
|---|---|
| `{ postId, parentId, createdAt }` | Top-level comments for a post — filters by `postId` and `parentId: null` |
| `{ parentId, createdAt }` | Replies for a comment — filters by `parentId` |

Both include `createdAt` to support future sort-by-date queries without a collection scan.

**`replyCount`** is denormalized on the parent comment document, maintained with atomic `$inc` on reply create and delete. The same reasoning applies as `commentCount` on Post — counting reply documents on every request is unnecessary work.

**`likedByMe`** is resolved for the page in one query, using the same `$in` set approach as the feed.

**Cascade delete** — deleting a top-level comment must also remove its replies and all associated likes. `deleteComment` runs four operations in parallel via `Promise.all`: delete the comment, delete all its replies (`Comment.deleteMany({ parentId: id })`), delete all likes on the comment and its replies (`Like.deleteMany({ $or: [{ targetId: id }, { parentCommentId: id }] })`), and decrement `commentCount` on the post. The `parentCommentId` field on Like documents makes the like cleanup a single query — no reply IDs need to be loaded into memory first.

**Separate delete endpoints** — a top-level comment and a reply share the same collection but are intentionally deleted through different endpoints. The service enforces this at the boundary: `deleteComment` rejects documents where `parentId !== null`, and `deleteReply` rejects documents where `parentId === null`. This prevents accidental cross-endpoint deletions and keeps the cleanup logic for each case simple and correct.

### Like

The first instinct is to embed likes as an array on the post: `likes: [userId]`. This breaks at scale. The array is unbounded — a post with millions of likes grows the document indefinitely, and MongoDB enforces a 16MB document size limit. Scanning the array for `likedByMe` is O(n). A separate Like collection solves both: a unique compound index on `{ userId, targetId, targetType }` prevents duplicate likes at the database level, and the lookup is O(log n).

The Like schema carries two denormalized fields beyond the basic reference:

**`targetType: 'post' | 'comment'`** — makes the schema polymorphic. Post likes, comment likes, and reply likes all live in one collection. Adding a new likeable entity in the future is a schema change, not a new collection.

**`postId`** — when a post is deleted, its comments, replies, and all their associated likes must be cleaned up. Without `postId` on Like, getting the comment like IDs requires loading all comment IDs into memory first: `Comment.find({ postId }).distinct('_id')`. With `postId` denormalized on Like, the entire cleanup is a single query: `Like.deleteMany({ postId })`. No IDs in memory.

**`parentCommentId`** — the same problem exists when a top-level comment is deleted. Its replies exist in the Comment collection, and their likes exist in the Like collection. `parentCommentId` on reply-like documents enables: `Like.deleteMany({ $or: [{ targetId: commentId }, { parentCommentId: commentId }] })` — one query, no reply IDs loaded.

---

## Application Architecture

The codebase follows a **layered architecture**: every request moves through routes → controller → service, with no repository layer.

```
Routes       Define the HTTP method, path, and middleware chain
Controllers  Read from req, call the service, write to res — nothing else
Services     All business logic, validation rules, and database queries
```

A repository layer (an abstraction over the database client) is absent intentionally. Mongoose models already provide that abstraction — `Post.findById()`, `Post.create()`, `Post.updateOne()` are a clean enough interface. Adding a repository on top would mean writing wrapper functions that do nothing except call Mongoose, which adds indirection without value at this scale.

The boundary that matters here is the controller/service split. Services have no knowledge of HTTP — they receive plain arguments and throw `ApiError` on failure. This means business logic is fully testable without spinning up an HTTP server.

---

## Request Flow

A request to `POST /api/v1/posts` passes through the following layers in order:

```
1. Request logger     Starts a timer, attaches a finish listener to log method/path/status/ms
2. helmet             Sets security response headers
3. cors               Validates the request origin against FRONTEND_URL
4. express.json       Parses the request body (1MB limit)
5. cookieParser       Parses the Cookie header into req.cookies
6. apiRateLimit       Global guard — 300 req/min per IP
7. createPostLimit    Route-specific guard — 30 posts/hour per IP
8. requireAuth        Verifies JWT from cookie, loads user into req.currentUser
9. upload.single      Validates and buffers the image in memory (MIME + size check)
10. validate(schema)  Runs req.body through the Zod schema, strips unknown fields
11. Controller        Reads req, calls PostService.createPost, writes res
12. Service           Uploads image to Cloudinary, creates Post document, returns result
13. errorHandler      Catches anything thrown — ApiError gets its status code, everything else gets 500
```

---

## Core Modules

### Rate Limiting

Five separate limits are applied at different scopes:

| Limit | Window | Route |
|---|---|---|
| 300 requests | 1 min | All `/api/` routes |
| 10 attempts | 15 min | Login |
| 5 attempts | 1 hour | Register |
| 30 posts | 1 hour | Create post |
| 60 comments | 1 hour | Create comment/reply |

The global limit guards against DoS. The auth limits guard against brute force and account creation spam. Route-specific limits are more permissive than auth but still prevent abuse. `standardHeaders: true` exposes remaining quota in response headers so the frontend can act on it.

### Zod Validation

Every request body passes through a Zod schema before reaching the controller. On failure the middleware responds immediately with the field name and message — the controller is never reached. On success `req.body` is replaced with the parsed output, which strips any fields not defined in the schema. This prevents mass assignment: a request body containing `{ "isAdmin": true }` has that field removed before any service sees it.

### Global Error Handler

A single `errorHandler` middleware sits at the bottom of the Express stack. Services throw `ApiError` with an explicit status code and optional field name. The handler serializes it directly. Any error that is not an `ApiError` gets logged in full server-side and returns a generic 500 to the client — stack traces, file paths, and query details never leave the server.

### Logger

`pino` outputs structured JSON in production, readable colored output in development via `pino-pretty`. The request logger middleware measures each request's duration and logs `method + path` as the message with `{ status, ms }` as metadata. The log level is driven by the response status code — `>=500` logs as error, `>=400` as warn, the rest as info. This makes it straightforward to set up alerts on error-level logs in any log aggregation platform.

### Feed — Initial Fetch

The feed query returns public posts plus the current user's own private posts, sorted by `_id` descending (newest first). Pagination uses the last seen `_id` as a cursor rather than a page offset. Offset pagination requires skipping N documents on every deeper page — expensive and incorrect when new posts arrive between page loads. Cursor pagination is a range query on an indexed field, always O(log n), and stable under concurrent writes.

`likedByMe` is resolved for the entire page in one query. All post IDs are sent to the Like collection in a single `$in` query, the results are placed in a Set, and membership is checked in O(1) per post. This keeps the feed fetch at a constant two database queries regardless of page size.

### Image Upload

Post images are handled through a two-step pipeline: Multer receives the file, Cloudinary stores it.

```
multipart/form-data → Multer (memory) → uploadImage(buffer) → Cloudinary → URL stored on Post
```

Multer is configured with `memoryStorage` — the file never touches disk. It lives as a `Buffer` in RAM for the duration of the request and is passed directly to Cloudinary's upload stream. Disk storage was ruled out because in a multi-server deployment a file written to one server's disk is invisible to every other instance behind the load balancer. Memory storage has no this problem and requires no cleanup.

Validation happens at the Multer layer before the file reaches any business logic — MIME type must be `image/jpeg`, `image/png`, or `image/webp`, and size is capped at 5MB. A video file or an oversized image is rejected at the HTTP layer immediately.

Cloudinary was chosen to avoid building CDN infrastructure. It handles storage, delivery, and format optimization. The backend stores only the returned URL on the Post document — it has no knowledge of where or how the file is physically stored.

### Like Toggle

`POST /:id/like` is a toggle — one endpoint handles both like and unlike. When called, it checks for an existing Like document. If found, it deletes it and decrements the counter. If not, it creates one and increments. The counter update uses `$inc` which is atomic at the document level — concurrent like requests cannot produce an incorrect final count. The response always returns `{ liked: boolean, likeCount: number }` so the frontend can update state without a follow-up fetch.

---

## Running the Project

**Prerequisites:** Node.js 18+, MongoDB Atlas cluster, Cloudinary account.

```bash
npm install
cp .env.example .env   # fill in your values
npm run dev            # starts with hot reload on port 5000
```

```bash
npm run typecheck      # type check without emitting
npm run build          # compile to dist/
node dist/server.js    # run production build
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Server port (default: 5000) |
| `NODE_ENV` | `development` or `production` |
| `FRONTEND_URL` | Allowed CORS origin |
| `MONGODB_URI` | MongoDB Atlas connection string |
| `JWT_SECRET` | Minimum 32-character signing secret |
| `JWT_EXPIRES_IN` | Token lifetime — e.g. `7d` |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |
| `LOG_LEVEL` | pino log level — e.g. `info` |

See `.env.example` for the full template.
