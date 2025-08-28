// db.js
import mongoose from 'mongoose';

let hasListeners = false;
let connecting = null;

/**
 * Pretty names for connection states
 */
function stateName(s) {
  return ({
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  })[s] ?? String(s);
}

/**
 * Attach one-time listeners for observability.
 */
function attachConnectionListeners() {
  if (hasListeners) return;
  hasListeners = true;

  const { connection } = mongoose;

  connection.on('connected', () => {
    console.log(`✔ MongoDB ${connection.name || ''} connected (${connection.host}:${connection.port})`);
  });

  connection.on('error', (err) => {
    console.error('✖ MongoDB error:', err?.message || err);
  });

  connection.on('disconnected', () => {
    console.warn('⚠ MongoDB disconnected');
  });
}

/**
 * Connect to MongoDB with retries and sane defaults.
 * - Respects process.env.MONGO_URI if `uri` not provided
 * - Retries a few times on startup (useful on Render/Docker cold starts)
 */
export async function connectDB(uri = process.env.MONGO_URI, {
  maxRetries = 5,
  baseDelayMs = 1000,
  serverSelectionTimeoutMS = 10000,
  connectTimeoutMS = 10000
} = {}) {
  if (!uri) throw new Error('MONGO_URI is required');

  // global mongoose settings (safe, low-noise)
  mongoose.set('strictQuery', true);

  attachConnectionListeners();

  // avoid parallel connects
  if (connecting) return connecting;

  connecting = (async () => {
    let attempt = 0;
    // If already connected, just return
    if (mongoose.connection.readyState === 1) return mongoose.connection;

    while (true) {
      try {
        await mongoose.connect(uri, {
          serverSelectionTimeoutMS,
          connectTimeoutMS
          // Mongoose v8+ uses sensible defaults; no need for useNewUrlParser/useUnifiedTopology
        });
        return mongoose.connection;
      } catch (err) {
        attempt += 1;
        const done = attempt > maxRetries;
        const msg = err?.message || String(err);
        console.error(`✖ MongoDB connect attempt ${attempt}/${maxRetries} failed: ${msg}`);

        if (done) {
          console.error('✖ Exhausted MongoDB connection retries. Exiting.');
          throw err;
        }

        // Exponential backoff with a little jitter
        const delay = Math.round(baseDelayMs * Math.pow(2, attempt - 1) * (0.85 + Math.random() * 0.3));
        await new Promise(r => setTimeout(r, delay));
      }
    }
  })();

  try {
    return await connecting;
  } finally {
    // reset latch after result so future calls can reconnect if needed
    connecting = null;
  }
}

/**
 * Graceful disconnect (used on SIGINT/SIGTERM or in tests)
 */
export async function disconnectDB() {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
  console.log('ℹ MongoDB disconnected cleanly');
}

/**
 * Quick health signal for /api/health
 */
export function isDBHealthy() {
  return mongoose.connection.readyState === 1;
}

/* -------------------------- Graceful shutdown hooks ------------------------- */
const shutdown = async (signal) => {
  try {
    console.log(`\n${signal} received. Shutting down…`);
    await disconnectDB();
  } catch (err) {
    console.error('Error during DB disconnect:', err?.message || err);
  } finally {
    process.exit(0);
  }
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

console.log(`Mongo state: ${stateName(mongoose.connection.readyState)}`);
