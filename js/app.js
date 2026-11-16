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
  coins: 0, hearts: 4, lastOpen: null, owned: ["bg-prado"], bg: "bg-prado", item: null,
  myFoods: [], recent: [], weekClaimed: {}, kcalMode: "consumidas",
});
let S;
try { S = Object.assign(blank(), JSON.parse(localStorage.getItem(KEY) || "{}")); } catch { S = blank(); }
const save = () => localStorage.setItem(KEY, JSON.stringify(S));

let view = "home";
let curDate = today();
let eating = 0; // marca de tiempo de la última comida registrada (animación)
let statSel = {}; // barra seleccionada por gráfico

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
function calcPlan(p) {
  const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === "m" ? 5 : -161);
  const act = ACT.find((a) => a.id === p.activity) || ACT[0];
  const tdee = bmr * act.f;
  const delta = p.goal === "mantener" ? 0 : (p.pace * 7700) / 7 * (p.goal === "bajar" ? -1 : 1);
  const kcal = r0(Math.max(p.sex === "m" ? 1500 : 1200, tdee + delta));
  const weeks = p.goal === "mantener" || !p.pace ? 0 : Math.ceil(Math.abs(p.weight - p.goalWeight) / p.pace);
  return {
    kcal, carb: r0((kcal * 0.48) / 4), fat: r0((kcal * 0.29) / 9), prot: r0((kcal * 0.23) / 4),
    fiber: r0((kcal / 1000) * 14), water: clamp(Math.round((p.weight * 27) / 250) * 250, 1500, 4000),
    burn: act.burn, fastH: p.fastH, weeks, targetDate: weeks ? addDays(today(), weeks * 7) : null,
  };
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
function rollover() {
  const t = today();
  if (S.lastOpen && S.lastOpen < t && S.goals) {
    let lost = 0;
    for (let k = S.lastOpen; k < t; k = addDays(k, 1)) if (!getDay(k).foods.length) lost++;
    S.hearts = Math.max(0, S.hearts - lost);
  }
  S.lastOpen = t;
}
function commit() { checkChallenges(); save(); render(); }

// ---------- mascota ----------
function mood() {
  const t = totals(today()), g = S.goals.kcal;
  if (Date.now() - eating < 3500) return { id: "eat", fx: "🍴", msg: "¡Ñam! Anotado." };
  if (S.fast.start) return { id: "sleep", fx: "💤", msg: `Ayunando… llevamos ${hm(fastHours())}` };
  if (S.hearts === 0) return { id: "sad", fx: "💧", msg: "Te extrañé… ¿me das un algodón de azúcar?" };
  if (t.kcal > g * 1.15) return { id: "sad", fx: "💦", msg: "¡Nos pasamos hoy! Mañana lo compensamos." };
  if (inRange(today())) return { id: "party", fx: "✨", msg: "¡Meta cumplida! Eso no me hace feliz, tonto~ 🩷" };
  if (!getDay(today()).foods.length) return { id: "happy", fx: "", msg: "¿Qué comimos hoy? ¡Cuéntame!" };
  return { id: "happy", fx: "", msg: `Vamos bien: quedan ${fmt(Math.max(0, g - t.kcal))} kcal.` };
}

