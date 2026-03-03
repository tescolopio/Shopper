/**
 * app.js — Shopper: D&D 5e Shop Generator for Foundry VTT
 *
 * Pulls item data from the Open5e API and exports the resulting
 * shop inventory as a Foundry VTT Actor JSON that can be imported
 * directly into a D&D 5e world as a merchant NPC.
 */

'use strict';

/* ─────────────────────────────────────────────────────────────
   Constants
   ───────────────────────────────────────────────────────────── */
const API_V1 = 'https://api.open5e.com/v1';
const API_V2 = 'https://api.open5e.com/v2';
const PAGE_SIZE = 20;

/** Maps shop-type dropdown values to human-readable labels. */
const SHOP_TYPE_LABELS = {
  general:    'General Store',
  blacksmith: 'Blacksmith',
  alchemist:  'Alchemist',
  magic:      'Magic Shop',
  tavern:     'Tavern',
  armorer:    'Armorer',
};

/** Foundry VTT dnd5e weapon category → weaponType identifier. */
const WEAPON_TYPE_MAP = {
  'simple melee':   'simpleM',
  'simple ranged':  'simpleR',
  'martial melee':  'martialM',
  'martial ranged': 'martialR',
};

/** Open5e weapon property names → Foundry dnd5e property keys. */
const PROPERTY_MAP = {
  finesse:      'fin',
  light:        'lgt',
  thrown:       'thr',
  'two-handed': 'two',
  versatile:    'ver',
  reach:        'rch',
  ammunition:   'amm',
  loading:      'lod',
  heavy:        'hvy',
  special:      'spc',
};

/* ─────────────────────────────────────────────────────────────
   Application State
   ───────────────────────────────────────────────────────────── */
const state = {
  /** Currently selected category tab. */
  currentCategory: 'weapons',
  /** Current search term. */
  searchQuery: '',
  /** Current browser page (1-indexed). */
  currentPage: 1,
  /** Total results count for current query. */
  totalCount: 0,
  /** Items displayed in the browser (normalised). */
  browserItems: [],
  /** Items added to the shop inventory. */
  inventory: [],
  /** Whether an API call is in progress. */
  loading: false,
};

/* ─────────────────────────────────────────────────────────────
   API Layer
   ───────────────────────────────────────────────────────────── */

/**
 * Fetch items from the Open5e API for the given category, optional
 * search term, and page number.
 * @param {string} category - 'weapons' | 'armor' | 'magicitems' | 'equipment'
 * @param {string} search
 * @param {number} page
 * @returns {Promise<{count:number, results:Array}>}
 */
async function fetchItems(category, search, page) {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  params.set('limit', String(PAGE_SIZE));
  params.set('offset', String((page - 1) * PAGE_SIZE));

  let url;
  if (category === 'weapons')    url = `${API_V2}/weapons/?${params}`;
  else if (category === 'armor') url = `${API_V2}/armor/?${params}`;
  else if (category === 'magicitems') url = `${API_V1}/magicitems/?${params}`;
  else                            url = `${API_V1}/equipment/?${params}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open5e API error ${res.status}: ${res.statusText}`);
  return res.json();
}

/* ─────────────────────────────────────────────────────────────
   Data Normalisation Helpers
   ───────────────────────────────────────────────────────────── */

/**
 * Parse the price from a raw Open5e item into { value, denomination }.
 * v2 API (weapons/armor): cost = { quantity, unit }
 * v1 API (equipment):     cost = "10 gp"
 * v1 API (magicitems):    no standard cost
 */
function parsePrice(raw, category) {
  let value = 0;
  let denomination = 'gp';

  try {
    if (category === 'weapons' || category === 'armor') {
      if (raw.cost && typeof raw.cost === 'object') {
        value = parseFloat(raw.cost.quantity) || 0;
        denomination = String(raw.cost.unit || 'gp').toLowerCase();
      }
    } else if (category === 'equipment') {
      if (typeof raw.cost === 'string') {
        const m = raw.cost.match(/^([\d,]+(?:\.\d+)?)\s*([a-zA-Z]+)$/);
        if (m) {
          value = parseFloat(m[1].replace(',', '')) || 0;
          denomination = m[2].toLowerCase();
        }
      }
    }
    // magicitems: no standard price → stays 0 gp (user sets it manually)
  } catch (_) {
    // keep defaults
  }

  const validDen = ['cp', 'sp', 'ep', 'gp', 'pp'];
  if (!validDen.includes(denomination)) denomination = 'gp';

  return { value, denomination };
}

