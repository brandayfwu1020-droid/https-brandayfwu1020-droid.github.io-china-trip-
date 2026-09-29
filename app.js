'use strict';
/* China Trip — plain JS, no dependencies. Reads data/*.json made by scripts/import_data.py. */

const S = { trip: null, plan: {}, places: {}, placeList: [], tab: 'itinerary', date: null };

// ---------------------------------------------------------------- helpers
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (id, cls = '') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
const enc = encodeURIComponent;

const CJK = /[㐀-鿿]/;
// 'Qixinggang 七星岗 + Tongyuanmen 通远门' -> 'Qixinggang + Tongyuanmen'
const enPart = (s) => String(s || '').replace(/[\u3400-\u9fff（）·]+/g, ' ').replace(/\s+/g, ' ').replace(/[\s/+-]+$/, '').trim() || s;
const zhPart = (s) => { const i = String(s || '').search(CJK); return i < 0 ? null : s.slice(i).trim(); };

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const toDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const isoOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayISO = () => isoOf(new Date());
const fmtDay = (iso, long) => { const d = toDate(iso); return `${WD[d.getDay()]}, ${MO[d.getMonth()]} ${d.getDate()}${long ? '' : ''}`; };

function clock(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return { t: `${h % 12 || 12}:${String(m).padStart(2, '0')}`, ap: h < 12 ? 'AM' : 'PM', h, m };
}
function timeText(time) {
  if (!time) return '';
  if (!time.start) return time.label || '';
  const a = clock(time.start), b = clock(time.end);
  const approx = time.approx ? '~' : '';
  if (!b) return `${approx}${a.t} ${a.ap}`;
  return a.ap === b.ap ? `${approx}${a.t} – ${b.t} ${b.ap}` : `${approx}${a.t} ${a.ap} – ${b.t} ${b.ap}`;
}
const minutes = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

const cityInfo = (c) => (S.trip.cities[c] || {});
const cityColor = (c) => cityInfo(c).color || 'var(--text-3)';
const travelerLabel = (ids) => (ids || []).map((id) => S.trip.travelers.find((t) => t.id === id)?.label || id).join(', ');
const isEveryone = (who) => !who || who.length === S.trip.travelers.length;

const CAT_LABEL = { sight: 'Sight', shopping: 'Shopping', park: 'Park', nightlife: 'Evening', transit: 'Transit', restaurant: 'Food', hotel: 'Hotel' };
const CAT_KIND = { restaurant: 'meal', hotel: 'hotel' };
const MODE = {
  taxi: ['taxi', 'Taxi / DiDi'], metro: ['metro', 'Metro'], walk: ['walk', 'Walk'], bike: ['bike', 'Shared bike'],
  bus: ['bus', 'Shuttle / bus'], flight: ['flight', 'Flight'], train: ['train', 'Train'],
  'train/bus': ['train', 'Train or bus'], tbd: ['route', 'To be decided'],
};

// ---------------------------------------------------------------- maps
function mapQuery(p) {
  const cz = cityInfo(p.city).zh || '';
  return p.nameZh ? `${cz} ${p.nameZh.replace(/\s*·\s*/g, ' ')}`.trim() : `${p.name}, ${p.city}`;
}
function appleMapsURL(p) {
  if (p.coords) return `https://maps.apple.com/?daddr=${p.coords.lat},${p.coords.lng}&q=${enc(p.nameZh || p.name)}`;
  return `https://maps.apple.com/?daddr=${enc(mapQuery(p))}`;
}
function amapURL(p) {
  if (p.coords) return `https://uri.amap.com/marker?position=${p.coords.lng},${p.coords.lat}&name=${enc(p.nameZh || p.name)}&callnative=1&src=chinatrip`;
  return `https://uri.amap.com/search?keyword=${enc(p.nameZh || p.name)}&city=${enc(cityInfo(p.city).zh || '')}&view=map&callnative=1&src=chinatrip`;
}

// ---------------------------------------------------------------- data
async function load() {
  const get = (n) => fetch(`data/${n}.json`, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(n); return r.json(); });
  const [trip, plan, places] = await Promise.all([get('trip'), get('itinerary'), get('places')]);
  S.trip = trip;
  S.plan = plan;
  S.placeList = places;
  places.forEach((p) => { S.places[p.id] = p; });
  S.days = trip.days;
  S.legs = Object.fromEntries(trip.legs.map((l) => [l.id, l]));
}

function staysTonight(date) {
  const out = new Map();
  for (const t of S.trip.travelers) {
    for (const s of S.trip.stays) {
      if (s.who && !s.who.includes(t.id)) continue;
      const own = (s.datesFor || {})[t.id] || {};
      const cin = own.checkIn || s.checkIn, cout = own.checkOut || s.checkOut;
      if (cin <= date && date < cout) {
        if (!out.has(s.id)) out.set(s.id, { stay: s, who: [] });
        out.get(s.id).who.push(t.id);
      }
    }
  }
  return [...out.values()];
}

