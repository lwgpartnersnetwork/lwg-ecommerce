// seed.js — simple seeding script
import 'dotenv/config';
import mongoose from 'mongoose';
import Product from '../models/Product.js';

const { MONGO_URI, MONGO_DB } = process.env;

if (!MONGO_URI) {
  console.error('❌ MONGO_URI is not set in environment');
  process.exit(1);
}

try {
  await mongoose.connect(MONGO_URI, { dbName: MONGO_DB });
  console.log(`✔ Mongo connected (${MONGO_DB || 'default DB'})`);

  // Start clean (remove existing products)
  await Product.deleteMany({});
  console.log('ℹ Existing products cleared');

  // Insert demo products
  await Product.insertMany([
    {
      title: 'Fashion bag for ladies',
      price: 1.13,
      desc: 'Very strong and comfortable',
      image:
        'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?q=80&w=1200&auto=format&fit=crop',
      images: [],
      category: 'Bags',
      tags: ['fashion', 'ladies', 'bag'],
      slug: 'fashion-bag-for-ladies',
      stock: 2,
    },
    {
      title: 'Wireless Earbuds',
      price: 15,
      desc: 'Bluetooth 5.3, long battery',
      image:
        'https://images.unsplash.com/photo-1585386959984-a41552231658?q=80&w=1200&auto=format&fit=crop',
      tags: ['electronics', 'audio'],
      slug: 'wireless-earbuds',
      stock: 10,
    },
  ]);

  console.log('✔ Products seeded successfully');
} catch (err) {
  console.error('❌ Seed failed:', err?.message || err);
} finally {
  await mongoose.disconnect();
  process.exit(0);
}
