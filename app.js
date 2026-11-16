'use strict';
// Continents & Oceans Kids for Windows: port of the SwiftUI iOS app (ages 6–8).
// Hard paywall: everything is unlocked by one Microsoft Store durable add-on, checked via the Digital Goods API.

// MARK: - Config

const APP_VERSION = '1.0.0';
const BILLING = 'https://store.microsoft.com/billing';
// Partner Center add-on Product ID (InAppOfferToken). Must match Partner Center exactly.
const PRODUCTS = { lifetime: 'cok_lifetime' };
const PRODUCT_ORDER = [PRODUCTS.lifetime];
const STORE_ID = '';
const LINKS = {
  base: 'https://joykhansayan1.github.io/continents-oceans-kids-windows',
  get privacy() { return this.base + '/privacy.html'; },
  get terms() { return this.base + '/terms.html'; },
  get support() { return this.base + '/support.html'; },
  store: STORE_ID ? `https://apps.microsoft.com/detail/${STORE_ID}` : 'https://apps.microsoft.com/search?query=Continents%20%26%20Oceans%20Kids'
};
const SPRINT_SECONDS = 60;
const ANIMAL_ROUND = 8;
// Screenshot/demo mode: only on a local dev host so the paywall can't be bypassed from the public site.
const IS_LOCAL = ['localhost', '127.0.0.1'].includes(location.hostname);
const PARAMS = new URLSearchParams(location.search);
const DEMO = IS_LOCAL && PARAMS.has('demo');

const REGIONS = CONTENT.regions;
const CONTINENTS = REGIONS.filter((r) => r.kind === 'continent');
const OCEANS = REGIONS.filter((r) => r.kind === 'ocean');
const region = (id) => REGIONS.find((r) => r.id === id) || REGIONS[0];
const label = (r) => r.shortName || r.name;

// MARK: - Helpers

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const DAY = 86400000;
const starsHTML = (n, size = 28) => [0, 1, 2].map((i) => `<span class="star ${i < n ? 'on' : ''}" style="font-size:${size}px">★</span>`).join('');

// MARK: - Progress (stars, puzzles, stickers)

const PROGRESS_KEY = 'cok.progress.v1';
const P = {
  data: { onboarded: false, explored: [], levels: [], quizStars: {}, sprintBest: 0, animalRounds: 0, animalPerfect: false, sound: true, readAloud: true },
  load() {
    try { Object.assign(this.data, JSON.parse(lsGet(PROGRESS_KEY) || '{}')); } catch { /* ignore */ }
    if (DEMO) Object.assign(this.data, { onboarded: true, explored: ['asia', 'africa', 'europe', 'north-america', 'south-america', 'australia', 'antarctica', 'pacific', 'atlantic'], levels: [1, 2, 3, 4, 5], quizStars: { 'find-continents': 3, 'find-oceans': 2, 'fun-facts': 3 }, sprintBest: 14, animalRounds: 2 });
  },
  save() { if (!DEMO) lsSet(PROGRESS_KEY, JSON.stringify(this.data)); },
  explore(id) { if (!this.data.explored.includes(id)) { this.data.explored.push(id); this.save(); } },
  completeLevel(id) { if (!this.data.levels.includes(id)) { this.data.levels.push(id); this.save(); } },
  setStars(quiz, n) { if ((this.data.quizStars[quiz] || 0) < n) { this.data.quizStars[quiz] = n; this.save(); } },
  stars(quiz) { return this.data.quizStars[quiz] || 0; },
  get totalStars() { return Object.values(this.data.quizStars).reduce((a, b) => a + b, 0); },
  stickerEarned(id) {
    const d = this.data, all = (list) => list.every((r) => d.explored.includes(r.id));
    return {
      'first-step': d.explored.length > 0, continents: all(CONTINENTS), oceans: all(OCEANS),
      'puzzle-1': d.levels.length > 0, 'all-land': d.levels.includes(4), 'all-oceans': d.levels.includes(7),
      'whole-world': d.levels.length >= CONTENT.levels.length,
      'quiz-whiz': CONTENT.quizzes.some((q) => this.stars(q.id) >= 3), 'quiz-champ': CONTENT.quizzes.every((q) => this.stars(q.id) >= 3),
      speedy: d.sprintBest >= 10, 'animal-friend': d.animalRounds > 0, 'animal-expert': d.animalPerfect
    }[id] || false;
  },
  get stickerCount() { return CONTENT.stickers.filter((s) => this.stickerEarned(s.id)).length; },
  reset() { Object.assign(this.data, { explored: [], levels: [], quizStars: {}, sprintBest: 0, animalRounds: 0, animalPerfect: false }); this.save(); }
};

// MARK: - Sound & read-aloud

const Sound = {
  clips: {},
  play(name) {
    if (!P.data.sound || DEMO) return;
    try { const a = this.clips[name] || (this.clips[name] = new Audio(`audio/ui_${name}.wav`)); a.currentTime = 0; a.play().catch(() => {}); } catch { /* ignore */ }
  },
  say(text, force = false) {
    if ((!P.data.readAloud && !force) || DEMO || !('speechSynthesis' in window)) return;
    try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.rate = 0.9; u.pitch = 1.1; speechSynthesis.speak(u); } catch { /* ignore */ }
  },
  stop() { try { speechSynthesis.cancel(); } catch { /* ignore */ } }
};

// MARK: - Microsoft Store purchases (Digital Goods API)