// ---------- componentes ----------
function ring(pct, color, inner, size = 64) {
  const r = size / 2 - 5, c = 2 * Math.PI * r, p = clamp(pct, 0, 1);
  return `<div class="ring" style="width:${size}px;height:${size}px"><svg viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="#f1f2f4" stroke-width="6"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round"
      stroke-dasharray="${c * p} ${c}" transform="rotate(-90 ${size / 2} ${size / 2})"/></svg><span>${inner}</span></div>`;
}
const bar = (v, g, color) => `<div class="bar"><i style="width:${clamp((v / (g || 1)) * 100, 0, 100)}%;background:${color}"></i></div>`;
function toast(msg) {
  const el = document.createElement("div"); el.className = "toast"; el.textContent = msg;
  $("#toasts").appendChild(el); setTimeout(() => el.remove(), 3600);
}
function sheet(html, cls = "") {
  $("#sheet").innerHTML = `<div class="sheet-bg" data-act="close"></div><div class="sheet ${cls}" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  $("#sheet").classList.add("open");
}
function closeSheet() { stopScan(); $("#sheet").classList.remove("open"); $("#sheet").innerHTML = ""; }

// ---------- vistas ----------
function render() {
  const app = $("#app");
  if (!S.profile || !S.goals) { app.innerHTML = viewOnboard(); $("#nav").hidden = true; return; }
  $("#nav").hidden = false;
  document.querySelectorAll("#nav [data-view]").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
  const y = window.scrollY;
  app.innerHTML = view === "retos" ? viewRetos() : view === "stats" ? viewStats() : viewHome();
  window.scrollTo(0, y);
}

function viewHome() {
  const k = curDate, d = getDay(k), t = totals(k), g = S.goals, m = mood(), isToday = k === today();
  const item = SHOP.find((x) => x.id === S.item);
  const mode = S.kcalMode, left = g.kcal - t.kcal;
  const big = mode === "consumidas" ? fmt(t.kcal) : fmt(Math.abs(left));
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
      <div><h1>${esc(S.profile.petName)}</h1><div class="hearts" aria-label="${S.hearts} de 4 corazones">${"❤️".repeat(S.hearts)}${"🤍".repeat(4 - S.hearts)}</div></div>
      <button class="icon-btn" data-act="settings" aria-label="Configuración">⚙️</button>
    </div>
    <div class="bubble">${esc(m.msg)}</div>
    <div class="pet ${m.id}" data-act="pet">
      <img src="assets/chopper.png" alt="Chopper" draggable="false">
      ${m.fx ? `<span class="fx">${m.fx}</span>` : ""}${item ? `<span class="buddy">${item.icon}</span>` : ""}
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
  <main class="cards">
    <section class="card">
      <div class="card-h"><button class="lbl" data-act="kcalMode">${lbl} ⇅</button>
        <button class="ring-btn" data-act="addFood" aria-label="Agregar comida">${ring(t.kcal / g.kcal, t.kcal > g.kcal * 1.1 ? "#e5533c" : "#f5a524", "+")}</button></div>
      <div class="big">${big}</div>
      <div class="macros">
        <div><span>Carbohid.</span>${bar(t.c, g.carb, "#f5c043")}<small>${fmt(t.c)} / ${g.carb} g</small></div>
        <div><span>Grasas</span>${bar(t.f, g.fat, "#3b82f6")}<small>${fmt(t.f)} / ${g.fat} g</small></div>
        <div><span>Proteínas</span>${bar(t.p, g.prot, "#3fae5c")}<small>${fmt(t.p)} / ${g.prot} g</small></div>
      </div>
      ${foodsHtml || `<p class="empty">Aún no hay comidas registradas ${isToday ? "hoy" : "este día"}.</p>`}
      <div class="foot">Meta: ${fmt(g.kcal)} kcal</div>
    </section>

    <section class="card">
      <div class="card-h"><span class="lbl">Calorías quemadas</span>
        <button class="ring-btn" data-act="addWorkout" aria-label="Agregar entrenamiento">${ring(t.burned / g.burn, "#8b6cf6", "+")}</button></div>
      <div class="big">${fmt(t.burned)}</div>
      ${d.workouts.map((w) => `<div class="row"><div class="grow"><div class="t">${esc(w.name)}</div><div class="s">${w.min ? w.min + " min · " : ""}${fmt(w.kcal)} kcal</div></div>
        <button class="x" data-act="delWorkout" data-id="${w.id}" aria-label="Eliminar ${esc(w.name)}">✕</button></div>`).join("")}
      <div class="foot">Meta: ${fmt(g.burn)} kcal</div>
    </section>

    <section class="card">
      <div class="card-h"><span class="lbl">Plan de comidas</span></div>
      ${plan.map((r) => `<button class="recipe" data-act="recipe" data-id="${r.id}"><img src="assets/recetas/${r.id}.jpg" alt="" loading="lazy">
        <div class="grow"><div class="t">${esc(r.name)}</div><div class="s">${r.kcal} kcal • ${r.min} min</div></div></button>`).join("")}
    </section>

    <section class="card">
      <div class="card-h"><span class="lbl">Agua</span>
        <button class="ring-btn" data-act="addWater" aria-label="Agregar agua">${ring(d.water / g.water, "#3b82f6", "+")}</button></div>
      <div class="big">${fmt(d.water)}<small> ml</small></div>
      <div class="glasses">${Array.from({ length: glasses }, (_, i) => `<button class="glass ${i < full ? "full" : ""}" data-act="glass" data-i="${i}" aria-label="Vaso ${i + 1}">${i === full ? "+" : ""}</button>`).join("")}</div>
      <div class="foot">Meta: ${fmt(g.water)} ml</div>
    </section>

    <section class="card">
      <div class="card-h"><span class="lbl">Ayuno</span>
        <button class="pill-btn" data-act="fastToggle">${S.fast.start ? "TERMINAR" : "INICIO"}</button></div>
      ${S.fast.start
        ? `<div class="big" id="fastclock">${hm(fh)}</div>${bar(fh, g.fastH, fh >= g.fastH ? "#2f9e5b" : "#3b82f6")}
           <p class="s">${fh >= g.fastH ? "¡Meta alcanzada! Puedes terminar cuando quieras." : `Faltan ${hm(g.fastH - fh)} para tu meta`}</p>`
        : `<div class="big muted">¿Listo para empezar?</div>`}
      <div class="foot">Meta: ${g.fastH}h de ayuno · ${24 - g.fastH}h de alimentación</div>
    </section>

    <section class="card">
      <div class="card-h"><span class="lbl">Puntuación nutricional</span>${ring((sc || 0) / 100, scoreColor(sc), sc ?? "–")}</div>
      <div class="big">${scoreLabel(sc)}</div>
      <p class="s">Promedio de tus comidas del día según proteína, fibra y densidad calórica.</p>
    </section>

    <section class="card">
      <div class="card-h"><span class="lbl">Fibra</span>${ring(t.fi / g.fiber, "#7cc24a", "🌾")}</div>
      <div class="big">${fmt1(t.fi)}<small> g</small></div>
      <div class="foot">Meta: ${g.fiber} g</div>
    </section>

    <section class="card">
      <div class="card-h"><span class="lbl">Peso</span><button class="ring-btn plain" data-act="addWeight" aria-label="Registrar peso">+</button></div>
      <div class="big">${fmt1(lastWeight())}<small> kg</small></div>
      <div class="foot">${weightFoot()}</div>
    </section>
  </main>`;
}
function weightFoot() {
  const w = lastWeight(), gw = S.profile.goalWeight, diff = r1(w - gw);
  if (S.profile.goal === "mantener" || !gw) return "Meta: mantener tu peso";
  if (Math.abs(diff) < 0.05) return `🎉 ¡Llegaste a tu meta de ${fmt1(gw)} kg!`;
  return `${fmt1(Math.abs(diff))} kg ${diff > 0 ? "arriba" : "abajo"} de la meta: ${fmt1(gw)} kg`;
}
function planFor(k) {
  const n = Math.floor(parseD(k).getTime() / 864e5);
  const pick = (type, off) => { const l = RECIPES.filter((r) => r.type === type); return l[(n + off) % l.length]; };
  return [pick("desayuno", 0), pick("almuerzo", 1), pick("cena", 2), pick("snack", 3)];
}

