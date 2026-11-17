/* Chopper Fit — contador de calorías personal (PWA, datos solo en este dispositivo). */
"use strict";

// ---------- utilidades ----------
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const num = (v, d = 0) => { const n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : d; };
const r0 = (n) => Math.round(n);
const r1 = (n) => Math.round(n * 10) / 10;
const fmt = (n) => r0(n).toLocaleString("es-CL");
const fmt1 = (n) => r1(n).toLocaleString("es-CL");
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const pad = (n) => String(n).padStart(2, "0");
const dkey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => dkey(new Date());
const parseD = (k) => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parseD(k); d.setDate(d.getDate() + n); return dkey(d); };
const weekStart = (k) => { const d = parseD(k); return addDays(k, -((d.getDay() + 6) % 7)); };
const DOW = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const niceDate = (k) => { const d = parseD(k); return `${DOW[d.getDay()]} ${d.getDate()} ${MES[d.getMonth()]}`; };
const longDate = (k) => { const d = parseD(k); return `${d.getDate()} de ${["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"][d.getMonth()]} de ${d.getFullYear()}`; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---------- estado ----------
const KEY = "chopperfit.v1";
const blank = () => ({
  v: 1, profile: null, goals: null, days: {}, weights: [], fast: { start: null, history: [] },
  coins: 0, lastOpen: null, owned: ["bg-prado"], bg: "bg-prado", item: null,
  myFoods: [], recent: [], weekClaimed: {}, kcalMode: "consumidas",
});
let S;
try { S = Object.assign(blank(), JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { S = blank(); }
delete S.hearts; // las vidas se quitaron
// ¿El navegador deja guardar? (en navegación privada o en navegadores dentro de otras apps puede que no)
let canStore = true;
try { localStorage.setItem(KEY + ".t", "1"); canStore = localStorage.getItem(KEY + ".t") === "1"; localStorage.removeItem(KEY + ".t"); } catch { canStore = false; }
// Copia de seguridad en IndexedDB: si iOS limpia localStorage, se recupera desde aquí.
const idb = () => new Promise((ok, bad) => {
  const r = indexedDB.open("chopperfit", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("kv");
  r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error);
});
const idbSet = (k, v) => idb().then((db) => new Promise((ok, bad) => { const t = db.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = ok; t.onerror = () => bad(t.error); })).catch(() => {});
const idbGet = (k) => idb().then((db) => new Promise((ok) => { const q = db.transaction("kv").objectStore("kv").get(k); q.onsuccess = () => ok(q.result); q.onerror = () => ok(null); })).catch(() => null);
const save = () => {
  const json = JSON.stringify(S);
  try { localStorage.setItem(KEY, json); } catch { canStore = false; }
  idbSet(KEY, json);
};

let view = "home";
let curDate = today();
let statSel = {}; // barra seleccionada por gráfico
let enterNext = true; // el próximo render anima la entrada de las tarjetas
let enterTimer = 0;
let lastGlass = -1; // vaso recién llenado (animación)
let slide = ""; // dirección del deslizamiento al cambiar de día

const emptyDay = () => ({ foods: [], water: 0, workouts: [], claimed: [] });
const getDay = (k) => S.days[k] || emptyDay();
const mutDay = (k) => (S.days[k] = S.days[k] || emptyDay());

// ---------- cálculos ----------
const ACT = [
  { id: "sedentario", name: "Sedentario", desc: "Trabajo de escritorio, poco movimiento", f: 1.2, burn: 300 },
  { id: "ligero", name: "Ligeramente activo", desc: "Ejercicio 1–3 días por semana", f: 1.375, burn: 450 },
  { id: "moderado", name: "Moderadamente activo", desc: "Ejercicio 3–5 días por semana", f: 1.55, burn: 600 },
  { id: "muy", name: "Muy activo", desc: "Ejercicio intenso 6–7 días", f: 1.725, burn: 750 },
];
// Plan diario (Mifflin-St Jeor × actividad ± el déficit o superávit del ritmo elegido).
// Al llegar al peso meta, el plan pasa solo a mantención.
function calcPlan(p) {
  p = { ...p, pace: [0.25, 0.5, 0.75].includes(+p.pace) ? +p.pace : 0.5 };
  const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === "m" ? 5 : -161);
  const act = ACT.find((a) => a.id === p.activity) || ACT[0];
  const tdee = bmr * act.f;
  const mode = p.goal === "bajar" && p.weight > p.goalWeight + 0.2 ? "bajar" : p.goal === "subir" && p.weight < p.goalWeight - 0.2 ? "subir" : "mantener";
  const delta = mode === "mantener" ? 0 : (p.pace * 7700) / 7 * (mode === "bajar" ? -1 : 1);
  const floor = p.sex === "m" ? 1500 : 1200, raw = tdee + delta;
  const kcal = Math.round(Math.max(floor, raw) / 10) * 10;
  // Proteína por kilo (más al bajar o subir, para cuidar el músculo); grasas 28 %; el resto, carbohidratos.
  const ref = mode === "bajar" ? (p.weight + p.goalWeight) / 2 : p.weight;
  const prot = r0(clamp(ref * (mode === "mantener" ? 1.5 : 1.8), (kcal * 0.15) / 4, (kcal * 0.35) / 4));
  const fat = r0((kcal * 0.28) / 9), carb = r0(Math.max(0, kcal - prot * 4 - fat * 9) / 4);
  const weeks = mode === "mantener" || !p.pace ? 0 : Math.ceil(Math.abs(p.weight - p.goalWeight) / p.pace);
  return {
    kcal, carb, fat, prot, fiber: r0((kcal / 1000) * 14), water: clamp(Math.round((p.weight * 33) / 250) * 250, 1500, 4000),
    burn: act.burn, fastH: p.fastH, weeks, targetDate: weeks ? addDays(today(), weeks * 7) : null,
    tdee: r0(tdee), mode, floored: raw < floor,
  };
}
const GOAL_KEYS = ["kcal", "carb", "fat", "prot", "fiber", "water", "burn"];
const planNow = (prof = S.profile) => calcPlan({ ...prof, weight: lastWeight() });
// Con las metas automáticas, se recalculan con el último peso registrado (el ayuno se respeta).
function autoPlan() {
  if (!S.profile || !S.goals || S.manual) return false;
  const p = planNow(), before = S.goals.kcal;
  for (const k of GOAL_KEYS) S.goals[k] = p[k];
  S.goals.weeks = p.weeks; S.goals.targetDate = p.targetDate;
  return S.goals.kcal !== before;
}
// Explica de dónde sale la meta de calorías.
function planNote(p, prof, w) {
  const act = (ACT.find((a) => a.id === prof.activity) || ACT[0]).name.toLowerCase();
  let t = `Con ${fmt1(w)} kg y un estilo de vida ${act}, gastas unas ${fmt(p.tdee)} kcal al día. `;
  if (p.mode === "mantener") t += prof.goal === "mantener" ? `Para mantener tu peso, tu meta es ${fmt(p.kcal)} kcal.` : `¡Ya llegaste a tu peso meta! Tu meta pasa a mantención: ${fmt(p.kcal)} kcal.`;
  else t += `Para ${p.mode} ${String(prof.pace).replace(".", ",")} kg por semana, tu meta es ${fmt(p.kcal)} kcal${p.floored ? ` (no bajamos de ${fmt(p.kcal)} kcal por tu salud)` : ""}${p.targetDate ? `; llegarías a ${fmt1(prof.goalWeight)} kg cerca del ${longDate(p.targetDate)}` : ""}.`;
  return t;
}
function totals(k) {
  const d = getDay(k), t = { kcal: 0, c: 0, f: 0, p: 0, fi: 0, burned: 0 };
  for (const x of d.foods) { t.kcal += x.kcal; t.c += x.c || 0; t.f += x.f || 0; t.p += x.p || 0; t.fi += x.fi || 0; }
  for (const w of d.workouts) t.burned += w.kcal;
  return t;
}
// Puntuación nutricional 0–100 de un registro (null si solo tiene calorías).
function foodScore(x) {
  if (!x.kcal || (!x.c && !x.f && !x.p)) return null;
  const per = 100 / x.kcal;
  let s = 50 + Math.min(22, (x.p || 0) * per * 3.5) + Math.min(22, (x.fi || 0) * per * 9);
  if (x.g) { const dens = (x.kcal / x.g) * 100; if (dens > 250) s -= Math.min(22, (dens - 250) / 12); else if (dens < 100) s += 6; }
  const fatShare = ((x.f || 0) * 9) / x.kcal; if (fatShare > 0.45) s -= Math.min(12, (fatShare - 0.45) * 40);
  const carbShare = ((x.c || 0) * 4) / x.kcal; if (carbShare > 0.85 && !(x.fi > 1)) s -= 18;
  return clamp(r0(s), 5, 100);
}
function dayScore(k) {
  let w = 0, s = 0;
  for (const x of getDay(k).foods) { const sc = foodScore(x); if (sc != null) { s += sc * x.kcal; w += x.kcal; } }
  return w ? r0(s / w) : null;
}
const scoreLabel = (s) => (s == null ? "Sin datos" : s < 40 ? "Bajo" : s < 60 ? "Promedio" : s < 80 ? "Bueno" : "Excelente");
const scoreColor = (s) => (s == null ? "#d5d8dc" : s < 40 ? "#e5533c" : s < 60 ? "#f2c417" : s < 80 ? "#7cc24a" : "#2f9e5b");
function streak() {
  let k = today(), n = 0;
  if (!getDay(k).foods.length) k = addDays(k, -1);
  while (getDay(k).foods.length) { n++; k = addDays(k, -1); }
  return n;
}
const lastWeight = () => (S.weights.length ? S.weights[S.weights.length - 1].kg : S.profile?.weight);
const fastHours = () => (S.fast.start ? (Date.now() - S.fast.start) / 36e5 : 0);
const hm = (h) => `${Math.floor(h)}h ${pad(Math.floor((h % 1) * 60))}m`;

// ---------- retos ----------
const inRange = (k) => { const t = totals(k).kcal, g = S.goals.kcal; return t >= g * 0.9 && t <= g * 1.1; };
const DAILY = [
  { id: "balance", icon: "⚡", name: "Balance calórico", desc: "Alcanza el 90% de tu meta sin pasarte", coins: 35,
    prog: (k) => [Math.min(totals(k).kcal, S.goals.kcal * 1.1 < totals(k).kcal ? 0 : totals(k).kcal), r0(S.goals.kcal * 0.9)], done: inRange },
  { id: "constante", icon: "🍴", name: "Mantente constante", desc: "Registra comidas 4 veces", coins: 25, prog: (k) => [getDay(k).foods.length, 4] },
  { id: "consciente", icon: "🥦", name: "Come conscientemente", desc: "Obtén más de 70 puntos en 3 comidas", coins: 35,
    prog: (k) => [getDay(k).foods.filter((x) => (foodScore(x) || 0) > 70).length, 3] },
  { id: "agua", icon: "💧", name: "Bien hidratado", desc: "Alcanza tu meta de agua", coins: 25, prog: (k) => [getDay(k).water, S.goals.water] },
];
const weekDays = (k) => { const s = weekStart(k); return [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(s, i)); };
const countDays = (k, fn) => weekDays(k).filter(fn).length;
const WEEKLY = [
  { id: "racha", icon: "🔥", name: "Mantén la racha", desc: "Mantente activo 5 días", coins: 100, prog: (k) => [countDays(k, (d) => getDay(d).foods.length > 0), 5] },
  { id: "control", icon: "⚡", name: "Control de calorías", desc: "Alcanza tu meta de calorías en 5 días", coins: 150, prog: (k) => [countDays(k, inRange), 5] },
  { id: "hidra", icon: "💧", name: "Héroe de la hidratación", desc: "Alcanza tu meta de agua en 5 días", coins: 100, prog: (k) => [countDays(k, (d) => getDay(d).water >= S.goals.water), 5] },
  { id: "peso", icon: "⚖️", name: "Seguir el progreso", desc: "Registra tu peso", coins: 100, prog: (k) => [S.weights.filter((w) => !w.init && weekDays(k).includes(w.d)).length ? 1 : 0, 1] },
  { id: "ayuno", icon: "🌙", name: "Flujo de ayuno", desc: "Alcanza la meta de ayuno 3 veces", coins: 100,
    prog: (k) => [S.fast.history.filter((h) => h.ok && weekDays(k).includes(dkey(new Date(h.end)))).length, 3] },
  { id: "entreno", icon: "🏋️", name: "Doctor en movimiento", desc: "Registra 3 entrenamientos", coins: 100,
    prog: (k) => [weekDays(k).reduce((n, d) => n + getDay(d).workouts.length, 0), 3] },
];
const isDone = (ch, k) => (ch.done ? ch.done(k) : ch.prog(k)[0] >= ch.prog(k)[1]);
function checkChallenges() {
  if (!S.goals) return;
  const k = today(), d = getDay(k), wk = weekStart(k), wc = S.weekClaimed[wk] || [];
  const won = [];
  for (const ch of DAILY) if (!d.claimed.includes(ch.id) && isDone(ch, k)) { mutDay(k).claimed.push(ch.id); S.coins += ch.coins; won.push(ch); }
  for (const ch of WEEKLY) if (!wc.includes(ch.id) && isDone(ch, k)) { (S.weekClaimed[wk] = S.weekClaimed[wk] || []).push(ch.id); S.coins += ch.coins; won.push(ch); }
  if (won.length) toast(`🎉 ${won.map((c) => c.name).join(" · ")}  +${won.reduce((n, c) => n + c.coins, 0)} ฿`);
}
function rollover() { S.lastOpen = today(); }
// Si cambió el día mientras la app estaba abierta o en segundo plano, vuelve a «hoy».
function checkDay() {
  if (!S.goals || !S.lastOpen || S.lastOpen === today()) return false;
  rollover(); curDate = today(); autoPlan(); save(); render();
  return true;
}
function commit() { checkChallenges(); save(); render(); }

// ---------- mascota ----------
// Chopper descansa quieto y reacciona con clips cortos (WebP con transparencia) que se ven una vez:
// saluda al abrir la app, come al registrar, toma agua, celebra la meta, llora si se pasa y se acuesta al empezar un ayuno.
// Al tocarlo a veces baila o se sienta. En ayuno duerme acostado.
// Todos los WebP comparten el mismo encuadre (las poses nuevas en HD tienen más píxeles), así que solo cambia la imagen.
const PET_FRAME = 62; // ms por cuadro de los clips
// Duración de cada reacción en cuadros de 62 ms. Las poses nuevas van y vuelven solas al reposo.
const PET_CLIPS = { happy: 48, eat: 32, party: 48, sad: 48, lie: 40, sentado: 81, agua: 81, baile: 81 };
const PET_TAP = [["happy", 0.4], ["party", 0.2], ["baile", 0.2], ["sentado", 0.2]];
const petTapPick = () => { let r = Math.random(); return PET_TAP.find(([, p]) => (r -= p) < 0)?.[0] ?? "happy"; };
const petFile = (id) => `assets/chopper/${id}.webp`;
const ZZ = `<span class="zz" aria-hidden="true"><i>z</i><i>z</i><i>z</i></span>`;
// Una sola <img> que sobrevive a los render: así una reacción no se corta ni vuelve al inicio al redibujar.
const petImg = Object.assign(new Image(), { alt: "Chopper", draggable: false, decoding: "async" });
let petFailed = false, petPlaying = null, petToken = 0;
const fasting = () => !!(S.goals && S.fast.start);
// Reposo: de pie, o durmiendo si hay ayuno (quieto si el sistema pide menos movimiento).
const petBase = () => (petFailed ? "assets/chopper.png" : petFile(fasting() ? (reduced ? "nap" : "sleep") : "rest"));
function syncPet() {
  const pet = petImg.closest(".pet");
  petImg.classList.toggle("clip", !petFailed);
  pet?.classList.toggle("clip", !petFailed);
  pet?.classList.toggle("playing", !!petPlaying);
  $("#app .pet-shadow")?.classList.toggle("clip", !petFailed);
}
function setPetSrc(src) { if (petImg.getAttribute("src") !== src) petImg.setAttribute("src", src); syncPet(); }
petImg.onerror = () => {
  if (petPlaying || petImg.getAttribute("src") === "assets/chopper.png") return;
  petFailed = true; setPetSrc("assets/chopper.png");
};
function mountPet() {
  const slot = $("#app img[data-pet]");
  if (!slot) return;
  petImg.className = slot.className;
  slot.replaceWith(petImg);
  if (petPlaying) syncPet(); else setPetSrc(petBase());
}
const petBlobs = {};
function petBlob(id) {
  petBlobs[id] ??= fetch(petFile(id)).then((r) => (r.ok ? r.blob() : null)).catch(() => null)
    .then((b) => { if (!b) delete petBlobs[id]; return b; });
  return petBlobs[id];
}
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
// Reproduce una reacción (`times` veces seguidas) y vuelve al reposo. Una reacción nueva corta la anterior.
// Devuelve true si terminó sin que otra la interrumpiera.
async function playPet(id, times = 1) {
  if (reduced || petFailed || !PET_CLIPS[id]) return false;
  const my = ++petToken;
  const blob = await petBlob(id);
  if (!blob || my !== petToken) return false;
  // Cada reproducción usa su propia URL: así el clip parte siempre desde el primer cuadro.
  // (No se predecodifica en otra <img>: Chrome comparte la imagen y la deja congelada en el primer cuadro.)
  const url = URL.createObjectURL(blob);
  petPlaying = id; setPetSrc(url);
  await wait(PET_CLIPS[id] * PET_FRAME * times);
  const last = my === petToken;
  if (last) { petPlaying = null; setPetSrc(petBase()); }
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return last;
}
// Al sumar agua Chopper toma un vaso (salvo que esté durmiendo en ayuno o ya esté tomando).
const drinkPet = () => { if (!fasting() && petPlaying !== "agua") playPet("agua"); };
let petsLoaded = false;
function preloadPets() {
  if (petsLoaded || reduced) return;
  petsLoaded = true;
  setTimeout(() => {
    ["happy", "eat", "party", "sad", "lie"].forEach(petBlob);
    new Image().src = petFile(fasting() ? "rest" : "sleep");
  }, 1500);
  setTimeout(() => ["agua", "baile", "sentado"].forEach(petBlob), 6000); // más pesadas: después
}
// Al abrir (o volver a) la app: con ayuno en curso se muestra su pantalla; si no, Chopper saluda.
function greet() {
  if (!S.goals) return void setTimeout(() => playPet("happy"), 900);
  if (fasting()) { if (!$("#sheet").classList.contains("open")) sheetFast(); return; }
  if (view === "home") setTimeout(() => playPet("happy"), 900);
}

// ---------- pantalla de ayuno ----------
const whenFmt = (ts) => { const d = new Date(ts); return `${DOW[d.getDay()].toLowerCase()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
function fastMsg(h, goal) {
  if (h >= goal) return `¡Cumpliste tu meta de ${goal} h! Puedes terminar el ayuno cuando quieras.`;
  const stage = h < 4 ? "Tu cuerpo todavía está usando la energía de tu última comida."
    : h < 8 ? "El azúcar en la sangre empieza a bajar y a estabilizarse."
    : h < 12 ? "Tu cuerpo está empezando a usar sus reservas."
    : "Tu cuerpo ya está quemando grasa. ¡Vas muy bien!";
  return `${stage} Faltan ${hm(goal - h)} para tu meta de ${goal} h.`;
}
function sheetFast() {
  if (!fasting()) return;
  const h = fastHours(), goal = S.goals.fastH, done = h >= goal;
  sheet(`<div class="fastscreen">
    <button class="fast-x" data-act="close" aria-label="Cerrar">✕</button>
    <div class="fast-pet">${ZZ}<img src="${petFailed ? "assets/chopper.png" : petFile(reduced ? "nap" : "sleep")}" alt="Chopper durmiendo"></div>
    <div class="fast-time" id="fastbig">${hm(h)}</div>
    <p class="fast-msg" id="fastmsg">${fastMsg(h, goal)}</p>
    <div class="fast-when"><div><span>Iniciado</span><b>${whenFmt(S.fast.start)}</b></div><div><span>Meta</span><b>${whenFmt(S.fast.start + goal * 36e5)}</b></div></div>
    <div class="fast-actions">
      <button class="btn ${done ? "" : "warm"}" data-act="endFast">${done ? "Terminar ayuno" : "Terminar ayuno ahora"}</button>
      <button class="btn plain" data-act="close">Seguir ayunando</button>
    </div></div>`, "full fast");
}

// ---------- componentes ----------
function ring(pct, color, inner, size = 64, key = "") {
  const r = size / 2 - 5, c = 2 * Math.PI * r, p = clamp(pct, 0, 1);
  return `<div class="ring" style="width:${size}px;height:${size}px"><svg viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#f1f2f4" stroke-width="6"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" class="arc"
      ${key ? `data-ak="ring-${key}" data-ap="strokeDasharray" data-to="${r1(c * p)} ${r1(c)}" data-zero="0 ${r1(c)}"` : ""}
      style="stroke-dasharray:${r1(c * p)} ${r1(c)}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg><span>${inner}</span></div>`;
}
const bar = (v, g, color, key = "") => {
  const w = r1(clamp((v / (g || 1)) * 100, 0, 100)) + "%";
  return `<div class="bar"><i ${key ? `data-ak="bar-${key}" data-ap="width" data-to="${w}" data-zero="0%"` : ""} style="width:${w};background:${color}"></i></div>`;
};
const cnt = (v, key) => `<span data-cnt="${r0(v)}" data-ck="${key}">${fmt(v)}</span>`;

// Tras cada render, las barras, anillos y números parten del valor anterior y transicionan al nuevo.
const prevAnim = {}, prevCnt = {};
const reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
function animateIn(entering) {
  if (reduced) return;
  const jobs = [];
  for (const el of document.querySelectorAll("#app [data-ak]")) {
    const k = el.dataset.ak, to = el.dataset.to, from = k in prevAnim && !entering ? prevAnim[k] : el.dataset.zero;
    prevAnim[k] = to;
    if (from === to) continue;
    el.style.transition = "none"; el.style[el.dataset.ap] = from; jobs.push(el);
  }
  if (jobs.length) { void document.body.offsetWidth; for (const el of jobs) { el.style.transition = ""; el.style[el.dataset.ap] = el.dataset.to; } }
  for (const el of document.querySelectorAll("#app [data-cnt]")) {
    const k = el.dataset.ck, to = +el.dataset.cnt, from = k in prevCnt && !entering ? prevCnt[k] : 0;
    prevCnt[k] = to;
    if (from === to) continue;
    const t0 = performance.now(), dur = 550;
    const step = (t) => {
      if (!el.isConnected) return;
      const x = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - x, 3);
      el.textContent = fmt(from + (to - from) * e);
      if (x < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
}
function toast(msg) {
  const el = document.createElement("div"); el.className = "toast"; el.textContent = msg;
  $("#toasts").appendChild(el); setTimeout(() => el.remove(), 3600);
}
let closeTimer = 0;
function sheet(html, cls = "") {
  stopScan(); clearTimeout(closeTimer);
  const box = $("#sheet"), again = box.classList.contains("open") && !box.classList.contains("closing");
  box.classList.remove("closing");
  box.innerHTML = `<div class="sheet-bg" data-act="close"></div><div class="sheet ${cls}" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  box.classList.toggle("noanim", again && cls !== "full");
  box.classList.add("open");
  lockScroll(); fitSheet();
}
// iPhone: al abrir el teclado, iOS corre la pantalla y los botones de las hojas quedaban tapados o no respondían
// al tocarlos (por ejemplo «Guardar» después de escribir un peso). La capa de hojas sigue al área visible.
function fitSheet() {
  const box = $("#sheet"), vv = window.visualViewport;
  if (!vv || !box.classList.contains("open")) { box.style.top = box.style.height = box.style.bottom = ""; box.classList.remove("kb"); return; }
  Object.assign(box.style, { top: vv.offsetTop + "px", height: vv.height + "px", bottom: "auto" });
  box.classList.toggle("kb", window.innerHeight - vv.height > 120);
}
window.visualViewport?.addEventListener("resize", () => { fitSheet(); if ($("#chatlist")) $("#chatlist").scrollTop = $("#chatlist").scrollHeight; });
window.visualViewport?.addEventListener("scroll", fitSheet);
// Al cerrar el teclado, iOS puede dejar la página corrida bajo la hoja: se devuelve a su lugar.
document.addEventListener("focusout", () => setTimeout(() => {
  if (document.activeElement?.matches?.("input, textarea, select")) return; // pasó a otro campo
  if (lockY != null && window.scrollY) window.scrollTo(0, 0);
  fitSheet();
}, 60));
function closeSheet() {
  const box = $("#sheet");
  stopScan(); clearTimeout(onlineTimer); onlineCtl?.abort();
  if (!box.classList.contains("open")) return;
  clearTimeout(closeTimer);
  box.classList.remove("noanim"); box.classList.add("closing");
  closeTimer = setTimeout(() => { box.classList.remove("open", "closing"); box.innerHTML = ""; unlockScroll(); fitSheet(); }, reduced ? 0 : 230);
}
// Congela el fondo mientras hay una hoja abierta (en iOS el fondo se desplazaba detrás).
let lockY = null;
function lockScroll() {
  if (lockY != null) return;
  lockY = window.scrollY;
  Object.assign(document.body.style, { position: "fixed", top: `-${lockY}px`, left: "0", right: "0" });
}
function unlockScroll() {
  if (lockY == null) return;
  const y = lockY; lockY = null;
  Object.assign(document.body.style, { position: "", top: "", left: "", right: "" });
  window.scrollTo(0, y);
}

// ---------- vistas ----------
function render() {
  const app = $("#app");
  if (!S.profile || !S.goals) { app.innerHTML = viewOnboard(); mountPet(); $("#nav").hidden = true; return; }
  $("#nav").hidden = false;
  document.querySelectorAll("#nav [data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
  const y = window.scrollY;
  app.innerHTML = view === "retos" ? viewRetos() : view === "stats" ? viewStats() : viewHome();
  mountPet(); preloadPets();
  if (lockY == null) window.scrollTo(0, y);
  const entering = enterNext; enterNext = false;
  if (entering && !reduced) {
    app.classList.remove("enter"); void app.offsetWidth; app.classList.add("enter");
    // Al terminar la entrada se quita la clase: si no, cada render repetía la animación y Chopper quedaba quieto.
    clearTimeout(enterTimer); enterTimer = setTimeout(() => app.classList.remove("enter"), 800);
  }
  animateIn(entering); slide = "";
}

function viewHome() {
  const k = curDate, d = getDay(k), t = totals(k), g = S.goals, isToday = k === today(), pose = fasting() ? "sleep" : "rest";
  const item = SHOP.find((x) => x.id === S.item);
  const mode = S.kcalMode, left = g.kcal - t.kcal;
  const big = cnt(mode === "consumidas" ? t.kcal : Math.abs(left), "kcal-" + mode);
  const lbl = mode === "consumidas" ? "Calorías consumidas" : left >= 0 ? "Calorías restantes" : "Calorías de más";
  const sc = dayScore(k);
  const glasses = Math.ceil(g.water / 250), full = Math.floor(d.water / 250);
  const fh = fastHours();
  const plan = planFor(k);
  const foodsHtml = MEALS.map((ml) => {
    const list = d.foods.filter((x) => x.meal === ml.id);
    if (!list.length) return "";
    return `<div class="meal-h">${ml.icon} ${ml.name} <b>${fmt(list.reduce((n, x) => n + x.kcal, 0))} kcal</b></div>` +
      list.map((x) => `<div class="row"><div class="grow"><div class="t">${esc(x.name)}</div><div class="s">${x.g ? fmt(x.g) + " g · " : ""}${fmt(x.kcal)} kcal${foodScore(x) != null ? ` · <span class="dot" style="background:${scoreColor(foodScore(x))}"></span>${foodScore(x)} pts` : ""}</div></div>
        <button class="x" data-act="delFood" data-id="${x.id}" aria-label="Eliminar ${esc(x.name)}">✕</button></div>`).join("");
  }).join("");

  return `
  <header class="scene" style="background-image:url(assets/fondos/${esc(S.bg)}.jpg)">
    <div class="scene-top">
      <h1>${esc(S.profile.petName)}</h1>
      <button class="icon-btn" data-act="settings" aria-label="Configuración">⚙️</button>
    </div>
    <div class="pet-shadow ${pose}"></div>
    <div class="pet ${pose}" data-act="pet">
      <img data-pet alt="Chopper">
      ${pose === "sleep" ? ZZ : ""}${item ? `<span class="buddy">${item.icon}</span>` : ""}
    </div>
    <div class="scene-bar">
      <div class="datenav">
        <button data-act="prevDay" aria-label="Día anterior">‹</button>
        <button data-act="pickDay" class="date">📅 ${isToday ? "Hoy" : niceDate(k)}</button>
        <button data-act="nextDay" aria-label="Día siguiente" ${isToday ? "disabled" : ""}>›</button>
      </div>
      <div class="chips"><span class="chip">🔥 ${streak()}</span><button class="chip" data-act="shop">🏪 ${fmt(S.coins)} ฿</button></div>
    </div>
  </header>
  <main class="cards ${slide ? "slide-" + slide : ""}">
    ${!canStore ? `<div class="warn">⚠️ Este navegador no está guardando tus datos. Abre la app en Safari normal (no en modo privado ni dentro de otra app).</div>`
      : isIOS && !isInstalled && !S.hideInstall ? `<div class="warn">📲 Para no perder tus datos, instala la app: <b>Compartir → Agregar a pantalla de inicio</b>. Exporta un respaldo aquí (⚙️) e impórtalo en la app instalada. <button class="link" data-act="hideInstall">Entendido</button></div>` : ""}
    <section class="card">
      <div class="card-h"><button class="lbl" data-act="kcalMode">${lbl} ⇅</button>
        <button class="ring-btn" data-act="addFood" aria-label="Agregar comida">${ring(t.kcal / g.kcal, t.kcal > g.kcal * 1.1 ? "#e5533c" : "#f5a524", "+", 64, "kcal")}</button></div>
      <div class="big">${big}</div>
      <div class="macros">
        <div><span>Carbohid.</span>${bar(t.c, g.carb, "#f5c043", "c")}<small>${fmt(t.c)} / ${g.carb} g</small></div>
        <div><span>Grasas</span>${bar(t.f, g.fat, "#3b82f6", "f")}<small>${fmt(t.f)} / ${g.fat} g</small></div>
        <div><span>Proteínas</span>${bar(t.p, g.prot, "#3fae5c", "p")}<small>${fmt(t.p)} / ${g.prot} g</small></div>
      </div>
      ${foodsHtml || `<p class="empty">Aún no hay comidas registradas ${isToday ? "hoy" : "este día"}.</p>`}
      <div class="foot">Meta: ${fmt(g.kcal)} kcal${S.manual ? "" : ` · ${{ bajar: "para bajar", subir: "para subir", mantener: "para mantener" }[planNow().mode]}`}</div>
    </section>

    <section class="card">
      <div class="card-h"><span class="lbl">Calorías quemadas</span>
        <button class="ring-btn" data-act="addWorkout" aria-label="Agregar entrenamiento">${ring(t.burned / g.burn, "#8b6cf6", "+", 64, "burn")}</button></div>
      <div class="big">${cnt(t.burned, "burn")}</div>
      ${d.workouts.map((w) => `<div class="row"><div class="grow"><div class="t">${esc(w.name)}</div><div class="s">${w.min ? w.min + " min · " : ""}${fmt(w.kcal)} kcal</div></div>
        <button class="x" data-act="delWorkout" data-id="${w.id}" aria-label="Eliminar ${esc(w.name)}">✕</button></div>`).join("")}
      <div class="foot">Meta: ${fmt(g.burn)} kcal</div>
    </section>

    <section class="card">
      <div class="card-h"><span class="lbl">Recetas para ${isToday ? "ahora" : "este día"}</span><button class="link" data-act="allRecipes">Ver todas</button></div>
      ${plan.map(recipeCard).join("")}
    </section>

    <section class="card">
      <div class="card-h"><span class="lbl">Agua</span>
        <button class="ring-btn" data-act="addWater" aria-label="Agregar agua">${ring(d.water / g.water, "#3b82f6", "+", 64, "water")}</button></div>
      <div class="big">${cnt(d.water, "water")}<small> ml</small></div>
      <div class="glasses">${Array.from({ length: glasses }, (_, i) => `<button class="glass ${i < full ? "full" : ""} ${i === lastGlass ? "pop" : ""}" data-act="glass" data-i="${i}" aria-label="Vaso ${i + 1}">${i === full ? "+" : ""}</button>`).join("")}</div>
      <div class="foot">Meta: ${fmt(g.water)} ml</div>
    </section>

    <section class="card">
      <div class="card-h"><span class="lbl">Ayuno</span>
        <button class="pill-btn" data-act="fastToggle">${S.fast.start ? "TERMINAR" : "INICIO"}</button></div>
      ${S.fast.start
        ? `<div class="big" id="fastclock">${hm(fh)}</div>${bar(fh, g.fastH, fh >= g.fastH ? "#2f9e5b" : "#3b82f6", "fast")}
           <p class="s">${fh >= g.fastH ? "¡Meta alcanzada! Puedes terminar cuando quieras." : `Faltan ${hm(g.fastH - fh)} para tu meta`}</p>`
        : `<div class="big muted">¿Listo para empezar?</div>`}
      <div class="foot">Meta: ${g.fastH}h de ayuno · ${24 - g.fastH}h de alimentación</div>
    </section>

    <section class="card">
      <div class="card-h"><span class="lbl">Puntuación nutricional</span>${ring((sc || 0) / 100, scoreColor(sc), sc ?? "–", 64, "score")}</div>
      <div class="big">${scoreLabel(sc)}</div>
      <p class="s">Promedio de tus comidas del día según proteína, fibra y densidad calórica.</p>
    </section>

    <section class="card">
      <div class="card-h"><span class="lbl">Fibra</span>${ring(t.fi / g.fiber, "#7cc24a", "🌾", 64, "fiber")}</div>
      <div class="big">${fmt1(t.fi)}<small> g</small></div>
      <div class="foot">Meta: ${g.fiber} g</div>
    </section>

    <section class="card">
      <div class="card-h"><span class="lbl">Peso</span><button class="ring-btn plain" data-act="addWeight" aria-label="Registrar peso">+</button></div>
      <div class="big">${fmt1(lastWeight())}<small> kg</small></div>
      <p class="s">${weightWhen()}</p>
      <div class="foot">${weightFoot()}</div>
    </section>
  </main>`;
}
function weightWhen() {
  const w = S.weights[S.weights.length - 1];
  if (!w) return "";
  return w.d === today() ? "Registrado hoy" : `Último registro: ${niceDate(w.d)} · toca + para anotar el de hoy`;
}
function weightFoot() {
  const w = lastWeight(), gw = S.profile.goalWeight, diff = r1(w - gw);
  if (S.profile.goal === "mantener" || !gw) return "Meta: mantener tu peso";
  if (Math.abs(diff) < 0.05) return `🎉 ¡Llegaste a tu meta de ${fmt1(gw)} kg!`;
  return `${fmt1(Math.abs(diff))} kg ${diff > 0 ? "arriba" : "abajo"} de la meta: ${fmt1(gw)} kg`;
}
// Dos recetas por día: la comida que toca según la hora y la que sigue. Cambian cada día.
function planFor(k) {
  const n = Math.floor(parseD(k).getTime() / 864e5), h = k === today() ? new Date().getHours() : 12;
  const types = h < 11 ? ["desayuno", "almuerzo"] : h < 16 ? ["almuerzo", "snack"] : h < 19 ? ["snack", "cena"] : ["cena", "snack"];
  return types.map((type, i) => { const l = RECIPES.filter((r) => r.type === type); return l[(n + i * 3) % l.length]; });
}
const mealName = (id) => MEALS.find((m) => m.id === id)?.name || "";
const recipeCard = (r) => `<button class="recipe wide" data-act="recipe" data-id="${r.id}"><img src="assets/recetas/${r.id}.jpg" alt="" loading="lazy">
  <div class="grow"><div class="kind">${mealName(r.type)} · ${r.kcal} kcal · ${r.min} min</div><div class="t">${esc(r.name)}</div>
  <div class="ing">${esc(r.ing.join(" · "))}</div></div></button>`;

function chRow(ch, k, claimed) {
  const [v, g] = ch.prog(k), done = claimed || isDone(ch, k);
  const show = (n) => (n >= 1000 ? fmt(n) : r0(n));
  return `<div class="ch ${done ? "done" : ""}"><div class="hex">${done ? "✅" : ch.icon}</div>
    <div class="grow"><div class="t">${ch.name}</div><div class="s">${ch.desc}</div>
      <div class="chbar">${bar(done ? 1 : v, done ? 1 : g, "#f5a524", "ch-" + ch.id)}<span>${show(Math.min(v, g))} / ${show(g)}</span></div></div>
    <div class="reward">${ch.coins} ฿</div></div>`;
}
function viewRetos() {
  const k = today(), d = getDay(k), wc = S.weekClaimed[weekStart(k)] || [];
  const hrs = 24 - new Date().getHours(), daysLeft = 7 - ((parseD(k).getDay() + 6) % 7);
  return `<header class="top"><h1>Retos</h1><button class="chip" data-act="shop">🏪 ${fmt(S.coins)} ฿</button></header>
  <main class="cards">
    <section class="card"><div class="card-h"><span class="lbl">Diario <b class="tag">${d.claimed.length}/${DAILY.length}</b></span><span class="lbl">${hrs}h restantes</span></div>
      ${DAILY.map((c) => chRow(c, k, d.claimed.includes(c.id))).join("")}</section>
    <section class="card"><div class="card-h"><span class="lbl">Semanal <b class="tag">${wc.length}/${WEEKLY.length}</b></span><span class="lbl">${daysLeft}d restantes</span></div>
      ${WEEKLY.map((c) => chRow(c, k, wc.includes(c.id))).join("")}</section>
    <p class="note">Los berries (฿) se entregan solos al completar cada reto. Úsalos en la tienda.</p>
  </main>`;
}

// Gráfico de barras de una sola serie (7 días). El color marca la serie; el texto va en tinta.
function barChart(id, days, vals, goal, color, unit) {
  const W = 320, H = 150, L = 6, B = 22, T = 14, max = Math.max(goal * 1.15, ...vals, 1), bw = 22, step = (W - L * 2) / days.length;
  const y = (v) => T + (H - T - B) * (1 - v / max), sel = statSel[id] ?? days.length - 1;
  const bars = days.map((k, i) => {
    const x = L + step * i + (step - bw) / 2, h = Math.max(vals[i] ? 3 : 0, H - B - y(vals[i]));
    return `<g data-act="statSel" data-chart="${id}" data-i="${i}" role="button" aria-label="${niceDate(k)}: ${fmt(vals[i])} ${unit}">
      <rect x="${L + step * i}" y="0" width="${step}" height="${H}" fill="transparent"/>
      <path d="M${x},${H - B} v${-Math.max(0, h - 4)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${Math.max(0, h - 4)} z" fill="${color}" opacity="${i === sel ? 1 : 0.45}" ${h ? "" : 'display="none"'}/>
      <text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle" class="ax ${i === sel ? "on" : ""}">${DOW[parseD(k).getDay()][0]}</text></g>`;
  }).join("");
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Últimos 7 días">
    <line x1="${L}" x2="${W - L}" y1="${H - B}" y2="${H - B}" class="base"/>
    <line x1="${L}" x2="${W - L}" y1="${y(goal)}" y2="${y(goal)}" class="goal"/>
    <text x="${W - L}" y="${y(goal) - 4}" text-anchor="end" class="ax">meta ${fmt(goal)}</text>${bars}</svg>
    <p class="tip"><b>${niceDate(days[sel])}</b> · ${fmt(vals[sel])} ${unit} <span class="s">(${r0((vals[sel] / goal) * 100)}% de la meta)</span></p>`;
}
function lineChart(pts) {
  if (pts.length < 2) return `<p class="empty">Registra tu peso al menos dos veces para ver la curva.</p>`;
  const W = 320, H = 150, L = 34, R = 10, T = 12, B = 22, ks = pts.map((p) => p.kg), gw = S.profile.goal === "mantener" ? null : S.profile.goalWeight;
  const lo = Math.floor(Math.min(...ks, gw ?? Infinity) - 1), hi = Math.ceil(Math.max(...ks, gw ?? -Infinity) + 1);
  const x = (i) => L + ((W - L - R) * i) / (pts.length - 1), y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const sel = clamp(statSel.peso ?? pts.length - 1, 0, pts.length - 1);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolución del peso">
    ${[lo, (lo + hi) / 2, hi].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" class="ax">${fmt1(v)}</text>`).join("")}
    ${gw ? `<line x1="${L}" x2="${W - R}" y1="${y(gw)}" y2="${y(gw)}" class="goal"/><text x="${W - R}" y="${y(gw) - 4}" text-anchor="end" class="ax">meta ${fmt1(gw)}</text>` : ""}
    <polyline points="${pts.map((p, i) => `${x(i)},${y(p.kg)}`).join(" ")}" fill="none" stroke="#2f9e5b" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${pts.map((p, i) => `<g data-act="statSel" data-chart="peso" data-i="${i}" role="button" aria-label="${niceDate(p.d)}: ${fmt1(p.kg)} kg"><circle cx="${x(i)}" cy="${y(p.kg)}" r="14" fill="transparent"/>
      <circle cx="${x(i)}" cy="${y(p.kg)}" r="${i === sel ? 5 : 3.5}" fill="#2f9e5b" stroke="#fff" stroke-width="2"/></g>`).join("")}
    <text x="${L}" y="${H - 6}" class="ax">${niceDate(pts[0].d)}</text><text x="${W - R}" y="${H - 6}" text-anchor="end" class="ax">${niceDate(pts[pts.length - 1].d)}</text></svg>
    <p class="tip"><b>${niceDate(pts[sel].d)}</b> · ${fmt1(pts[sel].kg)} kg</p>`;
}
function viewStats() {
  const days = [6, 5, 4, 3, 2, 1, 0].map((i) => addDays(today(), -i));
  const kc = days.map((k) => totals(k).kcal), wa = days.map((k) => getDay(k).water), logged = kc.filter(Boolean);
  const avg = logged.length ? logged.reduce((a, b) => a + b, 0) / logged.length : 0;
  const pts = S.weights.slice(-30), start = S.weights[0]?.kg ?? S.profile.weight, now = lastWeight();
  const fasts = S.fast.history.slice(-5).reverse();
  return `<header class="top"><h1>Progreso</h1><span class="chip">🔥 ${streak()} días</span></header>
  <main class="cards">
    <section class="tiles">
      <div class="tile"><span>Promedio diario</span><b>${fmt(avg)}</b><small>kcal · 7 días</small></div>
      <div class="tile"><span>Días registrados</span><b>${Object.values(S.days).filter((d) => d.foods.length).length}</b><small>en total</small></div>
      <div class="tile"><span>Cambio de peso</span><b>${now - start > 0 ? "+" : ""}${fmt1(now - start)}</b><small>kg desde el inicio</small></div>
      <div class="tile"><span>Ayunos logrados</span><b>${S.fast.history.filter((h) => h.ok).length}</b><small>en total</small></div>
    </section>
    <section class="card"><div class="card-h"><span class="lbl">Calorías consumidas · últimos 7 días</span></div>${barChart("kcal", days, kc, S.goals.kcal, "#f5a524", "kcal")}</section>
    <section class="card"><div class="card-h"><span class="lbl">Peso (kg)</span></div>${lineChart(pts)}</section>
    <section class="card"><div class="card-h"><span class="lbl">Agua · últimos 7 días</span></div>${barChart("agua", days, wa, S.goals.water, "#3b82f6", "ml")}</section>
    <section class="card"><div class="card-h"><span class="lbl">Últimos ayunos</span></div>
      ${fasts.length ? fasts.map((h) => `<div class="row"><div class="grow"><div class="t">${hm((h.end - h.start) / 36e5)}</div><div class="s">${niceDate(dkey(new Date(h.end)))}</div></div><span>${h.ok ? "✅" : "⏳"}</span></div>`).join("") : `<p class="empty">Todavía no terminas ningún ayuno.</p>`}
    </section>
  </main>`;
}

// ---------- onboarding ----------
let ob = { step: 0, name: "", petName: "Chopper", sex: "m", age: 25, height: 170, weight: 75, goal: "bajar", goalWeight: 70, pace: 0.5, activity: "moderado", fastH: 12 };
// El avance del cuestionario también se guarda, para no partir de cero si se cierra a la mitad.
const OB_KEY = KEY + ".ob";
try { Object.assign(ob, JSON.parse(localStorage.getItem(OB_KEY) || "{}")); } catch {}
const saveOb = () => { try { localStorage.setItem(OB_KEY, JSON.stringify(ob)); } catch {} };
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isInstalled = window.navigator.standalone === true || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
const OB_STEPS = 6;
const opt = (field, val, title, desc = "") => `<button class="opt ${String(ob[field]) === String(val) ? "on" : ""}" data-act="obSet" data-f="${field}" data-v="${val}"><b>${title}</b>${desc ? `<small>${desc}</small>` : ""}</button>`;
const field = (id, label, val, unit, attrs = "") => `<label class="field"><span>${label}</span><div><input id="${id}" value="${esc(val)}" ${attrs}>${unit ? `<em>${unit}</em>` : ""}</div></label>`;
function viewOnboard() {
  const s = ob.step;
  let body = "";
  if (s === 0) body = `<img class="ob-pet" data-pet alt="Chopper"><h2>¡Hola! Soy tu doctor de a bordo</h2>
    <p>Voy a ayudarte a llevar tus calorías, agua, ayuno y peso. Primero necesito conocerte.</p>
    ${!canStore ? `<div class="warn">⚠️ Este navegador no deja guardar datos (navegación privada o navegador dentro de otra app). Abre el enlace en <b>Safari</b> normal, o tendrás que ingresar todo cada vez.</div>`
      : isIOS && !isInstalled ? `<div class="warn">📲 Antes de seguir, instala la app: <b>Compartir → Agregar a pantalla de inicio</b> y ábrela desde el ícono. Lo que ingreses aquí en Safari no pasa a la app instalada.</div>` : ""}
    ${field("ob-name", "¿Cómo te llamas?", ob.name, "", 'placeholder="Tu nombre" autocomplete="given-name"')}
    ${field("ob-pet", "Nombre de tu mascota", ob.petName, "", 'maxlength="16"')}
    <button class="link" data-act="import">Ya tengo un respaldo: importarlo</button>`;
  if (s === 1) body = `<h2>Sobre ti</h2><p>Lo usamos para calcular tu gasto de energía.</p>
    <div class="opts two">${opt("sex", "m", "Hombre")}${opt("sex", "f", "Mujer")}</div>
    ${field("ob-age", "Edad", ob.age, "años", 'inputmode="numeric"')}
    ${field("ob-height", "Estatura", ob.height, "cm", 'inputmode="numeric"')}
    ${field("ob-weight", "Peso actual", ob.weight, "kg", 'inputmode="decimal"')}`;
  if (s === 2) body = `<h2>¿Cuál es tu objetivo?</h2>
    <div class="opts">${opt("goal", "bajar", "Bajar de peso")}${opt("goal", "mantener", "Mantener mi peso")}${opt("goal", "subir", "Subir de peso")}</div>
    ${ob.goal !== "mantener" ? `${field("ob-goalw", "Peso meta", ob.goalWeight, "kg", 'inputmode="decimal"')}
    <span class="sub">Ritmo semanal</span><div class="opts three">${opt("pace", 0.25, "0,25 kg", "Suave")}${opt("pace", 0.5, "0,5 kg", "Recomendado")}${opt("pace", 0.75, "0,75 kg", "Exigente")}</div>` : ""}`;
  if (s === 3) body = `<h2>¿Qué tan activo eres?</h2><div class="opts">${ACT.map((a) => opt("activity", a.id, a.name, a.desc)).join("")}</div>`;
  if (s === 4) body = `<h2>Ayuno intermitente</h2><p>Elige cuántas horas quieres ayunar al día. Puedes cambiarlo después.</p>
    <div class="opts">${opt("fastH", 12, "12 : 12", "Suave, ideal para empezar")}${opt("fastH", 14, "14 : 10", "Intermedio")}${opt("fastH", 16, "16 : 8", "El clásico")}${opt("fastH", 18, "18 : 6", "Avanzado")}</div>`;
  if (s === 5) {
    const p = calcPlan(ob), act = ACT.find((a) => a.id === ob.activity);
    body = `<h2>Tu plan está listo${ob.name ? ", " + esc(ob.name) : ""}</h2>
    ${p.targetDate ? `<p class="ok">✅ Alcanza tu meta para el ${longDate(p.targetDate)}</p>` : ""}
    <div class="plan"><h3>Recomendaciones nutricionales</h3><div class="big">🔥 ${fmt(p.kcal)} <small>kcal</small></div>
      <div class="split"><i style="flex:${p.carb * 4};background:#f5c043"></i><i style="flex:${p.fat * 9};background:#3b82f6"></i><i style="flex:${p.prot * 4};background:#3fae5c"></i></div>
      <div class="trio"><div><span class="dot" style="background:#f5c043"></span>Carboh.<b>${p.carb} g</b></div><div><span class="dot" style="background:#3b82f6"></span>Grasas<b>${p.fat} g</b></div><div><span class="dot" style="background:#3fae5c"></span>Proteínas<b>${p.prot} g</b></div></div></div>
    <div class="plan"><h3>Horario de ayuno</h3><div class="trio"><div>🌙 Ayuno<b>${p.fastH} h</b></div><div>🍴 Alimentación<b>${24 - p.fastH} h</b></div></div>
      <div class="split"><i style="flex:${p.fastH};background:#3b82f6"></i><i style="flex:${24 - p.fastH};background:#3fae5c"></i></div></div>
    <div class="plan"><h3>Hidratación diaria</h3><div class="big">💧 ${fmt(p.water)} <small>ml</small></div></div>
    <div class="plan"><h3>Actividad diaria</h3><div class="big">🔥 ${p.burn} <small>kcal quemadas</small></div><p>Según un estilo de vida ${act.name.toLowerCase()}. Todo se ajusta después en Configuración.</p></div>`;
  }
  return `<div class="onboard"><div class="ob-prog"><i style="width:${((s + 1) / OB_STEPS) * 100}%"></i></div>
    <div class="ob-body">${body}</div>
    <div class="ob-foot">${s ? `<button class="btn ghost" data-act="obBack">Atrás</button>` : ""}
      <button class="btn" data-act="obNext">${s === OB_STEPS - 1 ? "Comprometerme con mi meta" : "Continuar"}</button></div></div>`;
}
function obRead() {
  const g = (id) => $(id)?.value;
  if (ob.step === 0) { ob.name = (g("#ob-name") || "").trim(); ob.petName = (g("#ob-pet") || "").trim() || "Chopper"; }
  if (ob.step === 1) { ob.age = clamp(num(g("#ob-age"), 25), 12, 100); ob.height = clamp(num(g("#ob-height"), 170), 100, 230); ob.weight = clamp(num(g("#ob-weight"), 75), 30, 300); }
  if (ob.step === 2 && ob.goal !== "mantener") ob.goalWeight = clamp(num(g("#ob-goalw"), ob.weight), 30, 300);
  saveOb();
}
function obFinish() {
  if (ob.goal === "mantener") ob.goalWeight = ob.weight;
  const { step, ...p } = ob;
  const first = !S.profile;
  S.profile = p; S.goals = calcPlan(p); S.manual = false;
  if (first) { S.weights.push({ d: today(), kg: p.weight, init: true }); S.lastOpen = today(); S.coins += 15; }
  // Al rehacer el cuestionario con otro peso, ese peso queda registrado hoy (si no, el plan seguiría con el anterior).
  else if (Math.abs(p.weight - lastWeight()) >= 0.05) S.weights = [...S.weights.filter((w) => w.d !== today()), { d: today(), kg: r1(p.weight) }].sort((a, b) => (a.d < b.d ? -1 : 1));
  ob.step = 0; try { localStorage.removeItem(OB_KEY); } catch {}
  navigator.storage?.persist?.();
  view = "home"; enterNext = true; save(); render(); window.scrollTo(0, 0);
  if (first) toast("🎁 ¡Bienvenido! Chopper te regala 15 ฿");
}

// ---------- hojas (modales) ----------
const mealNow = () => { const h = new Date().getHours(); return h < 11 ? "desayuno" : h < 16 ? "almuerzo" : h < 19 ? "snack" : "cena"; };
const mealSel = (id = "f-meal", v = mealNow()) => `<label class="field"><span>Comida</span><div><select id="${id}">${MEALS.map((m) => `<option value="${m.id}" ${m.id === v ? "selected" : ""}>${m.name}</option>`).join("")}</select></div></label>`;

function sheetAdd() {
  const t = totals(today()), d = getDay(today());
  sheet(`<div class="menu">
    <button data-act="addWorkout"><div><b>Entrenamiento</b><small>${fmt(Math.max(0, S.goals.burn - t.burned))} kcal restantes</small></div><span>🏋️</span></button>
    <button data-act="addWeight"><div><b>Peso</b><small>${fmt1(lastWeight())} kg</small></div><span>⚖️</span></button>
    <button data-act="addWater"><div><b>Agua</b><small>${fmt(d.water)} ml</small></div><span>💧</span></button>
    <button data-act="fastToggle"><div><b>Ayuno</b><small>${S.fast.start ? "En curso: " + hm(fastHours()) : "Meta de " + S.goals.fastH + " h"}</small></div><span class="txt">${S.fast.start ? "FIN" : "INICIO"}</span></button>
    <hr>
    <div class="quick">
      <button data-act="quickAdd"><span>🔥</span>Agregar rápido</button>
      <button data-act="newFood"><span>✏️</span>Crear alimento</button>
      <button data-act="scan"><span>▦</span>Código de barras</button>
    </div>
    <button class="primary" data-act="addFood"><div><b>Buscar alimento</b><small>${fmt(Math.max(0, S.goals.kcal - t.kcal))} kcal restantes</small></div><span>🔍</span></button>
  </div>`, "dark");
}

let searchPool = [];
let online = { q: "", status: "idle", list: [] }, onlineTimer = 0, onlineCtl = null;
function sheetSearch(q = "") {
  online = { q: "", status: "idle", list: [] };
  sheet(`<h2>Buscar alimento</h2>
    <input id="q" class="search" type="search" enterkeyhint="search" placeholder="Ej: marraqueta, pollo, monster…" value="${esc(q)}" autocomplete="off" autocorrect="off">
    <div id="results"></div>
    <div class="btn-row"><button class="btn ghost" data-act="newFood">✏️ Crear alimento</button><button class="btn ghost" data-act="scan">▦ Código</button></div>`, "tall");
  drawResults();
  setTimeout(() => $("#q")?.focus(), 50);
}
const foodRow = (f, i) => `<button class="row pick" data-act="pickFood" data-i="${i}"><div class="grow"><div class="t">${esc(f.name)}</div>
  <div class="s">${esc(f.label || f.portion + " g")} · ${fmt((f.kcal * f.portion) / 100)} kcal</div></div><span class="plus">+</span></button>`;
function drawResults() {
  if (!$("#results")) return;
  const raw = ($("#q")?.value || "").trim(), q = norm(raw);
  let local, title = "";
  if (!q) { local = [...S.recent, ...S.myFoods.filter((m) => !S.recent.some((r) => r.name === m.name))].slice(0, 25); title = local.length ? "Recientes y mis alimentos" : ""; }
  else { const words = q.split(/\s+/); local = [...S.myFoods, ...FOODS].filter((f) => words.every((w) => norm(f.name).includes(w))).slice(0, 30); }
  const net = online.q === q ? online : { status: q.length >= 3 ? "loading" : "idle", list: [] };
  const extra = net.list.filter((o) => !local.some((l) => norm(l.name) === norm(o.name)));
  searchPool = [...local, ...extra];
  let html = (title ? `<div class="meal-h">${title}</div>` : "") + local.map(foodRow).join("");
  if (!q && !local.length) html += `<p class="empty">Escribe para buscar. Con 3 letras o más también se busca en línea.</p>`;
  if (q && q.length < 3 && !local.length) html += `<p class="empty">Sigue escribiendo…</p>`;
  if (q.length >= 3) {
    html += `<div class="meal-h">En línea · Open Food Facts</div>`;
    if (net.status === "loading") html += `<p class="empty"><span class="spin"></span> Buscando «${esc(raw)}»…</p>`;
    else if (net.status === "error") html += `<p class="empty">No se pudo conectar con el servidor. <button class="link" data-act="searchOnline">Reintentar</button></p>`;
    else if (!extra.length) html += `<p class="empty">Sin resultados en línea${local.length ? "" : ". Puedes crearlo a mano"}.</p>`;
    else html += extra.map((f, i) => foodRow(f, local.length + i)).join("");
  }
  $("#results").innerHTML = html;
}
function queueOnline() {
  clearTimeout(onlineTimer); onlineCtl?.abort();
  const q = norm(($("#q")?.value || "").trim());
  if (q.length >= 3 && online.q !== q) onlineTimer = setTimeout(searchOnline, 450);
}
const offCache = new Map();
// El servidor de Open Food Facts falla a ratos: se reintenta una vez y se guarda lo ya consultado.
async function offQuery(host, raw, signal) {
  const key = host + "|" + norm(raw);
  if (offCache.has(key)) return offCache.get(key);
  const url = `https://${host}.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(raw)}&search_simple=1&action=process&json=1&page_size=25&fields=product_name,brands,nutriments,serving_quantity`;
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, { signal });
      if (!r.ok) throw new Error(r.status);
      const list = ((await r.json()).products || []).map(offToFood).filter(Boolean);
      offCache.set(key, list);
      return list;
    } catch (e) {
      if (signal.aborted || attempt) throw e;
      await new Promise((ok) => setTimeout(ok, 1200));
    }
  }
}
// Busca primero en el catálogo de Chile y completa con el mundial si hay pocos resultados.
async function searchOnline() {
  const raw = ($("#q")?.value || "").trim(), q = norm(raw);
  if (q.length < 3) return;
  clearTimeout(onlineTimer); onlineCtl?.abort();
  const ctl = (onlineCtl = new AbortController());
  online = { q, status: "loading", list: [] }; drawResults();
  let list = [], failed = 0;
  for (const host of ["cl", "world"]) {
    try {
      const more = await offQuery(host, raw, ctl.signal);
      list = [...list, ...more.filter((m) => !list.some((l) => norm(l.name) === norm(m.name)))];
    } catch (e) { if (ctl.signal.aborted) return; failed++; }
    if (ctl.signal.aborted) return;
    if (list.length) { online = { q, status: list.length >= 8 || host === "world" ? "done" : "loading", list }; drawResults(); }
    if (list.length >= 8) break;
  }
  online = { q, status: !list.length && failed === 2 ? "error" : "done", list }; drawResults();
}
function offToFood(p) {
  const n = p.nutriments || {}, kcal = n["energy-kcal_100g"] ?? (n.energy_100g ? n.energy_100g / 4.184 : null);
  if (!p.product_name || kcal == null) return null;
  const portion = clamp(num(p.serving_quantity, 100), 1, 1000);
  return { name: p.product_name + (p.brands ? ` (${p.brands.split(",")[0]})` : ""), kcal: r0(kcal), c: r1(n.carbohydrates_100g || 0), f: r1(n.fat_100g || 0), p: r1(n.proteins_100g || 0), fi: r1(n.fiber_100g || 0), portion, label: portion + " g" };
}