const ENT_KEY = 'cok.entitlement.v1';
const Store = {
  service: null, available: false, loaded: false, details: [], owned: new Set(), error: null,
  async init() {
    if (DEMO) { this.owned = new Set(['demo']); this.loaded = true; return; }
    if (typeof window.getDigitalGoodsService === 'function') {
      try { this.service = await window.getDigitalGoodsService(BILLING); this.available = true; }
      catch { this.available = false; }
    }
    if (this.available) { await this.fetchProducts(); await this.refresh(); }
    this.loaded = true;
  },
  async fetchProducts() {
    try {
      const list = await this.service.getDetails(PRODUCT_ORDER);
      this.details = PRODUCT_ORDER.map((id) => list.find((d) => d.itemId === id)).filter(Boolean);
      this.error = null;
    } catch { this.error = "Couldn't load the price. Check your connection and try again."; }
  },
  async refresh() {
    try {
      const purchases = await this.service.listPurchases();
      this.owned = new Set(purchases.map((p) => p.itemId).filter((id) => PRODUCT_ORDER.includes(id)));
      lsSet(ENT_KEY, JSON.stringify({ ids: [...this.owned], at: Date.now() }));
    } catch {
      // Store unreachable: honour the last known entitlement (a one-time purchase), so the app works offline.
      try { const c = JSON.parse(lsGet(ENT_KEY) || 'null'); if (c) this.owned = new Set(c.ids); } catch { /* ignore */ }
    }
  },
  async purchase() {
    this.error = null;
    try {
      const request = new PaymentRequest([{ supportedMethods: BILLING, data: { sku: PRODUCTS.lifetime } }],
        { total: { label: 'Total', amount: { currency: 'USD', value: '0' } } });
      const response = await request.show();
      try { await response.complete('success'); } catch { /* not required by Store billing */ }
    } catch (e) {
      if (e && e.name === 'AbortError') return false;
      this.error = 'Purchase failed: ' + (e && e.message ? e.message : 'please try again.');
      return false;
    }
    await this.refresh();
    return this.unlocked;
  },
  async restore() {
    this.error = null;
    if (!this.available) { this.error = 'Install the app from the Microsoft Store to restore your purchase.'; return; }
    await this.refresh();
    if (!this.unlocked) this.error = 'No previous purchase was found for this Microsoft account.';
  },
  get unlocked() { return this.owned.size > 0; },
  get price() {
    const d = this.details[0];
    if (DEMO) return '$4.99';
    if (!d || !d.price) return '';
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: d.price.currency }).format(Number(d.price.value)); }
    catch { return `${d.price.value} ${d.price.currency}`; }
  }
};

// MARK: - World map (SVG, normalized 0–1 coordinates)

const MAP_W = 1000, MAP_H = 620;
const px = ([x, y]) => [Math.round(x * MAP_W), Math.round(y * MAP_H)];
const polyPoints = (r) => r.outline.map((p) => px(p).join(',')).join(' ');
/**
 * opts.show: ids drawn in full colour; opts.ghost: ids drawn as grey outlines (puzzle targets);
 * opts.tap: tappable ids (data-act=tapAct); opts.glow: id to highlight; opts.labels: show names.
 */
function mapSVG(opts = {}) {
  const show = new Set(opts.show ?? REGIONS.map((r) => r.id)), ghost = new Set(opts.ghost || []), tap = new Set(opts.tap || []);
  const act = opts.tapAct || 'map-tap';
  const parts = [];
  for (const r of CONTINENTS) {
    const on = show.has(r.id), gh = ghost.has(r.id) && !on;
    if (!on && !gh && !tap.has(r.id)) continue;
    const cls = ['land', on ? 'on' : gh ? 'ghost' : 'blank', tap.has(r.id) ? 'tap' : '', opts.glow === r.id ? 'glow' : ''].join(' ');
    parts.push(`<polygon class="${cls}" points="${polyPoints(r)}" style="--c:${r.color}" ${tap.has(r.id) ? `data-act="${act}" data-arg="${r.id}" role="button" tabindex="0" aria-label="${esc(r.name)}"` : ''}><title>${esc(r.name)}</title></polygon>`);
  }
  for (const r of OCEANS) {
    const on = show.has(r.id), gh = ghost.has(r.id) && !on;
    if (!on && !gh && !tap.has(r.id)) continue;
    const rad = r.id === 'arctic' ? 30 : 46, [cx, cy0] = px(r.center), cy = Math.max(cy0, rad + 6);
    const cls = ['sea', on ? 'on' : gh ? 'ghost' : 'blank', tap.has(r.id) ? 'tap' : '', opts.glow === r.id ? 'glow' : ''].join(' ');
    parts.push(`<circle class="${cls}" cx="${cx}" cy="${cy}" r="${rad}" style="--c:${r.color}" ${tap.has(r.id) ? `data-act="${act}" data-arg="${r.id}" role="button" tabindex="0" aria-label="${esc(r.name)}"` : ''}><title>${esc(r.name)}</title></circle>`);
  }
  if (opts.labels !== false) {
    for (const r of REGIONS) {
      if (!show.has(r.id)) continue;
      const [cx, cy0] = px(r.center), cy = r.kind === 'ocean' ? Math.max(cy0, (r.id === 'arctic' ? 30 : 46) + 6) : cy0;
      parts.push(`<text class="maplabel" x="${cx}" y="${cy + (r.kind === 'ocean' ? 6 : 8)}" text-anchor="middle">${esc(label(r))}</text>`);
    }
  }
  return `<svg class="worldmap" viewBox="0 0 ${MAP_W} ${MAP_H}" preserveAspectRatio="xMidYMid meet" aria-label="World map">
    <defs><linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5BBFF9"/><stop offset="1" stop-color="#2178E6"/></linearGradient></defs>
    <rect x="0" y="0" width="${MAP_W}" height="${MAP_H}" rx="28" fill="url(#sea)"/>${parts.join('')}</svg>`;
}