function chRow(ch, k, claimed) {
  const [v, g] = ch.prog(k), done = claimed || isDone(ch, k);
  const show = (n) => (n >= 1000 ? fmt(n) : r0(n));
  return `<div class="ch ${done ? "done" : ""}"><div class="hex">${done ? "✅" : ch.icon}</div>
    <div class="grow"><div class="t">${ch.name}</div><div class="s">${ch.desc}</div>
      <div class="chbar">${bar(done ? 1 : v, done ? 1 : g, "#f5a524")}<span>${show(Math.min(v, g))} / ${show(g)}</span></div></div>
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
  const pts = S.weights.slice(-30), start = S.profile.weight, now = lastWeight();
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
const OB_STEPS = 6;
const opt = (field, val, title, desc = "") => `<button class="opt ${String(ob[field]) === String(val) ? "on" : ""}" data-act="obSet" data-f="${field}" data-v="${val}"><b>${title}</b>${desc ? `<small>${desc}</small>` : ""}</button>`;
const field = (id, label, val, unit, attrs = "") => `<label class="field"><span>${label}</span><div><input id="${id}" value="${esc(val)}" ${attrs}>${unit ? `<em>${unit}</em>` : ""}</div></label>`;
function viewOnboard() {
  const s = ob.step;
  let body = "";
  if (s === 0) body = `<img class="ob-pet" src="assets/chopper.png" alt="Chopper"><h2>¡Hola! Soy tu doctor de a bordo</h2>
    <p>Voy a ayudarte a llevar tus calorías, agua, ayuno y peso. Primero necesito conocerte.</p>
    ${field("ob-name", "¿Cómo te llamas?", ob.name, "", 'placeholder="Tu nombre" autocomplete="given-name"')}
    ${field("ob-pet", "Nombre de tu mascota", ob.petName, "", 'maxlength="16"')}`;
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
      <div class="split"><i style="flex:48;background:#f5c043"></i><i style="flex:29;background:#3b82f6"></i><i style="flex:23;background:#3fae5c"></i></div>
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
}
function obFinish() {
  if (ob.goal === "mantener") ob.goalWeight = ob.weight;
  const { step, ...p } = ob;
  const first = !S.profile;
  S.profile = p; S.goals = calcPlan(p);
  if (first) { S.weights.push({ d: today(), kg: p.weight, init: true }); S.lastOpen = today(); S.coins += 15; }
  view = "home"; save(); render(); window.scrollTo(0, 0);
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
function sheetSearch(q = "") {
  sheet(`<h2>Buscar alimento</h2>
    <input id="q" class="search" type="search" placeholder="Ej: marraqueta, pollo, palta…" value="${esc(q)}" autocomplete="off">
    <div id="results"></div>
    <div class="btn-row"><button class="btn ghost" data-act="searchOnline">🌐 Buscar en línea</button><button class="btn ghost" data-act="newFood">✏️ Crear</button></div>`, "tall");
  drawResults();
  setTimeout(() => $("#q")?.focus(), 50);
}
function drawResults(online) {
  const q = norm($("#q")?.value || "").trim();
  let list, title;
  if (online) { list = online; title = "Open Food Facts"; }
  else if (!q) { list = [...S.recent, ...S.myFoods.filter((m) => !S.recent.some((r) => r.name === m.name))].slice(0, 25); title = list.length ? "Recientes y mis alimentos" : ""; }
  else { const words = q.split(/\s+/); list = [...S.myFoods, ...FOODS].filter((f) => words.every((w) => norm(f.name).includes(w))).slice(0, 40); title = ""; }
  searchPool = list;
  $("#results").innerHTML = (title ? `<div class="meal-h">${title}</div>` : "") +
    (list.length ? list.map((f, i) => `<button class="row pick" data-act="pickFood" data-i="${i}"><div class="grow"><div class="t">${esc(f.name)}</div>
      <div class="s">${esc(f.label || f.portion + " g")} · ${fmt((f.kcal * f.portion) / 100)} kcal</div></div><span class="plus">+</span></button>`).join("")
      : `<p class="empty">${q ? "Sin resultados aquí. Prueba «Buscar en línea» o crea el alimento." : "Escribe para buscar entre los alimentos."}</p>`);
}
async function searchOnline() {
  const q = ($("#q")?.value || "").trim();
  if (q.length < 2) return toast("Escribe al menos 2 letras");
  $("#results").innerHTML = `<p class="empty">Buscando en Open Food Facts…</p>`;
  try {
    const r = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=25&fields=product_name,brands,nutriments,serving_quantity`);
    const j = await r.json();
    const list = (j.products || []).map(offToFood).filter(Boolean);
    if ($("#results")) drawResults(list);
  } catch { if ($("#results")) $("#results").innerHTML = `<p class="empty">No se pudo conectar. Revisa tu internet.</p>`; }
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
function logFood(entry) {
  mutDay(curDate).foods.push({ id: uid(), t: Date.now(), ...entry });
  eating = Date.now(); setTimeout(() => { if (view === "home") render(); }, 3600);
  closeSheet(); commit();
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
  sheet(`<h2>Registrar peso</h2>${field("w-kg", niceDate(curDate), lastWeight(), "kg", 'inputmode="decimal"')}
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
function sheetRecipe(id) {
  const r = RECIPES.find((x) => x.id === id); if (!r) return;
  sheet(`<img class="hero" src="assets/recetas/${r.id}.jpg" alt=""><h2>${esc(r.name)}</h2>
    <div class="preview"><div><b>${r.kcal}</b><small>kcal</small></div><div><b>${r.c}</b><small>carbos</small></div><div><b>${r.f}</b><small>grasas</small></div><div><b>${r.p}</b><small>proteína</small></div><div><b>${r.min}</b><small>min</small></div></div>
    <h3>Ingredientes</h3><ul>${r.ing.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>
    <h3>Preparación</h3><ol>${r.steps.map((i) => `<li>${esc(i)}</li>`).join("")}</ol>
    <button class="btn" data-act="logRecipe" data-id="${r.id}">Registrar esta comida</button>`, "tall");
}
function sheetShop() {
  const row = (x) => {
    const own = S.owned.includes(x.id), active = S.bg === x.id || S.item === x.id;
    const btn = x.kind === "use" ? `<button class="pill-btn" data-act="buy" data-id="${x.id}" ${S.coins < x.price || S.hearts >= 4 ? "disabled" : ""}>${x.price} ฿</button>`
      : own ? `<button class="pill-btn ${active ? "on" : ""}" data-act="equip" data-id="${x.id}">${active ? (x.kind === "item" ? "Quitar" : "En uso") : "Usar"}</button>`
      : `<button class="pill-btn" data-act="buy" data-id="${x.id}" ${S.coins < x.price ? "disabled" : ""}>${x.price} ฿</button>`;
    return `<div class="row">${x.kind === "bg" ? `<img class="thumb" src="assets/fondos/${x.id}.jpg" alt="">` : `<span class="thumb em">${x.icon}</span>`}
      <div class="grow"><div class="t">${x.name}</div><div class="s">${x.desc || (x.kind === "bg" ? "Fondo" : "Compañero de Chopper")}</div></div>${btn}</div>`;
  };
  sheet(`<h2>Tienda <span class="chip dark">${fmt(S.coins)} ฿</span></h2>
    <div class="meal-h">Cuidados</div>${SHOP.filter((x) => x.kind === "use").map(row).join("")}
    <div class="meal-h">Fondos</div>${SHOP.filter((x) => x.kind === "bg").map(row).join("")}
    <div class="meal-h">Compañeros</div>${SHOP.filter((x) => x.kind === "item").map(row).join("")}`, "tall");
}
function sheetSettings() {
  const g = S.goals;
  sheet(`<h2>Configuración</h2>
    ${field("s-pet", "Nombre de la mascota", S.profile.petName, "", 'maxlength="16"')}
    <div class="grid2">${field("s-kcal", "Meta de calorías", g.kcal, "kcal", 'inputmode="numeric"')}${field("s-water", "Meta de agua", g.water, "ml", 'inputmode="numeric"')}
    ${field("s-carb", "Carbohidratos", g.carb, "g", 'inputmode="numeric"')}${field("s-fat", "Grasas", g.fat, "g", 'inputmode="numeric"')}
    ${field("s-prot", "Proteínas", g.prot, "g", 'inputmode="numeric"')}${field("s-fiber", "Fibra", g.fiber, "g", 'inputmode="numeric"')}
    ${field("s-burn", "Meta de quema", g.burn, "kcal", 'inputmode="numeric"')}${field("s-fast", "Horas de ayuno", g.fastH, "h", 'inputmode="numeric"')}
    ${field("s-goalw", "Peso meta", S.profile.goalWeight, "kg", 'inputmode="decimal"')}</div>
    <button class="btn" data-act="saveSettings">Guardar</button>
    <button class="btn ghost" data-act="replan">Recalcular mi plan desde cero</button>
    <div class="meal-h">Respaldo de datos</div>
    <p class="s">Tus datos viven solo en este teléfono. Exporta un respaldo de vez en cuando.</p>
    <div class="btn-row"><button class="btn ghost" data-act="export">⬇️ Exportar</button><button class="btn ghost" data-act="import">⬆️ Importar</button></div>
    <input type="file" id="importFile" accept="application/json,.json" hidden>
    <button class="btn danger" data-act="wipe">Borrar todos los datos</button>
    <p class="s center">Chopper Fit · proyecto personal de fan, sin fines comerciales.</p>`, "tall");
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
async function sheetScan() {
  sheet(`<h2>Código de barras</h2><div class="scanbox"><video id="scanv" playsinline muted></video><div class="scanline"></div></div>
    <p class="s center" id="scanmsg">Apunta la cámara al código del envase.</p>
    ${field("scan-code", "O escríbelo a mano", "", "", 'inputmode="numeric" placeholder="7801234567890"')}
    <button class="btn" data-act="scanManual">Buscar código</button>`, "tall");
  try {
    await loadZX();
    zxReader = new ZXing.BrowserMultiFormatReader();
    await zxReader.decodeFromConstraints({ video: { facingMode: "environment" } }, "scanv", (res) => { if (res) lookupBarcode(res.getText()); });
  } catch { if ($("#scanmsg")) $("#scanmsg").textContent = "No se pudo abrir la cámara. Escribe el código a mano."; }
}
async function lookupBarcode(code) {
  code = String(code).replace(/\D/g, ""); if (code.length < 6) return toast("Código no válido");
  stopScan(); if ($("#scanmsg")) $("#scanmsg").textContent = `Buscando ${code}…`;
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,brands,nutriments,serving_quantity`);
    const j = await r.json(), f = j.status === 1 ? offToFood(j.product) : null;
    if (f) return sheetPortion(f);
    toast("Producto no encontrado: créalo a mano"); sheetNewFood();
  } catch { toast("Sin conexión para buscar el código"); }
}

