// Overclock 1v1 rooms. Upstash Redis is only used to swap the connection handshake;
// the fight itself runs directly between the two browsers.
function findStorage(){
  const env=process.env,keys=Object.keys(env),pick=s=>keys.find(k=>k===s||k.endsWith('_'+s));
  for(const [u,t] of [['KV_REST_API_URL','KV_REST_API_TOKEN'],['UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN']]){
    const ku=pick(u),kt=ku&&(keys.find(k=>k===ku.replace(u,t))||pick(t));
    if(ku&&kt&&env[ku]&&env[kt])return {url:env[ku],token:env[kt]};
  }
  for(const k of keys.filter(k=>/(^|_)(REDIS_URL|KV_URL)$/.test(k))){
    try{const u=new URL(env[k]);if(/upstash\.io$/.test(u.hostname)&&u.password)return {url:'https://'+u.hostname,token:decodeURIComponent(u.password)};}catch{}
  }
  return null;
}
async function redis(s,cmd){
  const r=await fetch(s.url,{method:'POST',headers:{Authorization:'Bearer '+s.token,'Content-Type':'application/json'},body:JSON.stringify(cmd)});
  const j=await r.json();if(j.error)throw new Error(j.error);return j.result;
}
const TTL='900',JOIN='60';
module.exports=async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const s=findStorage();
  if(!s)return res.status(503).json({error:'setup'});
  try{
    const q=req.method==='GET'?req.query:(typeof req.body==='string'?JSON.parse(req.body||'{}'):req.body||{});
    const code=String(q.code||'').toUpperCase();
    if(!/^[A-Z0-9]{5}$/.test(code))return res.status(req.query&&req.query.ping?200:400).json(req.query&&req.query.ping?{ok:true}:{error:'code'});
    const K=n=>`oc:${n}:${code}`;
    if(req.method==='GET'){
      const v=await redis(s,['GET',K(q.want==='answer'?'ans':q.want==='room'?'room':'off')]);
      return res.json({v:v||null});
    }
    const blob=v=>{const t=JSON.stringify(v);if(t.length>20000)throw new Error('too big');return t;};
    if(q.a==='create'){const ok=await redis(s,['SET',K('room'),'1','NX','EX',TTL]);return res.status(ok?200:409).json({ok:!!ok});}
    if(q.a==='offer'){
      if(!await redis(s,['GET',K('room')]))return res.status(404).json({error:'none'});
      const ok=await redis(s,['SET',K('off'),blob(q.v),'NX','EX',JOIN]);return res.status(ok?200:409).json({ok:!!ok});
    }
    if(q.a==='answer'){await redis(s,['SET',K('ans'),blob(q.v),'EX',JOIN]);return res.json({ok:true});}
    if(q.a==='reset'){await redis(s,['DEL',K('off'),K('ans')]);return res.json({ok:true});}
    if(q.a==='close'){await redis(s,['DEL',K('off'),K('ans'),K('room')]);return res.json({ok:true});}
    res.status(400).json({error:'action'});
  }catch(e){res.status(500).json({error:'db'});}
};