// MARK: - Router & rendering

let route = 'home', routeArg = null;
function go(r, arg = null) { Sound.stop(); route = r; routeArg = arg; render(); window.scrollTo(0, 0); }

function render() {
  const app = $('#app');
  if (!Store.loaded) { app.innerHTML = `<div class="splash"><div class="globe">🌍</div><h1>Continents &amp; Oceans</h1><div class="spinner"></div></div>`; return; }
  if (!Store.unlocked) {
    app.innerHTML = (!P.data.onboarded || route === 'onboarding') ? Onboarding.view() : Paywall.view();
    return;
  }
  const views = { home: homeView, explore: exploreView, detail: detailView, puzzles: puzzleListView, puzzle: Puzzle.view.bind(Puzzle), quizzes: quizListView, quiz: Quiz.view.bind(Quiz), animals: Animals.view.bind(Animals), sprint: Sprint.view.bind(Sprint), stickers: stickersView, grownups: Grown.view.bind(Grown) };
  app.innerHTML = (views[route] || homeView)();
  if (route === 'puzzle') Puzzle.mount();
}

const topBar = (title, back = 'home', extra = '') => `<header class="top"><button class="round" data-act="nav" data-arg="${back}" aria-label="Back">‹</button><h1>${title}</h1><div class="top-extra">${extra}</div></header>`;

// MARK: - Onboarding & paywall

const Onboarding = {
  step: 0,
  view() {
    if (this.step === 0) return `<main class="center-screen"><div class="big-emoji">🌍</div><h1 class="title">Welcome, Explorer!</h1>
      <p class="lead">Let's discover the 7 continents and 5 oceans<br>with puzzles, animals, and quizzes.</p>
      <button class="btn sun" data-act="ob-next">Let's go! →</button></main>`;
    return `<main class="center-screen"><div class="big-emoji">🧭</div><h1 class="title">Your world adventure is ready!</h1>
      <div class="feature-row">${[['🧩', 'Map puzzles'], ['🌍', '12 places to explore'], ['⭐️', 'Quizzes & stars'], ['🦘', 'Animal homes']].map(([e, t]) => `<div class="feature-pill"><span>${e}</span>${t}</div>`).join('')}</div>
      <button class="btn sun" data-act="ob-done">Start exploring →</button></main>`;
  }
};

const Paywall = {
  busy: false, gate: false,
  view() {
    const price = Store.price;
    let cta;
    if (!Store.available) cta = `<p class="note">Purchases are handled by the Microsoft Store. Install Continents &amp; Oceans Kids from the Microsoft Store on Windows to unlock everything.</p><a class="btn sun" href="${LINKS.store}" target="_blank" rel="noopener">Get it from Microsoft Store</a>`;
    else if (!Store.details.length) cta = Store.error ? `<p class="error">${esc(Store.error)}</p><button class="btn" data-act="pw-reload">Try again</button>` : `<div class="spinner"></div>`;
    else cta = `<button class="btn sun" data-act="pw-buy" ${this.busy ? 'disabled' : ''}>${this.busy ? 'Please wait…' : '🔓 Unlock Everything'}</button>
      <p class="note">One-time purchase • ${esc(price)}. Pay once, keep it forever. No subscription. No ads.</p>`;
    return `<main class="center-screen paywall">
      <div class="big-emoji">🌍</div><h1 class="title">Continents &amp; Oceans Kids</h1>
      <p class="lead">Drag the continents, discover the oceans,<br>and become a world map explorer!</p>
      <div class="card pw-map">${mapSVG({ labels: true })}</div>
      <div class="feature-row">${[['🧩', '8 map puzzles'], ['🌍', '7 continents + 5 oceans'], ['⭐️', '4 quizzes · 32 questions'], ['🦘', 'Animal Homes & Globe Sprint'], ['🏅', '12 stickers to collect']].map(([e, t]) => `<div class="feature-pill"><span>${e}</span>${t}</div>`).join('')}</div>
      ${cta}
      ${Store.error && Store.details.length ? `<p class="error">${esc(Store.error)}</p>` : ''}
      <div class="small-links">${Store.available ? '<button class="linkbtn" data-act="pw-restore">Restore Purchase</button> · ' : ''}<a href="${LINKS.terms}" target="_blank" rel="noopener">Terms of Use</a> · <a href="${LINKS.privacy}" target="_blank" rel="noopener">Privacy Policy</a></div>
      <p class="tiny">Purchases are protected by a grown-up check. Payment is charged to the Microsoft account.</p>
      ${this.gate ? Gate.view('pw-gate-ok', 'pw-gate-cancel') : ''}
    </main>`;
  }
};

// Parental gate: simple multiplication a young child can't answer by guessing.
const Gate = {
  a: 0, b: 0, wrong: false,
  fresh() { this.a = 3 + Math.floor(Math.random() * 7); this.b = 3 + Math.floor(Math.random() * 7); this.wrong = false; },
  view(okAct, cancelAct) {
    return `<div class="modal-back"><div class="modal"><h2>👨‍👩‍👧 Ask a Grown-Up</h2><p>This area is for parents.<br>Please solve to continue:</p>
      <div class="gate-q">What is ${this.a} × ${this.b}?</div>
      <input id="gate-input" class="gate-input" inputmode="numeric" autocomplete="off" aria-label="Answer">
      ${this.wrong ? '<p class="error">That\'s not right — try again!</p>' : ''}
      <div class="row-btns"><button class="btn ghostbtn" data-act="${cancelAct}">Cancel</button><button class="btn sun" data-act="${okAct}">Continue</button></div></div></div>`;
  },
  check() { const v = Number(($('#gate-input') || {}).value); const ok = v === this.a * this.b; this.wrong = !ok; return ok; }
};