function initialDate() {
  const days = S.days.map((d) => d.date);
  const today = todayISO();
  if (days.includes(today)) return today;
  return today < days[0] ? days[0] : days[days.length - 1];
}

// ---------------------------------------------------------------- routing
function route() {
  const [tab, arg] = location.hash.replace(/^#/, '').split('/');
  S.tab = ['places', 'itinerary', 'overview'].includes(tab) ? tab : 'itinerary';
  if (S.tab === 'itinerary') {
    const valid = arg && S.days.some((d) => d.date === arg);
    selectDate(valid ? arg : (S.date || initialDate()), { scroll: !valid || arg !== S.date });
  }
  $$('.view').forEach((v) => v.classList.toggle('is-active', v.dataset.view === S.tab));
  $$('.tab').forEach((a) => { if (a.dataset.tab === S.tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
}

// ---------------------------------------------------------------- itinerary
function renderItineraryShell() {
  const v = $('#view-itinerary');
  let month = null;
  const chips = S.days.map((d) => {
    const dt = toDate(d.date);
    let marker = '';
    if (dt.getMonth() !== month) { month = dt.getMonth(); marker = `<span class="dchip-month">${MO[month]}</span>`; }
    const cities = (d.label || '').split(' → ').filter(Boolean);
    let short = cities.map((c) => cityInfo(c).short || '').filter(Boolean).join('→');
    const splits = d.groups.filter((g) => g.city);
    if (!d.hasPlan && splits.length > 1) short = splits.map((g) => cityInfo(g.city).short).join('·');
    const color = cityColor(cities[cities.length - 1] || d.city);
    return `${marker}<button class="dchip${d.date === todayISO() ? ' is-today' : ''}" data-date="${d.date}" role="tab" aria-label="${esc(fmtDay(d.date))}, ${esc(d.label || '')}">
      <span class="dchip-wd">${WD[dt.getDay()]}</span><span class="dchip-num">${dt.getDate()}</span>
      <span class="dchip-city" style="--c:${color}">${esc(short || '•')}</span></button>`;
  }).join('');
  v.innerHTML = `
    <header class="head">
      <div class="head-row"><h1 id="it-title"></h1><span class="head-sub" id="it-sub"></span></div>
      <div class="dates" role="tablist" aria-label="Trip days">${chips}</div>
    </header>
    <div class="page" id="it-day"></div>`;
  v.addEventListener('click', onItineraryClick);
}

function selectDate(date, { scroll = true } = {}) {
  S.date = date;
  const idx = S.days.findIndex((d) => d.date === date);
  const day = S.days[idx];
  $('#it-title').textContent = fmtDay(date);
  $('#it-sub').textContent = `Day ${idx + 1} of ${S.days.length}`;
  $$('.dchip').forEach((c) => {
    const sel = c.dataset.date === date;
    c.classList.toggle('is-sel', sel);
    c.setAttribute('aria-selected', sel);
  });
  $('#it-day').innerHTML = dayHTML(day);
  $('.tab[data-tab="itinerary"]').setAttribute('href', `#itinerary/${date}`);
  if (location.hash !== `#itinerary/${date}` && S.tab === 'itinerary') history.replaceState(null, '', `#itinerary/${date}`);
  const chip = $(`.dchip[data-date="${date}"]`);
  chip?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: scroll ? 'smooth' : 'auto' });
  if (scroll) $('#view-itinerary').scrollTop = 0;
  requestAnimationFrame(addMoreButtons);
}

function dayHTML(day) {
  const plan = S.plan[day.date];
  const main = day.city;
  const splitGroups = day.groups.filter((g) => g.city);
  const isSplit = splitGroups.length > 1;
  const zh = !day.label?.includes('→') && main ? cityInfo(main).zh : '';

  let html = `<div class="day-summary">
    <h2 class="day-city">${esc(day.label || 'Travel day')}${zh ? `<span class="zh">${esc(zh)}</span>` : ''}</h2>
    <div class="day-meta">
      ${day.weather ? `<span>${icon('sun')}${esc(day.weather.replace(/\s*\(.*\)/, ''))}</span>` : ''}
    </div>`;
  if (day.note) html += `<div class="note">${esc(day.note)}</div>`;
  if (isSplit) {
    html += `<div class="groups">${splitGroups.map((g) => `<div class="group"><span class="dot" style="--c:${cityColor(g.city)}"></span><b>${esc(travelerLabel(g.who))}</b> ${esc(g.city)}</div>`).join('')}</div>`;
  }

  const minis = [];
  for (const id of day.legIds) minis.push(legMiniHTML(S.legs[id]));
  for (const { stay, who } of staysTonight(day.date)) {
    const p = S.places[stay.hotelPlaceId];
    if (!p) continue;
    const whoText = isEveryone(who) ? '' : ` · ${travelerLabel(who)}`;
    minis.push(`<button class="mini" data-place="${p.id}">
      <span class="mini-icon hotel">${icon('bed')}</span>
      <span class="mini-body"><span class="mini-title">${esc(p.name)}</span><span class="mini-sub">Tonight's hotel${esc(whoText)}</span></span>
      ${icon('chevron')}</button>`);
  }
  if (minis.length) html += `<div class="mini-list">${minis.join('')}</div>`;
  html += `</div>`;

  if (!plan) {
    const soon = cityInfo(main).planStatus === 'coming';
    html += `<div class="card empty-day">
      <div class="big">${soon ? '🗓️' : '🧭'}</div>
      <h3>${soon ? 'Plan coming soon' : (main ? 'No detailed plan' : 'Travel day')}</h3>
      <p>${soon ? `The ${esc(main)} day plan will appear here once it's ready.` : (main ? 'This app only has the travel and hotel details for this day.' : 'Safe travels! Flight details are above.')}</p>
    </div>`;
  } else {
    html += `<ol class="timeline">${timelineHTML(day, plan.items)}</ol>`;
  }
  html += `<p class="footnote">Data updated ${esc(updatedText())}</p>`;
  return html;
}

function legMiniHTML(l) {
  const [ic] = MODE[l.mode] || MODE.tbd;
  const a = clock(l.depart.time), b = clock(l.arrive.time);
  const tzA = cityInfo(l.from).tzLabel, tzB = cityInfo(l.to).tzLabel;
  let when = l.timeLabel || '';
  if (a) {
    const dayShift = l.arrive.date !== l.depart.date ? ` (${fmtDay(l.arrive.date)})` : '';
    when = tzA === tzB
      ? `${a.t} ${a.ap} → ${b ? `${b.t} ${b.ap}${dayShift}` : ''} · ${tzA || ''}`
      : `${a.t} ${a.ap} ${tzA || ''} → ${b ? `${b.t} ${b.ap} ${tzB || ''}${dayShift}` : ''}`;
  }
  const who = isEveryone(l.who) ? '' : ` · ${travelerLabel(l.who)}`;
  return `<div class="mini">
    <span class="mini-icon move">${icon(ic)}</span>
    <span class="mini-body"><span class="mini-title">${esc(l.from)} → ${esc(l.to || '')}</span>
    <span class="mini-sub">${esc(when)}${esc(who)}</span></span></div>`;
}

function timelineHTML(day, items) {
  const isToday = day.date === todayISO();
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  let nowPlaced = !isToday;
  const out = [];
  for (const it of items) {
    if (!nowPlaced && it.time.start && minutes(it.time.start) > nowMin) {
      out.push(`<li class="now" aria-label="Now"><span>NOW</span><i></i><hr></li>`);
      nowPlaced = true;
    }
    out.push(it.kind === 'transport' ? moveHTML(it) : stopHTML(it));
  }
  return out.join('');
}

function timeCol(time, compact) {
  if (!time.start) return `<div class="tl-time"><span class="lbl">${esc(time.label || '')}</span></div>`;
  const a = clock(time.start), b = clock(time.end);
  return `<div class="tl-time"><b>${time.approx ? '~' : ''}${a.t}<span class="ampm">${a.ap}</span></b>${!compact && b ? `<span class="end">–${b.t}</span>` : ''}</div>`;
}

function mealLabel(time) {
  if (!time.start) return 'Meal';
  const m = minutes(time.start);
  if (m < 630) return 'Breakfast';
  if (m < 900) return 'Lunch';
  if (m < 1050) return 'Snack';
  if (m < 1290) return 'Dinner';
  return 'Late-night food';
}

function kindLabel(it, p) {
  if (it.kind === 'meal') return mealLabel(it.time);
  if (it.kind === 'hotel') return 'Hotel';
  if (it.kind === 'activity') return 'Free time';
  return CAT_LABEL[p?.category] || 'Stop';
}

function badgesHTML(it) {
  const b = [];
  if (it.stars >= 3) b.push('<span class="badge star">★ Top pick</span>');
  else if (it.stars) b.push('<span class="badge star">★ Highlight</span>');
  if (it.badge) b.push(`<span class="badge">${esc(it.badge)}</span>`);
  if (it.city) b.push(`<span class="badge city" style="--c:${cityColor(it.city)}">${esc(it.city)}</span>`);
  return b.join('');
}

function placeActions(p) {
  return `<div class="actions">
    <a class="btn primary" href="${appleMapsURL(p)}" target="_blank" rel="noopener">${icon('nav')}Navigate</a>
    <button class="btn" data-driver="${p.id}">${icon('driver')}Show driver</button>
  </div>`;
}

function stopHTML(it) {
  const p = S.places[it.placeId];
  const title = enPart(it.title);
  const zh = p?.nameZh || zhPart(it.title);
  const titleEl = p
    ? `<button class="tl-title" data-place="${p.id}">${esc(title)}</button>`
    : `<div class="tl-title">${esc(title)}</div>`;
  const opts = it.optionIds.map((id) => S.places[id]).filter(Boolean);
  const optLabel = it.kind === 'meal' ? (opts.length > 1 ? 'Pick one' : 'Restaurant') : 'Eat here';
  const getThere = it.getThere && it.kind !== 'hotel' ? `<p class="tl-details clamp"><b>Getting there:</b> ${esc(it.getThere)}</p>` : '';
  const kindCls = it.kind === 'destination' && p ? (CAT_KIND[p.category] ? `k-${CAT_KIND[p.category]}` : 'k-destination') : `k-${it.kind}`;
  return `<li class="tl ${kindCls}" id="it-${it.id}">
    ${timeCol(it.time)}
    <div class="tl-rail"><span class="tl-dot"></span></div>
    <div class="tl-body"><div class="tl-card">
      <div class="tl-kind">${esc(kindLabel(it, p))}${it.duration ? `<span class="dur">· ${esc(it.duration)}</span>` : ''}${badgesHTML(it)}</div>
      ${titleEl}
      ${zh && p ? `<div class="tl-zh" lang="zh-CN">${esc(zh)}</div>` : ''}
      ${it.details ? `<p class="tl-details clamp">${esc(it.details)}</p>` : ''}
      ${getThere}
      ${opts.length ? `<div class="options"><span class="options-label">${optLabel}</span>${opts.map((o) =>
        `<button class="chip" data-place="${o.id}">${esc(o.name)} <span class="zh" lang="zh-CN">${esc(o.nameZh || '')}</span></button>`).join('')}</div>` : ''}
      ${p && !(it.kind === 'hotel' && /wake|pack|check-in/i.test(it.title)) ? placeActions(p) : ''}
    </div></div>
  </li>`;
}

function moveHTML(it) {
  const p = S.places[it.placeId];
  const modes = it.modes.length ? it.modes : ['taxi'];
  const labels = modes.map((m) => (MODE[m] || MODE.tbd)[1]).join(' or ');
  let title = enPart(it.title);
  if (!title.includes('→') && !/^(travel|leave|depart)/i.test(title)) title = `To ${title}`;
  const route = it.getThere ? `<p class="tl-details">${esc(it.getThere)}</p>` : '';
  return `<li class="tl k-transport" id="it-${it.id}">
    ${timeCol(it.time, true)}
    <div class="tl-rail"><span class="move-icon">${icon((MODE[modes[0]] || MODE.tbd)[0])}</span></div>
    <div class="tl-move">
      <div class="tl-move-top">${esc(labels)}${it.duration ? ` · ${esc(it.duration)}` : ''}${badgesHTML(it)}</div>
      <div class="tl-move-title">${esc(title)}</div>
      ${route}
      ${it.details ? `<p class="tl-details clamp">${esc(it.details)}</p>` : ''}
      ${p ? `<div class="move-links"><a class="linkish" href="${appleMapsURL(p)}" target="_blank" rel="noopener">${icon('nav')}Navigate</a>
        <button class="linkish" data-driver="${p.id}">${icon('driver')}Show driver</button></div>` : ''}
    </div>
  </li>`;
}

function addMoreButtons() {
  $$('#it-day .clamp').forEach((el) => {
    if (el.nextElementSibling?.classList.contains('more')) return;
    if (el.scrollHeight > el.clientHeight + 2) {
      el.insertAdjacentHTML('afterend', '<button class="more" data-more>More</button>');
    }
  });
}

function onItineraryClick(e) {
  const chip = e.target.closest('.dchip');
  if (chip) { location.hash = `#itinerary/${chip.dataset.date}`; return; }
  const more = e.target.closest('[data-more]');
  if (more) {
    const p = more.previousElementSibling;
    const open = p.classList.toggle('clamp');
    more.textContent = open ? 'More' : 'Less';
    return;
  }
  handleCommonClick(e);
}

function handleCommonClick(e) {
  const pl = e.target.closest('[data-place]');
  if (pl) { openPlace(pl.dataset.place); return true; }
  const dr = e.target.closest('[data-driver]');
  if (dr) { openDriver(dr.dataset.driver); return true; }
  return false;
}

function updatedText() {
  const d = new Date(S.trip.generatedAt);
  return `${MO[d.getMonth()]} ${d.getDate()}, ${clock(`${d.getHours()}:${d.getMinutes()}`).t} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

// ---------------------------------------------------------------- place sheet
let lastFocus = null;

function openPlace(id) {
  const p = S.places[id];
  if (!p) return;
  const sheet = $('#sheet');
  const kind = CAT_KIND[p.category] || 'destination';
  const visits = (p.visits || []).map((v) =>
    `<button class="chip" data-goto="${v.date}" data-item="${v.itemId}">${esc(fmtDay(v.date))}${v.time ? ` · ${esc(timeText({ start: v.time }))}` : ''}</button>`).join('');
  sheet.className = `sheet k-${kind}`;
  sheet.innerHTML = `
    <div class="sheet-grab"><i></i></div>
    <button class="sheet-close" data-close aria-label="Close">${icon('close')}</button>
    <div class="sheet-kicker">${esc(CAT_LABEL[p.category] || 'Place')} · ${esc(p.city || '')}</div>
    <h2 id="sheet-title">${esc(p.name)}</h2>
    ${p.nameZh ? `<div class="zh-big" lang="zh-CN">${esc(p.nameZh)}</div>` : ''}
    ${p.intro ? `<p>${esc(p.intro)}</p>` : ''}
    ${p.tips ? `<div class="tips"><b>Tips</b>${esc(p.tips)}</div>` : ''}
    ${p.addressZh || p.address ? `<div class="section-label">Address</div>
      <div class="address">${p.addressZh ? `<span lang="zh-CN">${esc(p.addressZh)}</span>` : ''}${p.address ? `<span class="en">${esc(p.address)}</span>` : ''}</div>` : ''}
    ${visits ? `<div class="section-label">On the plan</div><div class="visits">${visits}</div>` : ''}
    <div class="actions">
      <a class="btn primary block" href="${appleMapsURL(p)}" target="_blank" rel="noopener">${icon('nav')}Navigate in Apple Maps</a>
      <a class="btn" href="${amapURL(p)}" target="_blank" rel="noopener">Amap 高德</a>
      <button class="btn" data-driver="${p.id}">${icon('driver')}Show driver</button>
    </div>`;
  lastFocus = document.activeElement;
  const bd = $('#sheet-backdrop');
  bd.hidden = false;
  sheet.hidden = false;
  sheet.scrollTop = 0;
  requestAnimationFrame(() => { bd.classList.add('is-open'); sheet.classList.add('is-open'); });
  $('.sheet-close', sheet).focus({ preventScroll: true });
}

function closeSheet() {
  const sheet = $('#sheet'), bd = $('#sheet-backdrop');
  if (sheet.hidden) return;
  sheet.style.transform = '';
  sheet.classList.remove('is-open', 'is-dragging');
  bd.classList.remove('is-open');
  setTimeout(() => { sheet.hidden = true; bd.hidden = true; }, 300);
  lastFocus?.focus?.({ preventScroll: true });
}

function setupSheet() {
  const sheet = $('#sheet');
  $('#sheet-backdrop').addEventListener('click', closeSheet);
  sheet.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { closeSheet(); return; }
    const go = e.target.closest('[data-goto]');
    if (go) {
      closeSheet();
      location.hash = `#itinerary/${go.dataset.goto}`;
      setTimeout(() => flashItem(go.dataset.item), 350);
      return;
    }
    handleCommonClick(e);
  });
  // Swipe down to close (only when the sheet is scrolled to the top).
  let startY = null, dy = 0;
  sheet.addEventListener('touchstart', (e) => {
    startY = sheet.scrollTop <= 0 ? e.touches[0].clientY : null;
    dy = 0;
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    dy = e.touches[0].clientY - startY;
    if (dy > 0) {
      e.preventDefault();
      sheet.classList.add('is-dragging');
      sheet.style.transform = `translateY(${dy}px)`;
    }
  }, { passive: false });
  sheet.addEventListener('touchend', () => {
    if (startY == null) return;
    sheet.classList.remove('is-dragging');
    if (dy > 90) closeSheet(); else sheet.style.transform = '';
    startY = null;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#driver').hidden) closeDriver(); else closeSheet();
  });
}

