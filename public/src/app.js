const PYODIDE_VERSION = "0.27.7";
const DB_NAME = "own-a-bank";
const DB_VERSION = 1;
const SLOT_COUNT = 3;
const $ = (id) => document.getElementById(id);
let pyodide, bank = null, datasets = null, geography = null, selectedDifficulty = "easy", currentView = "overview";
let selectedGeo = {country:null, region:null, province:null, city:null};
let timer = null, paused = false, speed = 1, currentApplication = null;

const money = (v) => new Intl.NumberFormat("en-PH",{style:"currency",currency:"PHP",maximumFractionDigits:0}).format(Number(v||0));
const num = (v) => new Intl.NumberFormat("en-PH").format(Number(v||0));
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const safe = (s)=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(message,error=false){const el=document.createElement("div");el.className="toast"+(error?" error":"");el.textContent=message;$("toast-root").append(el);setTimeout(()=>el.remove(),3400);}
function showModal(html){$("modal-root").innerHTML=`<div class="modal-backdrop"><div class="modal-card">${html}</div></div>`;$("modal-root").querySelector(".modal-backdrop").addEventListener("click",e=>{if(e.target.classList.contains("modal-backdrop"))closeModal();});}
function closeModal(){$("modal-root").innerHTML="";}
async function loadPyodideRuntime(){
  const localScript="/pyodide/pyodide.js";
  let scriptUrl=localScript,indexURL="/pyodide/";
  try{const check=await fetch(localScript,{method:"HEAD",cache:"no-store"});if(!check.ok)throw new Error("Local runtime not prepared");}
  catch(_){scriptUrl=`https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.js`;indexURL=`https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;}
  const script=document.createElement("script");script.src=scriptUrl;
  document.head.append(script);await new Promise((res,rej)=>{script.onload=res;script.onerror=rej;});
  pyodide=await loadPyodide({indexURL});const [pyRes,dataRes,geoRes]=await Promise.all([
    fetch("/src/simulation.py"),fetch("/src/datasets.json"),fetch("/src/geography.json")
  ]);
  if(!pyRes.ok||!dataRes.ok)throw new Error("Unable to load simulation assets.");
  const pyText=await pyRes.text();datasets=await dataRes.json();pyodide.runPython(pyText);
  geography=geoRes.ok?await geoRes.json():fallbackGeography();
  initializeGeography();
}
function fallbackGeography(){
  const provinces=[
    ["NCR","National Capital Region",[{name:"Manila"},{name:"Quezon City"},{name:"Makati City"},{name:"Pasig City"},{name:"Taguig City"}]],
    ["I","Ilocos Region",[{name:"Ilocos Norte"},{name:"Ilocos Sur"},{name:"La Union"},{name:"Pangasinan"}]],
    ["II","Cagayan Valley",[{name:"Batanes"},{name:"Cagayan"},{name:"Isabela"},{name:"Nueva Vizcaya"},{name:"Quirino"}]],
    ["III","Central Luzon",[{name:"Aurora"},{name:"Bataan"},{name:"Bulacan"},{name:"Nueva Ecija"},{name:"Pampanga"},{name:"Tarlac"},{name:"Zambales"}]],
    ["IV-A","Calabarzon",[{name:"Batangas"},{name:"Cavite"},{name:"Laguna"},{name:"Quezon"},{name:"Rizal"}]],
    ["IV-B","Mimaropa",[{name:"Marinduque"},{name:"Occidental Mindoro"},{name:"Oriental Mindoro"},{name:"Palawan"},{name:"Romblon"}]],
    ["V","Bicol Region",[{name:"Albay"},{name:"Camarines Norte"},{name:"Camarines Sur"},{name:"Catanduanes"},{name:"Masbate"},{name:"Sorsogon"}]],
    ["VI","Western Visayas",[{name:"Aklan"},{name:"Antique"},{name:"Capiz"},{name:"Guimaras"},{name:"Iloilo"},{name:"Negros Occidental"}]],
    ["VII","Central Visayas",[{name:"Bohol"},{name:"Cebu"},{name:"Negros Oriental"},{name:"Siquijor"}]],
    ["VIII","Eastern Visayas",[{name:"Biliran"},{name:"Eastern Samar"},{name:"Leyte"},{name:"Northern Samar"},{name:"Samar"},{name:"Southern Leyte"}]],
    ["IX","Zamboanga Peninsula",[{name:"Zamboanga del Norte"},{name:"Zamboanga del Sur"},{name:"Zamboanga Sibugay"}]],
    ["X","Northern Mindanao",[{name:"Bukidnon"},{name:"Camiguin"},{name:"Lanao del Norte"},{name:"Misamis Occidental"},{name:"Misamis Oriental"}]],
    ["XI","Davao Region",[{name:"Davao de Oro"},{name:"Davao del Norte"},{name:"Davao del Sur"},{name:"Davao Occidental"},{name:"Davao Oriental"}]],
    ["XII","Soccsksargen",[{name:"Cotabato"},{name:"Sarangani"},{name:"South Cotabato"},{name:"Sultan Kudarat"}]],
    ["XIII","Caraga",[{name:"Agusan del Norte"},{name:"Agusan del Sur"},{name:"Dinagat Islands"},{name:"Surigao del Norte"},{name:"Surigao del Sur"}]],
    ["CAR","Cordillera Administrative Region",[{name:"Abra"},{name:"Apayao"},{name:"Benguet"},{name:"Ifugao"},{name:"Kalinga"},{name:"Mountain Province"}]],
    ["BARMM","Bangsamoro Autonomous Region",[{name:"Basilan"},{name:"Lanao del Sur"},{name:"Maguindanao del Norte"},{name:"Maguindanao del Sur"},{name:"Sulu"},{name:"Tawi-Tawi"}]]
  ];
  return {countries:[{code:"PH",name:"Philippines",admin1:provinces.map(([code,name,ps])=>({
    code,name,admin2:ps.map((p,i)=>({
      code:`${code}-${i}`,name:p.name,
      places:(p.name==="Leyte"?["Baybay City","Ormoc City","Tacloban City"]:p.name==="Cebu"?["Cebu City","Mandaue City","Lapu-Lapu City"]:p.name==="Iloilo"?["Iloilo City"]:p.name==="Davao del Sur"?["Davao City"]:p.name==="National Capital Region"?["Manila","Quezon City","Makati City"]:[]).map((n,j)=>({id:`${code}-${i}-${j}`,name:n,population:0}))
    }))
  }))}]};
}
function setSelectOptions(el,items,placeholder){
  el.innerHTML="";const first=document.createElement("option");first.value="";first.textContent=placeholder;el.append(first);
  items.forEach(item=>{const option=document.createElement("option");option.value=item.code;option.textContent=item.name;el.append(option);});
  el.disabled=!items.length;
}
function initializeGeography(){
  const countries=(geography?.countries||[]).slice().sort((a,b)=>a.name.localeCompare(b.name));
  setSelectOptions($("country-select"),countries.map(c=>({code:c.code,name:c.name})),"Choose a country");
  const ph=countries.find(c=>c.code==="PH");if(ph){$("country-select").value="PH";onCountryChange();}
  $("country-select").addEventListener("change",onCountryChange);
  $("region-select").addEventListener("change",onRegionChange);
  $("province-select").addEventListener("change",onProvinceChange);
  $("city-select").addEventListener("change",updateLocationSummary);
  $("location-search").addEventListener("input",filterPlaceOptions);
}
function onCountryChange(){
  selectedGeo={country:null,region:null,province:null,city:null};
  const country=geography.countries.find(c=>c.code===$("country-select").value);selectedGeo.country=country||null;
  setSelectOptions($("region-select"),(country?.admin1||[]).map(a=>({code:a.code,name:a.name})),"Choose a region / state");
  setSelectOptions($("province-select"),[],"Choose a region first");setSelectOptions($("city-select"),[],"Choose a province or area first");
  $("location-search").value="";$("location-search").disabled=true;updateLocationSummary();
}
function onRegionChange(){
  selectedGeo.region=null;selectedGeo.province=null;selectedGeo.city=null;
  const region=selectedGeo.country?.admin1?.find(a=>a.code===$("region-select").value);selectedGeo.region=region||null;
  const directPlaces=region?.places||[];
  const provinceOptions=(region?.admin2||[]).map(a=>({code:a.code,name:a.name}));
  if(provinceOptions.length&&directPlaces.length)provinceOptions.push({code:`${region.code}.OTHER`,name:"Other areas"});
  setSelectOptions($("province-select"),provinceOptions,"Choose a province / district");
  const hasProvinces=provinceOptions.length>0;
  if(!hasProvinces&&directPlaces.length){setSelectOptions($("city-select"),directPlaces.map(p=>({code:p.id,name:p.name})),"Choose a city / local area");$("location-search").disabled=false;}
  else {setSelectOptions($("city-select"),[],"Choose a province / district first");$("location-search").disabled=true;}
  $("location-search").value="";updateLocationSummary();
}
function onProvinceChange(){
  selectedGeo.province=null;selectedGeo.city=null;
  const selectedCode=$("province-select").value;
  const province=selectedGeo.region?.admin2?.find(a=>a.code===selectedCode);
  const otherAreas=selectedCode===`${selectedGeo.region?.code}.OTHER`?{code:selectedCode,name:"Other areas",places:selectedGeo.region?.places||[]}:null;
  selectedGeo.province=province||otherAreas||null;
  const places=selectedGeo.province?.places||[];
  setSelectOptions($("city-select"),places.map(p=>({code:p.id,name:p.name})),"Choose a city / municipality / local area");
  $("location-search").value="";$("location-search").disabled=!places.length;updateLocationSummary();
}
function filterPlaceOptions(){
  const select=$("city-select"),term=$("location-search").value.trim().toLocaleLowerCase();
  const list=selectedGeo.province?.places||selectedGeo.region?.places||[];
  const filtered=list.filter(p=>p.name.toLocaleLowerCase().includes(term));
  const current=select.value;setSelectOptions(select,filtered.map(p=>({code:p.id,name:p.name})),"Choose a city / municipality / local area");
  if(filtered.some(p=>p.id===current))select.value=current;
  updateLocationSummary();
}
function updateLocationSummary(){
  const country=selectedGeo.country,region=selectedGeo.region,province=selectedGeo.province;
  const places=province?.places||selectedGeo.region?.places||[];
  selectedGeo.city=places.find(p=>p.id===$("city-select").value)||null;
  const parts=[selectedGeo.city?.name,province?.name,region?.name,country?.name].filter(Boolean);
  $("location-summary").textContent=parts.length?parts.join(" · "):"Choose a country, then narrow down to a city or local area.";
}
function getSelectedLocation(){
  updateLocationSummary();
  if(!selectedGeo.country||!selectedGeo.region||!selectedGeo.city)throw new Error("Please select a country, region / state, and city or local area.");
  return {country:selectedGeo.country.name,country_code:selectedGeo.country.code,region:selectedGeo.region.name,province:selectedGeo.province?.name||null,city:selectedGeo.city.name,population:selectedGeo.city.population||null,place_id:String(selectedGeo.city.id??""),admin1_code:selectedGeo.region?.code||null,admin2_code:selectedGeo.province?.code||null,
    label:[selectedGeo.city.name,selectedGeo.province?.name,selectedGeo.region.name,selectedGeo.country.name].filter(Boolean).join(", ")};
}
function pyCall(name,args){const json=JSON.stringify(args);return pyodide.runPython(`json.loads(${JSON.stringify(json)}) if False else None`) /* placeholder */;}
function callPy(fn,args){
  const payload=JSON.stringify(args);
  pyodide.globals.set("_payload",payload);
  const result=pyodide.runPython(`_args = json.loads(_payload)\n_result = ${fn}(**_args)\njson.dumps(_result)`);
  return JSON.parse(result);
}
function callPyPos(fn,args){
  const payload=JSON.stringify(args);
  pyodide.globals.set("_payload",payload);
  const result=pyodide.runPython(`_args = json.loads(_payload)\n_result = ${fn}(*_args)\njson.dumps(_result)`);
  return JSON.parse(result);
}
function callPyBank(fn,args){
  pyodide.globals.set("_payload",JSON.stringify(args));
  const out=pyodide.runPython(`_args = json.loads(_payload)\n_result = ${fn}(*_args)\njson.dumps({"result": _result, "bank": (_args[0] if _args and isinstance(_args[0], dict) else None)})`);
  const parsed=JSON.parse(out);
  const next=unwrapBank(parsed.result,null)||(parsed.bank&&parsed.bank.name!==undefined&&parsed.bank.cash!==undefined?parsed.bank:null);
  return {result:parsed.result,bank:next};
}
function adoptBank(next){
  if(!next)return;
  const keep={paused:bank.paused,speed:bank.speed,last_active:bank.last_active,created_at:bank.created_at,location_details:bank.location_details};
  bank={...keep,...next};
}
function applyMutation(fn,args){
  const r=callPyBank(fn,args);
  adoptBank(r.bank);
  return r.result&&typeof r.result==="object"?r.result:{ok:!!r.bank,message:r.bank?"Done.":"Nothing changed."};
}
const metricPrev={};
let ui={history:[],activity:[]};
const TICK_MS=12000;let nextTickAt=0,lastFrame=0;
const sevOf=(e)=>String(e?.severity||"").toLowerCase();
const cap=(t)=>{t=String(t??"");return t.charAt(0).toUpperCase()+t.slice(1);};
function ensureDelta(el){let d=el.nextElementSibling;if(!d||!d.classList.contains("delta")){d=document.createElement("em");d.className="delta flat";el.after(d);}return d;}
function setMetric(id,value,fmt=money,opts={}){
  const el=$(id);if(!el)return;
  const v=Number(value||0),old=metricPrev[id];
  el.textContent=fmt(v);
  const d=opts.delta?ensureDelta(el):null;
  if(old!==undefined&&Math.round(old*100)!==Math.round(v*100)){
    const diff=v-old,good=opts.goodUp===false?diff<0:diff>0;
    if(d){d.textContent=`${diff>0?"▲":"▼"} ${fmt(Math.abs(diff))}`;d.className="delta "+(good?"up":"down");}
    el.classList.remove("flash");void el.offsetWidth;el.classList.add("flash");
  }
  metricPrev[id]=v;
}
function persistUI(){try{putSetting(`ui-${activeSlot}`,ui).catch(()=>{});}catch(_){}}
function logActivity(tag,text){ui.activity.unshift({tag,text});if(ui.activity.length>40)ui.activity.length=40;}
function recordSnapshot(){
  if(!bank)return;
  let snap;try{const s=getSummary();snap={day:bank.day,year:bank.year,assets:s.assets,deposits:bank.deposits,cash:bank.cash,income:bank.net_income,customers:bank.customers};}catch(_){return;}
  let last=ui.history[ui.history.length-1];
  if(last&&(snap.year<last.year||(snap.year===last.year&&snap.day<last.day))){ui.history=[];ui.activity=[];last=null;}
  if(last&&last.year===snap.year&&last.day===snap.day)ui.history[ui.history.length-1]=snap;
  else{
    if(last){const parts=[];const d=(label,a,b)=>{const diff=Math.round(b-a);if(diff)parts.push(`${label} ${diff>0?"▲":"▼"} ${money(Math.abs(diff))}`);};
      d("Deposits",last.deposits,snap.deposits);d("Cash",last.cash,snap.cash);d("Net income",last.income,snap.income);
      const c=(snap.customers||0)-(last.customers||0);if(c)parts.push(`Customers ${c>0?"▲":"▼"} ${num(Math.abs(c))}`);
      if(parts.length)logActivity(`Day ${snap.day}`,parts.join(" · "));}
    ui.history.push(snap);if(ui.history.length>120)ui.history.shift();
  }
  persistUI();
}
function sparkline(values,cls){
  if(values.length<2)return `<div class="trend-empty">Collecting data… the chart fills in as days pass.</div>`;
  const w=300,h=64,pad=4,min=Math.min(...values),max=Math.max(...values),range=max-min||1;
  const pts=values.map((v,i)=>[pad+i*(w-2*pad)/(values.length-1),h-pad-((v-min)/range)*(h-2*pad)]);
  const line=pts.map(q=>q[0].toFixed(1)+","+q[1].toFixed(1)).join(" ");
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-hidden="true"><polygon class="area ${cls}" points="${pad},${h} ${line} ${w-pad},${h}"/><polyline class="line ${cls}" points="${line}"/></svg>`;
}
function renderPnl(s){
  const pl=s.pnl||{},has=pl.net!==undefined;
  const set=(id,v,neg)=>{const el=$(id);if(!el)return;el.textContent=has?((neg&&v?"−":"")+money(Math.abs(v))):"—";};
  set("pnl-interest",pl.interest);set("pnl-treasury",pl.treasury);set("pnl-fees",pl.fees);
  set("pnl-funding",pl.funding_cost,true);set("pnl-payroll",pl.payroll,true);set("pnl-operating",pl.operating,true);set("pnl-writeoffs",pl.writeoffs,true);
  const n=$("pnl-net");if(n){n.textContent=has?((pl.net<0?"−":"+")+money(Math.abs(pl.net))):"—";n.className=has?(pl.net<0?"down":"up"):"";}
  const mk=$("strip-market");if(mk&&bank)mk.textContent=String(bank.market_condition||"Stable").toUpperCase();
}
function renderTrends(){
  if(!$("trend-assets"))return;
  const h=ui.history;
  [["assets","trend-assets","c1"],["deposits","trend-deposits","c2"],["income","trend-income","c3"]].forEach(([key,id,cls])=>{
    $(id).innerHTML=sparkline(h.map(x=>x[key]),cls);
    const last=h[h.length-1],first=h[0];
    $(id+"-val").textContent=last?money(last[key]):"—";
    const change=last&&first&&h.length>1?last[key]-first[key]:0;
    const c=$(id+"-chg");c.textContent=change?`${change>0?"▲":"▼"} ${money(Math.abs(change))} since tracking began`:"No change yet";c.className="trend-chg "+(change>0?"up":change<0?"down":"flat");
  });
  $("activity-list").innerHTML=ui.activity.slice(0,8).map(a=>`<div class="activity-row"><span class="activity-tag">${safe(a.tag)}</span><span>${safe(a.text)}</span></div>`).join("")||`<div class="empty-state">Activity appears here after each simulated day.</div>`;
}
function updateStrip(){
  if(!bank||!$("strip-day"))return;
  $("strip-day").textContent=`Day ${bank.day} · ${bank.year}`;
  const left=Math.max(0,nextTickAt-Date.now());
  $("tick-bar").style.width=`${paused?0:clamp(100-(left/TICK_MS)*100,0,100)}%`;
  $("tick-countdown").textContent=paused?"Paused":`Next day in ${Math.ceil(left/1000)}s`;
}
function openDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,DB_VERSION);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains("slots"))db.createObjectStore("slots",{keyPath:"slot"});if(!db.objectStoreNames.contains("settings"))db.createObjectStore("settings",{keyPath:"key"});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
let db;
function txStore(name,mode="readonly"){return db.transaction(name,mode).objectStore(name);}
function getSlot(slot){return new Promise((resolve,reject)=>{const req=txStore("slots").get(slot);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);});}
function putSlot(slot,data){return new Promise((resolve,reject)=>{const req=txStore("slots","readwrite").put({slot,data,updatedAt:Date.now()});req.onsuccess=()=>resolve();req.onerror=()=>reject(req.error);});}
function getSetting(key){return new Promise(resolve=>{const req=txStore("settings").get(key);req.onsuccess=()=>resolve(req.result?.value);req.onerror=()=>resolve(null);});}
function putSetting(key,value){return new Promise((resolve,reject)=>{const req=txStore("settings","readwrite").put({key,value});req.onsuccess=()=>resolve();req.onerror=()=>reject(req.error);});}
function migrateSave(data){
  if(!data||typeof data!=="object")throw new Error("Invalid save file.");
  if(!data.version)data.version=1;
  if(data.version>1)throw new Error("This save was created by a newer version of Own A Bank.");
  data.events ||= [];data.employees ||= [];data.competitors ||= [];data.loan_applications ||= [];
  data.npl ||= 0;data.credit_policy ||= "balanced";data.speed ||= 1;data.day ||= 1;data.year ||= 2026;
  data.version=1;return data;
}
function unwrapBank(result,fallback){
  if(result&&typeof result==="object"){
    if(result.bank&&typeof result.bank==="object")return result.bank;
    if(result.state&&typeof result.state==="object")return result.state;
    if(result.name!==undefined&&result.cash!==undefined)return result;
  }
  return fallback;
}
function saveCurrent(){if(!bank)return Promise.resolve();bank.last_active=Date.now();return putSlot(activeSlot,bank);}
let activeSlot=1;
async function selectSlot(slot){activeSlot=slot;const rec=await getSlot(slot);if(rec?.data){bank=migrateSave(rec.data);enterGame();toast(`Loaded save slot ${slot}.`);}else{bank=null;showSetup();}}
function showSetup(){$("setup-screen").classList.remove("hidden");$("game-screen").classList.add("hidden");}
function enterGame(){
  if(!bank){showSetup();return;}
  $("setup-screen").classList.add("hidden");$("game-screen").classList.remove("hidden");
  $("side-bank-name").textContent=bank.name;$("side-bank-location").textContent=bank.location;
  $("welcome-bank-name").textContent=bank.name;
  paused=!!bank.paused;speed=bank.speed||1;updatePauseButton();
  document.querySelectorAll(".speed-btn").forEach(x=>x.classList.toggle("active",Number(x.dataset.speed)===speed));
  try{renderAll();}catch(err){console.error(err);toast("Display error: "+(err.message||err),true);}
  Object.keys(metricPrev).forEach(k=>delete metricPrev[k]);
  getSetting(`ui-${activeSlot}`).then(v=>{ui=v&&Array.isArray(v.history)?v:{history:[],activity:[]};if(!Array.isArray(ui.activity))ui.activity=[];recordSnapshot();renderAll();}).catch(()=>{});
  startTimer();
}
function startNewGame(){
  let location;
  try{location=getSelectedLocation();}catch(err){toast(err.message,true);return;}
  const name=$("bank-name").value.trim()||"Northstar Community Bank";
  const created=callPyPos("new_game",[name,location.label,selectedDifficulty,null]);
  created.location_details={country:location.country,country_code:location.country_code,region:location.region,province:location.province,city:location.city,population:location.population,place_id:location.place_id,admin1_code:location.admin1_code,admin2_code:location.admin2_code};
  try{const rr=callPyBank("apply_regional_context",[created,created.location_details]);if(rr.bank)Object.assign(created,rr.bank);}catch(err){console.warn("Regional market context skipped:",err);}
  bank=created;bank.created_at=Date.now();bank.last_active=Date.now();bank.paused=false;bank.speed=1;
  putSetting(`ui-${activeSlot}`,{history:[],activity:[]}).catch(()=>{}).then(()=>putSlot(activeSlot,bank)).then(()=>{enterGame();toast("Your institution has commenced operations.");});
}
function stopTimer(){if(timer)clearInterval(timer);timer=null;}
function runTick(){
  try{
    const r=callPyBank("tick",[bank,datasets,speed,null]);adoptBank(r.bank);
    recordSnapshot();renderAll();
    if(r.result?.new_events?.length)r.result.new_events.forEach(e=>toast(e.title));
    saveCurrent();
  }catch(err){console.error("Simulation tick failed:",err);}
}
function startTimer(){
  stopTimer();lastFrame=Date.now();nextTickAt=lastFrame+TICK_MS;
  timer=setInterval(()=>{
    if(!bank)return;const now=Date.now();
    if(paused){nextTickAt+=now-lastFrame;lastFrame=now;updateStrip();return;}
    lastFrame=now;
    if(now>=nextTickAt){nextTickAt=now+TICK_MS;runTick();}
    updateStrip();
  },250);
}
function updatePauseButton(){$("pause-btn").textContent=paused?"▶ Resume":"Ⅱ Pause";}
function setView(view){
  currentView=view;document.querySelectorAll(".view").forEach(el=>el.classList.remove("active"));
  $(`view-${view}`).classList.add("active");document.querySelectorAll(".nav-item[data-view]").forEach(el=>el.classList.toggle("active",el.dataset.view===view));
  const titles={overview:["EXECUTIVE OFFICE","Overview"],banking:["CUSTOMER & BRANCH SERVICES","Banking operations"],lending:["CREDIT PORTFOLIO","Credit & lending"],treasury:["FINANCIAL MANAGEMENT","Treasury"],employees:["PEOPLE & ORGANIZATION","Employees"],competitors:["MARKET INTELLIGENCE","Competitor landscape"],events:["WORLD DEVELOPMENTS","Situation center"]};
  $("view-eyebrow").textContent=titles[view][0];$("view-title").textContent=titles[view][1];$("sidebar")?.classList.remove("open");renderAll();
}
function getSummary(){return callPyPos("summary",[bank]);}
function renderAll(){if(!bank)return;const s=getSummary();
  $("side-bank-name").textContent=bank.name;$("side-bank-location").textContent=bank.location;$("welcome-bank-name").textContent=bank.name;
  $("bank-level").textContent=bank.level;$("level-stage").textContent=s.stage;$("date-label").textContent=`Day ${bank.day} · ${bank.year}`;
  setMetric("metric-assets",s.assets,money,{delta:true});setMetric("metric-deposits",bank.deposits,money,{delta:true});setMetric("metric-liquidity",bank.cash,money,{delta:true});setMetric("metric-income",bank.net_income,money,{delta:true});
  $("assets-change").textContent=`${num(bank.customers)} customers · ${bank.branches} branch`;
  $("liquidity-status").textContent=s.liquidity_ratio<12?"Liquidity needs attention":"Cash and liquid assets";
  setMetric("balance-cash",bank.cash);setMetric("balance-loans",bank.loans);setMetric("balance-other",bank.other_assets);setMetric("balance-liabilities",s.liabilities);setMetric("balance-equity",s.equity);
  $("capital-ratio").textContent=`${Number(s.capital_ratio).toFixed(2)}%`;$("capital-bar").style.width=`${clamp(s.capital_ratio,0,100)}%`;
  $("recent-events").innerHTML=bank.events.slice(0,3).map(eventHTML).join("")||`<div class="empty-state">No notable developments yet. The market may be quiet for now.</div>`;
  $("alert-count").textContent=bank.events.filter(e=>e.status==="Open").length;
  setMetric("ops-accounts",bank.accounts,num,{delta:true});setMetric("ops-transactions",bank.transactions,num,{delta:true});$("ops-confidence").textContent=`${bank.confidence.toFixed(0)}%`;$("branch-count").textContent=bank.branches;$("ops-location").textContent=bank.location;if($("ops-market"))$("ops-market").textContent=s.market_label?`${s.market_label}${s.market_known&&s.market_population?` · pop. ${num(s.market_population)}`:""}`:"—";$("ops-customers").textContent=num(bank.customers);
  setMetric("loan-total",bank.loans,money,{delta:true});$("loan-npl").textContent=money(bank.npl||0);$("npl-ratio").textContent=`${s.npl_ratio}% of portfolio`;$("loan-apps").textContent=bank.loan_applications.length;
  $("credit-policy").value=bank.credit_policy;$("loan-rate").textContent=({"conservative":"8.5%","balanced":"10.0%","growth":"11.5%"})[bank.credit_policy];
  currentApplication=bank.loan_applications[0]||null;
  $("loan-request").innerHTML=currentApplication?`<h4>${safe(currentApplication.borrower)}</h4><p>Request: <b>${money(currentApplication.amount)}</b><br>Purpose: ${safe(currentApplication.purpose)}<br>Indicative credit score: ${currentApplication.credit_score}/100 · ${safe(currentApplication.risk)} risk</p>`:`<div class="empty-state">No pending applications. New opportunities may arrive as the simulation develops.</div>`;
  $("approve-loan").disabled=!currentApplication;$("reject-loan").disabled=!currentApplication;
  $("treasury-cash").textContent=money(bank.cash);$("treasury-deposits").textContent=money(bank.deposits);$("treasury-coverage").textContent=`${s.liquidity_ratio}%`;$("t-assets").textContent=money(s.assets);$("t-liabilities").textContent=money(s.liabilities);$("t-equity").textContent=money(s.equity);$("t-buffer").textContent=money(bank.cash);
  $("employee-count").textContent=bank.employees.length;$("employee-morale").textContent=`${s.morale}%`;$("employee-payroll").textContent=money(s.payroll);
  $("employee-table").innerHTML=bank.employees.map(e=>`<tr><td><div class="employee-name"><span class="employee-avatar">${safe(e.name[0]||"E")}</span><strong>${safe(e.name)}</strong></div></td><td>${safe(e.role)}</td><td>${safe(e.department)}</td><td>${Math.round(e.competence)}%</td><td>${Math.round(e.loyalty)}%</td><td>${money(e.salary)}</td><td><button class="mini-action" data-employee="${e.id}">Review</button></td></tr>`).join("");
  $("competitor-count").textContent=bank.competitors.length;$("market-share").textContent=`${s.market_share}%`;$("market-condition").textContent=bank.market_condition;
  $("competitor-list").innerHTML=bank.competitors.map(r=>`<div class="competitor-row"><div class="competitor-logo">⌂</div><div><b>${safe(r.name)}</b><p>${safe(r.strategy)} · ${safe(r.location)}<br>Recent move: ${safe(r.last_move)}</p></div><div class="competitor-metrics"><strong>${money(r.deposits)}</strong><small>Estimated deposits</small></div></div>`).join("");
  $("event-list").innerHTML=bank.events.map(e=>`<article class="event-card"><div class="event-mark">${sevOf(e)==="positive"?"↗":sevOf(e)==="material"?"!":"◉"}</div><div><h3>${safe(e.title)}</h3><p>${safe(e.description)}</p>${e.impact?`<p class="event-impact">${safe(e.impact)}</p>`:""}<div class="event-meta">DAY ${e.day} · ${safe(e.category)} · ${safe(e.severity)} · ${safe(e.status)}</div></div><div class="event-actions">${e.status==="Open"?(e.choices||[]).map(c=>`<button class="secondary-btn" data-event="${e.id}" data-action="${c.action}">${safe(cap(c.label))}</button>`).join(""):`<span class="tag">${safe(String(e.status||"Noted")).toUpperCase()}</span>`}</div></article>`).join("")||`<div class="empty-state">No events have been generated yet. Your institution's environment is currently quiet.</div>`;
  const open=bank.events.find(e=>e.status==="Open"&&sevOf(e)==="material");$("global-alert").classList.toggle("hidden",!open);$("global-alert").textContent=open?`Attention: ${open.title} — review the Situation Center for available responses.`:"";renderPnl(s);renderTrends();updateStrip();
}
function eventHTML(e){return `<div class="recent-event"><div class="event-mark">${sevOf(e)==="positive"?"↗":"◉"}</div><div><b>${safe(e.title)}</b><p>${safe(e.description)}</p></div></div>`;}
async function actionResult(result){if(!result.ok){toast(result.message,true);return;}toast(result.message);logActivity(`Day ${bank.day}`,result.message);recordSnapshot();renderAll();await saveCurrent();}
function doAction(name){const result=applyMutation("action",[bank,name]);actionResult(result);}
function openHireModal(){
  showModal(`<h2>Recruit an employee</h2><p>Recruitment is available from the beginning. Consider the role, department, and ongoing salary commitment.</p><label class="field-label">Employee name</label><input id="hire-name" placeholder="e.g. Alex Dela Cruz"><label class="field-label">Position</label><select id="hire-role"><option>Operations Manager</option><option>Credit Officer</option><option>Risk Analyst</option><option>Compliance Officer</option><option>Technology Officer</option><option>Customer Service Associate</option><option>Branch Manager</option><option>Finance Officer</option><option>Human Resources Officer</option></select><label class="field-label">Department</label><select id="hire-dept"><option>Operations</option><option>Credit</option><option>Risk Management</option><option>Compliance</option><option>Technology</option><option>Customer Service</option><option>Branch Management</option><option>Finance</option><option>Human Resources</option></select><label class="field-label">Daily salary (PHP)</label><input id="hire-salary" type="number" min="700" max="15000" value="1800"><div class="modal-actions"><button class="secondary-btn" id="cancel-modal">Cancel</button><button class="primary-btn" id="confirm-hire">Recruit employee</button></div>`);
  $("cancel-modal").onclick=closeModal;$("confirm-hire").onclick=async()=>{const result=applyMutation("hire",[bank,$("hire-name").value,$("hire-role").value,$("hire-dept").value,Number($("hire-salary").value)]);closeModal();await actionResult(result);};
}
function openSaveModal(){
  showModal(`<h2>Save & export</h2><p>Three independent save slots. Export a slot to move it to another browser or device.</p><div id="save-slot-list">Loading slots…</div><div class="modal-actions"><button class="secondary-btn" id="close-save">Close</button><label class="primary-btn" style="text-align:center;cursor:pointer">Import save<input id="import-save" type="file" accept=".json,application/json" hidden></label></div>`);
  $("close-save").onclick=closeModal;renderSlotList();
  $("import-save").onchange=async e=>{const file=e.target.files[0];if(!file)return;try{const raw=JSON.parse(await file.text());const parsed=migrateSave(raw.bank||raw);const target=activeSlot;await putSlot(target,parsed);bank=parsed;closeModal();enterGame();toast(`Save imported into slot ${target}.`);}catch(err){toast(err.message||"Unable to import save.",true);}};
}
async function renderSlotList(){let html="";for(let i=1;i<=SLOT_COUNT;i++){const rec=await getSlot(i);const active=i===activeSlot;html+=`<div class="save-slot"><div><b>Save slot ${i} ${active?"· CURRENT":""}</b><small>${rec?.data?`${safe(rec.data.name)} · Level ${rec.data.level} · Day ${rec.data.day}`:"Empty slot"}</small></div><div class="save-actions"><button class="mini-action" data-load="${i}">Load</button><button class="mini-action" data-export="${i}" ${rec?.data?"":"disabled"}>Export</button><button class="mini-action" data-clear="${i}" ${rec?.data?"":"disabled"}>Clear</button></div></div>`;}$("save-slot-list").innerHTML=html;
  $("save-slot-list").querySelectorAll("[data-load]").forEach(b=>b.onclick=async()=>{await saveCurrent();await selectSlot(Number(b.dataset.load));closeModal();});
  $("save-slot-list").querySelectorAll("[data-export]").forEach(b=>b.onclick=async()=>{const slot=Number(b.dataset.export),rec=await getSlot(slot);if(!rec)return;const blob=new Blob([JSON.stringify({game:"Own A Bank",version:1,exportedAt:new Date().toISOString(),bank:rec.data},null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`own-a-bank-slot-${slot}.json`;a.click();URL.revokeObjectURL(url);});
  $("save-slot-list").querySelectorAll("[data-clear]").forEach(b=>b.onclick=async()=>{const slot=Number(b.dataset.clear);if(!confirm(`Clear save slot ${slot}? This cannot be undone unless you exported it.`))return;await new Promise((resolve,reject)=>{const req=txStore("slots","readwrite").delete(slot);req.onsuccess=resolve;req.onerror=()=>reject(req.error);});if(slot===activeSlot){bank=null;showSetup();closeModal();}else renderSlotList();});
}
function openSettings(){
  const themes=[["corporate-dark","Corporate Dark"],["corporate-light","Corporate Light"],["executive","Executive"],["modern-fintech","Modern Fintech"],["glass","Glass"],["monochrome","Monochrome"]];
  showModal(`<h2>Preferences</h2><p>Visual themes change presentation only. They do not affect simulation outcomes.</p><label class="field-label">Interface theme</label><select id="theme-select">${themes.map(([v,l])=>`<option value="${v}" ${document.body.dataset.theme===v?"selected":""}>${l}</option>`).join("")}</select><div class="modal-actions"><button class="secondary-btn" id="close-settings">Close</button><button class="primary-btn" id="apply-theme">Apply theme</button></div>`);
  $("close-settings").onclick=closeModal;$("apply-theme").onclick=async()=>{document.body.dataset.theme=$("theme-select").value;await putSetting("theme",$("theme-select").value);closeModal();};
}
function bindEvents(){
  document.querySelectorAll(".difficulty-card").forEach(b=>b.onclick=()=>{selectedDifficulty=b.dataset.difficulty;document.querySelectorAll(".difficulty-card").forEach(x=>x.classList.toggle("selected",x===b));});
  $("start-game").onclick=startNewGame;
  document.querySelectorAll(".nav-item[data-view]").forEach(b=>b.onclick=()=>setView(b.dataset.view));
  document.querySelectorAll("[data-goto]").forEach(b=>b.onclick=()=>setView(b.dataset.goto));
  const mobileMenu=$("mobile-menu"), sidebar=$("sidebar"), sidebarBackdrop=$("sidebar-backdrop");
  const setSidebarOpen=(open)=>{
    const isMobile=window.matchMedia("(max-width: 760px)").matches;
    const shouldOpen=Boolean(open&&isMobile);
    sidebar.classList.toggle("open",shouldOpen);
    sidebarBackdrop.classList.toggle("visible",shouldOpen);
    mobileMenu.setAttribute("aria-expanded",String(shouldOpen));
    mobileMenu.setAttribute("aria-label",shouldOpen?"Close navigation":"Open navigation");
    document.body.classList.toggle("nav-open",shouldOpen);
  };
  mobileMenu.addEventListener("click",()=>setSidebarOpen(!sidebar.classList.contains("open")));
  sidebarBackdrop.addEventListener("click",()=>setSidebarOpen(false));
  sidebar.querySelectorAll(".nav-item[data-view]").forEach(item=>item.addEventListener("click",()=>setSidebarOpen(false)));
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&sidebar.classList.contains("open"))setSidebarOpen(false);});
  window.addEventListener("resize",()=>{if(!window.matchMedia("(max-width: 760px)").matches)setSidebarOpen(false);});
  $("pause-btn").onclick=async()=>{paused=!paused;bank.paused=paused;updatePauseButton();await saveCurrent();toast(paused?"Simulation paused.":"Simulation resumed.");};
  document.querySelectorAll(".speed-btn").forEach(b=>b.onclick=async()=>{speed=Number(b.dataset.speed);bank.speed=speed;document.querySelectorAll(".speed-btn").forEach(x=>x.classList.toggle("active",x===b));await saveCurrent();});
  $("theme-toggle").onclick=()=>openSettings();$("settings-menu").onclick=()=>openSettings();$("save-menu").onclick=()=>openSaveModal();
  $("hire-employee").onclick=openHireModal;
  if($("repay-funding"))$("repay-funding").onclick=()=>doAction("repay");
  if($("open-branch"))$("open-branch").onclick=()=>doAction("branch");
  document.querySelectorAll("[data-action]").forEach(b=>b.addEventListener("click",()=>{const a=b.dataset.action;if(a==="hire")openHireModal();else if(a==="deposit"){const r=applyMutation("campaign",[bank]);actionResult(r);}else if(a==="loan")setView("lending");else if(a==="invest")doAction("funding");}));
  $("run-campaign").onclick=()=>actionResult(applyMutation("campaign",[bank]));
  $("improve-service").onclick=()=>doAction("service");
  $("approve-loan").onclick=()=>{if(!currentApplication)return;actionResult(applyMutation("approve_loan",[bank,currentApplication.id]));};
  $("reject-loan").onclick=()=>{if(!currentApplication)return;actionResult(applyMutation("reject_loan",[bank,currentApplication.id]));};
  $("credit-policy").onchange=async e=>{bank.credit_policy=e.target.value;await saveCurrent();renderAll();toast("Credit policy updated.");};
  $("retain-earnings").onclick=()=>doAction("retain");$("wholesale-funding").onclick=()=>doAction("funding");$("tighten-lending").onclick=()=>doAction("tighten");
  $("event-list").onclick=e=>{const b=e.target.closest("[data-event]");if(!b)return;actionResult(applyMutation("resolve_event",[bank,b.dataset.event,b.dataset.action]));};
  $("employee-table").onclick=e=>{const b=e.target.closest("[data-employee]");if(!b)return;const emp=bank.employees.find(x=>x.id===b.dataset.employee);if(emp)showModal(`<h2>${safe(emp.name)}</h2><p>${safe(emp.role)} · ${safe(emp.department)}</p><div class="info-row"><span>Competence</span><strong>${Math.round(emp.competence)}%</strong></div><div class="info-row"><span>Loyalty</span><strong>${Math.round(emp.loyalty)}%</strong></div><div class="info-row"><span>Morale</span><strong>${Math.round(emp.morale)}%</strong></div><div class="info-row"><span>Experience</span><strong>${emp.experience} years</strong></div><div class="info-row"><span>Daily salary</span><strong>${money(emp.salary)}</strong></div><div class="modal-actions"><button class="secondary-btn" id="raise-emp">Give 10% raise</button><button class="primary-btn" id="close-emp">Close</button></div>`);if($("close-emp"))$("close-emp").onclick=closeModal;if($("raise-emp"))$("raise-emp").onclick=async()=>{closeModal();await actionResult(applyMutation("give_raise",[bank,emp.id]));};};
}
async function init(){
  try{
    await loadPyodideRuntime();db=await openDB();
    const theme=await getSetting("theme");if(theme)document.body.dataset.theme=theme;
    bindEvents();
    $("boot-screen").classList.add("hidden");$("app").classList.remove("hidden");
    // Resume most recently active populated slot; otherwise show new game setup.
    let latest=null;for(let i=1;i<=SLOT_COUNT;i++){const rec=await getSlot(i);if(rec&&(!latest||rec.updatedAt>latest.rec.updatedAt))latest={slot:i,rec};}
    if(latest){activeSlot=latest.slot;bank=migrateSave(latest.rec.data);const elapsed=bank.last_active?Date.now()-bank.last_active:0;if(elapsed>60000){try{const r=callPyBank("offline_catchup",[bank,datasets,Math.min(86400000,elapsed/1000)]);if(r.bank){adoptBank(r.bank);if(r.result?.simulated_ticks)toast(`Welcome back. ${r.result.simulated_ticks} offline simulation ticks were processed (maximum 24 hours).`);}else console.warn("Offline catch-up returned an unexpected result; keeping saved state.",r.result);}catch(err){console.warn("Offline catch-up skipped; keeping saved state.",err);}}enterGame();}
    else showSetup();
  }catch(err){$("app").classList.add("hidden");$("boot-screen").classList.remove("hidden");$("boot-screen").innerHTML=`<div class="boot-mark">OB</div><h1>OWN A BANK</h1><p>Unable to initialize the simulation.</p><p style="max-width:560px;text-align:center;color:#e58b8b">${safe(err.message)}</p><p>Check your internet connection and reload. The local Pyodide runtime is prepared by the repository workflow; the CDN is used only as a fallback.</p>`;console.error(err);}
}
window.addEventListener("beforeunload",()=>{if(bank){bank.last_active=Date.now();putSlot(activeSlot,bank);}});
init();