let picked = null;
function sheetPortion(f) {
  picked = f;
  sheet(`<h2>${esc(f.name)}</h2><p class="s">Por 100 g: ${fmt(f.kcal)} kcal · C ${fmt1(f.c)} · G ${fmt1(f.f)} · P ${fmt1(f.p)}</p>
    ${field("f-g", `Cantidad${f.label ? ` (${esc(f.label)} ≈ ${f.portion} g)` : ""}`, f.portion, "g", 'inputmode="decimal"')}
    <div class="stepper"><button data-act="portionMul" data-m="0.5">½</button><button data-act="portionMul" data-m="1">1×</button><button data-act="portionMul" data-m="1.5">1½</button><button data-act="portionMul" data-m="2">2×</button></div>
    ${mealSel()}
    <div class="preview" id="preview"></div>
    <button class="btn" data-act="savePortion">Agregar</button>`);
  drawPreview();
}
function portionVals() {
  const g = clamp(num($("#f-g")?.value, 0), 0, 5000), k = g / 100, f = picked;
  return { g, kcal: r0(f.kcal * k), c: r1(f.c * k), f: r1(f.f * k), p: r1(f.p * k), fi: r1(f.fi * k) };
}
function drawPreview() {
  if (!$("#preview") || !picked) return;
  const v = portionVals(), sc = foodScore(v);
  $("#preview").innerHTML = `<div><b>${fmt(v.kcal)}</b><small>kcal</small></div><div><b>${fmt1(v.c)}</b><small>carbos</small></div><div><b>${fmt1(v.f)}</b><small>grasas</small></div><div><b>${fmt1(v.p)}</b><small>proteína</small></div><div><b>${sc ?? "–"}</b><small>puntos</small></div>`;
}
// entry puede ser un alimento o una lista. keep deja abierta la hoja actual (el chat).
function logFood(entry, { k = curDate, keep = false } = {}) {
  const over = () => totals(k).kcal > S.goals.kcal * 1.15, wasIn = inRange(k), wasOver = over();
  for (const x of [entry].flat()) mutDay(k).foods.push({ id: uid(), t: Date.now(), ...x });
  if (!keep) closeSheet();
  commit();
  // Chopper come y, si con esto se cumplió la meta o se pasó, celebra o llora una vez.
  const next = k !== today() ? null : inRange(k) && !wasIn ? "party" : over() && !wasOver ? "sad" : null;
  playPet("eat", 2).then((done) => { if (done && next) playPet(next); });
}
function remember(f) {
  S.recent = [f, ...S.recent.filter((r) => r.name !== f.name)].slice(0, 15);
}

