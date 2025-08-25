import jwt from 'jsonwebtoken';

export function requireAdmin(req,res,next){
  const token = (req.headers.authorization||'').replace('Bearer ','');
  if(!token) return res.status(401).json({error:'No token'});
  try{
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if(payload.role!=='admin') return res.status(403).json({error:'Forbidden'});
    req.user = payload;
    next();
  }catch(e){
    res.status(401).json({error:'Invalid token'});
  }
}