// MARK: - Home

function homeView() {
  const d = P.data;
  const card = (emoji, title, sub, act, arg, color) => `<button class="menu-card" style="--c:${color}" data-act="${act}" data-arg="${arg}"><span class="menu-emoji">${emoji}</span><span class="menu-title">${title}</span><span class="menu-sub">${sub}</span></button>`;
  return `<main class="page">
    <header class="hero"><div><h1>Continents &amp; Oceans</h1><div class="hero-sub"><span class="star on">★</span> ${P.totalStars} stars earned</div></div>
      <button class="pill-btn" data-act="nav" data-arg="grownups">👨‍👩‍👧 Grown-Ups</button></header>
    <div class="menu-grid">
      ${card('🌍', 'Explore World', `${d.explored.length} of ${REGIONS.length} discovered`, 'nav', 'explore', '#4CC06B')}
      ${card('🧩', 'Map Puzzles', `${d.levels.length} of ${CONTENT.levels.length} done`, 'nav', 'puzzles', '#FFC733')}
      ${card('⭐️', 'Quizzes', `Earn stars in ${CONTENT.quizzes.length} quizzes`, 'nav', 'quizzes', '#9470E6')}
      ${card('🦘', 'Animal Homes', 'Who lives where?', 'start-animals', '', '#FF736B')}
      ${card('⏱️', 'Globe Sprint', d.sprintBest ? `Best: ${d.sprintBest}` : 'A fun speedy game', 'nav', 'sprint', '#3FA8F2')}
      ${card('🏅', 'Sticker Book', `${P.stickerCount} of ${CONTENT.stickers.length} collected`, 'nav', 'stickers', '#F59E0B')}
    </div></main>`;
}

// MARK: - Explore

function exploreView() {
  const tile = (r) => `<button class="region-tile ${P.data.explored.includes(r.id) ? 'seen' : ''}" style="--c:${r.color}" data-act="nav" data-arg="detail:${r.id}">
    <span class="tile-emoji">${r.emoji}</span><span class="tile-name">${esc(r.name)}</span><span class="tile-sub">${esc(r.sizeRank)}</span>${P.data.explored.includes(r.id) ? '<span class="tick">✓</span>' : ''}</button>`;
  return `<main class="page">${topBar('Explore World')}
    <div class="card map-card">${mapSVG({ tap: REGIONS.map((r) => r.id), tapAct: 'explore-tap' })}</div>
    <h2 class="section">🗺️ 7 Continents</h2><div class="tile-grid">${CONTINENTS.map(tile).join('')}</div>
    <h2 class="section">🌊 5 Oceans</h2><div class="tile-grid">${OCEANS.map(tile).join('')}</div></main>`;
}

function detailView() {
  const r = region(routeArg);
  P.explore(r.id);
  return `<main class="page">${topBar(`${r.emoji} ${esc(r.name)}`, 'explore', `<button class="round" data-act="say-region" data-arg="${r.id}" aria-label="Read aloud">🔊</button>`)}
    <div class="detail-head" style="--c:${r.color}"><span class="detail-emoji">${r.emoji}</span><div><div class="badge">${esc(r.sizeRank)}</div><h2>${esc(r.name)}</h2></div></div>
    <div class="card map-card">${mapSVG({ show: REGIONS.map((x) => x.id), glow: r.id, labels: false })}</div>
    <div class="card"><h3>Did you know?</h3><ul class="facts">${r.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></div>
    <div class="card fun"><h3>💡 Fun fact!</h3><p>${esc(r.funFact)}</p></div>
    <div class="card"><h3>🐾 Animals</h3><p>${esc(r.animals)}</p></div></main>`;
}

// MARK: - Puzzles (drag pieces onto the map, or tap a piece then its spot)

function puzzleListView() {
  return `<main class="page">${topBar('Map Puzzles')}<div class="level-list">
    ${CONTENT.levels.map((l) => `<button class="level ${P.data.levels.includes(l.id) ? 'done' : ''}" data-act="nav" data-arg="puzzle:${l.id}">
      <span class="level-num">${P.data.levels.includes(l.id) ? '✓' : l.id}</span><span class="level-text"><b>${esc(l.title)}</b><span>${esc(l.subtitle)}</span></span>
      <span class="level-pieces">${l.regions.map((id) => region(id).emoji).join('')}</span></button>`).join('')}</div></main>`;
}