/** Format a price object as a human-readable string. */
function formatPrice(price) {
  return price.value > 0 ? `${price.value} ${price.denomination}` : 'Varies';
}

/**
 * Parse the weight field, which may be a number or a string like "3 lb."
 */
function parseWeight(raw) {
  if (!raw && raw !== 0) return 0;
  if (typeof raw === 'number') return raw;
  const m = String(raw).match(/^([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

/**
 * Produce a brief meta description line for display in the item browser.
 */
function buildMetaLine(raw, category) {
  const parts = [];
  if (category === 'weapons') {
    if (raw.category)    parts.push(raw.category);
    if (raw.damage_dice) parts.push(`${raw.damage_dice} ${raw.damage_type || ''}`.trim());
  } else if (category === 'armor') {
    if (raw.category) parts.push(raw.category);
    if (raw.ac_base)  parts.push(`AC ${raw.ac_base}`);
  } else if (category === 'magicitems') {
    if (raw.type)   parts.push(raw.type);
    if (raw.rarity) parts.push(raw.rarity);
  } else {
    if (raw.category) parts.push(raw.category);
  }
  return parts.join(' · ');
}

/**
 * Normalise a raw Open5e API item into a consistent shape used
 * throughout the application.
 */
function normaliseItem(raw, category) {
  const slug = raw.slug || String(raw.name || '').toLowerCase().replace(/\s+/g, '-');
  return {
    id:          `${category}::${slug}`,
    name:        raw.name || 'Unknown Item',
    category,
    meta:        buildMetaLine(raw, category),
    price:       parsePrice(raw, category),
    weight:      parseWeight(raw.weight),
    description: String(raw.desc || raw.description || ''),
    raw,
  };
}

/* ─────────────────────────────────────────────────────────────
   Rendering
   ───────────────────────────────────────────────────────────── */

function renderBrowserItems(items, category) {
  const listEl = document.getElementById('item-list');
  if (!items.length) {
    listEl.innerHTML = '<p class="hint">No items found — try a different search or category.</p>';
    return;
  }

  const normalised = items.map(raw => normaliseItem(raw, category));
  state.browserItems = normalised;

  listEl.innerHTML = normalised.map(item => `
    <div class="item-entry" role="listitem">
      <div class="item-entry-info">
        <div class="item-entry-name">${esc(item.name)}</div>
        <div class="item-entry-meta">${esc(item.meta)}</div>
      </div>
      <span class="item-entry-price">${esc(formatPrice(item.price))}</span>
      <button class="btn-add" data-id="${escAttr(item.id)}" aria-label="Add ${esc(item.name)} to inventory">+ Add</button>
    </div>
  `).join('');

  listEl.querySelectorAll('.btn-add').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const item = state.browserItems.find(i => i.id === btn.dataset.id);
      if (item) addToInventory(item);
    });
  });
}

function renderPagination() {
  const el = document.getElementById('pagination');
  const totalPages = Math.ceil(state.totalCount / PAGE_SIZE);

  if (totalPages <= 1) { el.innerHTML = ''; return; }

  el.innerHTML = `
    <button id="btn-prev" ${state.currentPage === 1 ? 'disabled' : ''}>◀ Prev</button>
    <span class="page-info">Page ${state.currentPage} of ${totalPages}</span>
    <button id="btn-next" ${state.currentPage >= totalPages ? 'disabled' : ''}>Next ▶</button>
  `;

  el.querySelector('#btn-prev')?.addEventListener('click', () => {
    if (state.currentPage > 1) { state.currentPage--; loadBrowserItems(); }
  });
  el.querySelector('#btn-next')?.addEventListener('click', () => {
    if (state.currentPage < totalPages) { state.currentPage++; loadBrowserItems(); }
  });
}

