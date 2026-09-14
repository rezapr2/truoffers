import mongoose, { Connection } from 'mongoose';

export async function connectTestMongo(): Promise<Connection> {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI!);
  }
  return mongoose.connection;
}

export async function resetTestMongo(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) return;
  const collections = await db.collections();
  // Raw driver deletes: model middleware (e.g. the offer lifecycle guard) must not interfere with test cleanup.
  await Promise.all(collections.map((c) => c.deleteMany({})));
}

export async function disconnectTestMongo(): Promise<void> {
  await mongoose.disconnect();
}
