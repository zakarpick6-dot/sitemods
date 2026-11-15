const $=s=>document.querySelector(s),esc=s=>String(s).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
const cat=(location.pathname.match(/^\/c\/(\w+)/)||[])[1]||'';let sort='latest',q='',seen=new Set,hot=new Set;const bd=d=>hot.has(d.id)?'<span class="bd hot">HOT</span>':Date.now()-new Date(d.created_at)<2592e5?'<span class="bd">NEW</span>':'';
const track=(t,id)=>fetch('/api/drops',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({t,id}),keepalive:true}).catch(()=>{});
const toast=m=>{const e=$('#toast');e.textContent=m;e.classList.add('s');setTimeout(()=>e.classList.remove('s'),2200)};
$('#yr').textContent=new Date().getFullYear();
document.querySelectorAll('#nav a').forEach(a=>a.getAttribute('href')==(cat?'/c/'+cat:'/')&&a.classList.add('on'));
const words=(cat?cat.toUpperCase()+' <em>DROPS</em>':'LIVE <em>GAMING</em> DROPS').split(' ');
$('#h1').innerHTML=words.map((w,i)=>`<span class="w" style="animation-delay:${i*.12}s">${w}</span>`).join(' ');
function count(e,n){const t0=performance.now();(function f(t){const k=Math.min(1,(t-t0)/1200);e.textContent=Math.round(n*(1-Math.pow(1-k,3))).toLocaleString();k<1&&requestAnimationFrame(f)})(t0)}
const io=new IntersectionObserver(es=>es.forEach(e=>{if(!e.isIntersecting)return;const c=e.target;io.unobserve(c);c.classList.add('in');const id=c.dataset.id;if(!seen.has(id)){seen.add(id);track('view',id)}}),{threshold:.3});
async function load(){
  $('#grid').innerHTML='<div class="sk"></div>'.repeat(6);
  try{
    const r=await fetch(`/api/drops?cat=${cat}&sort=${sort}&q=${encodeURIComponent(q)}`).then(r=>r.json());
    if(!r.drops)throw 0;
    const s=r.stats,items=[['Total Drops',s.drops],['Total Views',s.views],['Link Clicks',s.clicks],['Visitors',s.visitors]];
    $('#stats').innerHTML=items.map(i=>`<div class="st"><b>0</b><small>${i[0]}</small></div>`).join('');
    document.querySelectorAll('.st b').forEach((e,i)=>count(e,items[i][1]));
    const tp=[...r.drops].sort((a,b)=>b.views-a.views);hot=new Set(tp.slice(0,3).map(d=>d.id));$('#trs').hidden=tp.length<3||!!q||!!cat;$('#tr').innerHTML=tp.slice(0,6).map((d,i)=>`<button class="tc" data-id="${d.id}" data-u="${esc(d.url)}"><b>${i+1}</b><span><h4>${esc(d.title)}</h4><small>${d.views.toLocaleString()} views</small></span></button>`).join('');const c=r.cats.find(c=>c.slug==cat);$('#ttl').textContent=c?c.name+' - '+c.description:'Drops';
    $('#grid').innerHTML=r.drops.length?r.drops.map(d=>`<article class="card" data-id="${d.id}"><span class="tag">${esc(d.category.toUpperCase())}</span>${bd(d)}
      <div class="th">${d.has_thumb?`<img loading="lazy" alt="${esc(d.title)}" src="/api/thumb?id=${d.id}&v=${d.tv}">`:''}</div>
      <div class="cb"><h3>${esc(d.title)}</h3><p>${esc(d.description)}</p><div class="meta"><span>${new Date(d.created_at).toLocaleDateString()} &middot; ${d.views.toLocaleString()} views</span>
      <span class="acts"><button class="btn ghost sm" data-sh="${esc(d.url)}" aria-label="Copy link">COPY</button><button class="btn" data-id="${d.id}" data-u="${esc(d.url)}">GET DROP</button></span></div></div></article>`).join(''):'<div class="empty">No drops here yet. Check back soon.</div>';
    document.querySelectorAll('.card').forEach((c,i)=>{c.style.transitionDelay=i%6*.07+'s';io.observe(c)});
  }catch{$('#grid').innerHTML='<div class="empty">Could not load drops. Please refresh.</div>'}
}
document.addEventListener('click',e=>{const b=e.target.closest('.btn,.tc');if(!b||!b.dataset.u&&!b.dataset.sh)return;if(b.dataset.sh){navigator.clipboard&&navigator.clipboard.writeText(b.dataset.sh);return toast('Link copied')}
  window.open(b.dataset.u,'_blank','noopener,noreferrer');track('click',b.dataset.id);toast('Opening drop in a new tab...')});
$('#grid').addEventListener('pointermove',e=>{const c=e.target.closest('.card');if(!c)return;const r=c.getBoundingClientRect();
  c.style.setProperty('--ry',((e.clientX-r.left)/r.width-.5)*10+'deg');c.style.setProperty('--rx',-((e.clientY-r.top)/r.height-.5)*10+'deg')});
$('#grid').addEventListener('pointerout',e=>{const c=e.target.closest('.card');c&&(c.style.setProperty('--rx','0deg'),c.style.setProperty('--ry','0deg'))});
document.querySelectorAll('.chip').forEach(b=>b.onclick=()=>{document.querySelectorAll('.chip').forEach(x=>x.classList.remove('on'));b.classList.add('on');sort=b.dataset.s;load()});
$('#sf').onsubmit=e=>{e.preventDefault();q=$('#q').value.trim();load()};
document.addEventListener('pointermove',e=>$('#glow').style.transform=`translate(${e.clientX}px,${e.clientY}px)`);
document.querySelectorAll('.btn').forEach(b=>b.addEventListener('pointermove',e=>{const r=b.getBoundingClientRect();b.style.transform=`translate(${(e.clientX-r.left-r.width/2)*.15}px,${(e.clientY-r.top-r.height/2)*.25}px)`}));
document.addEventListener('pointerout',e=>{const b=e.target.closest&&e.target.closest('.btn');b&&(b.style.transform='')});
(()=>{const c=$('#fx'),x=c.getContext('2d');let W,H,P=[];const rs=()=>{W=c.width=innerWidth;H=c.height=innerHeight;P=Array.from({length:Math.min(60,W/22|0)},()=>({x:Math.random()*W,y:Math.random()*H,vx:(Math.random()-.5)*.4,vy:(Math.random()-.5)*.4}))};rs();addEventListener('resize',rs);
if(matchMedia('(prefers-reduced-motion:reduce)').matches)return;
(function f(){if(!document.hidden){x.clearRect(0,0,W,H);P.forEach((p,i)=>{p.x=(p.x+p.vx+W)%W;p.y=(p.y+p.vy+H)%H;x.fillStyle='rgba(167,139,250,.7)';x.fillRect(p.x,p.y,2,2);
for(let j=i+1;j<P.length;j++){const d=Math.hypot(p.x-P[j].x,p.y-P[j].y);if(d<110){x.strokeStyle=`rgba(99,102,241,${.18*(1-d/110)})`;x.beginPath();x.moveTo(p.x,p.y);x.lineTo(P[j].x,P[j].y);x.stroke()}}})}requestAnimationFrame(f)})()})();
track('visit');load();

addEventListener('scroll',()=>{const h=document.documentElement;$('#pg').style.width=scrollY/(h.scrollHeight-innerHeight||1)*100+'%';$('#top').classList.toggle('s',scrollY>500)},{passive:true});
$('#top').onclick=()=>scrollTo({top:0,behavior:'smooth'});