const Puzzle = {
  level: null, placed: [], selected: null, msg: '', drag: null,
  start(id) { this.level = CONTENT.levels.find((l) => l.id === Number(id)) || CONTENT.levels[0]; this.placed = []; this.selected = null; this.msg = 'Drag each piece to its place on the map!'; if (DEMO) this.placed = this.level.regions.slice(0, Math.ceil(this.level.regions.length / 2)); },
  get done() { return this.level && this.placed.length === this.level.regions.length; },
  view() {
    if (!this.level) this.start(routeArg || 1);
    const l = this.level, left = l.regions.filter((id) => !this.placed.includes(id));
    if (this.done) {
      return `<main class="page">${topBar(esc(l.title), 'puzzles')}<div class="card map-card">${mapSVG({ show: l.regions })}</div>
        ${celebrate('Puzzle complete!', 'You put every piece in the right place!', 3, `<button class="btn sun" data-act="nav" data-arg="puzzles">More puzzles</button>${l.id < CONTENT.levels.length ? `<button class="btn" data-act="nav" data-arg="puzzle:${l.id + 1}">Next level →</button>` : ''}`)}</main>`;
    }
    return `<main class="page">${topBar(esc(l.title), 'puzzles', `<span class="count">${this.placed.length}/${l.regions.length}</span>`)}
      <p class="prompt">${esc(this.msg)}</p>
      <div class="card map-card" id="puzzle-map">${mapSVG({ show: this.placed, ghost: l.regions, tap: left, tapAct: 'pz-target', labels: true })}</div>
      <div class="tray">${left.map((id) => { const r = region(id); return `<button class="piece ${this.selected === id ? 'sel' : ''}" style="--c:${r.color}" data-piece="${id}" data-act="pz-pick" data-arg="${id}"><span>${r.emoji}</span>${esc(r.name)}</button>`; }).join('')}</div></main>`;
  },
  tryPlace(pieceId, targetId) {
    const r = region(pieceId);
    if (pieceId === targetId) {
      this.placed.push(pieceId); this.selected = null; Sound.play('correct');
      this.msg = `Yes! That's ${r.name}! ${r.emoji}`; Sound.say(`${r.name}!`);
      if (this.done) { P.completeLevel(this.level.id); Sound.play('cheer'); }
    } else {
      Sound.play('soft');
      this.msg = targetId ? `That spot is ${region(targetId).name}. Try again!` : `Almost! Try another spot for ${r.name}.`;
    }
    render();
  },
  // Pointer drag: pieces follow the pointer; dropping over a region's spot tries to place it.
  mount() {
    document.querySelectorAll('.piece').forEach((el) => {
      el.addEventListener('pointerdown', (e) => {
        const id = el.dataset.piece;
        this.drag = { id, x0: e.clientX, y0: e.clientY, moved: false, ghost: null };
        el.setPointerCapture(e.pointerId);
      });
      el.addEventListener('pointermove', (e) => {
        const d = this.drag; if (!d) return;
        if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 8) {
          d.moved = true; d.ghost = el.cloneNode(true); d.ghost.classList.add('dragging'); document.body.appendChild(d.ghost); el.style.opacity = '0.3';
        }
        if (d.ghost) { d.ghost.style.left = e.clientX + 'px'; d.ghost.style.top = e.clientY + 'px'; }
      });
      el.addEventListener('pointerup', (e) => {
        const d = this.drag; this.drag = null; if (!d) return;
        if (d.ghost) d.ghost.remove();
        if (!d.moved) return; // a plain tap is handled by the click action (select the piece)
        el.dataset.dragged = '1';
        const map = $('#puzzle-map svg');
        if (!map) { render(); return; }
        const box = map.getBoundingClientRect(), scale = Math.min(box.width / MAP_W, box.height / MAP_H);
        const ox = box.left + (box.width - MAP_W * scale) / 2, oy = box.top + (box.height - MAP_H * scale) / 2;
        const nx = (e.clientX - ox) / (MAP_W * scale), ny = (e.clientY - oy) / (MAP_H * scale);
        if (nx < 0 || ny < 0 || nx > 1 || ny > 1) { render(); return; }
        const open = this.level.regions.filter((id) => !this.placed.includes(id));
        const hit = open.map((id) => ({ id, dist: Math.hypot(region(id).center[0] - nx, (region(id).center[1] - ny) * MAP_H / MAP_W) }))
          .sort((a, b) => a.dist - b.dist)[0];
        this.tryPlace(d.id, hit && hit.dist < 0.12 ? hit.id : null);
      });
    });
  }
};

// MARK: - Quizzes

function quizListView() {
  return `<main class="page">${topBar('Quizzes')}<div class="level-list">
    ${CONTENT.quizzes.map((q) => `<button class="level" data-act="start-quiz" data-arg="${q.id}"><span class="level-num emoji">${q.emoji}</span>
      <span class="level-text"><b>${esc(q.title)}</b><span>${q.questions.length} questions</span></span><span class="level-stars">${starsHTML(P.stars(q.id), 24)}</span></button>`).join('')}</div></main>`;
}

const starsFor = (good, total) => { const r = total ? good / total : 0; return r >= 0.9 ? 3 : r >= 0.6 ? 2 : 1; };

function celebrate(title, msg, stars, buttons) {
  return `<div class="card celebrate"><div class="big-emoji">🎉</div><h2>${esc(title)}</h2><div class="stars-big">${starsHTML(stars, 44)}</div><p>${esc(msg)}</p><div class="row-btns">${buttons}</div></div>`;
}