function sheetNewFood(pre = {}) {
  sheet(`<h2>Crear alimento</h2><p class="s">Ingresa los valores de una porción (míralos en la etiqueta). Se guarda en «Mis alimentos».</p>
    ${field("n-name", "Nombre", pre.name || "", "", 'placeholder="Ej: Barra de cereal"')}
    ${field("n-g", "Tamaño de la porción", pre.portion || 100, "g", 'inputmode="decimal"')}
    ${field("n-kcal", "Calorías", pre.kcal ?? "", "kcal", 'inputmode="decimal"')}
    <div class="grid2">${field("n-c", "Carbohidratos", "", "g", 'inputmode="decimal"')}${field("n-f", "Grasas", "", "g", 'inputmode="decimal"')}
    ${field("n-p", "Proteínas", "", "g", 'inputmode="decimal"')}${field("n-fi", "Fibra", "", "g", 'inputmode="decimal"')}</div>
    <button class="btn" data-act="saveNewFood">Guardar y agregar</button>`, "tall");
}
function sheetQuick() {
  sheet(`<h2>Agregar rápido</h2><p class="s">Solo calorías, sin detalle de macros.</p>
    ${field("q-kcal", "Calorías", "", "kcal", 'inputmode="numeric" autofocus')}
    ${field("q-name", "Descripción (opcional)", "", "", 'placeholder="Ej: Almuerzo en el casino"')}
    ${mealSel("q-meal")}<button class="btn" data-act="saveQuick">Agregar</button>`);
}
function sheetWater() {
  sheet(`<h2>Agua</h2><div class="big center">${fmt(getDay(curDate).water)}<small> / ${fmt(S.goals.water)} ml</small></div>
    <div class="stepper big-s"><button data-act="water" data-ml="250">🥛<small>+250 ml</small></button><button data-act="water" data-ml="500">🍶<small>+500 ml</small></button><button data-act="water" data-ml="750">🧴<small>+750 ml</small></button></div>
    <div class="btn-row"><button class="btn ghost" data-act="water" data-ml="-250">− 250 ml</button><button class="btn" data-act="close">Listo</button></div>`);
}
function sheetWeight() {
  sheet(`<h2>Registrar peso</h2>${field("w-kg", curDate === today() ? `Peso de hoy (${niceDate(curDate)})` : `Peso del ${niceDate(curDate)}`, lastWeight(), "kg", 'inputmode="decimal"')}
    <button class="btn" data-act="saveWeight">Guardar</button>`);
}
function sheetWorkout() {
  sheet(`<h2>Entrenamiento</h2>
    <label class="field"><span>Actividad</span><div><select id="wo-type">${WORKOUTS.map((w, i) => `<option value="${i}">${w.name}</option>`).join("")}</select></div></label>
    ${field("wo-min", "Duración", 30, "min", 'inputmode="numeric"')}
    ${field("wo-kcal", "Calorías quemadas (estimado, puedes corregirlo)", "", "kcal", 'inputmode="numeric"')}
    <button class="btn" data-act="saveWorkout">Agregar</button>`);
  estWorkout();
}
function estWorkout() {
  const w = WORKOUTS[num($("#wo-type")?.value)], min = num($("#wo-min")?.value);
  if ($("#wo-kcal") && w) $("#wo-kcal").value = r0(w.kpm * min * (lastWeight() / 75));
}
function sheetRecipe(id, fromChat = false) {
  const r = RECIPES.find((x) => x.id === id); if (!r) return;
  sheet(`<img class="hero" src="assets/recetas/${r.id}.jpg" alt=""><h2>${esc(r.name)}</h2>
    <div class="preview"><div><b>${r.kcal}</b><small>kcal</small></div><div><b>${r.c}</b><small>carbos</small></div><div><b>${r.f}</b><small>grasas</small></div><div><b>${r.p}</b><small>proteína</small></div><div><b>${r.min}</b><small>min</small></div></div>
    <h3>Ingredientes</h3><ul>${r.ing.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
    <h3>Preparación</h3><ol>${r.steps.map((i) => `<li>${esc(i)}</li>`).join("")}</ol>
    <button class="btn" data-act="logRecipe" data-id="${r.id}">Registrar esta comida</button>
    ${fromChat ? `<button class="btn ghost" data-act="chat">‹ Volver al chat</button>` : `<button class="btn ghost" data-act="allRecipes">Ver todas las recetas</button>`}`, "tall");
}
function sheetRecipes() {
  sheet(`<h2>Recetas</h2><p class="s">Toca una para ver los ingredientes y la preparación.</p>
    ${MEALS.map((m) => `<div class="meal-h">${m.icon} ${m.name}</div>` + RECIPES.filter((r) => r.type === m.id).map((r) => `<button class="recipe" data-act="recipe" data-id="${r.id}">
      <img src="assets/recetas/${r.id}.jpg" alt="" loading="lazy"><div class="grow"><div class="t">${esc(r.name)}</div><div class="s">${r.kcal} kcal • ${r.min} min</div></div></button>`).join("")).join("")}`, "tall");
}
function sheetShop() {
  const row = (x) => {
    const own = S.owned.includes(x.id), active = S.bg === x.id || S.item === x.id;
    const btn = own ? `<button class="pill-btn ${active ? "on" : ""}" data-act="equip" data-id="${x.id}">${active ? (x.kind === "item" ? "Quitar" : "En uso") : "Usar"}</button>`
      : `<button class="pill-btn" data-act="buy" data-id="${x.id}" ${S.coins < x.price ? "disabled" : ""}>${x.price} ฿</button>`;
    return `<div class="row">${x.kind === "bg" ? `<img class="thumb" src="assets/fondos/${x.id}.jpg" alt="">` : `<span class="thumb em">${x.icon}</span>`}
      <div class="grow"><div class="t">${x.name}</div><div class="s">${x.desc || (x.kind === "bg" ? "Fondo" : "Compañero de Chopper")}</div></div>${btn}</div>`;
  };
  sheet(`<h2>Tienda <span class="chip dark">${fmt(S.coins)} ฿</span></h2>
    <div class="meal-h">Fondos</div>${SHOP.filter((x) => x.kind === "bg").map(row).join("")}
    <div class="meal-h">Compañeros</div>${SHOP.filter((x) => x.kind === "item").map(row).join("")}`, "tall");
}
const selField = (id, label, opts, v) => `<label class="field"><span>${label}</span><div><select id="${id}">${opts.map(([val, t]) => `<option value="${val}" ${String(val) === String(v) ? "selected" : ""}>${t}</option>`).join("")}</select></div></label>`;
function sheetSettings() {
  const g = S.goals, pr = S.profile, ro = S.manual ? "" : " readonly";
  sheet(`<h2>Configuración</h2>
    ${field("s-pet", "Nombre de la mascota", pr.petName, "", 'maxlength="16"')}
    <div class="meal-h">Tu objetivo</div>
    ${selField("s-goal", "Objetivo", [["bajar", "Bajar de peso"], ["mantener", "Mantener mi peso"], ["subir", "Subir de peso"]], pr.goal)}
    <div class="grid2" id="s-target">${field("s-goalw", "Peso meta", pr.goalWeight, "kg", 'inputmode="decimal"')}
      ${selField("s-pace", "Ritmo por semana", [[0.25, "0,25 kg · suave"], [0.5, "0,5 kg · recomendado"], [0.75, "0,75 kg · exigente"]], pr.pace)}</div>
    ${selField("s-act", "Actividad", ACT.map((x) => [x.id, x.name]), pr.activity)}
    <div class="grid2">${field("s-age", "Edad", pr.age, "años", 'inputmode="numeric"')}${field("s-height", "Estatura", pr.height, "cm", 'inputmode="numeric"')}</div>
    ${field("s-fast", "Horas de ayuno", g.fastH, "h", 'inputmode="numeric"')}
    <div class="meal-h">Metas diarias</div>
    <label class="check"><input type="checkbox" id="s-auto" ${S.manual ? "" : "checked"}><span>Calcularlas solas con mi peso y mi objetivo</span></label>
    <p class="s plan-note" id="s-note"></p>
    <div class="grid2 goals" id="s-goals">${field("s-kcal", "Calorías", g.kcal, "kcal", 'inputmode="numeric"' + ro)}${field("s-water", "Agua", g.water, "ml", 'inputmode="numeric"' + ro)}
    ${field("s-carb", "Carbohidratos", g.carb, "g", 'inputmode="numeric"' + ro)}${field("s-fat", "Grasas", g.fat, "g", 'inputmode="numeric"' + ro)}
    ${field("s-prot", "Proteínas", g.prot, "g", 'inputmode="numeric"' + ro)}${field("s-fiber", "Fibra", g.fiber, "g", 'inputmode="numeric"' + ro)}
    ${field("s-burn", "Meta de quema", g.burn, "kcal", 'inputmode="numeric"' + ro)}</div>
    <button class="btn" data-act="saveSettings">Guardar</button>
    <button class="btn ghost" data-act="replan">Rehacer el cuestionario inicial</button>
    <div class="meal-h">Respaldo de datos</div>
    <p class="s">Tus datos viven solo en este teléfono. Exporta un respaldo de vez en cuando.</p>
    <div class="btn-row"><button class="btn ghost" data-act="export">⬇️ Exportar</button><button class="btn ghost" data-act="import">⬆️ Importar</button></div>
    <div class="meal-h">Chat con ${esc(S.profile.petName)}</div>
    <p class="s">${ai.key ? `Conectado a Gemini con tu clave (termina en ${esc(ai.key.slice(-4))}).` : "Conecta el chat con tu clave gratis de Gemini."}</p>
    <button class="btn ghost" data-act="aiKey">${ai.key ? "Cambiar o quitar la clave" : "Conectar Gemini"}</button>
    <button class="btn danger" data-act="wipe">Borrar todos los datos</button>
    <p class="s center">Chopper Fit · proyecto personal de fan, sin fines comerciales.</p>`, "tall");
  drawSettingsPlan();
}

