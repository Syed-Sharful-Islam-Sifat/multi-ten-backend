import 'dotenv/config';
import app from './app';
import { connectDB } from './lib/mongodb';
import { configureCloudinary } from './lib/cloudinary';
import { logger } from './lib/logger';

const PORT = Number(process.env.PORT) || 5000;

async function start(): Promise<void> {
  configureCloudinary();
  await connectDB();

  app.listen(PORT, () => {
    logger.info({ port: PORT, env: process.env.NODE_ENV }, 'Server started');
  });
}

start().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
