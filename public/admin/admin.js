const $=s=>document.querySelector(s),esc=s=>String(s).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
const call=async(p,m='GET',b)=>{const r=await fetch('/api/'+p,{method:m,headers:{'content-type':'application/json','x-rm':'1'},body:b&&JSON.stringify(b)});const j=await r.json().catch(()=>({}));if(!r.ok)throw j.error||'Error';return j};
let eid=0,drops=[],thumb,cur,U='';
const img=d=>d.img||(d.has_thumb?`/api/thumb?id=${d.id}&v=${d.tv}`:'');
const n=x=>(+x).toLocaleString();
function setv(v){document.querySelectorAll('.sec').forEach(s=>s.hidden=s.id!='v-'+v);document.querySelectorAll('.sb button[data-v]').forEach(b=>b.classList.toggle('on',b.dataset.v==v));scrollTo(0,0)}
function chart(D){const W=600,H=170,mx=Math.max(1,...D.map(d=>Math.max(d.views,d.clicks))),x=i=>i*W/(D.length-1),y=v=>H-8-v/mx*(H-24),ln=k=>D.map((d,i)=>(i?'L':'M')+x(i).toFixed(1)+' '+y(d[k]).toFixed(1)).join('');
return `<svg class="cs" viewBox="-16 0 ${W+32} ${H+22}"><defs><linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8b5cf6" stop-opacity=".5"/><stop offset="1" stop-color="#8b5cf6" stop-opacity="0"/></linearGradient></defs>${[0,1,2,3].map(i=>`<line x1="0" x2="${W}" y1="${8+i*(H-16)/3}" y2="${8+i*(H-16)/3}" stroke="#fff" opacity=".07"/>`).join('')}<path d="${ln('views')}L${W} ${H}L0 ${H}Z" fill="url(#ga)"/><path class="ln" d="${ln('views')}" stroke="#a78bfa"/><path class="ln" d="${ln('clicks')}" stroke="#3b82f6" style="animation-delay:.3s"/>${D.map((d,i)=>`<circle cx="${x(i)}" cy="${y(d.views)}" r="4" fill="#a78bfa"><title>${d.day}: ${d.views} views, ${d.clicks} clicks, ${d.visitors} visitors</title></circle><text x="${x(i)}" y="${H+16}" fill="#9a9ab5" font-size="10" text-anchor="middle">${d.day.slice(3)}</text>`).join('')}</svg>`}
const th=d=>img(d)?`<img src="${img(d)}" alt="">`:'<div class="ph"></div>';
function render(){
  const R=cur,tv=R.totals.views||0,tc=R.totals.clicks||0,ctr=tv?(tc/tv*100).toFixed(1)+'%':'0%';
  $('#kp').innerHTML=[['&#128230;',drops.length,'Total drops'],['&#128065;',n(tv),'Total views'],['&#128433;',n(tc),'Link clicks'],['&#128101;',n(R.totals.visitors),'Visitors'],['&#127919;',ctr,'Click rate']].map((k,i)=>`<div class="k" style="animation-delay:${i*.08}s"><i>${k[0]}</i><b>${k[1]}</b><small>${k[2]}</small></div>`).join('');
  $('#ch').innerHTML=chart(R.daily);
  const t=[...drops].sort((a,b)=>b.views-a.views).slice(0,5),mx=Math.max(1,t[0]?.views||1);
  $('#top5').innerHTML=t.map(d=>`<div class="tp">${th(d)}<div><span>${esc(d.title)}</span><small style="color:var(--m)">${n(d.views)} views &middot; ${n(d.clicks)} clicks</small><div class="br"><i style="width:${d.views/mx*100}%"></i></div></div></div>`).join('')||'<p style="color:var(--m)">No drops yet.</p>';
  const cv=R.cats.map(c=>[c.name,drops.filter(d=>d.category==c.slug).reduce((a,d)=>a+d.views,0)]),cm=Math.max(1,...cv.map(c=>c[1]));
  $('#cv').innerHTML=cv.map(c=>`<div class="tp"><div><span>${esc(c[0])} <small style="color:var(--m)">${n(c[1])}</small></span><div class="br"><i style="width:${c[1]/cm*100}%"></i></div></div></div>`).join('');
  $('#c').innerHTML=R.cats.map(c=>`<option value="${c.slug}">${esc(c.name)}</option>`).join('');
  list()}
