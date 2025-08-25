import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';
import cors from 'cors';
import { connectDB } from './db.js';
import ordersRoutes from './routes/orders.js';
import adminRoutes from './routes/admin.js';

const app = express();
app.use(morgan('dev'));
app.use(express.json({limit:'5mb'}));
app.use(cors({
  origin: process.env.CORS_ORIGIN?.split(',') || '*'
}));

app.get('/', (_req,res)=>res.json({ok:true,name:'LWG Orders API'}));

app.use('/api/orders', ordersRoutes);
app.use('/api/admin', adminRoutes);

const PORT = process.env.PORT || 5002;
connectDB(process.env.MONGO_URI).then(()=>{
  app.listen(PORT, ()=>console.log('✔ Orders API on http://localhost:'+PORT));
});