function renderInventory() {
  const listEl   = document.getElementById('inventory-list');
  const countEl  = document.getElementById('item-count');
  const total    = state.inventory.length;
  countEl.textContent = `${total} item${total !== 1 ? 's' : ''}`;

  if (total === 0) {
    listEl.innerHTML = '<p class="hint">Add items from the browser on the left to build your shop.</p>';
    return;
  }

  listEl.innerHTML = `
    <div class="inventory-header">
      <span style="flex:1">Item</span>
      <span style="width:54px;text-align:center">Qty</span>
      <span style="width:60px;text-align:center">Price</span>
      <span style="width:46px;text-align:center">Den</span>
      <span style="width:32px"></span>
    </div>
    ${state.inventory.map((item, idx) => `
      <div class="inventory-item">
        <div class="inv-name-block">
          <div class="inv-item-name">${esc(item.name)}</div>
          <div class="inv-item-meta">${esc(item.meta)}</div>
        </div>
        <input class="qty-input"   type="number" value="${item.quantity}"     min="1"   max="999" data-idx="${idx}" aria-label="Quantity for ${esc(item.name)}">
        <input class="price-input" type="number" value="${item.price.value}"  min="0" step="0.01" data-idx="${idx}" aria-label="Price for ${esc(item.name)}">
        <select class="den-select" data-idx="${idx}" aria-label="Denomination for ${esc(item.name)}">
          ${['cp','sp','ep','gp','pp'].map(d =>
            `<option value="${d}" ${d === item.price.denomination ? 'selected' : ''}>${d}</option>`
          ).join('')}
        </select>
        <button class="btn-remove" data-idx="${idx}" title="Remove ${esc(item.name)}">×</button>
      </div>
    `).join('')}
  `;

  // Quantity change
  listEl.querySelectorAll('.qty-input').forEach(input => {
    input.addEventListener('change', () => {
      const idx = parseInt(input.dataset.idx, 10);
      state.inventory[idx].quantity = Math.max(1, parseInt(input.value, 10) || 1);
      renderInventory();
    });
  });

  // Price value change
  listEl.querySelectorAll('.price-input').forEach(input => {
    input.addEventListener('change', () => {
      const idx = parseInt(input.dataset.idx, 10);
      state.inventory[idx].price.value = Math.max(0, parseFloat(input.value) || 0);
    });
  });

  // Denomination change
  listEl.querySelectorAll('.den-select').forEach(select => {
    select.addEventListener('change', () => {
      const idx = parseInt(select.dataset.idx, 10);
      state.inventory[idx].price.denomination = select.value;
    });
  });

  // Remove button
  listEl.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      state.inventory.splice(idx, 1);
      renderInventory();
      document.getElementById('export-preview').classList.add('hidden');
    });
  });
}

/* ─────────────────────────────────────────────────────────────
   Inventory Management
   ───────────────────────────────────────────────────────────── */

function addToInventory(item) {
  // Increment quantity if already present
  const existing = state.inventory.find(i => i.id === item.id);
  if (existing) {
    existing.quantity++;
    renderInventory();
    showToast(`+1 ${item.name}`);
    return;
  }

  // Apply the price modifier configured by the user
  const modifier = Math.max(0, parseFloat(document.getElementById('price-modifier').value) || 100);
  const adjustedPrice = {
    value: Math.round(item.price.value * modifier / 100 * 100) / 100,
    denomination: item.price.denomination,
  };

  state.inventory.push({ ...item, quantity: 1, price: adjustedPrice });
  renderInventory();
  showToast(`Added: ${item.name}`);
}

/* ─────────────────────────────────────────────────────────────
   Foundry VTT JSON Export
   ───────────────────────────────────────────────────────────── */

/**
 * Build the full Foundry VTT Actor document for the configured shop.
 * Compatible with the dnd5e system (v3.x) on Foundry v12.
 */
function buildFoundryActorJson() {
  const shopName       = document.getElementById('shop-name').value.trim()        || 'The Shop';
  const shopkeeperName = document.getElementById('shopkeeper-name').value.trim()  || '';
  const description    = document.getElementById('shop-description').value.trim() || '';
  const shopType       = document.getElementById('shop-type').value;

  const bioParts = [];
  if (shopkeeperName) bioParts.push(`<p><strong>Shopkeeper:</strong> ${esc(shopkeeperName)}</p>`);
  bioParts.push(`<p><strong>Type:</strong> ${esc(SHOP_TYPE_LABELS[shopType] || shopType)}</p>`);
  if (description)    bioParts.push(`<p>${esc(description)}</p>`);

  return {
    name: shopName,
    type: 'npc',
    img:  'icons/svg/mystery-man.svg',
    system: {
      abilities: {},
      attributes: {
        hp: { value: 10, min: 0, max: 10 },
      },
      details: {
        biography: { value: bioParts.join('\n') },
        alignment: 'neutral',
        race:      'Human',
        type:      { value: 'humanoid', subtype: '' },
      },
      traits: { size: 'med' },
    },
    prototypeToken: {
      name:        shopkeeperName || shopName,
      displayName: 20,
      disposition: 1,
      actorLink:   false,
      vision:      false,
    },
    items:   state.inventory.map(buildFoundryItem),
    effects: [],
    flags: {
      shopper: {
        shopType,
        generated:  new Date().toISOString(),
        apiSource:  'Open5e',
        version:    '1.0.0',
      },
    },
  };
}

