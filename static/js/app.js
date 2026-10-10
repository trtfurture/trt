(function () {
  'use strict';
  const CART_KEY = 'trt-cart-v1';
  const SAVED_KEY = 'trt-saved-v1';
  const SESSION_KEY = 'trt-session-v1';
  const REF_KEY = 'trt-ref-v1';
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const body = document.body;
  const currency = (body.dataset.siteName ? 'KSh' : 'KSh');
  const intro = $('#brandIntro');
  try { if (intro && !sessionStorage.getItem('trt-intro-seen') && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) { sessionStorage.setItem('trt-intro-seen','1'); intro.classList.add('intro-play'); window.setTimeout(()=>{intro.classList.add('intro-done');intro.classList.remove('intro-play');},900); } else if (intro) intro.classList.add('intro-done'); } catch (_) { if (intro) intro.classList.add('intro-done'); }

  function safeParse(value, fallback) { try { return JSON.parse(value) ?? fallback; } catch (_) { return fallback; } }
  function getCart() { const cart = safeParse(localStorage.getItem(CART_KEY), []); return Array.isArray(cart) ? cart.filter(x => x && x.id && Number(x.quantity) > 0) : []; }
  function saveCart(cart) { localStorage.setItem(CART_KEY, JSON.stringify(cart)); renderCart(); renderCheckout(); renderFullCart(); }
  function money(amount) { return currency + ' ' + Number(amount || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 }); }
  function cartCount() { return getCart().reduce((sum, item) => sum + Number(item.quantity || 0), 0); }
  function cartSubtotal() { return getCart().reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0); }
  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
  function toast(message) { const el = $('#toast'); if (!el) return; el.textContent = message; el.classList.add('show'); window.clearTimeout(toast._timer); toast._timer = window.setTimeout(() => el.classList.remove('show'), 2600); }
  function getSessionId() { let value = sessionStorage.getItem(SESSION_KEY); if (!value) { value = 's_' + (window.crypto && crypto.randomUUID ? crypto.randomUUID().replace(/-/g,'') : Math.random().toString(36).slice(2) + Date.now().toString(36)); sessionStorage.setItem(SESSION_KEY, value); } return value; }
  function referralCode() { const urlCode = new URLSearchParams(location.search).get('ref'); if (urlCode) { localStorage.setItem(REF_KEY, urlCode.slice(0,80)); return urlCode.slice(0,80); } return localStorage.getItem(REF_KEY) || ''; }
  function track(event, extras={}) {
    const payload = Object.assign({ event, path: location.pathname + location.search, session_id: getSessionId(), referral_code: referralCode() }, extras);
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(payload)], {type:'application/json'});
      navigator.sendBeacon('/api/analytics', blob);
    } else fetch('/api/analytics', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),keepalive:true}).catch(()=>{});
  }
  function normalizePhone(value) { return String(value || '').replace(/\D/g, '').replace(/^0(?=\d{9}$)/,'254').replace(/^(7|1)(?=\d{8}$)/,'254$1'); }
  function whatsappUrl(message) { const phone = normalizePhone(body.dataset.whatsapp); if (!phone) { toast('WhatsApp is not set up yet. Use Contact TRT.'); return ''; } return 'https://wa.me/' + phone + '?text=' + encodeURIComponent(message || 'Hello TRT, I have a furniture enquiry.'); }
  function openCart() { $('#cartDrawer')?.classList.add('open'); $('#cartBackdrop')?.classList.add('open'); $('#cartDrawer')?.setAttribute('aria-hidden','false'); document.body.classList.add('drawer-open'); }
  function closeCart() { $('#cartDrawer')?.classList.remove('open'); $('#cartBackdrop')?.classList.remove('open'); $('#cartDrawer')?.setAttribute('aria-hidden','true'); document.body.classList.remove('drawer-open'); }
  function openCategories() { $('#categoryDrawer')?.classList.add('open'); $('#drawerBackdrop')?.classList.add('open'); $('#categoryDrawer')?.setAttribute('aria-hidden','false'); $('#menuOpen')?.setAttribute('aria-expanded','true'); }
  function closeCategories() { $('#categoryDrawer')?.classList.remove('open'); $('#drawerBackdrop')?.classList.remove('open'); $('#categoryDrawer')?.setAttribute('aria-hidden','true'); $('#menuOpen')?.setAttribute('aria-expanded','false'); }

  function addProduct(button) {
    const id = Number(button.dataset.productId);
    const name = button.dataset.name || button.dataset.productName || 'TRT product';
    const price = Number(button.dataset.price || button.dataset.productPrice || 0);
    const quantityInput = button.dataset.useQuantity ? document.getElementById(button.dataset.useQuantity) : null;
    const quantity = Math.max(1, Math.min(20, Number(quantityInput?.value || 1)));
    const stock = Number(button.dataset.stock ?? 99);
    if (!id || !Number.isFinite(price)) return toast('This product could not be added. Refresh the page and try again.');
    if (stock <= 0) { const url = whatsappUrl('Hello TRT, is ' + name + ' available or made to order?'); if (url) window.open(url, '_blank', 'noopener'); return; }
    let cart = getCart();
    const found = cart.find(item => Number(item.id) === id);
    if (found) {
      if (found.quantity + quantity > stock) return toast('Only ' + stock + ' of this item are currently listed.');
      found.quantity += quantity;
    } else {
      if (quantity > stock) return toast('Only ' + stock + ' of this item are currently listed.');
      cart.push({id, name, price, image: button.dataset.image || '', slug: button.dataset.slug || '', quantity, stock});
    }
    saveCart(cart); track('add_to_cart', {product_id:id, metadata:{name,quantity}}); toast(name + ' added to your bag.');
    if (button.classList.contains('add-detail-button')) button.innerHTML = 'Added to bag ✓';
    if (button.dataset.fromFullCart !== 'yes') { /* Side drawer remains non-blocking after an add. */ }
  }

  function itemHtml(item, idx, full=false) {
    const image = item.image || 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=400&q=75';
    const productLink = item.slug ? '/product/' + encodeURIComponent(item.slug) : '/shop';
    if (full) return `<article class="full-cart-line" data-cart-line="${Number(item.id)}"><a href="${productLink}"><img src="${escapeHtml(image)}" alt="${escapeHtml(item.name)}"></a><div><span class="full-cart-category">TRT / SELECTION</span><h3><a href="${productLink}">${escapeHtml(item.name)}</a></h3><p>${money(item.price)} each</p><div class="cart-line-actions"><div class="mini-quantity"><button type="button" data-cart-change="-1" data-cart-id="${Number(item.id)}" aria-label="Decrease quantity">−</button><span>${Number(item.quantity)}</span><button type="button" data-cart-change="1" data-cart-id="${Number(item.id)}" aria-label="Increase quantity">+</button></div><button type="button" class="text-button" data-cart-remove="${Number(item.id)}">Remove</button></div></div><div class="full-cart-line-total">${money(item.price*item.quantity)}</div></article>`;
    return `<article class="cart-line-item" data-cart-line="${Number(item.id)}"><a href="${productLink}"><img src="${escapeHtml(image)}" alt="${escapeHtml(item.name)}"></a><div class="cart-line-copy"><strong>${escapeHtml(item.name)}</strong><span>${money(item.price)}</span><div class="cart-line-actions"><div class="mini-quantity"><button type="button" data-cart-change="-1" data-cart-id="${Number(item.id)}" aria-label="Decrease quantity">−</button><span>${Number(item.quantity)}</span><button type="button" data-cart-change="1" data-cart-id="${Number(item.id)}" aria-label="Increase quantity">+</button></div></div></div><strong class="cart-line-price">${money(item.price*item.quantity)}</strong><button type="button" class="cart-remove" data-cart-remove="${Number(item.id)}" aria-label="Remove ${escapeHtml(item.name)}">×</button></article>`;
  }
  function renderCart() {
    const cart = getCart(); const count = cart.reduce((sum,item)=>sum+Number(item.quantity),0); const subtotal = cartSubtotal();
    const countEl = $('#cartCount'); if(countEl) countEl.textContent = count > 99 ? '99+' : count;
    const itemText = $('#cartItemText'); if(itemText) itemText.textContent = '(' + count + ')';
    const items = $('#cartItems'); if(items) items.innerHTML = cart.map((item,i)=>itemHtml(item,i)).join('');
    const empty = $('#cartEmpty'); const footer = $('#cartFooter');
    if(empty) empty.style.display = cart.length ? 'none' : 'block';
    if(footer) footer.style.display = cart.length ? 'block' : 'none';
    const sum = $('#cartSubtotal'); if(sum) sum.textContent = money(subtotal);
  }
  function renderFullCart() {
    const root = $('#fullCartItems'); if(!root) return;
    const cart = getCart();
    if (!cart.length) { root.innerHTML = `<div class="no-products"><div class="no-products-mark">◇</div><h2>Your bag is waiting for something lovely.</h2><p>Explore the collection and add a few pieces you like.</p><a class="button button-dark" href="/shop">Explore all pieces ↗</a></div>`; }
    else root.innerHTML = cart.map((item,i)=>itemHtml(item,i,true)).join('');
    const sum = $('#fullCartSubtotal'); if(sum) sum.textContent = money(cartSubtotal());
    const go = $('#fullCartCheckout'); if(go) { go.setAttribute('aria-disabled', cart.length ? 'false':'true'); go.classList.toggle('is-disabled',!cart.length); }
  }
  function renderCheckout() {
    const root = $('#checkoutItems'); if (!root) return;
    const cart = getCart();
    if (!cart.length) {
      root.innerHTML = '<p class="checkout-empty-note">Your bag is empty. <a href="/shop">Explore products ↗</a></p>';
      const button = $('#placeOrder'); if(button) button.disabled = true;
    } else {
      root.innerHTML = cart.map(item => `<div class="checkout-mini-item"><img src="${escapeHtml(item.image || '')}" alt="${escapeHtml(item.name)}"><div><strong>${escapeHtml(item.name)}</strong><span>${item.quantity} × ${money(item.price)}</span></div><b>${money(item.quantity*item.price)}</b></div>`).join('');
      const button = $('#placeOrder'); if(button) button.disabled = false;
    }
    const count = cart.reduce((sum,item)=>sum+item.quantity,0); const countEl=$('#checkoutItemCount'); if(countEl) countEl.textContent='(' + count + (count===1?' item':' items') + ')';
    const subtotal = cartSubtotal(); const subtotalEl=$('#checkoutSubtotal'); if(subtotalEl) subtotalEl.textContent=money(subtotal);
    const pickup = $('#deliveryMethod')?.value === 'pickup';
    const fee = pickup ? 0 : Number($('#checkoutForm')?.dataset.deliveryFee || 0);
    const d=$('#checkoutDelivery'); if(d) d.textContent=pickup ? 'Collection' : (fee > 0 ? money(fee) : 'To confirm');
    const t=$('#checkoutTotal'); if(t) t.textContent=money(subtotal+fee);
  }

  $('#menuOpen')?.addEventListener('click', openCategories);
  $('#menuClose')?.addEventListener('click', closeCategories);
  $('#drawerBackdrop')?.addEventListener('click', closeCategories);
  $('#cartOpen')?.addEventListener('click', openCart);
  $('#cartClose')?.addEventListener('click', closeCart);
  $('#cartBackdrop')?.addEventListener('click', closeCart);
  $('#continueShopping')?.addEventListener('click', closeCart);
  $('#keepShopping')?.addEventListener('click', closeCart);
  $('#mobileSearchOpen')?.addEventListener('click', () => { const header=$('.site-header'); header?.classList.toggle('search-open'); if(header?.classList.contains('search-open')) setTimeout(()=>$('.header-search input')?.focus(),80); });
  document.addEventListener('keydown', e => { if(e.key==='Escape'){closeCart();closeCategories();$('.site-header')?.classList.remove('search-open');} });

  document.addEventListener('click', (event) => {
    const add = event.target.closest('[data-add-cart]'); if(add){ event.preventDefault(); addProduct(add); return; }
    const wa = event.target.closest('[data-whatsapp-product]'); if(wa){ event.preventDefault(); const name=wa.dataset.productName||wa.dataset.name||'this piece'; const price=wa.dataset.productPrice||wa.dataset.price; const msg='Hello TRT, I am interested in ' + name + (price ? ' listed at ' + money(price) : '') + '. Please confirm availability, exact details and delivery.'; const url=whatsappUrl(msg); if(url){ track('whatsapp_click',{product_id:Number(wa.dataset.productId)||null,metadata:{product_name:name}}); window.open(url,'_blank','noopener'); } return; }
    const change = event.target.closest('[data-cart-change]'); if(change){ const id=Number(change.dataset.cartId), delta=Number(change.dataset.cartChange); let cart=getCart(); const item=cart.find(x=>Number(x.id)===id); if(item){ const next=item.quantity+delta; if(next<1) return; if(item.stock && next>item.stock) return toast('Only '+item.stock+' of this item are listed.'); item.quantity=next; saveCart(cart); } return; }
    const remove = event.target.closest('[data-cart-remove]'); if(remove){ const id=Number(remove.dataset.cartRemove); saveCart(getCart().filter(x=>Number(x.id)!==id)); track('remove_from_cart',{product_id:id}); toast('Item removed from your bag.'); return; }
    const save = event.target.closest('[data-save-product]'); if(save){ let saved=safeParse(localStorage.getItem(SAVED_KEY),[]); const id=Number(save.dataset.saveProduct); if(saved.includes(id)){saved=saved.filter(x=>x!==id);save.classList.remove('saved');toast('Removed from saved pieces.');}else{saved.push(id);save.classList.add('saved');toast('Saved for later on this device.');} localStorage.setItem(SAVED_KEY,JSON.stringify(saved)); $$('[data-save-product="'+id+'"]').forEach(el=>el.classList.toggle('saved',saved.includes(id))); return; }
    const share = event.target.closest('[data-share-product]'); if(share){ const data={title:share.dataset.productName||'TRT product',text:'Have a look at this piece on TRT',url:location.href}; if(navigator.share) navigator.share(data).catch(()=>{}); else if(navigator.clipboard) navigator.clipboard.writeText(location.href).then(()=>toast('Product link copied.')).catch(()=>toast('Copy the product URL from your browser.')); else toast('Copy the product URL from your browser.'); track('share_click',{metadata:{product_name:data.title}}); return; }
    const tracked = event.target.closest('[data-track]'); if(tracked){ const ev=tracked.dataset.track; const id=Number(tracked.dataset.productId)||null; track(ev,{product_id:id,category:tracked.dataset.category||'',metadata:{kind:tracked.dataset.contactKind||''}}); }
  });

  $$('[data-quantity-minus]').forEach(btn=>btn.addEventListener('click',()=>{const input=$('#productQuantity');if(input)input.value=Math.max(1,Number(input.value||1)-1);}));
  $$('[data-quantity-plus]').forEach(btn=>btn.addEventListener('click',()=>{const input=$('#productQuantity');if(input)input.value=Math.min(Number(input.max||20),Number(input.value||1)+1);}));
  const deliveryMethod=$('#deliveryMethod'); if(deliveryMethod) deliveryMethod.addEventListener('change',renderCheckout);
  const checkoutForm=$('#checkoutForm');
  if(checkoutForm){ checkoutForm.dataset.deliveryFee=String(document.body.dataset.deliveryFee||0); checkoutForm.addEventListener('submit',async (event)=>{
    event.preventDefault(); const cart=getCart(); if(!cart.length){toast('Your bag is empty. Add products first.');return;}
    if(!$('#orderConsent')?.checked){toast('Please confirm the ordering note before submitting.');return;}
    const button=$('#placeOrder'); const original=button?.innerHTML; if(button){button.disabled=true;button.innerHTML='Saving your order…';}
    track('begin_checkout',{metadata:{item_count:cart.length}}); const formData=new FormData(checkoutForm); const payload=Object.fromEntries(formData.entries()); payload.items=cart.map(item=>({id:item.id,quantity:item.quantity})); payload.referral_code=referralCode();
    try{
      const response=await fetch('/api/orders',{method:'POST',headers:{'Content-Type':'application/json','X-TRT-Session':getSessionId()},body:JSON.stringify(payload)}); const result=await response.json();
      if(!response.ok || !result.ok) throw new Error(result.error||'We could not submit this order. Try again.');
      localStorage.removeItem(CART_KEY); renderCart(); renderCheckout(); renderFullCart(); track('begin_checkout',{metadata:{order_no:result.order_no}});
      const resultBox=$('#checkoutResult'); if(resultBox){resultBox.hidden=false;resultBox.innerHTML=`<div class="order-success-mark">TRT</div><p class="eyebrow">ORDER REFERENCE / ${escapeHtml(result.order_no)}</p><h2>Your order has been saved.</h2><p>Estimated total: <strong>${escapeHtml(result.formatted_total||money(result.total))}</strong></p><p>${escapeHtml(result.payment_message||'TRT will contact you to confirm the order, payment and delivery details.')}</p><div class="checkout-result-actions">${result.payment_url?`<a class="button button-dark" href="${escapeHtml(result.payment_url)}" target="_blank" rel="noopener">Continue to payment ↗</a>`:''}<a class="button button-outline" href="${escapeHtml(result.order_url)}">View order status</a>${result.whatsapp_url?`<a class="button button-wa" href="${escapeHtml(result.whatsapp_url)}" target="_blank" rel="noopener">Contact TRT on WhatsApp ↗</a>`:''}</div><p>Keep your reference <strong>${escapeHtml(result.order_no)}</strong>. Never share your M-Pesa PIN.</p>`; resultBox.scrollIntoView({behavior:'smooth',block:'start'}); }
      checkoutForm.style.display='none';
    }catch(error){toast(error.message||'Something went wrong. Please try again.');if(button){button.disabled=false;button.innerHTML=original||'Place my order →';}}
  }); }

  // Initialize saved heart states, cart surfaces and useful analytics.
  const saved = safeParse(localStorage.getItem(SAVED_KEY),[]); $$('[data-save-product]').forEach(el=>el.classList.toggle('saved',saved.includes(Number(el.dataset.saveProduct))));
  renderCart(); renderCheckout(); renderFullCart();
  track('page_view');

  // Product typeahead keeps search useful without leaving the first page.
  const suggestionTimers = new WeakMap();
  function closeSuggestions(form) { form.querySelector('.search-suggestions')?.remove(); }
  function showSuggestions(form, products, term) {
    closeSuggestions(form);
    const box=document.createElement('div'); box.className='search-suggestions'; box.setAttribute('role','listbox');
    if(!products.length){box.innerHTML=`<div class="suggestion-empty">No direct matches for “${escapeHtml(term)}”. Press Enter to search the full catalogue.</div>`;}
    else {box.innerHTML=products.map(p=>`<a role="option" class="suggestion-link" href="/product/${encodeURIComponent(p.slug)}" data-suggestion-product="${Number(p.id)}"><img src="${escapeHtml(p.image)}" alt=""><span class="suggestion-copy"><strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(p.category)} · ${money(p.price)}</span></span><span class="suggestion-arrow">↗</span></a>`).join('');}
    form.appendChild(box);
  }
  $$('form.header-search, form.shop-search').forEach(form=>{
    const input=form.querySelector('input[name="q"]'); if(!input)return;
    input.setAttribute('autocomplete','off');
    input.addEventListener('input',()=>{
      window.clearTimeout(suggestionTimers.get(form)); const term=input.value.trim();
      if(term.length<2){closeSuggestions(form);return;}
      const timer=window.setTimeout(async()=>{try{const response=await fetch('/api/search/suggest?q='+encodeURIComponent(term));const data=await response.json();if(input.value.trim()===term)showSuggestions(form,data.products||[],term);}catch(_){closeSuggestions(form);}},190);
      suggestionTimers.set(form,timer);
    });
    input.addEventListener('focus',()=>{if(input.value.trim().length>=2)input.dispatchEvent(new Event('input'));});
    form.addEventListener('submit',()=>{closeSuggestions(form);});
  });
  document.addEventListener('click',event=>{const suggestion=event.target.closest('[data-suggestion-product]');if(suggestion)track('product_click',{product_id:Number(suggestion.dataset.suggestionProduct)});if(!event.target.closest('.header-search')&&!event.target.closest('.shop-search'))$$('.search-suggestions').forEach(el=>el.remove());});

  // Server-side verification lets a customer recheck an initiated payment without trusting a success redirect.
  const verifyForm=$('#verifyPaymentForm');
  verifyForm?.addEventListener('submit',async event=>{event.preventDefault();const phone=$('#verifyPhone')?.value.trim();const message=$('#verifyPaymentMessage');const button=verifyForm.querySelector('button[type="submit"]');if(!phone){toast('Enter the phone number used at checkout.');return;}const original=button.textContent;button.disabled=true;button.textContent='Checking…';if(message)message.textContent='Checking payment status with the provider…';try{const response=await fetch('/api/orders/'+encodeURIComponent(verifyForm.dataset.orderNo)+'/verify-payment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'Payment status could not be checked.');if(message)message.textContent=result.message||'Payment status checked.';if(result.paid){toast('Payment confirmed.');setTimeout(()=>location.reload(),850);}else toast(result.message||'Not confirmed yet.');}catch(error){if(message)message.textContent=error.message||'Could not verify payment at this time.';toast(error.message||'Could not check payment.');}finally{button.disabled=false;button.textContent=original;}});

  // Install is progressive and dismissible. No full-screen prompt and no disruption to checkout.
  let installPrompt = null; const nudge=$('#installNudge');
  window.addEventListener('beforeinstallprompt', event=>{event.preventDefault();installPrompt=event;if(!localStorage.getItem('trt-install-dismissed') && !window.matchMedia('(display-mode: standalone)').matches){setTimeout(()=>{if(nudge&&!localStorage.getItem('trt-install-dismissed'))nudge.hidden=false;},6500);}});
  $('#dismissInstall')?.addEventListener('click',()=>{if(nudge)nudge.hidden=true;localStorage.setItem('trt-install-dismissed','1');});
  $('#installApp')?.addEventListener('click',async()=>{if(!installPrompt){toast('Use your browser menu and choose “Install app” or “Add to Home screen”.');return;}installPrompt.prompt();const choice=await installPrompt.userChoice.catch(()=>({outcome:'dismissed'}));if(choice.outcome==='accepted'){if(nudge)nudge.hidden=true;track('install_prompt');}installPrompt=null;});
  window.addEventListener('appinstalled',()=>{if(nudge)nudge.hidden=true;localStorage.setItem('trt-install-dismissed','1');toast('TRT is installed on your device.');});
  if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));}
})();
