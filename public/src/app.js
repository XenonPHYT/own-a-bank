const PYODIDE_VERSION = "0.27.7";
const DB_NAME = "own-a-bank";
const DB_VERSION = 1;
const SLOT_COUNT = 3;
const $ = (id) => document.getElementById(id);
let pyodide, bank = null, datasets = null, selectedDifficulty = "easy", currentView = "overview";
let timer = null, paused = false, speed = 1, currentApplication = null;

const money = (v) => new Intl.NumberFormat("en-PH",{style:"currency",currency:"PHP",maximumFractionDigits:0}).format(Number(v||0));
const num = (v) => new Intl.NumberFormat("en-PH").format(Number(v||0));
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const safe = (s)=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(message,error=false){const el=document.createElement("div");el.className="toast"+(error?" error":"");el.textContent=message;$("toast-root").append(el);setTimeout(()=>el.remove(),3400);}
function showModal(html){$("modal-root").innerHTML=`<div class="modal-backdrop"><div class="modal-card">${html}</div></div>`;$("modal-root").querySelector(".modal-backdrop").addEventListener("click",e=>{if(e.target.classList.contains("modal-backdrop"))closeModal();});}
function closeModal(){$("modal-root").innerHTML="";}
async function loadPyodideRuntime(){
  const script=document.createElement("script");script.src=`https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.js`;
  document.head.append(script);await new Promise((res,rej)=>{script.onload=res;script.onerror=rej;});
  pyodide=await loadPyodide();const [pyRes,dataRes]=await Promise.all([fetch("/src/simulation.py"),fetch("/src/datasets.json")]);
  if(!pyRes.ok||!dataRes.ok)throw new Error("Unable to load simulation assets.");
  const pyText=await pyRes.text();datasets=await dataRes.json();pyodide.runPython(pyText);
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
function saveCurrent(){if(!bank)return Promise.resolve();bank.last_active=Date.now();return putSlot(activeSlot,bank);}
let activeSlot=1;
async function selectSlot(slot){activeSlot=slot;const rec=await getSlot(slot);if(rec?.data){bank=migrateSave(rec.data);enterGame();toast(`Loaded save slot ${slot}.`);}else{bank=null;showSetup();}}
function showSetup(){$("setup-screen").classList.remove("hidden");$("game-screen").classList.add("hidden");}
function enterGame(){
  $("setup-screen").classList.add("hidden");$("game-screen").classList.remove("hidden");
  $("side-bank-name").textContent=bank.name;$("side-bank-location").textContent=bank.location;
  $("welcome-bank-name").textContent=bank.name;
  paused=!!bank.paused;speed=bank.speed||1;updatePauseButton();renderAll();startTimer();
}
function startNewGame(){
  const name=$("bank-name").value.trim()||"Northstar Community Bank",location=$("bank-region").value;
  const created=callPyPos("new_game",[name,location,selectedDifficulty,null]);
  bank=created;bank.created_at=Date.now();bank.last_active=Date.now();bank.paused=false;bank.speed=1;
  putSlot(activeSlot,bank).then(()=>{enterGame();toast("Your institution has commenced operations.");});
}
function stopTimer(){if(timer)clearInterval(timer);timer=null;}
function startTimer(){stopTimer();timer=setInterval(()=>{if(!bank||paused)return;const result=callPyPos("tick",[bank,datasets,speed,null]);bank=result.bank;renderAll();if(result.new_events?.length)result.new_events.forEach(e=>toast(e.title));saveCurrent();},12000);}
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
  $("metric-assets").textContent=money(s.assets);$("metric-deposits").textContent=money(bank.deposits);$("metric-liquidity").textContent=money(bank.cash);$("metric-income").textContent=money(bank.net_income);
  $("assets-change").textContent=`${num(bank.customers)} customers · ${bank.branches} branch`;
  $("liquidity-status").textContent=s.liquidity_ratio<12?"Liquidity needs attention":"Cash and liquid assets";
  $("balance-cash").textContent=money(bank.cash);$("balance-loans").textContent=money(bank.loans);$("balance-other").textContent=money(bank.other_assets);$("balance-liabilities").textContent=money(s.liabilities);$("balance-equity").textContent=money(s.equity);
  $("capital-ratio").textContent=`${s.capital_ratio}%`;$("capital-bar").style.width=`${clamp(s.capital_ratio,0,100)}%`;
  $("recent-events").innerHTML=bank.events.slice(0,3).map(eventHTML).join("")||`<div class="empty-state">No notable developments yet. The market may be quiet for now.</div>`;
  $("alert-count").textContent=bank.events.filter(e=>e.status==="Open").length;
  $("ops-accounts").textContent=num(bank.accounts);$("ops-transactions").textContent=num(bank.transactions);$("ops-confidence").textContent=`${bank.confidence.toFixed(0)}%`;$("branch-count").textContent=bank.branches;$("ops-location").textContent=bank.location;$("ops-customers").textContent=num(bank.customers);
  $("loan-total").textContent=money(bank.loans);$("loan-npl").textContent=money(bank.npl||0);$("npl-ratio").textContent=`${s.npl_ratio}% of portfolio`;$("loan-apps").textContent=bank.loan_applications.length;
  $("credit-policy").value=bank.credit_policy;$("loan-rate").textContent=({"conservative":"8.5%","balanced":"10.0%","growth":"11.5%"})[bank.credit_policy];
  currentApplication=bank.loan_applications[0]||null;
  $("loan-request").innerHTML=currentApplication?`<h4>${safe(currentApplication.borrower)}</h4><p>Request: <b>${money(currentApplication.amount)}</b><br>Purpose: ${safe(currentApplication.purpose)}<br>Indicative credit score: ${currentApplication.credit_score}/100 · ${safe(currentApplication.risk)} risk</p>`:`<div class="empty-state">No pending applications. New opportunities may arrive as the simulation develops.</div>`;
  $("approve-loan").disabled=!currentApplication;$("reject-loan").disabled=!currentApplication;
  $("treasury-cash").textContent=money(bank.cash);$("treasury-deposits").textContent=money(bank.deposits);$("treasury-coverage").textContent=`${s.liquidity_ratio}%`;$("t-assets").textContent=money(s.assets);$("t-liabilities").textContent=money(s.liabilities);$("t-equity").textContent=money(s.equity);$("t-buffer").textContent=money(bank.cash);
  $("employee-count").textContent=bank.employees.length;$("employee-morale").textContent=`${s.morale}%`;$("employee-payroll").textContent=money(s.payroll);
  $("employee-table").innerHTML=bank.employees.map(e=>`<tr><td><div class="employee-name"><span class="employee-avatar">${safe(e.name[0]||"E")}</span><strong>${safe(e.name)}</strong></div></td><td>${safe(e.role)}</td><td>${safe(e.department)}</td><td>${e.competence}%</td><td>${e.loyalty}%</td><td>${money(e.salary)}</td><td><button class="mini-action" data-employee="${e.id}">Review</button></td></tr>`).join("");
  $("competitor-count").textContent=bank.competitors.length;$("market-share").textContent=`${s.market_share}%`;$("market-condition").textContent=bank.market_condition;
  $("competitor-list").innerHTML=bank.competitors.map(r=>`<div class="competitor-row"><div class="competitor-logo">⌂</div><div><b>${safe(r.name)}</b><p>${safe(r.strategy)} · ${safe(r.location)}<br>Recent move: ${safe(r.last_move)}</p></div><div class="competitor-metrics"><strong>${money(r.deposits)}</strong><small>Estimated deposits</small></div></div>`).join("");
  $("event-list").innerHTML=bank.events.map(e=>`<article class="event-card"><div class="event-mark">${e.severity==="Positive"?"↗":e.severity==="Material"?"!":"◉"}</div><div><h3>${safe(e.title)}</h3><p>${safe(e.description)}</p><div class="event-meta">DAY ${e.day} · ${safe(e.category)} · ${safe(e.severity)} · ${safe(e.status)}</div></div><div class="event-actions">${e.status==="Open"?(e.choices||[]).map(c=>`<button class="secondary-btn" data-event="${e.id}" data-action="${c.action}">${safe(c.label)}</button>`).join(""):`<span class="tag">REVIEWED</span>`}</div></article>`).join("")||`<div class="empty-state">No events have been generated yet. Your institution's environment is currently quiet.</div>`;
  const open=bank.events.find(e=>e.status==="Open"&&e.severity==="Material");$("global-alert").classList.toggle("hidden",!open);$("global-alert").textContent=open?`Attention: ${open.title} — review the Situation Center for available responses.`:"";
}
function eventHTML(e){return `<div class="recent-event"><div class="event-mark">${e.severity==="Positive"?"↗":"◉"}</div><div><b>${safe(e.title)}</b><p>${safe(e.description)}</p></div></div>`;}
async function actionResult(result){if(!result.ok){toast(result.message,true);return;}toast(result.message);renderAll();await saveCurrent();}
function doAction(name){const result=callPyPos("action",[bank,name]);actionResult(result);}
function openHireModal(){
  showModal(`<h2>Recruit an employee</h2><p>Recruitment is available from the beginning. Consider the role, department, and ongoing salary commitment.</p><label class="field-label">Employee name</label><input id="hire-name" placeholder="e.g. Alex Dela Cruz"><label class="field-label">Position</label><select id="hire-role"><option>Operations Manager</option><option>Credit Officer</option><option>Risk Analyst</option><option>Compliance Officer</option><option>Technology Officer</option><option>Customer Service Associate</option><option>Branch Manager</option><option>Finance Officer</option><option>Human Resources Officer</option></select><label class="field-label">Department</label><select id="hire-dept"><option>Operations</option><option>Credit</option><option>Risk Management</option><option>Compliance</option><option>Technology</option><option>Customer Service</option><option>Branch Management</option><option>Finance</option><option>Human Resources</option></select><label class="field-label">Daily salary (PHP)</label><input id="hire-salary" type="number" min="700" max="15000" value="1800"><div class="modal-actions"><button class="secondary-btn" id="cancel-modal">Cancel</button><button class="primary-btn" id="confirm-hire">Recruit employee</button></div>`);
  $("cancel-modal").onclick=closeModal;$("confirm-hire").onclick=async()=>{const result=callPyPos("hire",[bank,$("hire-name").value,$("hire-role").value,$("hire-dept").value,Number($("hire-salary").value)]);closeModal();await actionResult(result);};
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
  $("mobile-menu").onclick=()=>$("sidebar").classList.toggle("open");
  $("pause-btn").onclick=async()=>{paused=!paused;bank.paused=paused;updatePauseButton();await saveCurrent();toast(paused?"Simulation paused.":"Simulation resumed.");};
  document.querySelectorAll(".speed-btn").forEach(b=>b.onclick=async()=>{speed=Number(b.dataset.speed);bank.speed=speed;document.querySelectorAll(".speed-btn").forEach(x=>x.classList.toggle("active",x===b));await saveCurrent();});
  $("theme-toggle").onclick=()=>openSettings();$("settings-menu").onclick=()=>openSettings();$("save-menu").onclick=()=>openSaveModal();
  $("hire-employee").onclick=openHireModal;
  document.querySelectorAll("[data-action]").forEach(b=>b.addEventListener("click",()=>{const a=b.dataset.action;if(a==="hire")openHireModal();else if(a==="deposit"){const r=callPyPos("campaign",[bank]);actionResult(r);}else if(a==="loan")setView("lending");else if(a==="invest")doAction("funding");}));
  $("run-campaign").onclick=()=>actionResult(callPyPos("campaign",[bank]));
  $("improve-service").onclick=()=>doAction("service");
  $("approve-loan").onclick=()=>{if(!currentApplication)return;actionResult(callPyPos("approve_loan",[bank,currentApplication.id]));};
  $("reject-loan").onclick=()=>{if(!currentApplication)return;actionResult(callPyPos("reject_loan",[bank,currentApplication.id]));};
  $("credit-policy").onchange=async e=>{bank.credit_policy=e.target.value;await saveCurrent();renderAll();toast("Credit policy updated.");};
  $("retain-earnings").onclick=()=>doAction("retain");$("wholesale-funding").onclick=()=>doAction("funding");$("tighten-lending").onclick=()=>doAction("tighten");
  $("event-list").onclick=e=>{const b=e.target.closest("[data-event]");if(!b)return;actionResult(callPyPos("resolve_event",[bank,b.dataset.event,b.dataset.action]));};
  $("employee-table").onclick=e=>{const b=e.target.closest("[data-employee]");if(!b)return;const emp=bank.employees.find(x=>x.id===b.dataset.employee);if(emp)showModal(`<h2>${safe(emp.name)}</h2><p>${safe(emp.role)} · ${safe(emp.department)}</p><div class="info-row"><span>Competence</span><strong>${emp.competence}%</strong></div><div class="info-row"><span>Loyalty</span><strong>${emp.loyalty}%</strong></div><div class="info-row"><span>Morale</span><strong>${emp.morale}%</strong></div><div class="info-row"><span>Experience</span><strong>${emp.experience} years</strong></div><div class="info-row"><span>Daily salary</span><strong>${money(emp.salary)}</strong></div><div class="modal-actions"><button class="primary-btn" id="close-emp">Close</button></div>`);$("close-emp").onclick=closeModal;};
}
async function init(){
  try{
    await loadPyodideRuntime();db=await openDB();
    const theme=await getSetting("theme");if(theme)document.body.dataset.theme=theme;
    bindEvents();
    $("boot-screen").classList.add("hidden");$("app").classList.remove("hidden");
    // Resume most recently active populated slot; otherwise show new game setup.
    let latest=null;for(let i=1;i<=SLOT_COUNT;i++){const rec=await getSlot(i);if(rec&&(!latest||rec.updatedAt>latest.rec.updatedAt))latest={slot:i,rec};}
    if(latest){activeSlot=latest.slot;bank=migrateSave(latest.rec.data);const elapsed=bank.last_active?Date.now()-bank.last_active:0;if(elapsed>60000){const result=callPyPos("offline_catchup",[bank,datasets,Math.min(86400000,elapsed/1000)]);bank=result.bank;if(result.simulated_ticks)toast(`Welcome back. ${result.simulated_ticks} offline simulation ticks were processed (maximum 24 hours).`);}enterGame();}
    else showSetup();
  }catch(err){$("boot-screen").innerHTML=`<div class="boot-mark">OB</div><h1>OWN A BANK</h1><p>Unable to initialize the simulation.</p><p style="max-width:560px;text-align:center;color:#e58b8b">${safe(err.message)}</p><p>Check your internet connection and reload. Pyodide is loaded from its CDN.</p>`;console.error(err);}
}
window.addEventListener("beforeunload",()=>{if(bank){bank.last_active=Date.now();putSlot(activeSlot,bank);}});
init();