/** Convert a normalised inventory item into a Foundry dnd5e item document. */
function buildFoundryItem(item) {
  const doc = {
    name: item.name,
    img:  resolveItemIcon(item),
    system: {
      description: { value: item.description ? `<p>${esc(item.description)}</p>` : '' },
      quantity:    item.quantity,
      weight:      { value: item.weight || 0, units: 'lb' },
      price:       { value: item.price.value, denomination: item.price.denomination },
      identified:  true,
      rarity:      resolveRarity(item),
      equipped:    false,
    },
    effects: [],
    flags:   {},
  };

  const raw = item.raw;

  if (item.category === 'weapons') {
    doc.type = 'weapon';
    doc.system.weaponType = resolveWeaponType(raw.category);
    doc.system.properties = resolveWeaponProperties(raw.properties);
    const dmg = parseDamageDice(raw.damage_dice);
    if (dmg) {
      doc.system.damage = {
        base: { number: dmg.number, denomination: dmg.sides, bonus: '', damageType: raw.damage_type || 'bludgeoning' },
      };
      const vdmg = parseDamageDice(raw.versatile_dice);
      if (vdmg) {
        doc.system.damage.versatile = {
          number: vdmg.number, denomination: vdmg.sides, bonus: '', damageType: raw.damage_type || 'bludgeoning',
        };
      }
    }

  } else if (item.category === 'armor') {
    doc.type = 'equipment';
    const armorType = resolveArmorType(raw.category);
    doc.system.armor = {
      type:  armorType,
      value: raw.ac_base || (armorType === 'shield' ? 2 : 10),
      dex:   raw.ac_add_dex_mod ? (raw.ac_max_dex_mod ?? null) : null,
    };
    if (raw.strength_requirement) {
      doc.system.strength = raw.strength_requirement;
    }
    if (raw.stealth_disadvantage) {
      doc.system.properties = ['stealthDisadvantage'];
    }

  } else if (item.category === 'magicitems') {
    const itemTypeLower = String(raw.type || '').toLowerCase();
    if (itemTypeLower.includes('potion') || itemTypeLower.includes('scroll')) {
      doc.type = 'consumable';
      doc.system.consumableType = itemTypeLower.includes('potion') ? 'potion' : 'scroll';
    } else {
      doc.type = 'loot';
    }
    doc.system.attunement = raw.requires_attunement ? 1 : 0;
    doc.system.rarity     = String(raw.rarity || 'common').toLowerCase().replace(/\s+/g, '');

  } else {
    // Generic equipment
    doc.type = 'loot';
  }

  return doc;
}

/* ─────────────────────────────────────────────────────────────
   Foundry VTT Mapping Helpers
   ───────────────────────────────────────────────────────────── */

function resolveWeaponType(category) {
  const key = String(category || '').toLowerCase().replace(/\s+weapons?$/, '').trim();
  return WEAPON_TYPE_MAP[key] || 'simpleM';
}

function resolveArmorType(category) {
  const c = String(category || '').toLowerCase();
  if (c.includes('light'))  return 'light';
  if (c.includes('medium')) return 'medium';
  if (c.includes('heavy'))  return 'heavy';
  if (c.includes('shield')) return 'shield';
  return 'light';
}

function resolveWeaponProperties(properties) {
  if (!Array.isArray(properties)) return [];
  return properties
    .map(p => {
      const name = String(typeof p === 'string' ? p : (p.name || '')).toLowerCase();
      return PROPERTY_MAP[name] || null;
    })
    .filter(Boolean);
}

function resolveRarity(item) {
  if (item.category === 'magicitems' && item.raw.rarity) {
    return String(item.raw.rarity).toLowerCase().replace(/\s+/g, '');
  }
  return 'common';
}

/**
 * Parse a damage dice string like "1d8" into { number, sides }.
 * Returns null if the string is missing or unparseable.
 */