function list(){const q=$('#sq').value.toLowerCase();
  $('#dg').innerHTML=drops.filter(d=>d.title.toLowerCase().includes(q)).map((d,i)=>`<article class="dc" style="animation-delay:${i*.05}s"><i class="pill ${d.published?'ok':''}">${d.published?'LIVE':'DRAFT'}</i><div class="th">${img(d)?`<img src="${img(d)}" alt="">`:''}</div>
  <div class="cb"><h4>${esc(d.title)}</h4><small>${esc(d.category.toUpperCase())} &middot; ${n(d.views)} views &middot; ${n(d.clicks)} clicks</small><div class="ft"><button class="btn ghost" data-a="e" data-i="${d.id}">EDIT</button><button class="btn ghost" data-a="p" data-i="${d.id}">${d.published?'HIDE':'PUBLISH'}</button><button class="btn ghost" data-a="x" data-i="${d.id}">DELETE</button></div></div></article>`).join('')||'<p style="color:var(--m)">No drops found.</p>'}
function pv(){const s=thumb||(eid&&img(drops.find(d=>d.id==eid)||{}))||'';$('#pv').innerHTML=`<article class="card in"><span class="tag">${esc(($('#c').value||'cat').toUpperCase())}</span><div class="th">${s?`<img src="${s}" alt="">`:''}</div><div class="cb"><h3>${esc($('#t').value||'Drop title')}</h3><p>${esc($('#d').value||'Your description shows here.')}</p><div class="meta"><span>Just now &middot; 0 views</span><span class="btn sm">GET DROP</span></div></div></article>`}
async function load(){cur=await call('admin');drops=cur.drops;render();pv()}
async function shrink(f){const i=await createImageBitmap(f),c=document.createElement('canvas');c.width=640;c.height=360;const x=c.getContext('2d'),r=Math.max(640/i.width,360/i.height);x.drawImage(i,(640-i.width*r)/2,(360-i.height*r)/2,i.width*r,i.height*r);return c.toDataURL('image/webp',.8)}
function reset(){eid=0;thumb=undefined;$('#f').reset();$('#pub').checked=true;$('#ft').textContent='New Drop';$('#fe2').textContent='';pv()}
function show(on,u){$('#login').hidden=on;$('#app').hidden=!on;if(on){U=u||U;$('#gr').textContent='Welcome back, '+(U||'owner');load().catch(e=>alert(e))}}
$('#lf').onsubmit=async e=>{e.preventDefault();try{const r=await call('auth','POST',{u:$('#u').value,p:$('#p').value});show(true,r.user)}catch(x){$('#le').textContent=x}};
$('#out').onclick=async()=>{await call('auth','DELETE');show(false)};
document.querySelectorAll('.sb button[data-v]').forEach(b=>b.onclick=()=>{if(b.dataset.v=='ed'&&eid)reset();setv(b.dataset.v)});
$('#sq').oninput=list;['t','c','d'].forEach(i=>$('#'+i).oninput=pv);
$('#th').onchange=async e=>{const f=e.target.files[0];if(f)try{thumb=await shrink(f);pv()}catch{$('#fe2').textContent='Could not read image'}};
$('#rs').onclick=reset;
$('#f').onsubmit=async e=>{e.preventDefault();const b={title:$('#t').value,category:$('#c').value,url:$('#url').value,description:$('#d').value,published:$('#pub').checked,featured:$('#fe').checked};if(thumb!==undefined)b.thumb=thumb;
  try{await call('admin'+(eid?'?id='+eid:''),eid?'PUT':'POST',b);reset();await load();setv('dr')}catch(x){$('#fe2').textContent=x}};
$('#dg').onclick=async e=>{const b=e.target.closest('button');if(!b)return;const d=drops.find(x=>x.id==b.dataset.i);
  try{if(b.dataset.a=='x'){if(confirm('Delete "'+d.title+'" and its stats?')){await call('admin?id='+d.id,'DELETE');await load()}}
  else if(b.dataset.a=='p'){await call('admin?id='+d.id,'PUT',{...d,thumb:undefined,img:undefined,published:!d.published});await load()}
  else{eid=d.id;thumb=undefined;$('#t').value=d.title;$('#c').value=d.category;$('#url').value=d.url;$('#d').value=d.description;$('#pub').checked=d.published;$('#fe').checked=d.featured;$('#ft').textContent='Edit Drop';pv();setv('ed')}}
  catch(x){alert(x)}};
call('auth').then(r=>show(!!r.user,r.user)).catch(()=>show(false));