function flashItem(itemId) {
  const el = document.getElementById(`it-${itemId}`);
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.remove('is-flash');
  void el.offsetWidth;
  el.classList.add('is-flash');
}

// ---------------------------------------------------------------- show to driver
function openDriver(id) {
  const p = S.places[id];
  if (!p) return;
  const d = $('#driver');
  d.innerHTML = `
    <div class="driver-top"><span>Show this screen to the driver</span><button class="driver-done" data-close>Done</button></div>
    <div class="driver-main" lang="zh-CN">
      <div class="driver-ask">师傅您好，请带我去这里，谢谢！</div>
      <div class="driver-name">${esc(p.nameZh || p.name)}</div>
      ${p.addressZh || p.address ? `<div class="driver-addr">${esc(p.addressZh || p.address)}</div>` : ''}
    </div>
    <div class="driver-en" lang="en">${esc(p.name)}${p.address ? ` · ${esc(p.address)}` : ''}</div>`;
  d.hidden = false;
  $('[data-close]', d).focus({ preventScroll: true });
}
function closeDriver() { $('#driver').hidden = true; }

// ---------------------------------------------------------------- places
const CAT_ICON = { restaurant: 'food', hotel: 'bed', transit: 'metro', shopping: 'pin', sight: 'pin', park: 'pin', nightlife: 'pin' };
const P = { city: 'all', query: '' };

