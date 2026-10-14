(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const money = n => 'GH\u20B5' + Number(n).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };
  const PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#e9e9eb"/><text x="200" y="208" font-family="Arial" font-size="20" text-anchor="middle" fill="#888">Image unavailable</text></svg>');
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const OTHER = () => config.locations.otherRegion.name;
const dateLabel = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); };
  const OFFLINE_MSG = 'We could not reach the server. Check your internet connection and try again. Your cart is saved and you were not charged.';

  let config = { locations: { freeDeliveryOver: 0, regions: [], otherRegion: { name: 'Outside Greater Accra', fee: 0 }, schedule: { timeSlots: [] } }, deliveryDates: [], whatsapp: '', payOnline: false, dropDate: '', instagram: '', tiktok: '' };
  let catalog = { collections: [], products: [] };
  let cart = store.get('bs-cart', []);
  let wish = store.get('bs-wish', []);
  let recent = store.get('bs-recent', []);
  const state = { collection: 'All', sort: '', q: '', limited: false, saved: false, promo: null, region: '', city: '' };
  let chosen = null, panel = null, openEl = null, lastFocus = null, galImgs = [], lastSwipe = 0, cdTimer = null;

  async function api(url, body) {
    const r = await fetch(url, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data };
  }

  /* ---------- Small UI helpers ---------- */
  function toast(msg, o = {}) {
    const t = document.createElement('div');
    t.className = 'toast ' + (o.type || '');
    t.textContent = msg;
    if (o.action) { const b = document.createElement('button'); b.type = 'button'; b.textContent = o.action; b.onclick = () => { o.fn(); t.remove(); }; t.append(b); }
    $('#toasts').append(t);
    setTimeout(() => t.remove(), o.ms || 4000);
  }
  // Error text lives in #e-<inputId>; the input gets aria-invalid.
  function setErr(inputId, msg) {
    const e = $('#e-' + inputId), i = $('#' + inputId);
    if (e) e.textContent = msg || '';
    if (i) { i.setAttribute('aria-invalid', msg ? 'true' : 'false'); if (e) i.setAttribute('aria-describedby', e.id); }
  }
  const phoneOk = v => {
    const s = v.trim(), d = s.replace(/\D/g, '');
    if (!/^[+0-9 ()-]+$/.test(s)) return false;
    if (s.startsWith('+')) return d.length >= 8 && d.length <= 15;
    return (d.length === 10 && d[0] === '0') || (d.length === 12 && d.startsWith('233'));
  };
  const rules = {
    name: v => v.trim().length < 2 ? 'Enter your full name.' : '',
    phone: v => !v.trim() ? 'Enter your phone number so our rider can reach you.' : phoneOk(v) ? '' : 'Enter a valid phone number, like 024 123 4567.',
    email: (v, f = {}) => { const e = v.trim(); if (!e) return f.payment === 'online' ? 'Enter your email so we can send your payment receipt.' : ''; return EMAIL_RE.test(e) ? '' : 'That email does not look right. Check for typos, for example name@gmail.com.'; },
    region: v => v ? '' : 'Choose your region.',
    city: (v, f = {}) => v.trim().length >= 2 ? '' : f.region === OTHER() ? 'Enter your town or city.' : 'Choose your town.',
    deliveryDate: v => v ? '' : 'Choose a delivery day.',
    deliverySlot: v => v ? '' : 'Choose a delivery time.',
    address: v => v.trim().length < 5 ? 'Enter your delivery address, including area and a landmark.' : ''
  };

  /* ---------- Data ---------- */
  async function loadConfig() {
    try { const { ok, data } = await api('/api/config'); if (ok) config = { ...config, ...data }; } catch {}
    if (!config.locations.regions.length) { try { const r = await fetch('data/locations.json'); if (r.ok) config.locations = await r.json(); } catch {} }
    const chat = $('#chat');
    if (config.whatsapp) { chat.href = 'https://wa.me/' + config.whatsapp.replace(/\D/g, '') + '?text=' + encodeURIComponent('Hi Blacksheep, I have a question.'); chat.hidden = false; }
    $('#socials').innerHTML = [['Instagram', config.instagram], ['TikTok', config.tiktok]].filter(x => /^https?:\/\//.test(x[1])).map(x => `<a href="${esc(x[1])}" target="_blank" rel="noopener">${x[0]}</a>`).join('');
    startCountdown();
  }
  async function loadCatalog() {
    try {
      const { ok, data } = await api('/api/products');
      if (!ok) throw 0;
      catalog = data;
    } catch {
      try { const r = await fetch('data/products.json'); if (!r.ok) throw 0; catalog = await r.json(); } catch { return false; }
    }
    $('#collection').innerHTML = catalog.collections.map(c => `<option value="${esc(c)}">${c === 'All' ? 'Explore collections' : esc(c)}</option>`).join('');
    $('#collection').value = state.collection;
    return true;
  }
  async function refreshCatalog() { if (await loadCatalog()) { render(); renderRecent(); } }

  const find = id => catalog.products.find(p => p.id === id);
  const avail = (id, size) => { const p = find(id); return p ? (p.stock[size] || 0) : 0; };
  const stockTotal = p => Object.values(p.stock).reduce((a, n) => a + n, 0);

  /* ---------- Product grid ---------- */
  function meter(p) {
    if (!p.editionSize) return '';
    const left = stockTotal(p);
    if (left < 1) return '';
    const pct = Math.max(3, Math.min(100, Math.round(left / p.editionSize * 100)));
    return `<div class="meter" aria-hidden="true"><i style="width:${pct}%"></i></div><small class="mtxt">${left} of ${p.editionSize} left</small>`;
  }
  function cardHTML(p) {
    const out = stockTotal(p) < 1, saved = wish.includes(p.id);
    return `
      <article>
        <div class="card ${out ? 'out' : ''}" data-id="${esc(p.id)}" tabindex="0" role="button" aria-label="${esc(p.name)}, ${money(p.price)}${out ? ', sold out' : ''}">
          <div class="ph">
            ${out ? '<span class="tag so">SOLD OUT</span>' : p.limited ? '<span class="tag">LIMITED</span>' : ''}
            <img class="f" src="${esc(p.front)}" alt="${esc(p.name)}, front" loading="lazy">
            <img class="b" src="${esc(p.back)}" alt="${esc(p.name)}, back" loading="lazy">
          </div>
          <h3>${esc(p.name)}</h3>
          <div class="price">${money(p.price)}</div>
          ${meter(p)}
        </div>
        <button class="heart ${saved ? 'on' : ''}" data-heart="${esc(p.id)}" aria-label="${saved ? 'Remove' : 'Save'} ${esc(p.name)}" aria-pressed="${saved}">${saved ? '\u2665' : '\u2661'}</button>
      </article>`;
  }
  const miniCard = p => `<article><div class="card ${stockTotal(p) < 1 ? 'out' : ''}" data-id="${esc(p.id)}" tabindex="0" role="button" aria-label="${esc(p.name)}, ${money(p.price)}"><div class="ph"><img src="${esc(p.front)}" alt="" loading="lazy"></div><h3>${esc(p.name)}</h3><div class="price">${money(p.price)}</div></div></article>`;

  function visible() {
    let list = catalog.products.filter(p =>
      (state.collection === 'All' || p.collection === state.collection) &&
      (!state.q || p.name.toLowerCase().includes(state.q)) &&
      (!state.limited || p.limited) &&
      (!state.saved || wish.includes(p.id)));
    if (state.sort === 'price-asc') list = [...list].sort((a, b) => a.price - b.price);
    if (state.sort === 'price-desc') list = [...list].sort((a, b) => b.price - a.price);
    return list;
  }
  function skeleton() {
    $('#grid').innerHTML = Array.from({ length: 10 }, () => '<article class="sk" aria-hidden="true"><div class="ph shimmer"></div><div class="l1 shimmer"></div><div class="l2 shimmer"></div></article>').join('');
    $('#empty').hidden = true; $('#loadErr').hidden = true;
  }
  function render() {
    const list = visible();
    $('#loadErr').hidden = true;
    $('#count').textContent = list.length + (list.length === 1 ? ' item' : ' items');
    $('#wishCount').textContent = wish.length;
    $('#empty').hidden = list.length > 0;
    if (!list.length) $('#emptyMsg').textContent = state.saved && !wish.length ? 'You have not saved anything yet. Tap the heart on a product to keep it here.' : 'Nothing matches. Clear the filter or search to see all products.';
    $('#grid').innerHTML = list.map(cardHTML).join('');
  }
  function renderRecent() {
    const items = recent.map(find).filter(Boolean).slice(0, 5);
    $('#recent').hidden = !items.length;
    $('#recentGrid').innerHTML = items.map(miniCard).join('');
  }

  /* ---------- Product modal ---------- */
  function openProduct(id) {
    const p = find(id); if (!p) return;
    chosen = null;
    recent = [id, ...recent.filter(x => x !== id)].slice(0, 8); store.set('bs-recent', recent);
    const sizes = Object.keys(p.stock), out = sizes.filter(s => p.stock[s] < 1), allOut = out.length === sizes.length;
    const others = catalog.products.filter(x => x.id !== p.id);
    const related = [...others.filter(x => x.collection === p.collection), ...others.filter(x => x.collection !== p.collection)].slice(0, 4);
    galImgs = [p.front, p.back];
    $('#modalBody').innerHTML = `
      <div class="pd">
        <div class="gal">
          <div class="gmain" id="galMain" title="Click to zoom"><img id="galImg" src="${esc(p.front)}" alt="${esc(p.name)}, front"></div>
          <div class="thumbs">
            <button type="button" class="on" data-img="0" aria-label="Show front"><img src="${esc(p.front)}" alt=""></button>
            <button type="button" data-img="1" aria-label="Show back"><img src="${esc(p.back)}" alt=""></button>
          </div>
        </div>
        <div>
          <h2>${esc(p.name)}</h2>
          <div class="price">${money(p.price)}</div>
          ${meter(p)}
          <p>${esc(p.desc)}</p>
          <p class="muted">Colour: ${esc(p.color)}</p>
          <strong>Size</strong>
          <div class="sizes" role="group" aria-label="Size">${sizes.map(s => `<button type="button" data-size="${esc(s)}" ${p.stock[s] < 1 ? 'disabled title="Sold out"' : ''}>${esc(s)}</button>`).join('')}</div>
          <p class="hint" id="sizeNote"></p>
          <p class="ferr" id="sizeErr" role="alert"></p>
          <button class="btn block" id="addBtn" data-id="${esc(p.id)}" ${allOut ? 'disabled' : ''}>${allOut ? 'Sold out' : 'Add to cart'}</button>
          <details class="guide"><summary>Size guide</summary>${$('#sizeGuideTpl').innerHTML}</details>
          ${out.length ? `
          <div class="notify">
            <strong>${allOut ? 'Sold out.' : 'Some sizes are sold out.'} Get an email when ${allOut ? 'it is' : 'they are'} back.</strong>
            <div class="row">
              <select id="nSize" aria-label="Size">${out.map(s => `<option>${esc(s)}</option>`).join('')}</select>
              <input id="nEmail" type="email" placeholder="Email address" aria-label="Email address" autocomplete="email">
              <button type="button" class="btn sm" data-notify="${esc(p.id)}">Notify me</button>
            </div>
            <p class="ferr" id="e-nEmail" role="alert"></p>
          </div>` : ''}
        </div>
      </div>
      ${related.length ? `<h3 class="rel-h">You may also like</h3><div class="grid mini">${related.map(miniCard).join('')}</div>` : ''}`;
    show('#productModal');
    $('#productModal .modal-box').scrollTop = 0;
    renderRecent();
  }
  function setGal(i) {
    $('#galImg').src = galImgs[i];
    $$('.thumbs button').forEach((b, k) => b.classList.toggle('on', k === i));
    $('#galMain').classList.remove('zoom');
  }

  /* ---------- Cart ---------- */
  const selected = () => cart.filter(l => l.sel !== false);
  const subtotal = () => selected().reduce((a, l) => a + find(l.id).price * l.qty, 0);
  const discount = sub => { const p = state.promo; if (!p) return 0; return p.type === 'percent' ? Math.round(sub * p.value) / 100 : Math.min(p.value, sub); };
  const deliveryFee = sub => {
    const L = config.locations;
    if (L.freeDeliveryOver && sub >= L.freeDeliveryOver) return 0;
    if (!state.region) return null;
    if (state.region === L.otherRegion.name) return L.otherRegion.fee;
    const r = L.regions.find(x => x.name === state.region), t = r && r.towns.find(x => x.name === state.city);
    return t ? t.fee : null;
  };
  const updateCount = () => { $('#cartCount').textContent = cart.reduce((a, l) => a + l.qty, 0); };
  // Keeps the cart in line with live stock and returns plain-language notes about anything that changed.
  function reconcileCart() {
    if (!catalog.products.length) return [];
    const msgs = [];
    cart = cart.filter(l => { const p = find(l.id); if (!p || p.stock[l.size] === undefined) { msgs.push('An item in your cart is no longer sold, so we removed it.'); return false; } return true; });
    for (const l of cart) {
      const a = avail(l.id, l.size), n = find(l.id).name;
      if (a < 1) { msgs.push(`${n} (${l.size}) sold out and was removed from your cart.`); l.qty = 0; }
      else if (l.qty > a) { msgs.push(`${n} (${l.size}): only ${a} left, so we lowered your quantity.`); l.qty = a; }
    }
    cart = cart.filter(l => l.qty > 0);
    store.set('bs-cart', cart);
    return [...new Set(msgs)];
  }
  const saveCart = () => { store.set('bs-cart', cart); renderCart(); };
  function openCart() { panel = null; renderCart(); show('#cartDrawer'); }

  const fld = (name, label, ctrl) => `<label for="c-${name}">${label}</label>${ctrl}<p class="ferr" id="e-c-${name}" role="alert"></p>`;
  const dateOptions = () => '<option value="">Choose a day</option>' + (config.deliveryDates || []).map(d => `<option value="${esc(d)}">${esc(dateLabel(d))}</option>`).join('');
  const slotOptions = () => '<option value="">Choose a time</option>' + (config.locations.schedule.timeSlots || []).map(t => `<option>${esc(t)}</option>`).join('');
  const regionOptions = () => '<option value="">Choose your region</option>' + config.locations.regions.map(r => `<option value="${esc(r.name)}">${esc(r.name)}</option>`).join('') + `<option value="${esc(OTHER())}">${esc(OTHER())} (${money(config.locations.otherRegion.fee)})</option>`;
  function townControl(region) {
    if (region === OTHER()) return '<input id="c-city" name="city" autocomplete="address-level2" placeholder="Town or city">';
    const r = config.locations.regions.find(x => x.name === region);
    const opts = r ? r.towns.map(t => `<option value="${esc(t.name)}">${esc(t.name)} (${money(t.fee)})</option>`).join('') : '';
    return `<select id="c-city" name="city" class="full" ${r ? '' : 'disabled'}><option value="">${r ? 'Choose your town' : 'Choose your region first'}</option>${opts}</select>`;
  }
  function formHTML() {
    return `
      <form class="form" id="checkout" novalidate>
        <strong>Delivery details</strong>
        ${fld('name', 'Full name', '<input id="c-name" name="name" autocomplete="name">')}
        ${fld('phone', 'Phone', '<input id="c-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="024 123 4567">')}
        ${fld('email', 'Email (needed for online payment and receipts)', '<input id="c-email" name="email" type="email" autocomplete="email">')}
        ${fld('region', 'Region', `<select id="c-region" name="region" class="full">${regionOptions()}</select>`)}
        ${fld('city', 'Town or area', `<div id="townWrap">${townControl('')}</div>`)}
        ${fld('address', 'Street, house number and landmark', '<textarea id="c-address" name="address" rows="2" autocomplete="street-address"></textarea>')}
        <div class="two">
          <div>${fld('deliveryDate', 'Delivery day', `<select id="c-deliveryDate" name="deliveryDate" class="full">${dateOptions()}</select>`)}</div>
          <div>${fld('deliverySlot', 'Delivery time', `<select id="c-deliverySlot" name="deliverySlot" class="full">${slotOptions()}</select>`)}</div>
        </div>
        <fieldset class="pay"><legend>Payment</legend>
          ${config.payOnline ? '<label class="payopt"><input type="radio" name="payment" value="online" checked><span><b>Pay now</b><small>Card or mobile money. Secure checkout by Paystack.</small></span></label>' : ''}
          <label class="payopt"><input type="radio" name="payment" value="delivery" ${config.payOnline ? '' : 'checked'}><span><b>Pay on delivery</b><small>Pay our rider when your order arrives.</small></span></label>
        </fieldset>
        <p class="ferr" id="orderErr" role="alert"></p>
        <button class="btn block" type="submit" id="placeBtn">Place order</button>
      </form>`;
  }
  function restoreForm() {
    const d = store.get('bs-form', {}) || {};
    ['name', 'phone', 'email', 'address'].forEach(k => { const el = $('#c-' + k); if (el && d[k]) el.value = d[k]; });
    const rg = $('#c-region');
    if (d.region && [...rg.options].some(o => o.value === d.region)) { rg.value = d.region; state.region = d.region; } else state.region = '';
    $('#townWrap').innerHTML = townControl(state.region);
    const c = $('#c-city');
    if (d.city && c && (c.tagName === 'INPUT' || [...c.options].some(o => o.value === d.city))) { c.value = d.city; state.city = d.city; } else state.city = '';
  }
  function linesHTML() {
    const nSel = selected().length;
    return `<div class="cartbar">
        <label class="selall"><input type="checkbox" data-selall ${nSel === cart.length ? 'checked' : ''}> Select all (${nSel} of ${cart.length})</label>
        <span><button type="button" class="link" data-rm-sel ${nSel ? '' : 'disabled'}>Remove selected</button><button type="button" class="link" data-clear-cart>Clear cart</button></span>
      </div>` + cart.map((l, i) => {
      const p = find(l.id), a = avail(l.id, l.size), on = l.sel !== false;
      return `
      <div class="line ${on ? '' : 'off'}">
        <input type="checkbox" class="lsel" data-sel="${i}" ${on ? 'checked' : ''} aria-label="Select ${esc(p.name)}, size ${esc(l.size)}">
        <img src="${esc(p.front)}" alt="">
        <div><strong>${esc(p.name)}</strong><br><small>Size ${esc(l.size)}</small>
          <div class="qty"><button type="button" data-dec="${i}" aria-label="Fewer">\u2212</button><span>${l.qty}</span><button type="button" data-inc="${i}" aria-label="More" ${l.qty >= a ? 'disabled' : ''}>+</button></div>
          ${l.qty >= a ? `<small class="warnTxt">That is all we have (${a})</small>` : a <= 3 ? `<small class="warnTxt">Only ${a} left</small>` : ''}
          <button type="button" class="rm" data-rm="${i}">Remove</button></div>
        <div>${money(p.price * l.qty)}</div>
      </div>`;
    }).join('');
  }
  function renderLines() {
    const el = $('#cartLines'); if (!el) return;
    const pv = $('#promoIn') ? $('#promoIn').value : '';
    const sub = subtotal(), disc = discount(sub), fee = deliveryFee(sub), total = sub - disc + (fee || 0), L = config.locations;
    el.innerHTML = linesHTML() + `
      <div class="promo">${state.promo
        ? `<span>Code <b>${esc(state.promo.code)}</b> applied</span><button type="button" class="rm inline" data-promo-rm>Remove</button>`
        : `<input id="promoIn" placeholder="Promo code" aria-label="Promo code" value="${esc(pv)}" autocapitalize="characters" autocomplete="off"><button type="button" class="btn sm" data-promo>Apply</button>`}</div>
      <p class="ferr" id="e-promoIn" role="alert"></p>
      <div class="sum">
        <div><span>Subtotal</span><span>${money(sub)}</span></div>
        ${disc ? `<div><span>Discount</span><span>\u2212${money(disc)}</span></div>` : ''}
        <div><span>Delivery${state.city && state.region !== OTHER() ? ' to ' + esc(state.city) : ''}</span><span>${fee === null ? 'Choose your town' : fee === 0 ? 'Free' : money(fee)}</span></div>
        ${L.freeDeliveryOver && sub < L.freeDeliveryOver ? `<p class="hint">Spend ${money(L.freeDeliveryOver - sub)} more for free delivery.</p>` : ''}
        <div class="total"><span>Total</span><span>${money(total)}</span></div>
      </div>`;
    const all = $('[data-selall]'); if (all) all.indeterminate = selected().length > 0 && selected().length < cart.length;
    updatePayUI();
  }
  function updatePayUI() {
    const btn = $('#placeBtn'); if (!btn || btn.dataset.busy) return;
    const sub = subtotal(), fee = deliveryFee(sub), total = sub - discount(sub) + (fee || 0);
    const pm = ($('#checkout [name=payment]:checked') || {}).value;
    btn.disabled = !selected().length;
    btn.textContent = !selected().length ? 'Select items to order' : pm === 'online' ? (fee === null ? 'Continue to payment' : `Pay ${money(total)} now`) : (fee === null ? 'Place order' : `Place order, pay ${money(total)} on delivery`);
  }
  function renderCart() {
    updateCount();
    if (panel === 'done') return;
    const body = $('#cartBody');
    if (!cart.length) { body.innerHTML = '<p class="empty">Your cart is empty. Pick a size on any product to add it.</p>'; return; }
    if (!$('#checkout', body)) { body.innerHTML = '<div id="cartLines"></div>' + formHTML(); restoreForm(); }
    renderLines();
  }
  const whenTxt = (date, slot) => date ? `<br>Delivery: ${esc(dateLabel(date))}, ${esc(slot)}` : '';
  const donePanel = (title, html) => { panel = 'done'; $('#cartBody').innerHTML = `<div class="ok"><img src="img/logo.png" alt=""><h2>${title}</h2>${html}<button class="btn" type="button" data-close>Keep shopping</button></div>`; };

  /* ---------- Checkout ---------- */
  const readForm = f => Object.fromEntries(new FormData(f));
  function validateAll(c, payment) {
    const errs = {};
    for (const k of Object.keys(rules)) { const m = rules[k](c[k] || '', { payment, region: c.region }); if (m) errs[k] = m; }
    return errs;
  }
  function showErrors(fields) {
    const keys = ['name', 'phone', 'email', 'region', 'city', 'address', 'deliveryDate', 'deliverySlot'];
    keys.forEach(k => setErr('c-' + k, fields[k] || ''));
    if (fields.promo) setErr('promoIn', fields.promo);
    const first = keys.find(k => fields[k]);
    if (first) $('#c-' + first).focus();
  }

  async function placeOrder(e) {
    e.preventDefault();
    const f = e.target, err = $('#orderErr'), btn = $('#placeBtn');
    err.textContent = '';
    const customer = readForm(f), payment = customer.payment || 'delivery';
    delete customer.payment;
    const errs = validateAll(customer, payment);
    showErrors(errs);
    if (Object.keys(errs).length) { err.textContent = 'Please fix the highlighted fields and try again.'; return; }
    const msgs = reconcileCart();
    if (msgs.length) { renderCart(); msgs.forEach(m => toast(m, { type: 'warn', ms: 6000 })); err.textContent = 'Your cart changed because of stock. Check it and place your order again.'; return; }
    if (!selected().length) { err.textContent = 'Select at least one item to order.'; return; }
    if (!navigator.onLine) { err.textContent = 'You appear to be offline. Your cart is saved. Try again when you are back online.'; return; }
    btn.dataset.busy = '1';
    btn.disabled = true; btn.textContent = payment === 'online' ? 'Taking you to payment...' : 'Placing order...';
    let finished = false;
    try {
      const items = selected().map(l => ({ id: l.id, size: l.size, qty: l.qty }));
      const { ok, status, data } = await api('/api/orders', { customer, items, payment, promo: state.promo && state.promo.code });
      if (!ok) {
        if (data.fields) showErrors(data.fields);
        if (data.code === 'STOCK' || data.code === 'INVALID_ITEM') { await refreshCatalog(); reconcileCart(); renderCart(); }
        if (data.code === 'SCHEDULE') await refreshSchedule();
        const el = $('#orderErr');
        if (el) el.textContent = data.error || (status === 429 ? 'Too many attempts. Please wait a few minutes and try again.' : 'We could not place your order. Please try again.');
        return;
      }
      cart = cart.filter(l => l.sel === false); state.promo = null; store.set('bs-cart', cart);
      updateCount();
      if (data.paymentUrl) { finished = true; location.href = data.paymentUrl; return; }
      donePanel('Order placed', `<p>Your order number is <strong>${esc(data.id)}</strong>.<br>Total ${money(data.total)}, pay on delivery.${whenTxt(customer.deliveryDate, customer.deliverySlot)}<br>We will call ${esc(customer.phone)} to confirm.</p><p class="hint">You can track it any time with your order number and phone number.</p>`);
      refreshCatalog();
    } catch { const el = $('#orderErr'); if (el) el.textContent = OFFLINE_MSG; }
    finally { delete btn.dataset.busy; if (!finished && btn.isConnected) updatePayUI(); }
  }

  async function refreshSchedule() {
    await loadConfig();
    const d = $('#c-deliveryDate'); if (d) { const keep = d.value; d.innerHTML = dateOptions(); if ([...d.options].some(o => o.value === keep)) d.value = keep; }
  }

  async function handleReturn() {
    const id = new URLSearchParams(location.search).get('pay');
    if (!id) return;
    history.replaceState(null, '', location.pathname);
    panel = 'done'; $('#cartBody').innerHTML = '<p class="empty">Confirming your payment...</p>'; show('#cartDrawer');
    try {
      const { ok, data } = await api('/api/orders/verify?reference=' + encodeURIComponent(id));
      if (!ok) throw new Error(data.error);
      if (data.paymentStatus === 'paid') donePanel('Payment received', `<p>Your order number is <strong>${esc(data.id)}</strong>.<br>Total ${money(data.total)}. We will contact you to confirm delivery.</p><p class="hint">A receipt is on its way to your email.</p>`);
      else if (data.status === 'cancelled') donePanel('Payment not completed', '<p>The payment was not completed in time, so the order was released. Your items are still in the shop if you would like to try again.</p>');
      else donePanel('Payment not completed', `<p>We have not received your payment yet. Order <strong>${esc(data.id)}</strong> is held for 30 minutes.</p>${data.paymentUrl ? `<p><a class="btn" href="${esc(data.paymentUrl)}">Complete payment</a></p>` : ''}`);
    } catch (x) { donePanel('We could not confirm your payment', `<p>${esc(x.message || 'Check your connection.')} If money left your account, track your order with your order number and phone number, or message us on WhatsApp.</p>`); }
  }

  /* ---------- Order tracking ---------- */
  const STATUS = { pending: 'Order received', paid: 'Payment confirmed', shipped: 'On the way', delivered: 'Delivered', cancelled: 'Cancelled' };
  function orderHTML(o) {
    const steps = ['pending', 'paid', 'shipped', 'delivered'], cur = steps.indexOf(o.status);
    return `
      <div class="trk">
        <p><strong>${esc(o.id)}</strong> <span class="badge ${esc(o.status)}">${STATUS[o.status] || esc(o.status)}</span></p>
        ${o.status === 'cancelled' ? '<p class="hint">This order was cancelled. If you paid, we will contact you about a refund.</p>' : `<ol class="steps">${steps.map((s, i) => `<li class="${i <= cur ? 'done' : ''}">${STATUS[s]}</li>`).join('')}</ol>`}
        ${o.schedule ? `<p class="hint">Delivery: ${esc(dateLabel(o.schedule.date))}, ${esc(o.schedule.slot)}${o.place ? ' to ' + esc(o.place) : ''}</p>` : ''}
        ${o.items.map(l => `<div class="trow"><span>${esc(l.name)} (${esc(l.size)}) x${l.qty}</span><span>${money(l.price * l.qty)}</span></div>`).join('')}
        <div class="trow"><span>Delivery</span><span>${o.delivery ? money(o.delivery) : 'Free'}</span></div>
        <div class="trow tot"><span>Total</span><span>${money(o.total)}</span></div>
        <p class="hint">${o.paymentMethod === 'online' ? (o.paymentStatus === 'paid' ? 'Paid online.' : 'Awaiting payment.') : 'Pay on delivery.'}</p>
        ${o.paymentUrl ? `<a class="btn" href="${esc(o.paymentUrl)}">Complete payment</a>` : ''}
      </div>`;
  }
  async function trackOrder(e) {
    e.preventDefault();
    const id = $('#t-id').value.trim().toUpperCase(), phone = $('#t-phone').value, out = $('#trackResult'), btn = $('#trackBtn');
    const idErr = /^BS-[A-F0-9]{6}$/.test(id) ? '' : 'Enter your order number, for example BS-1A2B3C.';
    const phErr = rules.phone(phone);
    setErr('t-id', idErr); setErr('t-phone', phErr); out.innerHTML = '';
    if (idErr || phErr) return;
    btn.disabled = true; btn.textContent = 'Looking...';
    try {
      const { ok, data } = await api('/api/orders/track', { id, phone });
      out.innerHTML = ok ? orderHTML(data) : `<p class="ferr">${esc(data.error || 'We could not find that order.')}</p>`;
    } catch { out.innerHTML = `<p class="ferr">${esc(OFFLINE_MSG.replace(' Your cart is saved and you were not charged.', ''))}</p>`; }
    finally { btn.disabled = false; btn.textContent = 'Track order'; }
  }

  /* ---------- Overlays ---------- */
  function show(sel) {
    const el = $(sel);
    if (!openEl) lastFocus = document.activeElement;
    $$('.drawer,.modal').forEach(x => { x.hidden = x !== el; });
    $('#scrim').hidden = false; document.body.style.overflow = 'hidden'; openEl = el;
    (el.querySelector('.x') || el).focus();
  }
  function closeAll() {
    $$('.drawer,.modal').forEach(x => { x.hidden = true; });
    $('#scrim').hidden = true; document.body.style.overflow = ''; openEl = null;
    if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
    lastFocus = null;
  }

  /* ---------- Drop countdown ---------- */
  function startCountdown() {
    clearInterval(cdTimer);
    const bar = $('#dropBar'), t = Date.parse(config.dropDate);
    if (!t || t <= Date.now()) { bar.hidden = true; return; }
    const tick = () => {
      const ms = t - Date.now();
      if (ms <= 0) { bar.hidden = true; clearInterval(cdTimer); refreshCatalog(); return; }
      const p = n => String(n).padStart(2, '0');
      $('#dropTime').textContent = `${Math.floor(ms / 864e5)}d ${p(Math.floor(ms % 864e5 / 36e5))}h ${p(Math.floor(ms % 36e5 / 6e4))}m ${p(Math.floor(ms % 6e4 / 1e3))}s`;
      bar.hidden = false;
    };
    tick(); cdTimer = setInterval(tick, 1000);
  }

  /* ---------- Events ---------- */
  document.addEventListener('error', e => { const t = e.target; if (t.tagName === 'IMG' && !t.dataset.fb) { t.dataset.fb = '1'; t.src = PLACEHOLDER; } }, true);

  document.addEventListener('click', async e => {
    const t = e.target;
    if (t.closest('[data-retry]')) { init(); return; }
    const heart = t.closest('[data-heart]');
    if (heart) {
      const id = heart.dataset.heart, had = wish.includes(id);
      wish = had ? wish.filter(x => x !== id) : [...wish, id]; store.set('bs-wish', wish);
      toast(had ? 'Removed from saved' : 'Saved. Find it under Saved at the top.');
      render(); return;
    }
    if (t.closest('[data-clear]')) {
      Object.assign(state, { q: '', limited: false, saved: false, collection: 'All' });
      $('#search').value = ''; $('#onlyLimited').checked = false; $('#collection').value = 'All';
      $('#openSaved').classList.remove('on'); $('#openSaved').setAttribute('aria-pressed', 'false'); render(); return;
    }
    if (t.closest('#openSaved')) {
      state.saved = !state.saved; const b = $('#openSaved');
      b.classList.toggle('on', state.saved); b.setAttribute('aria-pressed', String(state.saved));
      render(); if (state.saved) $('#shop').scrollIntoView({ behavior: 'smooth' }); return;
    }
    const card = t.closest('.card'); if (card) return openProduct(card.dataset.id);
    if (t.closest('#openCart')) { openCart(); return; }
    const op = t.closest('[data-open]'); if (op) { show(op.dataset.open); return; }
    if (t.closest('[data-close]') || t === $('#scrim') || t.classList.contains('modal')) return closeAll();

    const img = t.closest('[data-img]'); if (img) { setGal(+img.dataset.img); return; }
    if (t.closest('#galMain')) { if (Date.now() - lastSwipe > 400) $('#galMain').classList.toggle('zoom'); return; }

    const size = t.closest('[data-size]');
    if (size) {
      chosen = size.dataset.size;
      $$('.sizes button').forEach(b => b.classList.toggle('on', b === size));
      $('#sizeErr').textContent = '';
      const a = avail($('#addBtn').dataset.id, chosen);
      $('#sizeNote').textContent = a <= 5 ? `Only ${a} left in size ${chosen}.` : '';
      return;
    }
    const add = t.closest('#addBtn');
    if (add) {
      if (!chosen) { $('#sizeErr').textContent = 'Choose a size first.'; return; }
      const id = add.dataset.id, a = avail(id, chosen), line = cart.find(l => l.id === id && l.size === chosen);
      if ((line ? line.qty : 0) >= a) { $('#sizeErr').textContent = a < 1 ? 'That size just sold out.' : `You already have all ${a} available in your cart.`; return; }
      line ? line.qty++ : cart.push({ id, size: chosen, qty: 1 });
      panel = null; saveCart(); closeAll();
      const cb = $('#openCart'); cb.classList.remove('bump'); void cb.offsetWidth; cb.classList.add('bump');
      toast('Added to cart', { action: 'View cart', fn: openCart }); return;
    }
    const nb = t.closest('[data-notify]');
    if (nb) {
      const email = $('#nEmail').value.trim();
      if (!EMAIL_RE.test(email)) { setErr('nEmail', 'Enter a valid email address, for example name@gmail.com.'); return; }
      setErr('nEmail', ''); nb.disabled = true;
      try {
        const { ok, data } = await api('/api/notify', { id: nb.dataset.notify, size: $('#nSize').value, email });
        if (ok) { toast('Done. We will email you when it is back.'); $('#nEmail').value = ''; } else setErr('nEmail', data.error || 'We could not save that. Please try again.');
      } catch { setErr('nEmail', 'We could not reach the server. Check your connection and try again.'); }
      nb.disabled = false; return;
    }
    if (t.closest('[data-promo]')) {
      const code = ($('#promoIn').value || '').trim();
      if (!code) { setErr('promoIn', 'Enter a promo code first.'); return; }
      try {
        const { ok, data } = await api('/api/promo', { code });
        if (!ok) { setErr('promoIn', data.error || 'That promo code is not valid.'); return; }
        state.promo = data; renderLines(); toast('Promo code applied');
      } catch { setErr('promoIn', 'We could not check the code. Check your connection and try again.'); }
      return;
    }
    if (t.closest('[data-promo-rm]')) { state.promo = null; renderLines(); return; }

    const undoable = (msg, nextCart) => {
      const backup = JSON.parse(JSON.stringify(cart)), promo = state.promo;
      cart = nextCart; if (!cart.length) state.promo = null; panel = null; saveCart();
      toast(msg, { action: 'Undo', ms: 6000, fn: () => { cart = backup; state.promo = promo; saveCart(); } });
    };
    if (t.closest('[data-clear-cart]')) { undoable('Cart cleared', []); return; }
    if (t.closest('[data-rm-sel]')) { undoable('Selected items removed', cart.filter(l => l.sel === false)); return; }
    const inc = t.closest('[data-inc]'), dec = t.closest('[data-dec]'), rm = t.closest('[data-rm]');
    if (inc) { const l = cart[+inc.dataset.inc]; if (l && l.qty < avail(l.id, l.size)) l.qty++; }
    if (dec) cart[+dec.dataset.dec].qty = Math.max(1, cart[+dec.dataset.dec].qty - 1);
    if (rm) cart.splice(+rm.dataset.rm, 1);
    if (inc || dec || rm) { saveCart(); return; }
    const view = t.closest('.view');
    if (view) { $$('.view').forEach(v => v.classList.toggle('on', v === view)); $('#grid').classList.toggle('dense', view.dataset.cols === '8'); }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAll();
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('card')) { e.preventDefault(); openProduct(e.target.dataset.id); }
    if (e.key === 'Tab' && openEl) {
      const f = $$('button,[href],input,select,textarea,summary,[tabindex]:not([tabindex="-1"])', openEl).filter(x => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (!openEl.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  // Image zoom follows the pointer; swipe changes photo on touch screens.
  document.addEventListener('mousemove', e => { const m = e.target.closest && e.target.closest('#galMain.zoom'); if (m) { const r = m.getBoundingClientRect(); $('#galImg').style.transformOrigin = `${(e.clientX - r.left) / r.width * 100}% ${(e.clientY - r.top) / r.height * 100}%`; } });
  let tx = 0, ty = 0;
  document.addEventListener('touchstart', e => { if (e.target.closest('#galMain')) { tx = e.touches[0].clientX; ty = e.touches[0].clientY; } }, { passive: true });
  document.addEventListener('touchend', e => {
    if (!e.target.closest('#galMain') || $('#galMain').classList.contains('zoom')) return;
    const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { lastSwipe = Date.now(); setGal(dx < 0 ? 1 : 0); }
  });

  // Checkout form: check each field when the person leaves it, and clear the message once it is fixed.
  const fieldName = el => el && el.closest && el.closest('#checkout') && el.name && rules[el.name] ? el.name : null;
  document.addEventListener('focusout', e => {
    const n = fieldName(e.target); if (!n) return;
    setErr('c-' + n, rules[n](e.target.value, readForm($('#checkout'))));
  });
  document.addEventListener('input', e => {
    const f = e.target.closest && e.target.closest('#checkout');
    if (f) {
      const d = readForm(f); delete d.payment; delete d.deliveryDate; delete d.deliverySlot; store.set('bs-form', d);
      const n = fieldName(e.target);
      if (n && $('#e-c-' + n).textContent && !rules[n](e.target.value, readForm(f))) setErr('c-' + n, '');
    }
  });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.matches && t.matches('[data-selall]')) { cart.forEach(l => { l.sel = t.checked; }); saveCart(); return; }
    if (t.matches && t.matches('[data-sel]')) { cart[+t.dataset.sel].sel = t.checked; saveCart(); return; }
    if (t.id === 'c-region') {
      state.region = t.value; state.city = '';
      $('#townWrap').innerHTML = townControl(t.value);
      setErr('c-city', ''); renderLines();
      const f = $('#checkout'), d = readForm(f); store.set('bs-form', { name: d.name, phone: d.phone, email: d.email, address: d.address, region: d.region, city: '' });
    }
    if (t.id === 'c-city') { state.city = t.value; renderLines(); }
    if (t.name === 'payment') { updatePayUI(); if ($('#e-c-email').textContent) setErr('c-email', rules.email($('#c-email').value, readForm($('#checkout')))); }
  });
  document.addEventListener('submit', e => {
    if (e.target.id === 'checkout') placeOrder(e);
    if (e.target.id === 'trackForm') trackOrder(e);
  });

  $('#collection').addEventListener('change', e => { state.collection = e.target.value; render(); });
  $('#sort').addEventListener('change', e => { state.sort = e.target.value; render(); });
  $('#search').addEventListener('input', e => { state.q = e.target.value.trim().toLowerCase(); render(); });
  $('#onlyLimited').addEventListener('change', e => { state.limited = e.target.checked; render(); });
  $('#filterBtn').addEventListener('click', e => { const h = $('#filters').hidden = !$('#filters').hidden; e.target.setAttribute('aria-expanded', String(!h)); });

  $('#newsletter').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('#newsMsg'), email = $('#email').value.trim();
    msg.classList.remove('bad');
    if (!EMAIL_RE.test(email)) { msg.textContent = 'Enter a valid email address, for example name@gmail.com.'; msg.classList.add('bad'); return; }
    try {
      const { ok, data } = await api('/api/subscribe', { email });
      msg.textContent = ok ? 'You are on the list.' : (data.error || 'We could not sign you up. Please try again.');
      if (ok) e.target.reset(); else msg.classList.add('bad');
    } catch { msg.textContent = 'We could not reach the server. Check your connection and try again.'; msg.classList.add('bad'); }
  });

  window.addEventListener('offline', () => { $('#netBanner').hidden = false; });
  window.addEventListener('online', () => { $('#netBanner').hidden = true; toast('You are back online'); if (!catalog.products.length) init(); });

  /* ---------- Start ---------- */
  async function init() {
    skeleton();
    const [, ok] = await Promise.all([loadConfig(), loadCatalog()]);
    if (!ok) { $('#grid').innerHTML = ''; $('#count').textContent = ''; $('#loadErr').hidden = false; return; }
    render(); renderRecent();
    const msgs = reconcileCart(); renderCart();
    msgs.forEach(m => toast(m, { type: 'warn', ms: 6000 }));
  }
  $('#year').textContent = new Date().getFullYear();
  if (!navigator.onLine) $('#netBanner').hidden = false;
  init().then(handleReturn);
})();
