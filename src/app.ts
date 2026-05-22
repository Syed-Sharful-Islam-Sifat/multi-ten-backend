import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import { logger } from './lib/logger';
import { apiRateLimit } from './middleware/rateLimit.middleware';
import { errorHandler } from './middleware/error.middleware';

import authRoutes      from './routes/v1/auth.routes';
import userRoutes      from './routes/v1/user.routes';
import workspaceRoutes from './routes/v1/workspace.routes';
import noteRoutes      from './routes/v1/note.routes';
import historyRoutes   from './routes/v1/history.routes';
import publicRoutes    from './routes/v1/public.routes';
import voteRoutes      from './routes/v1/vote.routes';

const app = express();

// ─── Request logger ────────────────────────────────────────────────────────
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (req.url === '/health') return next();
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    const meta: Record<string, unknown> = { status: res.statusCode, ms };
    if (res.locals.errorMessage) meta.error = res.locals.errorMessage;
    logger[level](meta, `${req.method} ${req.url}`);
  });
  next();
});

// ─── Trust proxy (nginx) ───────────────────────────────────────────────────
// Without this, express sees nginx's IP for all requests.
// Needed for accurate rate limiting and logging behind a reverse proxy.
app.set('trust proxy', 1);

// ─── Security & parsing ────────────────────────────────────────────────────
app.use(helmet());

app.use(
  cors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());


app.use('/api/', apiRateLimit);

app.use('/api/v1/auth',authRoutes);
app.use('/api/v1/users',userRoutes);
app.use('/api/v1/workspaces',workspaceRoutes);
app.use('/api/v1/workspaces',noteRoutes);      
app.use('/api/v1/workspaces',historyRoutes); 
app.use('/api/v1/public/notes',publicRoutes);
app.use('/api/v1/public/notes',voteRoutes);      

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});


app.use((_req, res) => {
  res.status(404).json({ message: 'Route not found' });
});


app.use(errorHandler);

export default app;