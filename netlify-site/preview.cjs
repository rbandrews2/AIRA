const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'public');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'};
http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/api/simulate') {
    let body='';
    for await(const chunk of req){body+=chunk;if(body.length>48000){res.writeHead(413).end();return;}}
    const {default:handler}=await import('./netlify/functions/simulate.mjs');
    const response=await handler(new Request('http://localhost/api/simulate',{method:req.method,headers:{'Content-Type':'application/json'},...(req.method==='POST'?{body}: {})}));
    res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
  }
  let file;
  try{file=path.resolve(root,'.'+decodeURIComponent(pathname==='/'?'/index.html':pathname));}catch{res.writeHead(400).end();return;}
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);});
}).listen(3138,'127.0.0.1',()=>console.log('Aira preview: http://localhost:3138 (no production data connection by default)'));