function settingsProfile() {
  const v = (id) => $(id)?.value, pr = S.profile;
  return { ...pr, goal: v("#s-goal") || pr.goal, goalWeight: clamp(num(v("#s-goalw"), pr.goalWeight), 30, 300), pace: num(v("#s-pace"), pr.pace),
    activity: v("#s-act") || pr.activity, age: clamp(r0(num(v("#s-age"), pr.age)), 12, 100), height: clamp(r0(num(v("#s-height"), pr.height)), 100, 230) };
}
function drawSettingsPlan() {
  if (!$("#s-goals")) return;
  const auto = $("#s-auto").checked, prof = settingsProfile(), p = calcPlan({ ...prof, weight: lastWeight() });
  $("#s-target").hidden = prof.goal === "mantener";
  $("#s-goals").classList.toggle("auto", auto);
  for (const k of GOAL_KEYS) { const el = $("#s-" + k); el.readOnly = auto; if (auto) el.value = p[k]; }
  $("#s-note").textContent = auto ? planNote(p, prof, lastWeight()) : "Metas fijadas a mano: no cambian cuando registras tu peso.";
}

// ---------- chat con Chopper (Gemini) ----------
// Cada persona usa su propia clave gratis de Google AI Studio. La clave y la conversación se guardan solo en el
// teléfono (fuera de S, así no salen en el respaldo exportado) y las consultas van directo a Google.
const AI_KEY = KEY + ".ai", CHAT_KEY = KEY + ".chat";
const GEMINI = "https://generativelanguage.googleapis.com/v1beta";
// Modelos en orden de preferencia; al conectar se cruzan con los que la clave tiene disponibles.
// Primero los «Flash-Lite»: casi no «piensan» antes de responder (los Flash sí, y en la versión gratis tardaban mucho).
const AI_PREF = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-lite-latest", "gemini-3.6-flash", "gemini-flash-latest",
  "gemini-3.8-flash", "gemini-4-hydrogen", "gemini-2.5-flash-lite", "gemini-2.5-flash"];