const Quiz = {
  quiz: null, i: 0, correct: 0, tries: 0, answered: false, feedback: '', glow: null, picked: null,
  start(id) { this.quiz = CONTENT.quizzes.find((q) => q.id === id) || CONTENT.quizzes[0]; Object.assign(this, { i: 0, correct: 0, tries: 0, answered: false, feedback: '', glow: null, picked: null }); Sound.say(this.q.prompt); },
  get q() { return this.quiz.questions[this.i]; },
  get finished() { return this.i >= this.quiz.questions.length; },
  view() {
    if (!this.quiz) this.start(routeArg);
    const qz = this.quiz;
    if (this.finished) {
      const s = starsFor(this.correct, qz.questions.length);
      return `<main class="page">${topBar(esc(qz.title), 'quizzes')}${celebrate('Quiz complete!', `You got ${this.correct} of ${qz.questions.length} right!`, s, `<button class="btn" data-act="start-quiz" data-arg="${qz.id}">Play again</button><button class="btn sun" data-act="nav" data-arg="quizzes">More quizzes</button>`)}</main>`;
    }
    const q = this.q;
    const dots = qz.questions.map((_, k) => `<span class="dot ${k < this.i ? 'done' : k === this.i ? 'now' : ''}"></span>`).join('');
    let body;
    if (q.map) {
      body = `<div class="card map-card">${mapSVG({ tap: this.answered ? [] : REGIONS.map((r) => r.id), tapAct: 'quiz-map', glow: this.glow, labels: false })}</div>`;
    } else {
      body = `<div class="options">${q.options.map((o, k) => {
        const cls = this.answered ? (k === q.correct ? 'right' : k === this.picked ? 'wrong' : '') : (k === this.picked ? 'wrong' : '');
        return `<button class="option ${cls}" data-act="quiz-opt" data-arg="${k}" ${this.answered ? 'disabled' : ''}>${esc(o)}</button>`;
      }).join('')}</div>`;
    }
    return `<main class="page">${topBar(esc(qz.title), 'quizzes', `<button class="round" data-act="say-q" aria-label="Read aloud">🔊</button>`)}
      <div class="dots">${dots}</div><p class="prompt big">${esc(q.prompt)}</p>${body}
      ${this.feedback ? `<p class="feedback ${this.answered ? 'good' : 'soft'}">${esc(this.feedback)}</p>` : ''}
      ${this.answered ? `<button class="btn sun" data-act="quiz-next">${this.i + 1 < qz.questions.length ? 'Next →' : 'See my stars ⭐️'}</button>` : ''}</main>`;
  },
  answer(ok, wrongName) {
    if (ok) {
      if (this.tries === 0) this.correct++;
      this.answered = true; this.feedback = ['Great job! 🎉', 'You got it! ⭐️', 'Super explorer! 🌍'][Math.floor(Math.random() * 3)];
      Sound.play('correct'); Sound.say(this.feedback.replace(/[^\w\s!']/g, ''));
    } else {
      this.tries++; Sound.play('soft');
      this.feedback = (wrongName ? `That's ${wrongName}. ` : 'Not quite. ') + `Hint: ${this.q.hint}`;
      if (this.tries >= 2 && this.q.map) this.glow = this.q.map;
    }
    render();
  },
  next() {
    this.i++; Object.assign(this, { tries: 0, answered: false, feedback: '', glow: null, picked: null });
    if (this.finished) { P.setStars(this.quiz.id, starsFor(this.correct, this.quiz.questions.length)); Sound.play('cheer'); }
    else Sound.say(this.q.prompt);
    render();
  }
};

// MARK: - Animal Homes

const Animals = {
  round: [], i: 0, firstTry: 0, misses: 0, answered: false, feedback: '',
  start() { this.round = shuffle(CONTENT.animals).slice(0, ANIMAL_ROUND); Object.assign(this, { i: 0, firstTry: 0, misses: 0, answered: false, feedback: '' }); },
  get a() { return this.round[this.i]; },
  view() {
    if (!this.round.length) this.start();
    if (this.i >= this.round.length) {
      const s = starsFor(this.firstTry, this.round.length);
      return `<main class="page">${topBar('Animal Homes')}${celebrate('All animals home!', `You found ${this.firstTry} of ${this.round.length} homes on the first try!`, s, `<button class="btn" data-act="start-animals">Play again</button><button class="btn sun" data-act="nav" data-arg="home">Home</button>`)}</main>`;
    }
    const a = this.a, glow = (this.answered || this.misses >= 2) ? a.home : null;
    return `<main class="page">${topBar('Animal Homes', 'home', `<span class="count">${this.i + 1}/${this.round.length}</span>`)}
      <div class="animal-card"><span class="animal-emoji">${a.emoji}</span><div><b>${esc(a.name)}</b><p class="prompt big">${esc(a.prompt)}</p></div></div>
      <div class="card map-card">${mapSVG({ tap: this.answered ? [] : REGIONS.map((r) => r.id), tapAct: 'animal-tap', glow, labels: false })}</div>
      ${this.feedback ? `<p class="feedback ${this.answered ? 'good' : 'soft'}">${esc(this.feedback)}</p>` : ''}
      ${this.answered ? `<button class="btn sun" data-act="animal-next">${this.i + 1 < this.round.length ? 'Next animal →' : 'Finish 🎉'}</button>` : ''}</main>`;
  },
  tap(id) {
    const a = this.a;
    if (id === a.home) {
      if (this.misses === 0) this.firstTry++;
      this.answered = true; this.feedback = a.fact; Sound.play('correct'); Sound.say(a.fact);
    } else {
      this.misses++; Sound.play('soft');
      this.feedback = `That's ${region(id).name}. ${this.misses >= 2 ? 'Look for the glowing place!' : 'Try again!'}`;
    }
    render();
  },
  next() {
    this.i++; this.misses = 0; this.answered = false; this.feedback = '';
    if (this.i >= this.round.length) {
      P.data.animalRounds++; if (this.firstTry === this.round.length) P.data.animalPerfect = true; P.save(); Sound.play('cheer');
    } else Sound.say(this.a.prompt);
    render();
  }
};

// MARK: - Globe Sprint (gentle 60-second drill)

const Sprint = {
  running: false, timeLeft: SPRINT_SECONDS, found: 0, target: null, timer: null, flash: '',
  start() {
    this.running = true; this.timeLeft = SPRINT_SECONDS; this.found = 0; this.flash = ''; this.pick();
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (route !== 'sprint') { clearInterval(this.timer); this.running = false; return; }
      this.timeLeft--;
      if (this.timeLeft <= 0) { clearInterval(this.timer); this.running = false; if (this.found > P.data.sprintBest) { P.data.sprintBest = this.found; P.save(); } Sound.play('cheer'); }
      render();
    }, 1000);
    render();
  },
  pick() { let t; do { t = REGIONS[Math.floor(Math.random() * REGIONS.length)]; } while (this.target && t.id === this.target.id); this.target = t; Sound.say(t.name); },
  view() {
    if (DEMO && !this.running && routeArg === 'play') { this.running = true; this.timeLeft = 37; this.found = 9; this.target = region('africa'); }
    if (!this.running) {
      const ended = this.timeLeft <= 0;
      return `<main class="page">${topBar('Globe Sprint')}<div class="card celebrate"><div class="big-emoji">⏱️</div><h2>${ended ? `You found ${this.found} places!` : 'Globe Sprint'}</h2>
        <p>${ended ? (this.found >= P.data.sprintBest && this.found ? 'A new best score! 🎉' : `Your best: ${P.data.sprintBest}`) : `How many places can you find in ${SPRINT_SECONDS} seconds?<br>Just for fun — you can't lose!`}</p>
        <button class="btn sun" data-act="sprint-start">${ended ? 'Play again' : 'Start!'}</button></div></main>`;
    }
    return `<main class="page">${topBar('Globe Sprint', 'home', `<span class="count">⏱️ ${this.timeLeft}s</span>`)}
      <p class="prompt big">Tap: ${esc(this.target.name)} ${this.target.emoji}</p><p class="center-text">Found: <b>${this.found}</b>${this.flash ? ` · ${esc(this.flash)}` : ''}</p>
      <div class="card map-card">${mapSVG({ tap: REGIONS.map((r) => r.id), tapAct: 'sprint-tap', labels: false })}</div></main>`;
  },
  tap(id) {
    if (!this.running) return;
    if (id === this.target.id) { this.found++; this.flash = '✓ Yes!'; Sound.play('pop'); this.pick(); }
    else { this.flash = `That's ${region(id).name}`; Sound.play('soft'); }
    render();
  }
};

// MARK: - Sticker book

function stickersView() {
  return `<main class="page">${topBar('Sticker Book', 'home', `<span class="count">${P.stickerCount}/${CONTENT.stickers.length}</span>`)}
    <div class="sticker-grid">${CONTENT.stickers.map((s) => { const on = P.stickerEarned(s.id); return `<div class="sticker ${on ? 'on' : ''}"><span class="sticker-emoji">${on ? s.emoji : '❔'}</span><b>${esc(s.title)}</b><span>${esc(s.howTo)}</span></div>`; }).join('')}</div></main>`;
}

// MARK: - Grown-ups (behind the parental gate)

const Grown = {
  unlocked: false, busy: false, confirmReset: false,
  view() {
    if (!this.unlocked && !DEMO) return `<main class="page">${topBar('Grown-Ups')}${Gate.view('gr-gate-ok', 'nav-home')}</main>`;
    const t = (key, title) => `<label class="toggle"><span>${title}</span><input type="checkbox" data-toggle="${key}" ${P.data[key] ? 'checked' : ''}></label>`;
    return `<main class="page">${topBar('Grown-Ups')}
      <div class="card"><h3>Settings</h3>${t('sound', 'Sound effects')}${t('readAloud', 'Read aloud')}</div>
      <div class="card"><h3>Purchase</h3><p>${Store.unlocked ? '✅ Everything is unlocked. Thank you!' : 'Not unlocked yet.'}</p>
        ${Store.available ? `<button class="btn" data-act="gr-restore" ${this.busy ? 'disabled' : ''}>Restore Purchase</button>` : ''}${Store.error ? `<p class="error">${esc(Store.error)}</p>` : ''}</div>
      <div class="card"><h3>Progress</h3><p>${P.data.explored.length} places explored · ${P.data.levels.length} puzzles · ${P.totalStars} stars · ${P.stickerCount} stickers</p>
        ${this.confirmReset ? `<p>This erases all stars, puzzles, and stickers on this device. Your purchase is kept.</p><div class="row-btns"><button class="btn ghostbtn" data-act="gr-reset-cancel">Cancel</button><button class="btn danger" data-act="gr-reset-yes">Erase progress</button></div>` : '<button class="btn ghostbtn" data-act="gr-reset">Reset progress…</button>'}</div>
      <div class="card"><h3>About</h3><p>Continents &amp; Oceans Kids helps children ages 6–8 learn the 7 continents and 5 oceans. Works fully offline. No ads, no accounts, no data collected.</p>
        <p class="small-links"><a href="${LINKS.privacy}" target="_blank" rel="noopener">Privacy Policy</a> · <a href="${LINKS.terms}" target="_blank" rel="noopener">Terms of Use</a> · <a href="${LINKS.support}" target="_blank" rel="noopener">Support</a></p>
        <p class="tiny">Version ${APP_VERSION} · © 2026 MD Shahariar Nazim Joy</p></div></main>`;
  }
};

// MARK: - Actions

const ACTIONS = {
  nav: (arg) => { const [r, a] = String(arg).split(':'); if (r === 'puzzle') Puzzle.start(a); go(r, a ?? null); },
  'nav-home': () => { Grown.unlocked = false; go('home'); },
  'ob-next': () => { Onboarding.step = 1; render(); },
  'ob-done': () => { P.data.onboarded = true; P.save(); route = 'home'; render(); },
  'pw-buy': () => { Gate.fresh(); Paywall.gate = true; render(); setTimeout(() => $('#gate-input')?.focus(), 0); },
  'pw-gate-cancel': () => { Paywall.gate = false; render(); },
  'pw-gate-ok': async () => {
    if (!Gate.check()) { render(); return; }
    Paywall.gate = false; Paywall.busy = true; render();
    const ok = await Store.purchase(); Paywall.busy = false;
    if (ok) { Sound.play('cheer'); route = 'home'; }
    render();
  },
  'pw-restore': async () => { await Store.restore(); if (Store.unlocked) route = 'home'; render(); },
  'pw-reload': async () => { Store.error = null; render(); await Store.fetchProducts(); render(); },
  'gr-gate-ok': () => { if (Gate.check()) Grown.unlocked = true; render(); },
  'gr-restore': async () => { Grown.busy = true; render(); await Store.restore(); Grown.busy = false; render(); },
  'gr-reset': () => { Grown.confirmReset = true; render(); },
  'gr-reset-cancel': () => { Grown.confirmReset = false; render(); },
  'gr-reset-yes': () => { P.reset(); Grown.confirmReset = false; render(); },
  'explore-tap': (id) => go('detail', id),
  'say-region': (id) => { const r = region(id); Sound.say([r.name + '!', ...r.facts, 'Fun fact!', r.funFact].join(' '), true); },
  'pz-pick': (id, el) => { if (el && el.dataset.dragged) { delete el.dataset.dragged; return; } Puzzle.selected = Puzzle.selected === id ? null : id; Puzzle.msg = Puzzle.selected ? `Now tap where ${region(id).name} goes!` : 'Drag each piece to its place on the map!'; render(); },
  'pz-target': (id) => { if (!Puzzle.selected) { Puzzle.msg = 'First pick a piece below, then tap its spot!'; render(); return; } Puzzle.tryPlace(Puzzle.selected, id); },
  'start-quiz': (id) => { Quiz.start(id); go('quiz', id); },
  'say-q': () => Sound.say(Quiz.q.prompt, true),
  'quiz-map': (id) => { if (!Quiz.answered) Quiz.answer(id === Quiz.q.map, id === Quiz.q.map ? null : region(id).name); },
  'quiz-opt': (k) => { if (Quiz.answered) return; Quiz.picked = Number(k); Quiz.answer(Number(k) === Quiz.q.correct); },
  'quiz-next': () => Quiz.next(),
  'start-animals': () => { Animals.start(); go('animals'); Sound.say(Animals.a.prompt); },
  'animal-tap': (id) => { if (!Animals.answered) Animals.tap(id); },
  'animal-next': () => Animals.next(),
  'sprint-start': () => Sprint.start(),
  'sprint-tap': (id) => Sprint.tap(id)
};

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const fn = ACTIONS[t.dataset.act];
  if (fn) { e.preventDefault(); if (t.dataset.act !== 'nav' && !t.dataset.act.startsWith('pw-')) Sound.play('pop'); fn(t.dataset.arg, t); }
});
document.addEventListener('keydown', (e) => {
  const t = e.target.closest && e.target.closest('[data-act][tabindex]');
  if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); t.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  if (e.key === 'Enter' && e.target.id === 'gate-input') { e.preventDefault(); ACTIONS[Paywall.gate ? 'pw-gate-ok' : 'gr-gate-ok'](); }
  if (e.key === 'Escape' && route !== 'home' && Store.unlocked) go('home');
});
document.addEventListener('change', (e) => {
  const k = e.target.dataset && e.target.dataset.toggle;
  if (k) { P.data[k] = e.target.checked; P.save(); }
});

