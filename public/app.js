(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const money = n => 'GH\u20B5' + Number(n).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const store = {
    get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };

  let catalog = { collections: [], products: [] };
  let cart = store.get('bs-cart', []);
  let wish = store.get('bs-wish', []);
  const state = { collection: 'All', sort: '', q: '', limited: false };

  // Load from the API; fall back to the static JSON when the server is not running.
  async function load() {
    try {
      const r = await fetch('/api/products');
      if (!r.ok) throw 0;
      catalog = await r.json();
      state.api = true;
    } catch {
      catalog = await (await fetch('data/products.json')).json();
      state.api = false;
    }
    const sel = $('#collection');
    sel.innerHTML = catalog.collections.map(c => `<option>${c === 'All' ? 'Explore collections' : c}</option>`).join('');
    render();
    renderCart();
  }

  function visible() {
    let list = catalog.products.filter(p =>
      (state.collection === 'All' || p.collection === state.collection) &&
      (!state.q || p.name.toLowerCase().includes(state.q)) &&
      (!state.limited || p.limited));
    if (state.sort === 'price-asc') list = [...list].sort((a, b) => a.price - b.price);
    if (state.sort === 'price-desc') list = [...list].sort((a, b) => b.price - a.price);
    return list;
  }

  function render() {
    const list = visible();
    $('#count').textContent = list.length + (list.length === 1 ? ' item' : ' items');
    $('#empty').hidden = list.length > 0;
    $('#grid').innerHTML = list.map(p => `
      <article>
        <div class="card" data-id="${p.id}" tabindex="0" role="button" aria-label="${p.name}, ${money(p.price)}">
          <div class="ph">
            ${p.limited ? '<span class="tag">LIMITED</span>' : ''}
            <img class="f" src="${p.front}" alt="${p.name}, front" loading="lazy">
            <img class="b" src="${p.back}" alt="${p.name}, back" loading="lazy">
            <button class="heart ${wish.includes(p.id) ? 'on' : ''}" data-heart="${p.id}" aria-label="Save ${p.name}" aria-pressed="${wish.includes(p.id)}">${wish.includes(p.id) ? '\u2665' : '\u2661'}</button>
          </div>
          <h3>${p.name}</h3>
          <div class="price">${money(p.price)}</div>
        </div>
      </article>`).join('');
  }

  /* Product modal */
  let chosen = null;
  function openProduct(id) {
    const p = catalog.products.find(x => x.id === id); if (!p) return;
    chosen = null;
    const sizes = Object.keys(p.stock);
    $('#modalBody').innerHTML = `
      <div class="pd">
        <div class="imgs"><img src="${p.front}" alt="${p.name}, front"><img src="${p.back}" alt="${p.name}, back"></div>
        <div>
          <h2>${p.name}</h2>
          <div class="price">${money(p.price)}</div>
          <p>${p.desc}</p>
          <p class="muted" style="color:var(--muted)">Colour: ${p.color}</p>
          <strong>Size</strong>
          <div class="sizes" role="group" aria-label="Size">${sizes.map(s => `<button data-size="${s}" ${p.stock[s] < 1 ? 'disabled' : ''}>${s}</button>`).join('')}</div>
          <p class="err" id="sizeErr"></p>
          <button class="btn block" id="addBtn" data-id="${p.id}">Add to cart</button>
        </div>
      </div>`;
    show('#productModal');
  }

  /* Cart */
  const find = id => catalog.products.find(p => p.id === id);
  const saveCart = () => { store.set('bs-cart', cart); renderCart(); };
  function renderCart(view = 'cart') {
    const n = cart.reduce((a, l) => a + l.qty, 0);
    $('#cartCount').textContent = n;
    const body = $('#cartBody');
    if (view === 'done') return;
    cart = cart.filter(l => find(l.id));
    if (!cart.length) { body.innerHTML = '<p class="empty">Your cart is empty. Pick a size on any product to add it.</p>'; return; }
    const total = cart.reduce((a, l) => a + find(l.id).price * l.qty, 0);
    body.innerHTML = cart.map((l, i) => { const p = find(l.id); return `
      <div class="line">
        <img src="${p.front}" alt="">
        <div><strong>${p.name}</strong><br><small>Size ${l.size}</small>
          <div class="qty"><button data-dec="${i}" aria-label="Fewer">\u2212</button><span>${l.qty}</span><button data-inc="${i}" aria-label="More">+</button></div>
          <button class="rm" data-rm="${i}">Remove</button></div>
        <div>${money(p.price * l.qty)}</div>
      </div>`; }).join('') + `
      <div class="total"><span>Total</span><span>${money(total)}</span></div>
      <form class="form" id="checkout" novalidate>
        <strong>Delivery details</strong>
        <label for="cName">Full name</label><input id="cName" name="name" autocomplete="name" required>
        <label for="cPhone">Phone</label><input id="cPhone" name="phone" type="tel" autocomplete="tel" required>
        <label for="cEmail">Email (optional)</label><input id="cEmail" name="email" type="email" autocomplete="email">
        <label for="cCity">City</label><input id="cCity" name="city" required>
        <label for="cAddr">Address</label><textarea id="cAddr" name="address" rows="2" required></textarea>
        <p class="err" id="orderErr" role="alert"></p>
        <button class="btn block" type="submit">Place order</button>
      </form>`;
  }

  async function placeOrder(e) {
    e.preventDefault();
    const f = e.target, err = $('#orderErr'); err.textContent = '';
    const customer = Object.fromEntries(new FormData(f));
    const items = cart.map(l => ({ id: l.id, size: l.size, qty: l.qty }));
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      if (!state.api) throw new Error('The order server is offline. Start it with npm start and try again.');
      const r = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer, items }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Order failed');
      cart = []; store.set('bs-cart', cart);
      $('#cartCount').textContent = 0;
      $('#cartBody').innerHTML = `<div class="ok"><img src="img/logo.png" alt=""><h2>Order placed</h2><p>Your order number is <strong>${data.id}</strong>.<br>Total ${money(data.total)}. We will call ${customer.phone} to confirm payment and delivery.</p></div>`;
      load();
    } catch (x) { err.textContent = x.message; btn.disabled = false; }
  }

  /* Overlays */
  function show(sel) { $('#scrim').hidden = false; $(sel).hidden = false; document.body.style.overflow = 'hidden'; }
  function closeAll() { ['#scrim', '#cartDrawer', '#productModal'].forEach(s => $(s).hidden = true); document.body.style.overflow = ''; }

  /* Events */
  document.addEventListener('click', e => {
    const t = e.target;
    const heart = t.closest('[data-heart]');
    if (heart) { e.stopPropagation(); const id = heart.dataset.heart; wish = wish.includes(id) ? wish.filter(x => x !== id) : [...wish, id]; store.set('bs-wish', wish); render(); return; }
    const card = t.closest('.card'); if (card) return openProduct(card.dataset.id);
    if (t.closest('#openCart')) { renderCart(); show('#cartDrawer'); return; }
    if (t.closest('[data-close]') || t === $('#scrim') || t === $('#productModal')) return closeAll();
    const size = t.closest('[data-size]');
    if (size) { chosen = size.dataset.size; document.querySelectorAll('.sizes button').forEach(b => b.classList.toggle('on', b === size)); $('#sizeErr').textContent = ''; return; }
    const add = t.closest('#addBtn');
    if (add) {
      if (!chosen) { $('#sizeErr').textContent = 'Choose a size first.'; return; }
      const line = cart.find(l => l.id === add.dataset.id && l.size === chosen);
      line ? line.qty++ : cart.push({ id: add.dataset.id, size: chosen, qty: 1 });
      saveCart(); closeAll(); renderCart(); show('#cartDrawer'); return;
    }
    const inc = t.closest('[data-inc]'), dec = t.closest('[data-dec]'), rm = t.closest('[data-rm]');
    if (inc) cart[+inc.dataset.inc].qty++;
    if (dec) cart[+dec.dataset.dec].qty = Math.max(1, cart[+dec.dataset.dec].qty - 1);
    if (rm) cart.splice(+rm.dataset.rm, 1);
    if (inc || dec || rm) saveCart();
    const view = t.closest('.view');
    if (view) { document.querySelectorAll('.view').forEach(v => v.classList.toggle('on', v === view)); $('#grid').classList.toggle('dense', view.dataset.cols === '8'); }
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeAll();
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('card')) { e.preventDefault(); openProduct(e.target.dataset.id); }
  });
  document.addEventListener('submit', e => { if (e.target.id === 'checkout') placeOrder(e); });

  $('#collection').addEventListener('change', e => { state.collection = e.target.selectedIndex === 0 ? 'All' : e.target.value; render(); });
  $('#sort').addEventListener('change', e => { state.sort = e.target.value; render(); });
  $('#search').addEventListener('input', e => { state.q = e.target.value.trim().toLowerCase(); render(); });
  $('#onlyLimited').addEventListener('change', e => { state.limited = e.target.checked; render(); });
  $('#filterBtn').addEventListener('click', e => { const h = $('#filters').hidden = !$('#filters').hidden; e.target.setAttribute('aria-expanded', String(!h)); });

  $('#newsletter').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('#newsMsg');
    try {
      const r = await fetch('/api/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: $('#email').value }) });
      const d = await r.json();
      msg.textContent = r.ok ? 'You are on the list.' : d.error;
      if (r.ok) e.target.reset();
    } catch { msg.textContent = 'The server is offline. Try again shortly.'; }
  });

  $('#year').textContent = new Date().getFullYear();
  load();
})();