// Tiempo máximo por modelo y para toda la respuesta (si uno no contesta, se prueba el siguiente).
const AI_T = { try: 25000, total: 60000, slow: 8000 };
let ai = {}; // { key, models, listed, spent: { modelo: hasta }, last }
try { ai = JSON.parse(localStorage.getItem(AI_KEY) || "{}") || {}; } catch {}
const saveAi = () => { try { localStorage.setItem(AI_KEY, JSON.stringify(ai)); } catch {} };
let chat = []; // { role: "user" | "model", text, img?, foods?, recipes?, t }
try { chat = JSON.parse(localStorage.getItem(CHAT_KEY) || "[]") || []; } catch {}
function saveChat() {
  chat = chat.slice(-40);
  try { localStorage.setItem(CHAT_KEY, JSON.stringify(chat)); }
  catch { chat.forEach((m) => delete m.img); try { localStorage.setItem(CHAT_KEY, JSON.stringify(chat)); } catch {} } // sin espacio: sin fotos
}
let chatBusy = false, chatSlow = false, chatCtl = null, chatErr = null, chatImg = null, chatRetryImg = null, chatSeen = 0;

class AiError extends Error { constructor(kind, msg = "", perDay = false) { super(msg); this.kind = kind; this.perDay = perDay; } }
async function aiFetch(path, body, key = ai.key, signal) {
  let r, j;
  try {
    r = await fetch(GEMINI + path, { method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined, signal,
      headers: { "x-goog-api-key": key, ...(body ? { "Content-Type": "application/json" } : {}) } });
    j = await r.json().catch((e) => { if (signal?.aborted) throw e; return {}; });
  } catch { throw new AiError(signal?.aborted ? "timeout" : "net"); }
  if (r.ok) return j;
  const e = j.error || {}, info = JSON.stringify(e.details || []) + " " + (e.message || "");
  if (/API_KEY_INVALID|API key not valid|API_KEY_SERVICE_BLOCKED|leaked/i.test(info) || r.status === 401) throw new AiError("key", e.message);
  if (r.status === 429) throw new AiError("quota", e.message, /PerDay/i.test(info));
  if (r.status === 404) throw new AiError("model", e.message);
  if (r.status >= 500) throw new AiError("busy", e.message);
  throw new AiError(r.status === 403 ? "key" : "bad", e.message);
}
async function aiModels(key) {
  const j = await aiFetch("/models?pageSize=1000", null, key);
  const names = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent")).map((m) => m.name.replace(/^models\//, ""));
  const pref = AI_PREF.filter((n) => names.includes(n));
  const extra = names.filter((n) => /flash/.test(n) && !/image|tts|audio|live|embed|native|robot|computer|exp/.test(n) && !pref.includes(n));
  return pref.length || extra.length ? [...pref, ...extra.slice(0, 4)] : AI_PREF;
}
const CHAT_SCHEMA = {
  type: "OBJECT",
  properties: {
    reply: { type: "STRING", description: "Respuesta para el usuario" },
    foods: { type: "ARRAY", description: "Alimentos para ofrecer anotar (vacío si no aplica)", items: { type: "OBJECT", properties: {
      name: { type: "STRING" }, meal: { type: "STRING", enum: MEALS.map((m) => m.id) }, g: { type: "NUMBER", description: "gramos aprox." },
      kcal: { type: "NUMBER" }, c: { type: "NUMBER", description: "carbohidratos g" }, f: { type: "NUMBER", description: "grasas g" },
      p: { type: "NUMBER", description: "proteínas g" }, fi: { type: "NUMBER", description: "fibra g" } },
      required: ["name", "meal", "g", "kcal", "c", "f", "p", "fi"] } },
    recipes: { type: "ARRAY", description: "ids de recetas de la app sugeridas, máximo 3 (vacío si no aplica)", items: { type: "STRING" } },
  },
  required: ["reply", "foods", "recipes"],
};
function chatSystem() {
  const p = S.profile, g = S.goals, k = today(), d = getDay(k), t = totals(k), now = new Date();
  const eaten = d.foods.map((x) => `${mealName(x.meal)}: ${x.name}${x.g ? ` (${fmt(x.g)} g)` : ""}, ${fmt(x.kcal)} kcal`).join("; ") || "nada todavía";
  const week = [7, 6, 5, 4, 3, 2, 1].map((i) => addDays(k, -i)).map((dk) => `${niceDate(dk)}: ${getDay(dk).foods.length ? fmt(totals(dk).kcal) + " kcal" : "sin registro"}`).join("; ");
  const goal = { bajar: "bajar de peso", subir: "subir de peso", mantener: "mantener su peso" }[p.goal] || p.goal;
  return `Eres ${p.petName}, el pequeño reno doctor que acompaña al usuario en Chopper Fit, su app para contar calorías (un proyecto personal de fan).
Personalidad: tierno, entusiasta y algo tímido; si te halagan te avergüenzas y lo niegas feliz («¡No me hace feliz que me digas eso, tonto~!»). Hablas en español de Chile, de tú y cercano.
Responde corto: de 1 a 4 frases (unas 70 palabras como máximo), salvo que pida una receta o un plan. Sin listas largas y con pocos emojis. Puedes usar **negrita**.
Tu tema es la alimentación, las calorías, el agua, el ayuno, el ejercicio y los hábitos; si preguntan otra cosa, responde breve y vuelve con cariño al tema. Usa sus datos para personalizar, sin recitarlos.
Las calorías son estimaciones: si no dice la cantidad, supón una porción típica en Chile y dilo. No eres un médico de verdad: no diagnostiques; ante síntomas, embarazo, enfermedades, medicamentos o señales de un trastorno alimentario, recomienda con cariño consultar a un profesional. Nunca sugieras comer menos de 1200 kcal al día ni ayunar más de 24 horas.
Cuando el usuario cuente que comió o va a comer algo, pregunte las calorías de una comida o envíe una foto de comida, pon cada alimento en «foods» con tu estimación (gramos, kcal y macros); la app le mostrará un botón para anotarlo. No digas que ya lo anotaste: dile que puede anotarlo con el botón. Elige «meal» según lo que diga o la hora. Si la foto no es de comida, dilo con humor y deja «foods» vacío.
Si pide ideas de qué comer, sugiere hasta 3 recetas de la lista de la app en «recipes» (por id) y coméntalas en tu respuesta.

DATOS DEL USUARIO
- Ahora: ${DOW[now.getDay()]} ${longDate(k)}, ${pad(now.getHours())}:${pad(now.getMinutes())}.
- ${p.name ? `Se llama ${p.name}. ` : ""}${p.sex === "f" ? "Mujer" : "Hombre"}, ${p.age} años, ${p.height} cm, pesa ${fmt1(lastWeight())} kg. Objetivo: ${goal}${p.goal !== "mantener" ? ` (meta ${fmt1(p.goalWeight)} kg)` : ""}.
- Metas diarias: ${g.kcal} kcal; carbohidratos ${g.carb} g, grasas ${g.fat} g, proteínas ${g.prot} g, fibra ${g.fiber} g; agua ${g.water} ml; quemar ${g.burn} kcal; ayuno de ${g.fastH} h.
- Hoy comió: ${eaten}. Total ${fmt(t.kcal)} kcal (C ${fmt(t.c)} g, G ${fmt(t.f)} g, P ${fmt(t.p)} g, fibra ${fmt1(t.fi)} g). ${t.kcal <= g.kcal ? `Le quedan ${fmt(g.kcal - t.kcal)} kcal` : `Se pasó por ${fmt(t.kcal - g.kcal)} kcal`}.
- Agua hoy: ${fmt(d.water)} ml. Ejercicio hoy: ${d.workouts.map((w) => `${w.name}${w.min ? ` ${w.min} min` : ""}, ${w.kcal} kcal`).join("; ") || "ninguno"}.
- Ayuno: ${S.fast.start ? `en curso, lleva ${hm(fastHours())}` : "no está ayunando"}.
- Últimos 7 días: ${week}.
- Pesos registrados: ${S.weights.slice(-5).map((w) => `${niceDate(w.d)} ${fmt1(w.kg)} kg`).join("; ")}.

RECETAS DE LA APP (id: nombre, comida, kcal)
${RECIPES.map((r) => `${r.id}: ${r.name}, ${r.type}, ${r.kcal}`).join("\n")}`;
}
function parseAi(j) {
  const c = j.candidates?.[0], txt = (c?.content?.parts || []).filter((x) => !x.thought).map((x) => x.text || "").join("").trim();
  if (!txt) throw new AiError(j.promptFeedback?.blockReason || /SAFETY|PROHIBITED|BLOCK/.test(c?.finishReason || "") ? "blocked" : "busy");
  let o = null;
  try { o = JSON.parse(txt); } catch { try { o = JSON.parse(txt.match(/\{[\s\S]*\}/)?.[0]); } catch {} }
  if (!o || typeof o.reply !== "string") return { text: txt };
  const foods = (Array.isArray(o.foods) ? o.foods : []).filter((x) => x?.name && num(x.kcal, -1) >= 0).slice(0, 8).map((x) => ({
    name: String(x.name).slice(0, 60), meal: MEALS.some((m) => m.id === x.meal) ? x.meal : mealNow(), g: r0(num(x.g)),
    kcal: r0(num(x.kcal)), c: r1(num(x.c)), f: r1(num(x.f)), p: r1(num(x.p)), fi: r1(num(x.fi)) }));
  const recipes = [...new Set(Array.isArray(o.recipes) ? o.recipes : [])].filter((id) => RECIPES.some((r) => r.id === id)).slice(0, 3);
  return { text: o.reply.trim(), foods, recipes };
}
// Prueba los modelos en orden. Si uno agotó su cuota gratis, no existe o no contesta a tiempo, pasa al siguiente.
async function aiAsk(contents, ctl) {
  if (!ai.models?.length || Date.now() - (ai.listed || 0) > 7 * 864e5) {
    try { ai.models = await aiModels(ai.key); ai.listed = Date.now(); saveAi(); }
    catch (e) { if (e.kind === "key" || e.kind === "net") throw e; if (!ai.models?.length) ai.models = AI_PREF; }
  }
  const start = Date.now(), spent = (ai.spent ||= {}), noThink = (ai.noThink ||= {});
  const rank = (m) => { const i = AI_PREF.indexOf(m); return i < 0 ? AI_PREF.length : i; };
  const order = [...ai.models].sort((a, b) => rank(a) - rank(b));
  let err = null;
  for (const m of order) {
    const left = AI_T.total - (Date.now() - start);
    if (spent[m] > Date.now()) continue;
    if (left < 5000) { err = new AiError("timeout"); break; }
    const tc = new AbortController(), stop = () => tc.abort();
    const timer = setTimeout(stop, Math.min(AI_T.try, left));
    ctl.signal.addEventListener("abort", stop);
    try {
      const body = { systemInstruction: { parts: [{ text: chatSystem() }] }, contents,
        generationConfig: { responseMimeType: "application/json", responseSchema: CHAT_SCHEMA } };
      // Los Flash (no Lite) piensan bastante por defecto: se les pide pensar poco. Si el modelo no acepta la opción, se quita.
      const think = !/lite/.test(m) && !noThink[m];
      if (think) body.generationConfig.thinkingConfig = { thinkingLevel: "low" };
      let j;
      try { j = await aiFetch(`/models/${m}:generateContent`, body, ai.key, tc.signal); }
      catch (e) {
        if (!think || e.kind !== "bad") throw e;
        noThink[m] = true; delete body.generationConfig.thinkingConfig;
        j = await aiFetch(`/models/${m}:generateContent`, body, ai.key, tc.signal);
      }
      const res = parseAi(j);
      ai.last = m; saveAi();
      return res;
    } catch (e) {
      if (ctl.signal.aborted) throw new AiError("cancel");
      err = e;
      if (e.kind === "key" || e.kind === "net" || e.kind === "blocked") throw e;
      if (e.kind === "quota") spent[m] = Date.now() + (e.perDay ? 3 * 36e5 : 60e3);
      if (e.kind === "timeout") spent[m] = Date.now() + 15 * 60e3; // lento: se deja de lado un rato
      if (e.kind === "model") ai.models = ai.models.filter((x) => x !== m);
      saveAi();
    } finally { clearTimeout(timer); ctl.signal.removeEventListener("abort", stop); }
  }
  throw err || new AiError("quota");
}
function aiErrMsg(e) {
  if (e.kind === "key") return { text: "Gemini no aceptó tu clave. Revisa que esté bien copiada o crea una nueva.", fixKey: true };
  if (e.kind === "net") return { text: "Sin conexión a internet. Revísala e intenta de nuevo.", retry: true };
  if (e.kind === "quota") return { text: "Se acabaron los mensajes gratis de Gemini por ahora. Intenta en un rato; el límite se renueva cada día.", retry: true };
  if (e.kind === "busy") return { text: "Gemini está saturado en este momento. Intenta de nuevo.", retry: true };
  if (e.kind === "timeout") return { text: "Gemini no respondió a tiempo. Intenta de nuevo; si sigue lento, prueba en un rato.", retry: true };
  if (e.kind === "cancel") return { text: "Cancelaste la respuesta.", retry: true };
  if (e.kind === "blocked") return { text: "Gemini no quiso responder eso. Prueba preguntándolo de otra forma." };
  return { text: `Algo falló con Gemini${e.message ? ` (${e.message})` : ""}.`, retry: true };
}