// Lowercase, strip accents (Swissôtel → swissotel) and punctuation for forgiving matching.
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’'`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const teaser = (p) => { const m = String(p.intro || '').match(/^.+?[.!?](\s|$)/); return (m ? m[0] : p.intro || '').trim(); };

function placeIndex() {
  if (S.searchIndex) return S.searchIndex;
  S.searchIndex = S.placeList.map((p) => ({
    p,
    hay: fold([p.name, p.nameZh, p.category, CAT_LABEL[p.category], p.city, cityInfo(p.city).zh, p.intro, p.tips, p.addressZh].join(' ')),
  }));
  return S.searchIndex;
}

function renderPlacesShell() {
  const v = $('#view-places');
  const cities = S.trip.cityOrder.filter((c) => S.placeList.some((p) => p.city === c));
  v.innerHTML = `
    <header class="head">
      <div class="head-row"><h1>Places</h1><span class="head-sub" id="pl-count"></span></div>
      <div class="search-wrap">
        <label class="search">${icon('search')}
          <input id="pl-search" type="search" placeholder="Search places, food, 中文…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" enterkeyhint="search" aria-label="Search places">
          <button class="search-clear" id="pl-clear" aria-label="Clear search" hidden>${icon('close')}</button>
        </label>
      </div>
      <div class="filters" id="pl-filters" role="tablist" aria-label="Filter by city">
        <button class="fchip" data-city="all" role="tab">All</button>
        ${cities.map((c) => `<button class="fchip" data-city="${esc(c)}" role="tab" style="--c:${cityColor(c)}"><span class="dot"></span>${esc(c)}</button>`).join('')}
      </div>
    </header>
    <div class="page" id="pl-list"></div>`;
  const input = $('#pl-search');
  input.addEventListener('input', () => { P.query = input.value; renderPlaceList(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  $('#pl-clear').addEventListener('click', () => { input.value = ''; P.query = ''; renderPlaceList(); input.focus(); });
  $('#pl-filters').addEventListener('click', (e) => {
    const b = e.target.closest('.fchip');
    if (!b) return;
    P.city = b.dataset.city;
    b.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
    if (P.query) { input.value = ''; P.query = ''; }
    renderPlaceList();
    v.scrollTop = 0;
  });
  v.addEventListener('click', (e) => { handleCommonClick(e); });
  renderPlaceList();
}

function renderPlaceList() {
  const q = fold(P.query);
  const searching = q.length > 0;
  $('#pl-clear').hidden = !searching;
  $$('#pl-filters .fchip').forEach((b) => {
    const on = !searching && b.dataset.city === P.city;
    b.classList.toggle('is-sel', on);
    b.setAttribute('aria-selected', on);
  });
  let list;
  if (searching) {
    // Every word must appear somewhere (partial words are fine): "hot pot" and "hotp" both work.
    const words = q.split(' ');
    const compact = q.replace(/ /g, '');
    const nameHit = (p) => (fold(`${p.name} ${p.nameZh}`).includes(q) ? 0 : 1);
    list = placeIndex().filter(({ hay }) => words.every((w) => hay.includes(w)) || hay.replace(/ /g, '').includes(compact))
      .map((x) => x.p).sort((a, b) => nameHit(a) - nameHit(b));
  } else {
    list = S.placeList.filter((p) => P.city === 'all' || p.city === P.city);
  }
  $('#pl-count').textContent = `${list.length} place${list.length === 1 ? '' : 's'}`;

  if (!list.length) {
    $('#pl-list').innerHTML = `<div class="pl-empty"><p><b>No places match “${esc(P.query)}”.</b></p><p>Try an English or Chinese name, a city, or a word like “noodles” or “park”.</p></div>`;
    return;
  }
  const groups = [];
  for (const c of S.trip.cityOrder) {
    const items = list.filter((p) => p.city === c)
      .sort((a, b) => (a.category === 'hotel' ? -1 : 0) - (b.category === 'hotel' ? -1 : 0));
    if (items.length) groups.push([c, items]);
  }
  const extra = list.filter((p) => !S.trip.cityOrder.includes(p.city));
  if (extra.length) groups.push(['Other', extra]);

  $('#pl-list').innerHTML = (searching ? `<p class="pl-hint">Searching all cities</p>` : '') + groups.map(([c, items]) => `
    <section class="pl-group">
      <h2 class="pl-city" style="--c:${cityColor(c)}"><span class="dot"></span>${esc(c)} <span class="zh">${esc(cityInfo(c).zh || '')}</span><span class="n">${items.length}</span></h2>
      <div class="card pl-card">${items.map(placeRowHTML).join('')}</div>
    </section>`).join('');
}

function placeRowHTML(p) {
  const kind = CAT_KIND[p.category] || 'destination';
  const first = (p.visits || [])[0];
  const when = p.category === 'hotel' ? 'Our hotel' : (first ? fmtDay(first.date).replace(',', '') : '');
  return `<button class="pl-row k-${kind}" data-place="${p.id}">
    <span class="pl-icon">${icon(CAT_ICON[p.category] || 'pin')}</span>
    <span class="pl-body">
      <span class="pl-name">${esc(p.name)}</span>
      ${p.nameZh ? `<span class="pl-zh" lang="zh-CN">${esc(p.nameZh)}</span>` : ''}
      <span class="pl-meta">${esc(CAT_LABEL[p.category] || 'Place')}${when ? ` · ${esc(when)}` : ''}</span>
      ${teaser(p) ? `<span class="pl-teaser">${esc(teaser(p))}</span>` : ''}
    </span>
    ${icon('chevron')}
  </button>`;
}

// ---------------------------------------------------------------- overview
const shortDay = (iso) => { const d = toDate(iso); return `${MO[d.getMonth()]} ${d.getDate()}`; };
const nightsBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000);

function cityOnNight(traveler, date) {
  let city = null;
  for (const s of S.trip.stays) {
    if (s.who && !s.who.includes(traveler)) continue;
    const own = (s.datesFor || {})[traveler] || {};
    if ((own.checkIn || s.checkIn) <= date && date < (own.checkOut || s.checkOut)) city = s.city;
  }
  return city;
}

// One row per family: consecutive nights in the same city merged into a segment.
function timelineRows() {
  const dates = S.days.map((d) => d.date);
  return S.trip.travelers.map((t) => {
    const segs = [];
    dates.forEach((date, i) => {
      const city = cityOnNight(t.id, date);
      const last = segs[segs.length - 1];
      if (last && last.city === city) last.n++;
      else segs.push({ city, start: i, n: 1, date });
    });
    return { t, segs };
  });
}

function renderOverview() {
  const v = $('#view-overview');
  const days = S.days;
  const total = days.length;
  const rows = timelineRows();

  const ticks = days.map((d, i) => {
    const dt = toDate(d.date);
    const show = i === 0 || i === total - 1 || (dt.getDay() === 1 && i < total - 3);
    return show ? `<span class="tick" style="left:${((i + 0.5) / total) * 100}%">${shortDay(d.date)}</span>` : '';
  }).join('');

  const bars = rows.map(({ t, segs }) => `
    <div class="tb-row">
      <div class="tb-who">${esc(t.label)}</div>
      <div class="tb-track">${segs.map((sg) => `<button class="tb-seg${sg.city ? '' : ' is-travel'}" data-goto="${sg.date}"
          style="left:${(sg.start / total) * 100}%;width:${(sg.n / total) * 100}%;--c:${sg.city ? cityColor(sg.city) : 'transparent'}"
          aria-label="${esc(sg.city || 'Travelling')} from ${esc(fmtDay(sg.date))}">
          <span>${esc(sg.city ? (sg.n >= 4 ? sg.city : cityInfo(sg.city).short) : '✈︎')}</span></button>`).join('')}</div>
    </div>`).join('');

  // City list (chronological, merged across families).
  const cityStays = S.trip.stays.map((s) => {
    const alt = Object.entries(s.datesFor || {}).map(([id, d]) =>
      `${travelerLabel([id])}: ${shortDay(d.checkIn || s.checkIn)} – ${shortDay(d.checkOut || s.checkOut)}`);
    return `<button class="city-row" data-goto="${s.checkIn}">
      <span class="dot" style="--c:${cityColor(s.city)}"></span>
      <span class="city-row-body"><b>${esc(s.city)}</b> <span class="zh">${esc(cityInfo(s.city).zh || '')}</span>
        <span class="sub">${shortDay(s.checkIn)} – ${shortDay(s.checkOut)} · ${nightsBetween(s.checkIn, s.checkOut)} nights${isEveryone(s.who) ? '' : ` · ${esc(travelerLabel(s.who))}`}</span>
        ${alt.length ? `<span class="sub">${esc(alt.join(' · '))}</span>` : ''}</span>
      ${icon('chevron')}</button>`;
  }).join('');

  const legs = S.trip.legs.map(legCardHTML).join('');
  const hotels = S.trip.stays.filter((s) => S.places[s.hotelPlaceId]).map(hotelCardHTML).join('');

  v.innerHTML = `
    <header class="head"><div class="head-row"><h1>Overview</h1><span class="head-sub">${esc(shortDay(days[0].date))} – ${esc(shortDay(days[total - 1].date))}</span></div></header>
    <div class="page">
      <h2 class="ov-h">Where we are</h2>
      <div class="card tb">
        <div class="tb-ticks">${ticks}</div>
        ${bars}
      </div>
      <div class="card city-list">${cityStays}</div>

      <h2 class="ov-h">Getting around</h2>
      <div class="legs">${legs}</div>
      <p class="tz-note">Hong Kong and mainland China are both UTC+8, 16 hours ahead of San Francisco in December. All times are local.</p>

      <h2 class="ov-h">Hotels</h2>
      <div class="hotels">${hotels}</div>

      <p class="footnote">Data updated ${esc(updatedText())}</p>
    </div>`;
  v.addEventListener('click', (e) => {
    const go = e.target.closest('[data-goto]');
    if (go) { location.hash = `#itinerary/${go.dataset.goto}`; return; }
    handleCommonClick(e);
  });
}

function legCardHTML(l) {
  const [ic, label] = MODE[l.mode] || MODE.tbd;
  const a = clock(l.depart.time), b = clock(l.arrive.time);
  const tz = (c) => cityInfo(c).tzLabel || '';
  const nextDay = l.arrive.date !== l.depart.date;
  const times = a ? `
    <div class="leg-times">
      <div><span class="k">Depart</span><b>${a.t} <small>${a.ap}</small></b><span class="tz">${esc(tz(l.from))} · ${esc(shortDay(l.depart.date))}</span></div>
      <div class="leg-arrow">${icon('chevron')}</div>
      <div><span class="k">Arrive</span><b>${b ? `${b.t} <small>${b.ap}</small>` : '—'}</b><span class="tz">${esc(tz(l.to))} · ${esc(shortDay(l.arrive.date))}${nextDay ? ' <em>+1 day</em>' : ''}</span></div>
    </div>` : `<div class="leg-when">${esc(l.timeLabel || 'Time TBD')}</div>`;
  return `<article class="card leg">
    <div class="leg-top">
      <span class="leg-icon">${icon(ic)}</span>
      <span class="leg-mode">${esc(label)}</span>
      <button class="leg-date" data-goto="${l.date}">${esc(fmtDay(l.date))}${icon('chevron')}</button>
    </div>
    <div class="leg-route">${esc(l.from)} <span class="arr">→</span> ${esc(l.to || '')}</div>
    ${times}
    ${l.extra ? `<div class="leg-extra">${esc(l.extra)}</div>` : ''}
    ${l.note ? `<div class="leg-note">${esc(l.note)}</div>` : ''}
    ${isEveryone(l.who) ? '' : `<div class="who">${icon('people')}${esc(travelerLabel(l.who))} only</div>`}
  </article>`;
}

function hotelCardHTML(s) {
  const p = S.places[s.hotelPlaceId];
  const inT = clock(s.checkInTime), outT = clock(s.checkOutTime);
  const alt = Object.entries(s.datesFor || {}).map(([id, d]) =>
    `<div class="who">${icon('people')}${esc(travelerLabel([id]))}: ${esc(shortDay(d.checkIn || s.checkIn))} – ${esc(shortDay(d.checkOut || s.checkOut))}</div>`).join('');
  return `<article class="card hotel" style="--c:${cityColor(s.city)}">
    <div class="hotel-city"><span class="dot"></span>${esc(s.city)} · ${nightsBetween(s.checkIn, s.checkOut)} nights</div>
    <button class="hotel-name" data-place="${p.id}">${esc(p.name)}</button>
    ${p.nameZh ? `<div class="hotel-zh" lang="zh-CN">${esc(p.nameZh)}</div>` : ''}
    ${p.addressZh || p.address ? `<div class="hotel-addr">${esc(p.addressZh || p.address)}</div>` : ''}
    <div class="hotel-dates">
      <div><span class="k">Check-in</span><b>${esc(fmtDay(s.checkIn))}</b>${inT ? `<span>${inT.t} ${inT.ap}</span>` : ''}</div>
      <div><span class="k">Check-out</span><b>${esc(fmtDay(s.checkOut))}</b>${outT ? `<span>${outT.t} ${outT.ap}</span>` : ''}</div>
    </div>
    ${alt}
    ${p.phone ? `<a class="hotel-phone" href="tel:${esc(p.phone)}">${esc(p.phone)}</a>` : ''}
    <div class="actions">
      <a class="btn primary" href="${appleMapsURL(p)}" target="_blank" rel="noopener">${icon('nav')}Navigate</a>
      <button class="btn" data-driver="${p.id}">${icon('driver')}Show to taxi driver</button>
    </div>
  </article>`;
}

// ---------------------------------------------------------------- offline + updates
function showToast(html, onTap) {
  const t = $('#toast');
  t.innerHTML = html;
  t.hidden = false;
  t.onclick = onTap || (() => { t.hidden = true; });
}

function setupOffline() {
  const offlineNote = () => {
    if (!navigator.onLine) showToast('<b>Offline</b> · showing saved trip info');
    else if ($('#toast').textContent.startsWith('Offline')) $('#toast').hidden = true;
  };
  window.addEventListener('online', offlineNote);
  window.addEventListener('offline', offlineNote);
  offlineNote();
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  let shown = false;
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type !== 'updated' || shown) return;
    shown = true;
    showToast('<b>Trip info updated</b> · Tap to refresh', () => location.reload());
  });
}

// ---------------------------------------------------------------- boot
async function boot() {
  try {
    await load();
  } catch (err) {
    $('#loading').textContent = 'Could not load trip data. Check your connection and reopen the app.';
    return;
  }
  renderItineraryShell();
  renderPlacesShell();
  renderOverview();
  setupSheet();
  $('#driver').addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeDriver(); });
  window.addEventListener('hashchange', route);
  route();
  $('#loading').remove();
  setupOffline();
}

boot();