function parseDamageDice(dice) {
  if (!dice) return null;
  const m = String(dice).match(/^(\d+)d(\d+)$/);
  return m ? { number: parseInt(m[1], 10), sides: parseInt(m[2], 10) } : null;
}

/**
 * Choose a best-guess Foundry VTT default icon for an item.
 * These paths correspond to built-in assets in the dnd5e system.
 */
function resolveItemIcon(item) {
  const name = item.name.toLowerCase();
  const cat  = item.category;

  if (cat === 'weapons') {
    if (name.includes('sword') || name.includes('blade') || name.includes('scimitar'))
      return 'icons/weapons/swords/sword-longsword.webp';
    if (name.includes('bow') && !name.includes('crossbow'))
      return 'icons/weapons/bows/bow-longbow.webp';
    if (name.includes('crossbow'))
      return 'icons/weapons/crossbows/crossbow.webp';
    if (name.includes('axe'))
      return 'icons/weapons/axes/axe-battle.webp';
    if (name.includes('dagger') || name.includes('knife'))
      return 'icons/weapons/daggers/dagger.webp';
    if (name.includes('staff') || name.includes('quarterstaff'))
      return 'icons/weapons/staves/staff.webp';
    if (name.includes('hammer') || name.includes('maul'))
      return 'icons/weapons/hammers/hammer.webp';
    if (name.includes('mace') || name.includes('flail'))
      return 'icons/weapons/maces/mace.webp';
    if (name.includes('spear') || name.includes('lance') || name.includes('javelin'))
      return 'icons/weapons/spears/spear.webp';
    return 'icons/weapons/swords/sword-guard.webp';
  }

  if (cat === 'armor') {
    if (name.includes('shield'))
      return 'icons/equipment/shield/buckler-steel.webp';
    if (name.includes('leather') || name.includes('hide') || name.includes('padded'))
      return 'icons/equipment/chest/vest-armor-leather.webp';
    if (name.includes('chain'))
      return 'icons/equipment/chest/chainmail.webp';
    if (name.includes('plate') || name.includes('splint') || name.includes('full'))
      return 'icons/equipment/chest/breastplate-solid-steel.webp';
    return 'icons/equipment/chest/breastplate-layered-steel.webp';
  }

  if (cat === 'magicitems') {
    if (name.includes('potion'))
      return 'icons/consumables/potions/potion-healing.webp';
    if (name.includes('scroll'))
      return 'icons/consumables/scrolls/scroll-magic.webp';
    if (name.includes('ring'))
      return 'icons/equipment/finger/ring-band-gold.webp';
    if (name.includes('wand'))
      return 'icons/weapons/wands/wand-magic.webp';
    if (name.includes('rod'))
      return 'icons/weapons/rods/rod.webp';
    if (name.includes('staff'))
      return 'icons/weapons/staves/staff-ornate.webp';
    if (name.includes('amulet') || name.includes('necklace') || name.includes('pendant'))
      return 'icons/equipment/neck/amulet-gold-holy.webp';
    if (name.includes('cloak') || name.includes('robe'))
      return 'icons/equipment/back/cloak-simple-purple.webp';
    if (name.includes('boots') || name.includes('shoes'))
      return 'icons/equipment/feet/boots-simple-blue.webp';
    if (name.includes('gloves') || name.includes('gauntlets'))
      return 'icons/equipment/hand/gauntlet-metal.webp';
    if (name.includes('helm') || name.includes('crown') || name.includes('hat'))
      return 'icons/equipment/head/helm-knight.webp';
    return 'icons/sundries/lights/candle-lit.webp';
  }

  // equipment
  if (name.includes('rope'))
    return 'icons/commodities/materials/rope-hemp-brown.webp';
  if (name.includes('torch'))
    return 'icons/sundries/lights/torch-unlit.webp';
  if (name.includes('potion') || name.includes('vial') || name.includes('flask'))
    return 'icons/consumables/potions/potion-empty.webp';
  if (name.includes('bag') || name.includes('pack') || name.includes('pouch'))
    return 'icons/containers/bags/pack-leather-tan.webp';
  if (name.includes('tool') || name.includes('kit'))
    return 'icons/tools/hand/tools-simple.webp';
  return 'icons/commodities/treasure/chest-simple-wood.webp';
}

/* ─────────────────────────────────────────────────────────────
   Utility / Security Helpers
   ───────────────────────────────────────────────────────────── */