// MARK: - Boot

(async function boot() {
  P.load();
  render();
  await Store.init();
  if (DEMO) {
    const s = PARAMS.get('screen');
    if (PARAMS.has('paywall')) { Store.owned = new Set(); Store.available = true; Store.details = [{ itemId: PRODUCTS.lifetime, price: { currency: 'USD', value: '4.99' } }]; }
    if (PARAMS.has('onboarding')) { Store.owned = new Set(); P.data.onboarded = false; }
    if (s === 'quiz') { Quiz.start(PARAMS.get('arg') || 'fun-facts'); Quiz.i = 2; Quiz.correct = 2; Quiz.picked = Quiz.q.correct; Quiz.answer(true); route = 'quiz'; }
    else if (s === 'mapquiz') { Quiz.start('find-continents'); Quiz.i = 1; Quiz.correct = 1; route = 'quiz'; }
    else if (s === 'puzzle') { Puzzle.start(PARAMS.get('arg') || 4); route = 'puzzle'; }
    else if (s === 'animals') { Animals.start(); Animals.round = CONTENT.animals.slice(0, ANIMAL_ROUND); Animals.i = 2; Animals.firstTry = 2; Animals.tap(Animals.a.home); route = 'animals'; }
    else if (s === 'detail') { route = 'detail'; routeArg = PARAMS.get('arg') || 'africa'; }
    else if (s === 'sprint') { route = 'sprint'; routeArg = 'play'; }
    else if (s) route = s;
  }
  render();
  if ('serviceWorker' in navigator && !IS_LOCAL) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