const CHAT_SUGS = ["¿Cómo voy hoy?", "¿Qué ceno con lo que me queda?", "¿Cuántas calorías tiene un completo?", "Dame una idea de snack"];
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\n/g, "<br>");
function sheetAiKey(err = "", val = "") {
  sheet(`<div class="aikey">
    <img class="chat-av big" src="assets/chopper-av.jpg" alt="">
    <h2>Habla con ${esc(S.profile.petName)}</h2>
    <p class="s">El chat usa Gemini, la IA de Google, con tu propia cuenta. Solo necesitas una clave gratis; se hace una vez:</p>
    <ol>
      <li>Abre <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a> y entra con tu cuenta de Google.</li>
      <li>Toca <b>Create API key</b> (Crear clave de API).</li>
      <li>Cópiala y pégala aquí.</li>
    </ol>
    ${field("ai-key", "Clave de Gemini", val, "", `autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="${ai.key ? "…" + esc(ai.key.slice(-4)) : "AIza…"}"`)}
    ${err ? `<p class="aierr">${esc(err)}</p>` : ""}
    <button class="btn" data-act="aiSave">${ai.key ? "Guardar" : "Conectar"}</button>
    ${ai.key ? `<button class="btn ghost" data-act="chat">‹ Volver al chat</button><button class="btn danger" data-act="aiForget">Quitar la clave</button>` : ""}
    <p class="s aisafe">La clave queda guardada solo en este teléfono. Lo que escribas en el chat y tus datos del día (comidas, metas, peso) se envían a Google para responderte, y con la clave gratis Google puede usarlos para mejorar sus productos.</p>
  </div>`, "tall");
}
function sheetChat() {
  if (!S.profile) return;
  if (!ai.key) return sheetAiKey();
  chatSeen = chat.length;
  sheet(`<div class="chat">
    <div class="chat-h">
      <button class="chat-x" data-act="close" aria-label="Cerrar">‹</button>
      <img class="chat-av" src="assets/chopper-av.jpg" alt="">
      <div class="grow"><b>${esc(S.profile.petName)}</b><small id="chatstate"></small></div>
      <button class="chat-clear" data-act="chatClear" aria-label="Borrar la conversación">🗑️</button>
    </div>
    <div class="chat-list" id="chatlist"></div>
    <div class="chat-att" id="chatatt"></div>
    <form class="chat-in" id="chatform">
      <button type="button" class="chat-cam" data-act="chatPhoto" aria-label="Enviar una foto">📷</button>
      <textarea id="chatq" rows="1" enterkeyhint="send" placeholder="Escríbele a ${esc(S.profile.petName)}…"></textarea>
      <button type="submit" class="chat-send" aria-label="Enviar">↑</button>
    </form>
    <input type="file" id="chatfile" accept="image/*" hidden>
  </div>`, "full chat");
  drawChat(); drawAtt(); fitChat();
}
function msgHtml(m, i) {
  const anim = i >= chatSeen ? " new" : "";
  if (m.role === "user") return `<div class="msg me${m.img && !m.text ? " pic" : ""}${anim}">${m.img ? `<img src="${m.img}" alt="Foto">` : ""}${m.text ? md(m.text) : ""}</div>`;
  const foods = m.foods || [], left = foods.filter((x) => !x.done);
  return `<div class="msg bot${anim}">${md(m.text)}</div>` +
    (foods.length ? `<div class="chat-card${anim}">${foods.map((x, j) => `<div class="row"><div class="grow"><div class="t">${esc(x.name)}</div>
        <div class="s">${mealName(x.meal)}${x.g ? ` · ${fmt(x.g)} g` : ""} · <b>${fmt(x.kcal)} kcal</b> · C ${fmt(x.c)} · G ${fmt(x.f)} · P ${fmt(x.p)}</div></div>
        ${x.done ? `<span class="ok" aria-label="Anotado">✓</span>` : `<button class="pill-btn" data-act="chatLog" data-i="${i}" data-j="${j}">Anotar</button>`}</div>`).join("")}
      ${left.length > 1 ? `<button class="btn" data-act="chatLog" data-i="${i}" data-j="all">Anotar todo · ${fmt(left.reduce((n, x) => n + x.kcal, 0))} kcal</button>` : ""}</div>` : "") +
    (m.recipes?.length ? `<div class="chat-card${anim}">${m.recipes.map((id) => RECIPES.find((r) => r.id === id)).filter(Boolean).map((r) =>
      `<button class="recipe" data-act="chatRecipe" data-id="${r.id}"><img src="assets/recetas/${r.id}.jpg" alt="" loading="lazy"><div class="grow"><div class="t">${esc(r.name)}</div><div class="s">${r.kcal} kcal · ${r.min} min</div></div></button>`).join("")}</div>` : "");
}
function drawChat(keepScroll = false) {
  const box = $("#chatlist"); if (!box) return;
  const y = box.scrollTop;
  let html = chat.length ? "" : `<div class="msg bot">¡Hola${S.profile.name ? ", " + esc(S.profile.name) : ""}! Soy ${esc(S.profile.petName)} 🩺 Pregúntame qué comer o cuántas calorías tiene algo, o mándame una foto de tu plato y te lo calculo.</div>
    <div class="chat-sugs">${CHAT_SUGS.map((q) => `<button data-act="chatSug" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div>`;
  html += chat.map(msgHtml).join("");
  if (chatErr) html += `<div class="msg err">${esc(chatErr.text)}${chatErr.retry ? ` <button class="link" data-act="chatRetry">Reintentar</button>` : ""}${chatErr.fixKey ? ` <button class="link" data-act="aiKey">Cambiar la clave</button>` : ""}</div>`;
  if (chatBusy) html += `<div class="msg bot typing" aria-label="Escribiendo"><i></i><i></i><i></i></div>` +
    (chatSlow ? `<div class="chat-wait">Gemini está tardando más de lo normal… <button class="link" data-act="chatCancel">Cancelar</button></div>` : "");
  box.innerHTML = html;
  chatSeen = chat.length;
  box.scrollTop = keepScroll ? y : box.scrollHeight;
  if ($("#chatstate")) $("#chatstate").textContent = chatBusy ? "escribiendo…" : `con Gemini${ai.last ? " · " + ai.last.replace(/^gemini-/, "") : ""}`;
}
function drawAtt() {
  const el = $("#chatatt"); if (!el) return;
  el.innerHTML = chatImg ? `<div class="att"><img src="${chatImg.thumb}" alt="Foto adjunta"><button data-act="chatUnatt" aria-label="Quitar la foto">✕</button></div>` : "";
}
function growChat() {
  const q = $("#chatq"); if (!q) return;
  q.style.height = "auto"; q.style.height = Math.min(q.scrollHeight, 120) + "px";
}
function fitChat() { fitSheet(); const box = $("#chatlist"); if (box) box.scrollTop = box.scrollHeight; }
// La foto se achica antes de enviarla (máx. 1024 px) y se guarda una miniatura para el historial.
async function prepImg(file) {
  const url = URL.createObjectURL(file);
  try {
    const im = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = bad; i.src = url; });
    const draw = (max, q) => {
      const s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement("canvas");
      c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", q);
    };
    return { data: draw(1024, 0.82).split(",")[1], thumb: draw(320, 0.62) };
  } finally { URL.revokeObjectURL(url); }
}
function sendChat(text) {
  text = String(text ?? $("#chatq")?.value ?? "").trim();
  const img = chatImg;
  if (chatBusy || (!text && !img)) return;
  chatErr = null; chatImg = null; drawAtt();
  if ($("#chatq")) { $("#chatq").value = ""; growChat(); }
  chat.push({ role: "user", text, img: img?.thumb, t: Date.now() }); saveChat();
  askChat(img);
}
async function askChat(img) {
  const ctl = (chatCtl = new AbortController());
  chatBusy = true; chatSlow = false; chatErr = null; drawChat();
  const slowT = setTimeout(() => { if (chatCtl === ctl) { chatSlow = true; drawChat(); } }, AI_T.slow);
  // Se envían los últimos mensajes como contexto; solo la foto del último va completa.
  const hist = chat.slice(-16);
  while (hist.length && hist[0].role !== "user") hist.shift();
  const contents = hist.map((m, i) => {
    if (m.role === "user") {
      const parts = [];
      if (i === hist.length - 1 && img) parts.push({ inlineData: { mimeType: "image/jpeg", data: img.data } });
      else if (m.img) parts.push({ text: "[Aquí envió una foto]" });
      parts.push({ text: m.text || "¿Qué es esto y cuántas calorías tiene?" });
      return { role: "user", parts };
    }
    const offered = m.foods?.length ? `\n(Le ofrecí anotar: ${m.foods.map((x) => `${x.name} ${x.kcal} kcal${x.done ? ", ya anotado" : ""}`).join("; ")})` : "";
    return { role: "model", parts: [{ text: m.text + offered }] };
  }).reduce((out, c) => { // dos mensajes seguidos del mismo lado se juntan en un turno
    const prev = out[out.length - 1];
    if (prev?.role === c.role) prev.parts.push(...c.parts); else out.push(c);
    return out;
  }, []);
  try {
    const res = await aiAsk(contents, ctl);
    if (chatCtl !== ctl) return; // se borró la conversación mientras esperaba
    chat.push({ role: "model", t: Date.now(), ...res }); saveChat(); chatRetryImg = null;
    if (!$("#chatlist")) toast(`💬 ${S.profile.petName} te respondió`);
  } catch (e) {
    if (chatCtl !== ctl) return;
    chatErr = aiErrMsg(e); chatRetryImg = img;
  } finally { clearTimeout(slowT); }
  chatCtl = null; chatBusy = false; chatSlow = false; drawChat();
}

// ---------- código de barras ----------
let zxReader = null;
function loadZX() {
  return new Promise((ok, bad) => {
    if (window.ZXing) return ok();
    const s = document.createElement("script"); s.src = "vendor/zxing.min.js"; s.onload = ok; s.onerror = bad; document.head.appendChild(s);
  });
}
function stopScan() { try { zxReader?.reset(); } catch {} zxReader = null; }
let torchOn = false;
const SCAN_HINT = "Escanea el código de barras del envase";
async function sheetScan() {
  torchOn = false;
  sheet(`<div class="scan">
    <video id="scanv" playsinline muted autoplay></video>
    <button class="scan-btn scan-x" data-act="close" aria-label="Cerrar">✕</button>
    <button class="scan-btn scan-flash" data-act="torch" aria-label="Linterna" hidden>⚡</button>
    <div class="scan-hint" id="scanmsg">${SCAN_HINT}</div>
    <div class="scan-frame" id="scanframe"><i></i><i></i><i></i><i></i><b></b></div>
    <div class="scan-manual" id="scanmanual" hidden>
      <input id="scan-code" inputmode="numeric" placeholder="Código: 7801234567890" autocomplete="off">
      <button data-act="scanManual">Buscar</button>
    </div>
    <div class="scan-bottom">
      <button class="scan-pill" data-act="addFood">🔖 Mis alimentos</button>
      <button class="scan-btn" data-act="scanKeyboard" aria-label="Escribir el código">⌨️</button>
    </div></div>`, "full");
  try {
    await loadZX();
    if (!$("#scanv")) return;
    zxReader = new ZXing.BrowserMultiFormatReader();
    await zxReader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } }, "scanv", (res) => {
      const frame = $("#scanframe");
      if (!res || !frame || frame.classList.contains("hit")) return;
      frame.classList.add("hit"); navigator.vibrate?.(60);
      const code = res.getText(); setTimeout(() => lookupBarcode(code), 350);
    });
    const track = $("#scanv")?.srcObject?.getVideoTracks?.()[0];
    if (track?.getCapabilities?.().torch && $(".scan-flash")) $(".scan-flash").hidden = false;
  } catch {
    if ($("#scanmsg")) $("#scanmsg").textContent = "No se pudo abrir la cámara. Revisa el permiso o escribe el código.";
    if ($("#scanmanual")) $("#scanmanual").hidden = false;
  }
}
async function lookupBarcode(code) {
  code = String(code).replace(/\D/g, ""); if (code.length < 6) return toast("Código no válido");
  const fromScan = !!$("#scanframe");
  if ($("#scanmsg")) $("#scanmsg").textContent = `Buscando ${code}…`;
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,brands,nutriments,serving_quantity`);
    const j = await r.json(), f = j.status === 1 ? offToFood(j.product) : null;
    if (fromScan && !$("#scanframe")) return; // se cerró el escáner mientras buscaba
    if (f) return sheetPortion(f);
    toast("Producto no encontrado: créalo a mano"); sheetNewFood();
  } catch {
    toast("Sin conexión para buscar el código");
    $("#scanframe")?.classList.remove("hit"); if ($("#scanmsg")) $("#scanmsg").textContent = SCAN_HINT;
  }
}

