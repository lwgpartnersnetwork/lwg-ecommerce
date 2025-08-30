// db.js — Mongo connection utilities
import mongoose from 'mongoose';

let hasListeners = false;
let connecting = null;

/** Human-readable state names */
function stateName(s) {
  return (
    {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting',
    }[s] ?? String(s)
  );
}

/** Attach connection event listeners once */
function attachConnectionListeners() {
  if (hasListeners) return;
  hasListeners = true;

  const { connection } = mongoose;

  connection.on('connected', () => {
    const { host, port, name } = connection;
    console.log(`✔ MongoDB ${name || ''} connected (${host}:${port})`);
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
 * - Uses process.env.MONGO_URI if `uri` isn’t provided
 * - Retries on startup (handy for Render/Docker cold starts)
 */
export async function connectDB(
  uri = process.env.MONGO_URI,
  {
    maxRetries = 5,
    baseDelayMs = 1000,
    serverSelectionTimeoutMS = 10_000,
    connectTimeoutMS = 10_000,
  } = {}
) {
  if (!uri) throw new Error('MONGO_URI is required');

  // global settings
  mongoose.set('strictQuery', true);
  attachConnectionListeners();

  // avoid parallel connects
  if (connecting) return connecting;

  // already connected?
  if (mongoose.connection.readyState === 1) return mongoose.connection;

  connecting = (async () => {
    let attempt = 0;
    while (true) {
      try {
        await mongoose.connect(uri, {
          serverSelectionTimeoutMS,
          connectTimeoutMS,
          // Mongoose v8+ sensible defaults; no need for deprecated flags
        });
        return mongoose.connection;
      } catch (err) {
        attempt += 1;
        const msg = err?.message || String(err);
        console.error(`✖ MongoDB connect attempt ${attempt}/${maxRetries} failed: ${msg}`);

        if (attempt >= maxRetries) {
          console.error('✖ Exhausted MongoDB connection retries.');
          throw err;
        }

        // Exponential backoff with jitter
        const delay =
          Math.round(baseDelayMs * Math.pow(2, attempt - 1) * (0.85 + Math.random() * 0.3));
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  })();

  try {
    return await connecting;
  } finally {
    // allow future reconnect attempts if needed
    connecting = null;
  }
}

/** Graceful disconnect (use on SIGINT/SIGTERM or in tests) */
export async function disconnectDB() {
  if (mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
  console.log('ℹ MongoDB disconnected cleanly');
}

/** Quick health signal for /api/health or readiness checks */
export function isDBHealthy() {
  return mongoose.connection.readyState === 1;
}

/* ----------------------- Graceful shutdown hooks ----------------------- */
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