/** Escape HTML special characters to prevent XSS in innerHTML. */
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape for use inside an HTML attribute value. */
function escAttr(str) {
  return String(str ?? '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Produce a safe filename from an arbitrary string by stripping characters
 * that are problematic on common filesystems, then appending the extension.
 */
function sanitizeFilename(name, ext) {
  const safe = String(name ?? '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_') || 'shop';
  return `${safe}.${ext}`;
}

/* ─────────────────────────────────────────────────────────────
   Toast Notifications
   ───────────────────────────────────────────────────────────── */
let _toastTimer = null;

function showToast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ─────────────────────────────────────────────────────────────
   Browser Load / Render Pipeline
   ───────────────────────────────────────────────────────────── */

async function loadBrowserItems() {
  if (state.loading) return;
  state.loading = true;

  const listEl = document.getElementById('item-list');
  listEl.innerHTML = '<p class="state-loading"><span class="spinner"></span>Loading items…</p>';
  document.getElementById('pagination').innerHTML = '';

  try {
    const data = await fetchItems(state.currentCategory, state.searchQuery, state.currentPage);
    state.totalCount = data.count || 0;
    renderBrowserItems(data.results || [], state.currentCategory);
    renderPagination();
  } catch (err) {
    listEl.innerHTML = `
      <div class="state-error">
        ⚠ Failed to load items — check your internet connection and try again.<br>
        <small>${esc(err.message)}</small>
      </div>`;
  } finally {
    state.loading = false;
  }
}

/* ─────────────────────────────────────────────────────────────
   Event Listeners
   ───────────────────────────────────────────────────────────── */

function initEventListeners() {
  // ── Category Tabs ──
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');

      state.currentCategory = tab.dataset.category;
      state.currentPage     = 1;
      state.searchQuery     = document.getElementById('item-search').value.trim();
      loadBrowserItems();
    });
  });

  // ── Search ──
  document.getElementById('search-btn').addEventListener('click', () => {
    state.searchQuery = document.getElementById('item-search').value.trim();
    state.currentPage = 1;
    loadBrowserItems();
  });

  document.getElementById('item-search').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      state.searchQuery = e.target.value.trim();
      state.currentPage = 1;
      loadBrowserItems();
    }
  });

  // ── Export ──
  document.getElementById('export-btn').addEventListener('click', () => {
    if (state.inventory.length === 0) {
      showToast('⚠ Add items to the inventory first!');
      return;
    }

    const actor    = buildFoundryActorJson();
    const json     = JSON.stringify(actor, null, 2);
    const shopName = document.getElementById('shop-name').value.trim() || 'shop';
    const filename = sanitizeFilename(`${shopName}_foundry`, 'json');

    // Show preview (truncated for display only)
    const preview   = document.getElementById('export-preview');
    const previewEl = document.getElementById('preview-content');
    const PREVIEW_LIMIT = 3000;
    previewEl.textContent = json.length > PREVIEW_LIMIT
      ? json.slice(0, PREVIEW_LIMIT) + '\n\n… (truncated — full file will be downloaded)'
      : json;
    preview.classList.remove('hidden');

    // Download the full JSON file
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast(`✓ Exported "${filename}"`);
  });

  // ── Copy JSON ──
  document.getElementById('copy-btn').addEventListener('click', () => {
    const text = document.getElementById('preview-content').textContent;
    // Rebuild full (non-truncated) JSON in case preview was truncated
    if (state.inventory.length > 0) {
      const fullJson = JSON.stringify(buildFoundryActorJson(), null, 2);
      navigator.clipboard.writeText(fullJson)
        .then(() => showToast('✓ Copied to clipboard'))
        .catch(() => showToast('⚠ Clipboard access denied'));
    } else {
      navigator.clipboard.writeText(text)
        .catch(() => showToast('⚠ Clipboard access denied'));
    }
  });

  // ── Clear Inventory ──
  document.getElementById('clear-btn').addEventListener('click', () => {
    if (state.inventory.length === 0) return;
    if (window.confirm('Clear all items from the inventory?')) {
      state.inventory = [];
      renderInventory();
      document.getElementById('export-preview').classList.add('hidden');
      showToast('Inventory cleared');
    }
  });
}

/* ─────────────────────────────────────────────────────────────
   Initialisation
   ───────────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
  initEventListeners();
  renderInventory();
  loadBrowserItems();
});
