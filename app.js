/* Riftbound Pack Opener
 * Card data + images: RiftHunt API (https://rifthunt.com/api/), free, CORS-open, no key.
 * Pull rates: community estimates (riftbound.gg, inksighttcg, tcgodds) plus Riot's published
 * pack layouts and Ultimate Rare odds. See the "Pull-rate model" panel and README.
 */
(() => {
  'use strict';

  const API = 'https://api.rifthunt.com';
  const CACHE_TTL = 24 * 60 * 60 * 1000;
  const PACK_PRICE = 5;

  // Booster sets. `ultimate` is the per-pack chance of an Ultimate Rare (Riot-published where known).
  const SETS = [
    { code: 'rad', name: 'Radiance',     release: '2026-10-23', ultimate: 0.00025 },
    { code: 'ven', name: 'Vendetta',     release: '2026-07-31', ultimate: 0 },
    { code: 'unl', name: 'Unleashed',    release: '2026-05-08', ultimate: 0.0008 },
    { code: 'sfd', name: 'Spiritforged', release: '2026-02-13', ultimate: 0 },
    { code: 'ogn', name: 'Origins',      release: '2025-10-31', ultimate: 0 },
  ];

  // Shared 14-card pack model. Weights are relative, per slot.
  //  - 7 commons, 3 uncommons
  //  - 2 "rare or better" slots: rare 83%, epic 13%, showcase 4%
  //  - 1 foil slot of any rarity: common 55%, uncommon 28%, rare 13%, epic 2%, showcase 2%
  //  - 1 token/rune slot, with an alt-art rune roughly once per 3 boxes
  // That yields ~0.26 epics per pack (about 1 in 4), ~2.4 showcase per 24-pack box
  // (about 2 alt art + 1 overnumbered every 3 boxes), and a signature about once per 30 boxes.
  const MODEL = {
    cardsPerPack: 14,
    packsPerBox: 24,
    slots: [
      { kind: 'common',   n: 7, weights: { common: 1 } },
      { kind: 'uncommon', n: 3, weights: { uncommon: 1 } },
      { kind: 'extra',    n: 1, weights: { token: 50, rune: 48.6, altrune: 1.4 } },
      { kind: 'foil',     n: 1, weights: { common: 55, uncommon: 28, rare: 13, epic: 2, showcase: 2 }, foil: true },
      { kind: 'premium',  n: 2, weights: { rare: 83, epic: 13, showcase: 4 } },
    ],
    showcase: { alt: 85, overnumbered: 13.5, signature: 1.5 },
  };

  // When a pool is empty for a set, fall back along this chain.
  const FALLBACK = {
    ultimate: 'signature', signature: 'overnumbered', overnumbered: 'alt', alt: 'epic',
    epic: 'rare', rare: 'uncommon', uncommon: 'common',
    altrune: 'rune', rune: 'token', token: 'common',
  };

  const RARITY_CLASS = {
    common: 'common', uncommon: 'uncommon', rare: 'rare', epic: 'epic',
    alt: 'showcase', overnumbered: 'showcase', signature: 'showcase', ultimate: 'ultimate',
    token: 'token', rune: 'rune', altrune: 'showcase',
  };
  const LABEL = {
    common: 'Common', uncommon: 'Uncommon', rare: 'Rare', epic: 'Epic',
    alt: 'Alt Art', overnumbered: 'Overnumbered', signature: 'Signature', ultimate: 'Ultimate Rare',
    token: 'Token', rune: 'Rune', altrune: 'Alt Rune',
  };
  const HIT_RANK = { ultimate: 6, signature: 5, overnumbered: 4, alt: 3, altrune: 2.5, epic: 2, rare: 1 };

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    setSelect: $('set-select'), btnPack: $('btn-pack'), btnBox: $('btn-box'), btnReveal: $('btn-reveal'),
    status: $('status'), packWrap: $('pack-wrap'), packArt: $('pack-art'), packSetName: $('pack-set-name'),
    grid: $('pack-grid'), boxView: $('box-view'),
    packValue: $('pack-value'), packBest: $('pack-best'),
    sPacks: $('s-packs'), sSpent: $('s-spent'), sValue: $('s-value'), sEpic: $('s-epic'), sAlt: $('s-alt'),
    sOver: $('s-over'), sSig: $('s-sig'), sUlt: $('s-ult'), hits: $('hits'), btnReset: $('btn-reset'),
    odds: $('odds-body'),
    modal: $('modal'), modalImg: $('modal-img'), modalName: $('modal-name'), modalMeta: $('modal-meta'),
    modalPrice: $('modal-price'), modalLink: $('modal-link'), modalClose: $('modal-close'), modalDismiss: $('modal-dismiss'),
  };

  // ---------- State ----------
  const pools = {};        // setCode -> { common: [...], ... }
  let currentSet = SETS[0];
  let currentPack = null;  // array of pulled cards for the open pack
  let busy = false;
  let stats = loadStats();

  // ---------- Data ----------
  function slim(c) {
    const p = c.prices || {};
    return {
      id: c.id, name: c.name, type: c.type, rarity: c.rarity, variant: c.variant,
      cn: c.collector_number, energy: c.energy, artist: c.artist, set: c.set,
      img: c.images || {}, uri: c.rifthunt_uri,
      pf: p.foil && p.foil.market != null ? p.foil.market : null,
      pn: p.normal && p.normal.market != null ? p.normal.market : null,
    };
  }

  async function fetchSet(code) {
    const key = 'rpo:set:' + code;
    try {
      const cached = JSON.parse(localStorage.getItem(key) || 'null');
      if (cached && Date.now() - cached.t < CACHE_TTL && Array.isArray(cached.cards) && cached.cards.length) {
        return cached.cards;
      }
    } catch (_) { /* ignore */ }

    const cards = [];
    let page = 1;
    for (;;) {
      const url = `${API}/cards/search?q=${encodeURIComponent('s:' + code)}&unique=prints&order=number&dir=asc&page=${page}`;
      const res = await fetch(url);
      if (res.status === 404) break;
      if (!res.ok) throw new Error(`RiftHunt API returned ${res.status}`);
      const json = await res.json();
      (json.data || []).forEach((c) => cards.push(slim(c)));
      if (!json.has_more || page >= 12) break;
      page += 1;
    }
    try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), cards })); } catch (_) { /* quota */ }
    return cards;
  }

  // Map a printing to a pool category, or null to exclude it from boosters.
  function classify(c) {
    const cn = c.cn || '';
    const name = c.name || '';
    if (/\(Ultimate\)/i.test(name)) return 'ultimate';
    if (cn[0] === 't') return 'token';
    if (cn[0] === 's') return 'alt';                     // sp1.. special art cards (K/DA, Crystal Rose)
    if (cn[0] === 'r' || c.type === 'Rune') {
      if (c.rarity === 'promo' || /b$/.test(cn)) return null; // promo runes from decks/bundles
      return /a$/.test(cn) || c.variant ? 'altrune' : 'rune';
    }
    if (c.variant === 'signature') return 'signature';
    if (c.variant === 'overnumbered') return 'overnumbered';
    if (c.variant === 'alternate' || c.variant === 'showcase') return 'alt';
    if ((c.type === 'Unit' || c.type === 'Gear') && c.energy == null) return 'token'; // Origins tokens are numbered
    if (['common', 'uncommon', 'rare', 'epic'].includes(c.rarity)) return c.rarity;
    return null;
  }

  function buildPools(cards) {
    const p = {};
    cards.forEach((c) => {
      const k = classify(c);
      if (!k) return;
      (p[k] = p[k] || []).push(c);
    });
    return p;
  }

  async function ensureSet(set) {
    if (pools[set.code]) return pools[set.code];
    setStatus(`Loading ${set.name} from RiftHunt…`);
    const cards = await fetchSet(set.code);
    pools[set.code] = buildPools(cards);
    const n = Object.values(pools[set.code]).reduce((a, b) => a + b.length, 0);
    setStatus(`${set.name}: ${n} booster printings loaded.`);
    return pools[set.code];
  }

  // ---------- Simulation ----------
  const rnd = () => Math.random();
  function weightedPick(weights) {
    const entries = Object.entries(weights);
    const total = entries.reduce((a, [, w]) => a + w, 0);
    let r = rnd() * total;
    for (const [k, w] of entries) { r -= w; if (r < 0) return k; }
    return entries[entries.length - 1][0];
  }
  function resolveCategory(cat, pool) {
    let k = cat;
    for (let i = 0; i < 8 && k; i += 1) {
      if (pool[k] && pool[k].length) return k;
      k = FALLBACK[k];
    }
    return 'common';
  }
  function drawFrom(pool, cat, used) {
    const list = pool[cat] || [];
    if (!list.length) return null;
    for (let tries = 0; tries < 20; tries += 1) {
      const c = list[Math.floor(rnd() * list.length)];
      if (!used.has(c.id) || list.length <= used.size) { used.add(c.id); return c; }
    }
    return list[Math.floor(rnd() * list.length)];
  }

  function openPack(set, pool) {
    const pulls = [];
    const used = new Set();
    MODEL.slots.forEach((slot) => {
      for (let i = 0; i < slot.n; i += 1) {
        let cat = weightedPick(slot.weights);
        if (cat === 'showcase') cat = weightedPick(MODEL.showcase);
        cat = resolveCategory(cat, pool);
        const card = drawFrom(pool, cat, used);
        if (!card) continue;
        const foil = !!slot.foil || ['epic', 'alt', 'overnumbered', 'signature', 'ultimate', 'altrune'].includes(cat);
        pulls.push({ card, cat, foil, slot: slot.kind });
      }
    });
    // Ultimate Rare roll: replaces the last premium slot.
    if (set.ultimate > 0 && pool.ultimate && pool.ultimate.length && rnd() < set.ultimate) {
      const idx = pulls.map((p) => p.slot).lastIndexOf('premium');
      const card = pool.ultimate[Math.floor(rnd() * pool.ultimate.length)];
      const pull = { card, cat: 'ultimate', foil: true, slot: 'premium' };
      if (idx >= 0) pulls[idx] = pull; else pulls.push(pull);
    }
    pulls.forEach((p) => { p.value = valueOf(p); });
    return pulls;
  }

  function valueOf(pull) {
    const c = pull.card;
    if (pull.foil) return c.pf != null ? c.pf : (c.pn != null ? c.pn : 0);
    return c.pn != null ? c.pn : (c.pf != null ? c.pf : 0);
  }

  // ---------- Stats ----------
  function loadStats() {
    try {
      const s = JSON.parse(localStorage.getItem('rpo:stats') || 'null');
      if (s && typeof s.packs === 'number') return s;
    } catch (_) { /* ignore */ }
    return { packs: 0, value: 0, epic: 0, alt: 0, over: 0, sig: 0, ult: 0, hits: [] };
  }
  function saveStats() {
    try { localStorage.setItem('rpo:stats', JSON.stringify(stats)); } catch (_) { /* ignore */ }
  }
  function recordPack(pulls) {
    stats.packs += 1;
    pulls.forEach((p) => {
      stats.value += p.value;
      if (p.cat === 'epic') stats.epic += 1;
      if (p.cat === 'alt' || p.cat === 'altrune') stats.alt += 1;
      if (p.cat === 'overnumbered') stats.over += 1;
      if (p.cat === 'signature') stats.sig += 1;
      if (p.cat === 'ultimate') stats.ult += 1;
      if (HIT_RANK[p.cat] >= 2) {
        stats.hits.unshift({ name: p.card.name, cat: p.cat, img: p.card.img.small, set: p.card.set, cn: p.card.cn, value: p.value, foil: p.foil, id: p.card.id, type: p.card.type });
        if (stats.hits.length > 60) stats.hits.length = 60;
      }
    });
    saveStats();
    renderStats();
  }
  function renderStats() {
    el.sPacks.textContent = stats.packs;
    el.sSpent.textContent = money(stats.packs * PACK_PRICE);
    el.sValue.textContent = money(stats.value);
    el.sEpic.textContent = stats.epic;
    el.sAlt.textContent = stats.alt;
    el.sOver.textContent = stats.over;
    el.sSig.textContent = stats.sig;
    el.sUlt.textContent = stats.ult;
    el.hits.innerHTML = '';
    if (!stats.hits.length) {
      el.hits.innerHTML = '<p class="muted">Epics and showcase cards you pull will show up here.</p>';
      return;
    }
    const sorted = stats.hits.slice().sort((a, b) => (HIT_RANK[b.cat] - HIT_RANK[a.cat]) || (b.value - a.value));
    sorted.forEach((h) => {
      const d = document.createElement('div');
      d.className = 'mini hit r-' + RARITY_CLASS[h.cat] + (h.type === 'Battlefield' ? ' landscape' : '');
      d.title = `${h.name} · ${LABEL[h.cat]} · ${money(h.value)}`;
      d.innerHTML = `<img loading="lazy" src="${h.img || ''}" alt="${esc(h.name)}">`;
      d.addEventListener('click', () => showModal({ card: { name: h.name, img: { large: upscale(h.img) }, set: h.set, cn: h.cn, uri: null, rarity: '', type: h.type || '' }, cat: h.cat, foil: h.foil, value: h.value }));
      el.hits.appendChild(d);
    });
  }
  const upscale = (u) => (u || '').replace('/cards/small/', '/cards/large/');

  // ---------- Rendering ----------
  function money(n) { return '$' + (Math.round(n * 100) / 100).toFixed(2); }
  // Battlefields are printed landscape; RiftHunt serves them as landscape images.
  function isLandscape(c) { return c.type === 'Battlefield'; }
  // Printed names carry the variant as a suffix; drop it when we show the variant label separately.
  function displayName(c) { return String(c.name || '').replace(/\s*\((Alternate Art|Overnumbered|Signature|Ultimate|[^()]*Special Art Card)\)\s*$/i, ''); }
  function bestOf(pulls) { return pulls.slice().sort((a, b) => ((HIT_RANK[b.cat] || 0) - (HIT_RANK[a.cat] || 0)) || (b.value - a.value))[0]; }
  function esc(s) { return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
  function setStatus(msg, isError) {
    el.status.textContent = msg;
    el.status.classList.toggle('error', !!isError);
  }

  function showPackArt() {
    el.packSetName.textContent = currentSet.name;
    el.packArt.classList.remove('opening');
    el.packWrap.hidden = false;
    el.grid.hidden = true;
    el.boxView.hidden = true;
    el.btnReveal.hidden = true;
  }

  function cardNode(pull, i) {
    const c = pull.card;
    const node = document.createElement('div');
    node.className = `card r-${RARITY_CLASS[pull.cat]}${pull.foil ? ' foil' : ''}${isLandscape(c) ? ' landscape' : ''}`;
    node.style.animationDelay = `${i * 45}ms`;
    node.innerHTML = `
      <div class="card-inner">
        <div class="face back"></div>
        <div class="face front"><img src="${c.img.normal || c.img.small || ''}" alt="${esc(c.name)}" loading="eager"></div>
      </div>
      <span class="tag">${LABEL[pull.cat]}${pull.foil && !['epic','alt','overnumbered','signature','ultimate','altrune'].includes(pull.cat) ? ' · Foil' : ''}</span>
      <span class="price">${pull.value ? money(pull.value) : '–'}</span>`;
    node.addEventListener('click', () => {
      if (!node.classList.contains('flipped')) { node.classList.add('flipped'); afterFlip(); }
      else showModal(pull);
    });
    return node;
  }

  function afterFlip() {
    const all = el.grid.querySelectorAll('.card');
    const flipped = el.grid.querySelectorAll('.card.flipped');
    if (all.length && flipped.length === all.length) el.btnReveal.hidden = true;
  }

  function revealAll() {
    const cards = Array.from(el.grid.querySelectorAll('.card:not(.flipped)'));
    cards.forEach((n, i) => setTimeout(() => n.classList.add('flipped'), i * 120));
    el.btnReveal.hidden = true;
  }

  function renderPack(pulls) {
    el.grid.innerHTML = '';
    pulls.forEach((p, i) => el.grid.appendChild(cardNode(p, i)));
    el.packWrap.hidden = true;
    el.boxView.hidden = true;
    el.grid.hidden = false;
    el.btnReveal.hidden = false;
    const total = pulls.reduce((a, p) => a + p.value, 0);
    const best = bestOf(pulls);
    el.packValue.textContent = money(total);
    el.packBest.textContent = best ? `${displayName(best.card)} (${LABEL[best.cat]})` : '–';
  }

  function renderBox(packs) {
    el.boxView.innerHTML = '';
    const all = packs.flat();
    const total = all.reduce((a, p) => a + p.value, 0);
    const count = (k) => all.filter((p) => p.cat === k).length;
    const summary = document.createElement('div');
    summary.className = 'box-summary';
    summary.innerHTML = `
      <div>Box of ${packs.length} packs · <b>${money(total)}</b> market value</div>
      <div>Epics <b>${count('epic')}</b></div>
      <div>Alt / Special <b>${count('alt')}</b></div>
      <div>Alt runes <b>${count('altrune')}</b></div>
      <div>Overnumbered <b>${count('overnumbered')}</b></div>
      <div>Signature <b>${count('signature')}</b></div>
      <div>Ultimate <b>${count('ultimate')}</b></div>`;
    el.boxView.appendChild(summary);
    packs.forEach((pulls, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'box-pack';
      const v = pulls.reduce((a, p) => a + p.value, 0);
      const best = bestOf(pulls);
      wrap.innerHTML = `<h4>Pack ${i + 1} · ${money(v)} · best: ${esc(displayName(best.card))} (${LABEL[best.cat]})</h4><div class="row"></div>`;
      const row = wrap.querySelector('.row');
      pulls.forEach((p) => {
        const d = document.createElement('div');
        d.className = `mini r-${RARITY_CLASS[p.cat]}${HIT_RANK[p.cat] >= 2 ? ' hit' : ''}${isLandscape(p.card) ? ' landscape' : ''}`;
        d.title = `${p.card.name} · ${LABEL[p.cat]} · ${money(p.value)}`;
        d.innerHTML = `<img loading="lazy" src="${p.card.img.small || ''}" alt="${esc(p.card.name)}">`;
        d.addEventListener('click', () => showModal(p));
        row.appendChild(d);
      });
      el.boxView.appendChild(wrap);
    });
    el.packWrap.hidden = true;
    el.grid.hidden = true;
    el.btnReveal.hidden = true;
    el.boxView.hidden = false;
    const bestAll = bestOf(all);
    el.packValue.textContent = money(total) + ' (box)';
    el.packBest.textContent = bestAll ? `${displayName(bestAll.card)} (${LABEL[bestAll.cat]})` : '–';
  }

  function showModal(pull) {
    const c = pull.card;
    el.modalImg.src = c.img.large || c.img.normal || c.img.small || '';
    el.modalImg.alt = c.name;
    el.modalName.textContent = displayName(c);
    const bits = [LABEL[pull.cat]];
    if (pull.foil && !['epic','alt','overnumbered','signature','ultimate','altrune'].includes(pull.cat)) bits.push('Foil');
    if (c.type) bits.push(c.type);
    if (c.set) bits.push(`${c.set.toUpperCase()} #${c.cn}`);
    if (c.artist) bits.push('Art: ' + c.artist);
    el.modalMeta.textContent = bits.join(' · ');
    el.modalPrice.textContent = pull.value ? `TCGplayer market ≈ ${money(pull.value)}` : 'No market price listed';
    if (c.uri) { el.modalLink.href = 'https://rifthunt.com' + c.uri; el.modalLink.hidden = false; }
    else if (c.set && c.cn) { el.modalLink.href = `https://rifthunt.com/cards/${c.set}/${c.cn}/`; el.modalLink.hidden = false; }
    else el.modalLink.hidden = true;
    el.modal.hidden = false;
  }
  function hideModal() { el.modal.hidden = true; el.modalImg.src = ''; }

  function renderOdds() {
    const rows = MODEL.slots.map((s) => {
      const w = Object.entries(s.weights);
      const t = w.reduce((a, [, v]) => a + v, 0);
      const txt = w.map(([k, v]) => `${LABEL[k] || k} ${Math.round((v / t) * 1000) / 10}%`).join(', ');
      return `<tr><td>${s.n}× ${s.kind}${s.foil ? ' (foil)' : ''}</td><td>${txt}</td></tr>`;
    }).join('');
    const sc = Object.entries(MODEL.showcase).map(([k, v]) => `${LABEL[k]} ${v}%`).join(', ');
    el.odds.innerHTML = `
      <table><tr><th>Slot</th><th>Contents</th></tr>${rows}
      <tr><td>Showcase split</td><td>${sc}</td></tr>
      <tr><td>Ultimate Rare</td><td>Unleashed 0.08% of packs, Radiance 0.025% (Riot). Replaces a rare slot.</td></tr></table>
      <p>Per 24-pack box this averages about 6 epics, 2 alt arts, 1 overnumbered every 3 boxes and 1 signature every 30 boxes, matching the riftbound.gg guide and community box openings. Riot has not published per-rarity odds, so treat this as a model, not the real print run. Prices use the foil market price for foil and showcase pulls and the normal market price otherwise.</p>`;
  }

  // ---------- Actions ----------
  async function doOpenPack() {
    if (busy) return;
    busy = true;
    try {
      const pool = await ensureSet(currentSet);
      if (!el.packWrap.hidden) {
        el.packArt.classList.add('opening');
        await new Promise((r) => setTimeout(r, 520));
      }
      currentPack = openPack(currentSet, pool);
      recordPack(currentPack);
      renderPack(currentPack);
      setStatus(`${currentSet.name} booster · click cards to flip them, or press R to reveal all.`);
    } catch (err) {
      setStatus('Could not load card data: ' + err.message, true);
      showPackArt();
    } finally { busy = false; }
  }

  async function doOpenBox() {
    if (busy) return;
    busy = true;
    try {
      const pool = await ensureSet(currentSet);
      const packs = [];
      for (let i = 0; i < MODEL.packsPerBox; i += 1) {
        const pulls = openPack(currentSet, pool);
        recordPack(pulls);
        packs.push(pulls);
      }
      renderBox(packs);
      setStatus(`${currentSet.name} booster box · ${MODEL.packsPerBox} packs. Click any card to enlarge it.`);
    } catch (err) {
      setStatus('Could not load card data: ' + err.message, true);
      showPackArt();
    } finally { busy = false; }
  }

  function resetStats() {
    stats = { packs: 0, value: 0, epic: 0, alt: 0, over: 0, sig: 0, ult: 0, hits: [] };
    saveStats();
    renderStats();
  }

  // ---------- Init ----------
  function init() {
    SETS.forEach((s) => {
      const o = document.createElement('option');
      o.value = s.code;
      o.textContent = `${s.name} (${s.code.toUpperCase()})`;
      el.setSelect.appendChild(o);
    });
    const saved = (() => { try { return localStorage.getItem('rpo:setcode'); } catch (_) { return null; } })();
    currentSet = SETS.find((s) => s.code === saved) || SETS[0];
    el.setSelect.value = currentSet.code;

    el.setSelect.addEventListener('change', () => {
      currentSet = SETS.find((s) => s.code === el.setSelect.value) || SETS[0];
      try { localStorage.setItem('rpo:setcode', currentSet.code); } catch (_) { /* ignore */ }
      showPackArt();
      ensureSet(currentSet).catch((e) => setStatus('Could not load card data: ' + e.message, true));
    });
    el.btnPack.addEventListener('click', doOpenPack);
    el.packArt.addEventListener('click', doOpenPack);
    el.btnBox.addEventListener('click', doOpenBox);
    el.btnReveal.addEventListener('click', revealAll);
    el.btnReset.addEventListener('click', resetStats);
    el.modalClose.addEventListener('click', hideModal);
    el.modalDismiss.addEventListener('click', hideModal);
    document.addEventListener('keydown', (e) => {
      if (e.target && /^(input|select|textarea)$/i.test(e.target.tagName)) return;
      if (e.key === 'Escape') hideModal();
      if (!el.modal.hidden) return;
      const k = e.key.toLowerCase();
      if (k === 'n') doOpenPack();
      if (k === 'r') revealAll();
      if (k === 'b') doOpenBox();
    });

    renderStats();
    renderOdds();
    showPackArt();
    ensureSet(currentSet).catch((e) => setStatus('Could not load card data: ' + e.message, true));
  }

  init();
})();