// ---------- acciones ----------
const A = {
  close: closeSheet,
  nav: (el) => {
    if (view === el.dataset.view && curDate === today() && !$("#sheet").classList.contains("open")) return window.scrollTo({ top: 0, behavior: "smooth" });
    view = el.dataset.view; curDate = today(); enterNext = true; if (lockY != null) lockY = 0; closeSheet(); render(); window.scrollTo(0, 0);
  },
  fab: sheetAdd,
  settings: sheetSettings, shop: sheetShop, addWater: sheetWater, addWeight: sheetWeight, addWorkout: sheetWorkout,
  addFood: () => sheetSearch(), newFood: () => sheetNewFood(), quickAdd: sheetQuick, scan: sheetScan,
  pet: (el) => {
    if (fasting()) return sheetFast();
    if (petPlaying) return;
    if (reduced || petFailed) el.querySelector("img")?.animate?.([{ transform: "scale(1)" }, { transform: "scale(1.09,.88)", offset: 0.3 }, { transform: "scale(.95,1.06)", offset: 0.6 }, { transform: "scale(1)" }], { duration: 520, easing: "cubic-bezier(.3,.7,.3,1)" });
    else playPet(petTapPick());
    toast(["¡No me hace feliz que me toques, tonto~ 🩷", "¡Soy un reno, no un mapache!", "¿Ya tomaste agua?", "¡El algodón de azúcar es lo mejor!"][Math.floor(Math.random() * 4)]);
  },
  kcalMode: () => { S.kcalMode = S.kcalMode === "consumidas" ? "restantes" : "consumidas"; save(); render(); },
  prevDay: () => { curDate = addDays(curDate, -1); slide = "r"; render(); },
  nextDay: () => { if (curDate < today()) { curDate = addDays(curDate, 1); slide = "l"; render(); } },
  pickDay: () => { const i = $("#datepick"); i.max = today(); i.value = curDate; i.showPicker ? i.showPicker() : i.click(); },
  delFood: (el) => { const d = mutDay(curDate); d.foods = d.foods.filter((x) => x.id !== el.dataset.id); commit(); },
  delWorkout: (el) => { const d = mutDay(curDate); d.workouts = d.workouts.filter((x) => x.id !== el.dataset.id); commit(); },
  glass: (el) => { const d = mutDay(curDate), i = +el.dataset.i, full = Math.floor(d.water / 250); d.water = i < full ? i * 250 : (i + 1) * 250; lastGlass = i < full ? -1 : i; commit(); lastGlass = -1; if (i >= full) drinkPet(); },
  water: (el) => { const d = mutDay(curDate); d.water = Math.max(0, d.water + +el.dataset.ml); checkChallenges(); save(); render(); sheetWater(); if (+el.dataset.ml > 0) drinkPet(); },
  // Con un ayuno en curso se abre su pantalla; desde ahí se termina.
  fastToggle: () => {
    if (S.fast.start) return sheetFast();
    S.fast.start = Date.now(); toast("🌙 Ayuno iniciado. ¡Tú puedes!");
    closeSheet(); commit(); playPet("lie");
  },
  endFast: () => {
    if (!S.fast.start) return closeSheet();
    const h = fastHours(), ok = h >= S.goals.fastH;
    S.fast.history.push({ start: S.fast.start, end: Date.now(), ok }); S.fast.start = null;
    toast(ok ? `🌙 ¡Ayuno de ${hm(h)} completado!` : `Ayuno terminado a las ${hm(h)}`);
    closeSheet(); commit(); playPet("happy");
  },
  pickFood: (el) => sheetPortion(searchPool[+el.dataset.i]),
  searchOnline,
  portionMul: (el) => { $("#f-g").value = r0(picked.portion * +el.dataset.m); drawPreview(); },
  savePortion: () => {
    const v = portionVals(); if (!v.g) return toast("Ingresa la cantidad");
    remember(picked); logFood({ name: picked.name, meal: $("#f-meal").value, ...v });
  },
  saveNewFood: () => {
    const name = $("#n-name").value.trim(), g = num($("#n-g").value), kcal = num($("#n-kcal").value, -1);
    if (!name || g <= 0 || kcal < 0) return toast("Completa nombre, porción y calorías");
    const k = 100 / g, f = { name, kcal: r1(kcal * k), c: r1(num($("#n-c").value) * k), f: r1(num($("#n-f").value) * k), p: r1(num($("#n-p").value) * k), fi: r1(num($("#n-fi").value) * k), portion: g, label: "1 porción" };
    S.myFoods = [f, ...S.myFoods.filter((m) => m.name !== name)]; save(); sheetPortion(f);
  },
  saveQuick: () => {
    const kcal = num($("#q-kcal").value); if (kcal <= 0) return toast("Ingresa las calorías");
    logFood({ name: $("#q-name").value.trim() || "Agregado rápido", meal: $("#q-meal").value, kcal: r0(kcal), c: 0, f: 0, p: 0, fi: 0 });
  },
  saveWeight: () => {
    const kg = num($("#w-kg").value); if (kg < 30 || kg > 300) return toast("Peso no válido");
    if (checkDay()) return toast("Empezó un día nuevo: vuelve a anotar tu peso");
    S.weights = [...S.weights.filter((w) => w.d !== curDate), { d: curDate, kg: r1(kg) }].sort((a, b) => (a.d < b.d ? -1 : 1));
    const changed = autoPlan();
    closeSheet(); commit();
    toast(`⚖️ Peso ${curDate === today() ? "de hoy" : "del " + niceDate(curDate)} guardado: ${fmt1(kg)} kg${changed ? ` · tu meta ahora es ${fmt(S.goals.kcal)} kcal` : ""}`);
  },
  saveWorkout: () => {
    const kcal = num($("#wo-kcal").value); if (kcal <= 0) return toast("Ingresa las calorías");
    mutDay(curDate).workouts.push({ id: uid(), name: WORKOUTS[num($("#wo-type").value)].name, min: r0(num($("#wo-min").value)), kcal: r0(kcal) });
    closeSheet(); commit();
  },
  recipe: (el) => sheetRecipe(el.dataset.id), allRecipes: sheetRecipes,
  chat: sheetChat,
  chatSug: (el) => sendChat(el.dataset.q),
  chatRetry: () => { if (!chatBusy) askChat(chatRetryImg); },
  chatCancel: () => chatCtl?.abort(),
  chatPhoto: () => $("#chatfile")?.click(),
  chatUnatt: () => { chatImg = null; drawAtt(); },
  chatRecipe: (el) => sheetRecipe(el.dataset.id, true),
  chatLog: (el) => {
    const m = chat[+el.dataset.i]; if (!m?.foods) return;
    const list = el.dataset.j === "all" ? m.foods.filter((x) => !x.done) : [m.foods[+el.dataset.j]].filter((x) => x && !x.done);
    if (!list.length) return;
    logFood(list.map(({ done, ...x }) => x), { k: today(), keep: true });
    list.forEach((x) => (x.done = true)); saveChat(); drawChat(true);
    toast(`🍽️ Anotado: ${list.length > 1 ? list.length + " alimentos" : list[0].name} · ${fmt(list.reduce((n, x) => n + x.kcal, 0))} kcal`);
  },
  // Se confirma con un segundo toque.
  chatClear: (el) => {
    if (!el.classList.contains("sure")) {
      el.classList.add("sure"); el.textContent = "¿Borrar?";
      return setTimeout(() => { if (el.isConnected) { el.classList.remove("sure"); el.textContent = "🗑️"; } }, 3000);
    }
    const ctl = chatCtl; chatCtl = null; ctl?.abort();
    chat = []; chatErr = null; chatBusy = chatSlow = false; saveChat(); drawChat(); el.classList.remove("sure"); el.textContent = "🗑️";
  },
  aiKey: () => sheetAiKey(),
  aiSave: async (el) => {
    const k = ($("#ai-key")?.value || "").replace(/\s+/g, "");
    if (!k) return ai.key ? sheetChat() : toast("Pega tu clave de Gemini");
    el.disabled = true; el.innerHTML = `<span class="spin"></span> Probando la clave…`;
    try {
      const models = await aiModels(k);
      ai = { key: k, models, listed: Date.now(), spent: {} }; saveAi();
      if ($("#ai-key")) { toast("✅ Chopper ya está conectado"); sheetChat(); }
    } catch (e) {
      if ($("#ai-key")) sheetAiKey(e.kind === "key" ? "Esa clave no funciona. Revisa que esté completa." : e.kind === "net" ? "Sin conexión. Intenta de nuevo." : `Gemini respondió: ${e.message || "error"}`, k);
    }
  },
  aiForget: () => { ai = {}; saveAi(); closeSheet(); toast("Clave de Gemini quitada"); },
  logRecipe: (el) => { const r = RECIPES.find((x) => x.id === el.dataset.id); logFood({ name: r.name, meal: r.type, kcal: r.kcal, c: r.c, f: r.f, p: r.p, fi: r.fi }); },
  buy: (el) => {
    const x = SHOP.find((s) => s.id === el.dataset.id); if (!x || S.coins < x.price) return;
    S.owned.push(x.id); if (x.kind === "bg") S.bg = x.id; else S.item = x.id; toast(`${x.icon} ¡${x.name} desbloqueado!`);
    S.coins -= x.price; save(); render(); sheetShop();
  },
  equip: (el) => { const x = SHOP.find((s) => s.id === el.dataset.id); if (x.kind === "bg") S.bg = x.id; else S.item = S.item === x.id ? null : x.id; save(); render(); sheetShop(); },
  statSel: (el) => { statSel[el.dataset.chart] = +el.dataset.i; render(); },
  scanManual: () => lookupBarcode($("#scan-code").value),
  scanKeyboard: () => { const m = $("#scanmanual"); m.hidden = !m.hidden; if (!m.hidden) $("#scan-code").focus(); },
  torch: () => {
    const tr = $("#scanv")?.srcObject?.getVideoTracks?.()[0]; torchOn = !torchOn;
    tr?.applyConstraints({ advanced: [{ torch: torchOn }] }).catch(() => {});
    $(".scan-flash").classList.toggle("on", torchOn);
  },
  saveSettings: () => {
    const g = S.goals, v = (id, d, a, b) => clamp(r0(num($(id).value, d)), a, b);
    S.profile = { ...settingsProfile(), petName: $("#s-pet").value.trim() || "Chopper" };
    g.fastH = S.profile.fastH = v("#s-fast", g.fastH, 1, 23);
    S.manual = !$("#s-auto").checked;
    if (S.manual) {
      g.kcal = v("#s-kcal", g.kcal, 800, 6000); g.water = v("#s-water", g.water, 500, 6000); g.carb = v("#s-carb", g.carb, 0, 900); g.fat = v("#s-fat", g.fat, 0, 400);
      g.prot = v("#s-prot", g.prot, 0, 500); g.fiber = v("#s-fiber", g.fiber, 0, 100); g.burn = v("#s-burn", g.burn, 0, 3000);
    } else autoPlan();
    closeSheet(); commit(); toast(`Cambios guardados · meta de ${fmt(g.kcal)} kcal`);
  },
  replan: () => { ob = { ...ob, ...S.profile, weight: lastWeight(), step: 1 }; S.goals = null; if (lockY != null) lockY = 0; closeSheet(); render(); window.scrollTo(0, 0); },
  export: () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 1)], { type: "application/json" }));
    a.download = `chopper-fit-${today()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  import: () => $("#importFile").click(),
  hideInstall: () => { S.hideInstall = true; save(); render(); },
  wipe: () => { if (confirm("¿Borrar TODOS tus datos? Esto no se puede deshacer.")) { [KEY, CHAT_KEY, AI_KEY].forEach((k) => localStorage.removeItem(k)); idbSet(KEY, null).then(() => location.reload()); } },
  obSet: (el) => { obRead(); const v = el.dataset.v; ob[el.dataset.f] = isNaN(v) ? v : +v; saveOb(); render(); },
  obBack: () => { obRead(); ob.step--; saveOb(); render(); },
  obNext: () => { obRead(); if (ob.step === OB_STEPS - 1) return obFinish(); ob.step++; saveOb(); render(); window.scrollTo(0, 0); },
};
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]"); if (!el || el.disabled) return;
  const fn = A[el.dataset.act]; if (!fn) return;
  // Si algo falla, se avisa en pantalla en vez de quedar «sin pasar nada».
  try { const r = fn(el); r?.catch?.(actionError); } catch (err) { actionError(err); }
});
function actionError(err) { console.error(err); toast(`⚠️ Algo falló: ${err?.message || err}`); }
document.addEventListener("input", (e) => {
  if (e.target.id === "q") { drawResults(); queueOnline(); }
  if (e.target.id === "f-g") drawPreview();
  if (e.target.id === "wo-min" || e.target.id === "wo-type") estWorkout();
  if (e.target.id === "chatq") growChat();
  if (/^s-(goal|goalw|pace|act|age|height|auto)$/.test(e.target.id)) drawSettingsPlan();
});
document.addEventListener("submit", (e) => { if (e.target.id === "chatform") { e.preventDefault(); sendChat(); } });
// Tocar «enviar» no debe cerrar el teclado.
document.addEventListener("mousedown", (e) => { if (e.target.closest?.(".chat-send")) e.preventDefault(); });
document.addEventListener("change", (e) => {
  if (e.target.id === "wo-type") estWorkout();
  if (/^s-(goal|pace|act|auto)$/.test(e.target.id)) drawSettingsPlan();
  if (e.target.id === "chatfile" && e.target.files[0]) {
    prepImg(e.target.files[0]).then((img) => { chatImg = img; drawAtt(); $("#chatq")?.focus(); })
      .catch(() => toast("No se pudo leer la foto")).finally(() => { e.target.value = ""; });
  }
  if (e.target.id === "datepick" && e.target.value) { curDate = e.target.value > today() ? today() : e.target.value; render(); }
  if (e.target.id === "importFile" && e.target.files[0]) {
    e.target.files[0].text().then((txt) => {
      const data = JSON.parse(txt);
      if (!data || typeof data !== "object" || !data.profile || !data.days) throw new Error("formato");
      S = Object.assign(blank(), data); S.lastOpen = S.lastOpen || today();
      if (S.goals && S.manual === undefined) S.manual = !wasAutoPlan();
      autoPlan(); save(); closeSheet(); enterNext = true; render(); toast("Respaldo importado");
    }).catch(() => toast("El archivo no es un respaldo válido")).finally(() => { e.target.value = ""; });
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSheet();
  if (e.key === "Enter" && e.target.id === "q") searchOnline();
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.target.id === "chatq") { e.preventDefault(); sendChat(); }
});

// ---------- arranque ----------
// Las metas de versiones anteriores eran automáticas si calzan con la fórmula de entonces; si no, se fijaron a mano.
function wasAutoPlan() {
  const p = S.profile, g = S.goals, act = ACT.find((a) => a.id === p.activity) || ACT[0];
  const tdee = (10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === "m" ? 5 : -161)) * act.f;
  const delta = p.goal === "mantener" ? 0 : (p.pace * 7700) / 7 * (p.goal === "bajar" ? -1 : 1);
  const kcal = r0(Math.max(p.sex === "m" ? 1500 : 1200, tdee + delta));
  const old = { kcal, carb: r0((kcal * 0.48) / 4), fat: r0((kcal * 0.29) / 9), prot: r0((kcal * 0.23) / 4), fiber: r0((kcal / 1000) * 14),
    water: clamp(Math.round((p.weight * 27) / 250) * 250, 1500, 4000), burn: act.burn };
  return GOAL_KEYS.every((k) => old[k] === g[k]);
}
if (S.profile && S.goals) {
  if (S.manual === undefined) S.manual = !wasAutoPlan();
  rollover(); autoPlan(); checkChallenges(); save();
}
render();
greet();
if (!S.profile) idbGet(KEY).then((json) => {
  if (!json || S.profile) return;
  try {
    const data = JSON.parse(json); if (!data.profile || !data.goals) return;
    S = Object.assign(blank(), data); rollover(); save(); enterNext = true; render(); toast("Datos recuperados");
  } catch {}
});
navigator.storage?.persist?.();
window.addEventListener("pageshow", checkDay);
window.addEventListener("focus", checkDay);
function tickFast() {
  if (!fasting()) return;
  const h = fastHours();
  if ($("#fastclock")) $("#fastclock").textContent = hm(h);
  if ($("#fastbig")) { $("#fastbig").textContent = hm(h); $("#fastmsg").textContent = fastMsg(h, S.goals.fastH); }
}
setInterval(() => {
  tickFast();
  checkDay();
}, 20000);
// Al volver a la app después de un rato se repite el saludo (o la pantalla del ayuno).
let hiddenAt = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  const away = hiddenAt && Date.now() - hiddenAt > 60000;
  hiddenAt = 0; checkDay(); tickFast();
  if (away) greet();
});
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js");