// ---------- acciones ----------
const A = {
  close: closeSheet,
  nav: (el) => { view = el.dataset.view; curDate = today(); closeSheet(); render(); window.scrollTo(0, 0); },
  fab: sheetAdd,
  settings: sheetSettings, shop: sheetShop, addWater: sheetWater, addWeight: sheetWeight, addWorkout: sheetWorkout,
  addFood: () => sheetSearch(), newFood: () => sheetNewFood(), quickAdd: sheetQuick, scan: sheetScan,
  pet: () => toast(["¡No me hace feliz que me toques, tonto~ 🩷", "¡Soy un reno, no un mapache!", "¿Ya tomaste agua?", "¡El algodón de azúcar es lo mejor!"][Math.floor(Math.random() * 4)]),
  kcalMode: () => { S.kcalMode = S.kcalMode === "consumidas" ? "restantes" : "consumidas"; save(); render(); },
  prevDay: () => { curDate = addDays(curDate, -1); render(); },
  nextDay: () => { if (curDate < today()) { curDate = addDays(curDate, 1); render(); } },
  pickDay: () => { const i = $("#datepick"); i.max = today(); i.value = curDate; i.showPicker ? i.showPicker() : i.click(); },
  delFood: (el) => { const d = mutDay(curDate); d.foods = d.foods.filter((x) => x.id !== el.dataset.id); commit(); },
  delWorkout: (el) => { const d = mutDay(curDate); d.workouts = d.workouts.filter((x) => x.id !== el.dataset.id); commit(); },
  glass: (el) => { const d = mutDay(curDate), i = +el.dataset.i, full = Math.floor(d.water / 250); d.water = i < full ? i * 250 : (i + 1) * 250; commit(); },
  water: (el) => { const d = mutDay(curDate); d.water = Math.max(0, d.water + +el.dataset.ml); checkChallenges(); save(); render(); sheetWater(); },
  fastToggle: () => {
    if (S.fast.start) {
      const h = fastHours(), ok = h >= S.goals.fastH;
      S.fast.history.push({ start: S.fast.start, end: Date.now(), ok }); S.fast.start = null;
      toast(ok ? `🌙 ¡Ayuno de ${hm(h)} completado!` : `Ayuno terminado a las ${hm(h)}`);
    } else { S.fast.start = Date.now(); toast("🌙 Ayuno iniciado. ¡Tú puedes!"); }
    closeSheet(); commit();
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
    S.weights = [...S.weights.filter((w) => w.d !== curDate), { d: curDate, kg: r1(kg) }].sort((a, b) => (a.d < b.d ? -1 : 1));
    closeSheet(); commit(); toast("⚖️ Peso registrado");
  },
  saveWorkout: () => {
    const kcal = num($("#wo-kcal").value); if (kcal <= 0) return toast("Ingresa las calorías");
    mutDay(curDate).workouts.push({ id: uid(), name: WORKOUTS[num($("#wo-type").value)].name, min: r0(num($("#wo-min").value)), kcal: r0(kcal) });
    closeSheet(); commit();
  },
  recipe: (el) => sheetRecipe(el.dataset.id),
  logRecipe: (el) => { const r = RECIPES.find((x) => x.id === el.dataset.id); logFood({ name: r.name, meal: r.type, kcal: r.kcal, c: r.c, f: r.f, p: r.p, fi: r.fi }); },
  buy: (el) => {
    const x = SHOP.find((s) => s.id === el.dataset.id); if (!x || S.coins < x.price) return;
    if (x.kind === "use") { if (S.hearts >= 4) return; S.hearts++; toast("🍭 ¡Algodón de azúcar! +1 ❤️"); }
    else { S.owned.push(x.id); if (x.kind === "bg") S.bg = x.id; else S.item = x.id; toast(`${x.icon} ¡${x.name} desbloqueado!`); }
    S.coins -= x.price; save(); render(); sheetShop();
  },
  equip: (el) => { const x = SHOP.find((s) => s.id === el.dataset.id); if (x.kind === "bg") S.bg = x.id; else S.item = S.item === x.id ? null : x.id; save(); render(); sheetShop(); },
  statSel: (el) => { statSel[el.dataset.chart] = +el.dataset.i; render(); },
  scanManual: () => lookupBarcode($("#scan-code").value),
  saveSettings: () => {
    const g = S.goals, v = (id, d, a, b) => clamp(r0(num($(id).value, d)), a, b);
    S.profile.petName = $("#s-pet").value.trim() || "Chopper";
    g.kcal = v("#s-kcal", g.kcal, 800, 6000); g.water = v("#s-water", g.water, 500, 6000); g.carb = v("#s-carb", g.carb, 0, 900); g.fat = v("#s-fat", g.fat, 0, 400);
    g.prot = v("#s-prot", g.prot, 0, 500); g.fiber = v("#s-fiber", g.fiber, 0, 100); g.burn = v("#s-burn", g.burn, 0, 3000); g.fastH = v("#s-fast", g.fastH, 1, 23);
    S.profile.goalWeight = clamp(num($("#s-goalw").value, S.profile.goalWeight), 30, 300);
    closeSheet(); commit(); toast("Cambios guardados");
  },
  replan: () => { ob = { ...ob, ...S.profile, weight: lastWeight(), step: 1 }; S.goals = null; closeSheet(); render(); window.scrollTo(0, 0); },
  export: () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 1)], { type: "application/json" }));
    a.download = `chopper-fit-${today()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  import: () => $("#importFile").click(),
  wipe: () => { if (confirm("¿Borrar TODOS tus datos? Esto no se puede deshacer.")) { localStorage.removeItem(KEY); location.reload(); } },
  obSet: (el) => { obRead(); const v = el.dataset.v; ob[el.dataset.f] = isNaN(v) ? v : +v; render(); },
  obBack: () => { obRead(); ob.step--; render(); },
  obNext: () => { obRead(); if (ob.step === OB_STEPS - 1) return obFinish(); ob.step++; render(); window.scrollTo(0, 0); },
};
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]"); if (!el || el.disabled) return;
  const fn = A[el.dataset.act]; if (fn) fn(el);
});
document.addEventListener("input", (e) => {
  if (e.target.id === "q") drawResults();
  if (e.target.id === "f-g") drawPreview();
  if (e.target.id === "wo-min" || e.target.id === "wo-type") estWorkout();
});
document.addEventListener("change", (e) => {
  if (e.target.id === "wo-type") estWorkout();
  if (e.target.id === "datepick" && e.target.value) { curDate = e.target.value > today() ? today() : e.target.value; render(); }
  if (e.target.id === "importFile" && e.target.files[0]) {
    e.target.files[0].text().then((txt) => {
      const data = JSON.parse(txt);
      if (!data || typeof data !== "object" || !data.profile || !data.days) throw new Error("formato");
      S = Object.assign(blank(), data); save(); closeSheet(); render(); toast("Respaldo importado");
    }).catch(() => toast("El archivo no es un respaldo válido"));
  }
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); if (e.key === "Enter" && e.target.id === "q") searchOnline(); });

// ---------- arranque ----------
if (S.profile && S.goals) { rollover(); checkChallenges(); save(); }
render();
setInterval(() => {
  if (S.fast.start && $("#fastclock")) $("#fastclock").textContent = hm(fastHours());
  if (S.lastOpen && S.lastOpen !== today() && S.goals) { rollover(); curDate = today(); save(); render(); }
}, 30000);
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js");
