/* shop-visit — 店舗訪問ログPWA（ひいらぎHDグループ・RF個人利用）
 * 型: mansion-patrol / rf-tracker / wine-app / swing-app と同族（ビルドレス vanilla JS・記録は端末内のみ）
 * 店舗マスター: 公式サイト hiiragi-hd.jp の WP REST API（microCMSキャッシュ・公開情報）から直接取得しIndexedDBに保持。
 * 記録: IndexedDB。写真は圧縮JPEG dataURLで記録に内包。回収はエクスポートJSON→Mac→Claude。
 */
'use strict';

const APP_VERSION = 'v2026-09-17.1';
const API = 'https://hiiragi-hd.jp/wp-json/microcms-cache/v1/data/';
const MASTER_TTL_MS = 24 * 3600 * 1000;
const EXPORT_FORMAT = 'shop-visit-records-v1';
const PAGE = 50;

/* ---------- 選択肢定義（キー固定・表示はラベル。集計の連続性のためキーは消さない） ---------- */
const RATINGS = [
  { key: 'good', label: '◎' },
  { key: 'ok',   label: '○' },
  { key: 'bad',  label: '△' },
];
const BASIC = {
  slot: [
    { key: 'open',   label: '開店直後' },
    { key: 'lunch',  label: '昼ピーク' },
    { key: 'idle',   label: 'アイドル' },
    { key: 'dinner', label: '夜ピーク' },
    { key: 'close',  label: '閉店前' },
  ],
  mode: [
    { key: 'notice',   label: '予告あり' },
    { key: 'surprise', label: '抜き打ち' },
    { key: 'tour',     label: '会議・視察同行' },
    { key: 'private',  label: '私用（食事）' },
  ],
  companions: ['単独', 'HD社長', '事業会社社長・役員', 'SV・部長', 'その他'],
  purposes: ['定期巡回', '新店・改装確認', '課題フォロー', 'PJ関連（リブランディング・統合・再建）', 'ベンチマーク（他社）'],
};
const OBSERVE = [
  { key: 'traffic',  label: '客数・混雑', tags: ['満席・待ち', '賑わい', '普通', '閑散', '客層:ファミリー', '客層:シニア', '客層:若年', '客層:ビジネス', '客層:単身', '客層:インバウンド'] },
  { key: 'q',        label: 'Q 商品',     tags: ['味', '提供時間', '盛付・温度', '欠品', '新商品・季節品の訴求'] },
  { key: 's',        label: 'S 接客・オペ', tags: ['挨拶', '笑顔・態度', '提供スピード', 'オーダー精度', 'レジ・モバイルオーダー対応', 'ピーク時の回し'] },
  { key: 'c',        label: 'C 清潔・外観', tags: ['客席', '厨房見え', 'トイレ', '外観・看板', 'ファサード照明', '臭い'] },
  { key: 'staff',    label: '人員',       tags: ['店長在店', '人数:不足', '人数:適正', '人数:過剰', '外国人スタッフ比率高', '新人多い'] },
  { key: 'promo',    label: '販促・価格', tags: ['POP・掲示物', '季節メニュー', '価格表示', 'SNS・アプリ導線', '値上げの受容感'] },
  { key: 'site',     label: '立地・商環境', tags: ['施設人流:多', '施設人流:普通', '施設人流:少', '隣接テナント変化', '競合の新規出店', '駐車場・アクセス'] },
  { key: 'facility', label: '設備',       tags: ['老朽化', '故障・修繕要', 'レイアウト課題'] },
];
const TALK = {
  roles: ['店長', '社員', 'アルバイト', 'SV', '事業会社役員', '施設側担当'],
  themes: ['人手不足・採用', 'シフト・労働時間', '売上感', '原価・ロス', '客数・客層変化', 'クレーム', '設備', '本部・仕組みへの要望', 'PJへの反応', 'モチベーション・離職懸念'],
  mood: [
    { key: 'up',   label: '前向き' },
    { key: 'flat', label: '普通' },
    { key: 'down', label: '不満・疲弊' },
  ],
};
const ISSUE = {
  judge: [
    { key: 'good',  label: '良好事例（横展開候補）' },
    { key: 'store', label: '要改善・店舗対応' },
    { key: 'hq',    label: '要改善・本部・仕組み' },
    { key: 'check', label: '要確認（事実未確認）' },
  ],
  priority: [
    { key: 'high', label: '高' },
    { key: 'mid',  label: '中' },
    { key: 'low',  label: '低' },
  ],
  to: ['HD', '事業会社', 'SV', '施設側'],
};
const PHOTO_TAGS = ['外観', '店内', 'メニュー・POP', '課題箇所', 'その他'];
const PREFS = ['北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県','茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県','新潟県','富山県','石川県','福井県','山梨県','長野県','岐阜県','静岡県','愛知県','三重県','滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県','鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県','愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県','宮崎県','鹿児島県','沖縄県'];

/* ---------- IndexedDB ---------- */
let _db;
function openDB() {
  return new Promise((res, rej) => {
    if (_db) return res(_db);
    const rq = indexedDB.open('shop-visit', 1);
    rq.onupgradeneeded = () => {
      const d = rq.result;
      if (!d.objectStoreNames.contains('visits')) {
        const st = d.createObjectStore('visits', { keyPath: 'id' });
        st.createIndex('ts', 'ts');
        st.createIndex('shopId', 'shopId');
      }
      if (!d.objectStoreNames.contains('stores')) {
        const st = d.createObjectStore('stores', { keyPath: 'id' });
        st.createIndex('companyId', 'companyId');
      }
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
    };
    rq.onsuccess = () => { _db = rq.result; res(_db); };
    rq.onerror = () => rej(rq.error);
  });
}
async function dbTx(store, mode, fn) {
  const d = await openDB();
  return new Promise((res, rej) => {
    const tx = d.transaction(store, mode);
    const rq = fn(tx.objectStore(store));
    tx.oncomplete = () => res(rq && 'result' in rq ? rq.result : undefined);
    tx.onerror = () => rej(tx.error);
  });
}
const dbPut = (store, rec) => dbTx(store, 'readwrite', s => s.put(rec));
const dbDel = (store, id) => dbTx(store, 'readwrite', s => s.delete(id));
const dbAll = (store) => dbTx(store, 'readonly', s => s.getAll()).then(r => r || []);
const dbGet = (store, key) => dbTx(store, 'readonly', s => s.get(key));
const dbClear = (store) => dbTx(store, 'readwrite', s => s.clear());
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- 店舗マスター（公式API） ---------- */
async function apiGet(path) {
  const r = await fetch(API + path, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
function slimShop(s) {
  const brands = s.brands || [];
  const co = s.company || {};
  return {
    id: s.id, name: s.name,
    label: `${brands[0] ? brands[0].name + ' ' : ''}${s.name}`,
    brandIds: brands.map(b => b.id), brandNames: brands.map(b => b.name),
    companyId: co.id || '', companyName: co.name || '',
    pref: (s.pref || [])[0] || '', postal_code: s.postal_code || '', address: s.address || '',
    phone: s.phone || '', business_hours: s.business_hours || '',
    image: s.image ? s.image.url : null, updatedAt: s.updatedAt || null, manual: false,
  };
}
async function fetchMaster() {
  const [co, br, first] = await Promise.all([
    apiGet('company?limit=100'), apiGet('brand?limit=100'), apiGet('shop?limit=100&offset=0'),
  ]);
  const total = first.totalCount;
  if (!(total >= 50)) throw new Error('店舗数が異常: ' + total);
  const pages = [];
  for (let o = 100; o < total && o < 1000; o += 100) pages.push(apiGet(`shop?limit=100&offset=${o}`));
  const contents = [...first.contents];
  (await Promise.all(pages)).forEach(p => contents.push(...p.contents));
  if (contents.length !== total) throw new Error(`件数不一致 ${contents.length}/${total}`);
  const shops = contents.map(slimShop);

  // ブランド→会社は shops から導出（brand API 側の company が空のものがあるため）
  const brandMap = {};
  br.contents.forEach((b, i) => { brandMap[b.id] = { id: b.id, name: b.name, slug: b.slug || '', seq: b.seq ?? i, companyIds: new Set() }; });
  shops.forEach(s => s.brandIds.forEach((bid, i) => {
    if (!brandMap[bid]) brandMap[bid] = { id: bid, name: s.brandNames[i], slug: '', seq: 999, companyIds: new Set() };
    brandMap[bid].companyIds.add(s.companyId);
  }));
  const brands = Object.values(brandMap).sort((a, b) => a.seq - b.seq).map(b => ({ ...b, companyIds: [...b.companyIds] }));
  const master = {
    key: 'master', fetchedAt: new Date().toISOString(),
    counts: { company: co.contents.length, brand: brands.length, shop: shops.length },
    companies: co.contents.map(c => ({ id: c.id, name: c.name })),
    brands,
  };
  // stores を全件置換（手入力店舗は残す）
  const d = await openDB();
  await new Promise((res, rej) => {
    const tx = d.transaction('stores', 'readwrite');
    const st = tx.objectStore('stores');
    const rq = st.getAll();
    rq.onsuccess = () => {
      const manual = (rq.result || []).filter(s => s.manual);
      st.clear();
      manual.forEach(m => st.put(m));
      shops.forEach(s => st.put(s));
    };
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
  await dbPut('meta', master);
  S.master = master;
  S.stores = await dbAll('stores');
  return master;
}
async function refreshMasterIfStale() {
  if (!navigator.onLine) return;
  const stale = !S.master || (Date.now() - Date.parse(S.master.fetchedAt)) > MASTER_TTL_MS;
  if (!stale) return;
  try { const m = await fetchMaster(); toast(`店舗マスター更新（${m.counts.shop}店）`); render(); }
  catch (e) { if (!S.master) { S.masterErr = e.message; render(); } }
}

/* ---------- 状態 ---------- */
const S = {
  tab: 'visit', master: null, masterErr: null, stores: [], visits: [], meta: {},
  shop: null, draft: null, open: { basic: true, observe: false, talk: false, issue: false, photos: false },
  q: '', fCompany: null, fBrand: null, fPref: null, sortStale: false, limit: PAGE, covOpen: false,
  addingManual: false, photoTag: '店内',
  recFilterCo: null, recFilterJudge: null,
};

function newDraft(shop) {
  const observe = {};
  OBSERVE.forEach(a => { observe[a.key] = { r: null, tags: [] }; });
  return {
    ts: new Date().toISOString(),
    shopId: shop.id, shopName: shop.name, brand: shop.brandNames[0] || '', brands: [...shop.brandNames],
    company: shop.companyName, pref: shop.pref, manual: !!shop.manual,
    basic: { slot: null, mode: null, companions: [], purposes: [], meal: { items: '', priceJudge: null } },
    observe,
    talk: { roles: [], themes: [], mood: null, memo: '' },
    issue: { judge: null, priority: null, to: [], due: '', memo: '' },
    memo: '', photos: [],
  };
}

/* ---------- ユーティリティ ---------- */
const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2000);
}
const p2 = (n) => String(n).padStart(2, '0');
function fmtTs(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
function toLocalInput(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
const daysSince = (ts) => Math.floor((Date.now() - Date.parse(ts)) / 86400000);
const labelOf = (list, key) => (list.find(x => x.key === key) || {}).label || '';
const JUDGE_SHORT = { good: '良好', store: '要改善(店)', hq: '要改善(本部)', check: '要確認' };
const judgeShort = (k) => JUDGE_SHORT[k] || '';
const norm = (s) => (s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');

function shrinkImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const MAX = 1280;
      let { width: w, height: h } = img;
      if (Math.max(w, h) > MAX) { const r = MAX / Math.max(w, h); w = Math.round(w * r); h = Math.round(h * r); }
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      res(cv.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('画像読込失敗')); };
    img.src = url;
  });
}

/* チップ行（単選/複選/警告色/評価色）。container に field-label と chips を追加する */
function chipRow(container, label, opts, getSel, setSel, { multi = false, warn = false, rate = false, small = false, noLabel = false } = {}) {
  if (label && !noLabel) container.append(el('div', 'field-label', label));
  const wrap = el('div', 'chips');
  opts.forEach(o => {
    const key = o.key || o, text = o.label || o;
    const c = el('button', 'chip' + (warn ? ' warn' : '') + (rate ? ' rate ' + key : '') + (small ? ' small' : ''), text);
    const sel = getSel();
    const on = multi ? (sel || []).includes(key) : sel === key;
    if (on) c.classList.add('on');
    c.onclick = () => {
      if (multi) {
        const arr = getSel() || [];
        setSel(arr.includes(key) ? arr.filter(x => x !== key) : [...arr, key]);
      } else {
        setSel(getSel() === key ? null : key);
      }
      render();
    };
    wrap.append(c);
  });
  container.append(wrap);
  return wrap;
}

/* ---------- 集計 ---------- */
function visitIndex() {
  const idx = {};
  S.visits.forEach(v => {
    const c = idx[v.shopId] || (idx[v.shopId] = { count: 0, lastTs: '' });
    c.count++; if (v.ts > c.lastTs) c.lastTs = v.ts;
  });
  return idx;
}
function coverage(idx) {
  const byCo = {};
  S.stores.filter(s => !s.manual).forEach(s => {
    const co = byCo[s.companyName] || (byCo[s.companyName] = { total: 0, visited: 0, brands: {} });
    const bn = s.brandNames[0] || '（ブランド未設定）';
    const b = co.brands[bn] || (co.brands[bn] = { total: 0, visited: 0, stale: 0 });
    co.total++; b.total++;
    if (idx[s.id]) { co.visited++; b.visited++; if (daysSince(idx[s.id].lastTs) > 90) b.stale++; }
  });
  const ids = new Set(S.stores.map(s => s.id));
  const outside = new Set(S.visits.filter(v => !ids.has(v.shopId)).map(v => v.shopId)).size;
  const order = S.master ? S.master.companies.map(c => c.name) : [];
  const names = [...new Set([...order, ...Object.keys(byCo)])].filter(n => byCo[n]);
  return { byCo, names, outside };
}

/* ---------- 描画: 訪問タブ（店舗選択） ---------- */
function renderVisit(root) {
  if (S.shop && S.draft) return renderForm(root);
  if (S.addingManual) return renderManualAdd(root);
  root.append(el('h1', null, '訪問 — 店舗を選ぶ'));

  if (!S.stores.length) {
    const n = el('div', 'notice');
    n.append(document.createTextNode(S.masterErr ? `店舗マスターの取得に失敗: ${S.masterErr}` : '店舗マスター未取得。オンラインで取得してください。'));
    const b = el('button', null, '店舗マスターを取得');
    b.onclick = async () => { try { const m = await fetchMaster(); toast(`${m.counts.shop}店を取得`); S.masterErr = null; render(); } catch (e) { toast('取得失敗: ' + e.message); } };
    n.append(b);
    const m = el('button', null, '店舗を手入力で追加');
    m.onclick = () => { S.addingManual = true; render(); };
    n.append(m);
    root.append(n);
    return;
  }

  const idx = visitIndex();

  // カバレッジ
  const cov = coverage(idx);
  const dt = el('details', 'cov'); dt.open = S.covOpen;
  dt.ontoggle = () => { S.covOpen = dt.open; };
  const totalStores = S.stores.filter(s => !s.manual).length;
  const visitedStores = Object.keys(idx).filter(id => S.stores.some(s => s.id === id && !s.manual)).length;
  const sm = el('summary');
  sm.append(el('span', null, 'カバレッジ'), el('span', null, `訪問済 ${visitedStores}/${totalStores}店・記録 ${S.visits.length}件`));
  dt.append(sm);
  cov.names.forEach(coName => {
    const co = cov.byCo[coName];
    const r = el('div', 'cov-row co');
    r.append(el('span', null, coName), el('span', 'n', `${co.visited}/${co.total}`));
    r.onclick = () => { S.fCompany = coName; S.fBrand = null; S.fPref = null; S.q = ''; S.limit = PAGE; render(); };
    dt.append(r);
    Object.entries(co.brands).sort((a, b) => b[1].total - a[1].total).forEach(([bn, b]) => {
      const br = el('div', 'cov-row br');
      const n = el('span', 'n', `${b.visited}/${b.total}`);
      if (b.total - b.visited) n.append(el('span', 'un', `未訪問${b.total - b.visited}`));
      if (b.stale) n.append(el('span', 'un', `90日超${b.stale}`));
      br.append(el('span', null, bn), n);
      br.onclick = (e) => { e.stopPropagation(); S.fCompany = coName; S.fBrand = bn; S.fPref = null; S.q = ''; S.limit = PAGE; render(); };
      dt.append(br);
    });
  });
  if (cov.outside) {
    const r = el('div', 'cov-row br'); r.append(el('span', null, 'マスター外（閉店・手入力削除）'), el('span', 'n', `${cov.outside}店`));
    dt.append(r);
  }
  root.append(dt);

  // 検索・絞り込み
  const search = el('input', 'search'); search.type = 'search'; search.placeholder = '店名・ブランド・住所で検索';
  search.value = S.q;
  search.oninput = () => { S.q = search.value; S.limit = PAGE; renderList(); };
  root.append(search);

  const filters = el('div', 'filters');
  const companies = S.master ? S.master.companies.map(c => c.name) : [...new Set(S.stores.map(s => s.companyName))];
  chipRow(filters, null, companies, () => S.fCompany, v => { S.fCompany = v; S.fBrand = null; S.fPref = null; S.limit = PAGE; }, { small: true, noLabel: true });
  if (S.fCompany) {
    const coId = (S.master ? S.master.companies.find(c => c.name === S.fCompany) || {} : {}).id;
    let brands = S.master ? S.master.brands.filter(b => b.companyIds.includes(coId)).map(b => b.name) : [];
    if (!brands.length) brands = [...new Set(S.stores.filter(s => s.companyName === S.fCompany).flatMap(s => s.brandNames))];
    chipRow(filters, null, brands, () => S.fBrand, v => { S.fBrand = v; S.fPref = null; S.limit = PAGE; }, { small: true, noLabel: true });
  }
  const base = S.stores.filter(s => (!S.fCompany || s.companyName === S.fCompany) && (!S.fBrand || s.brandNames.includes(S.fBrand)));
  const prefCount = {};
  base.forEach(s => { if (s.pref) prefCount[s.pref] = (prefCount[s.pref] || 0) + 1; });
  const prefOpts = PREFS.filter(p => prefCount[p]).map(p => ({ key: p, label: `${p} ${prefCount[p]}` }));
  if (prefOpts.length > 1) chipRow(filters, null, prefOpts, () => S.fPref, v => { S.fPref = v; S.limit = PAGE; }, { small: true, noLabel: true });
  const sortBtn = el('button', 'chip small' + (S.sortStale ? ' on' : ''), '経過日数が長い順');
  sortBtn.onclick = () => { S.sortStale = !S.sortStale; render(); };
  const sw = el('div', 'chips'); sw.append(sortBtn);
  if (S.fCompany || S.fBrand || S.fPref || S.q) {
    const clr = el('button', 'chip small', '絞り込み解除');
    clr.onclick = () => { S.fCompany = S.fBrand = S.fPref = null; S.q = ''; S.limit = PAGE; render(); };
    sw.append(clr);
  }
  filters.append(sw);
  root.append(filters);

  const listWrap = el('div');
  root.append(listWrap);

  const shopRow = (s) => {
    const b = el('button', 'shop-row');
    b.append(document.createTextNode(s.label + (s.manual ? '（手入力）' : '')));
    const sub = el('span', 'sub');
    const parts = [s.companyName, s.pref].filter(Boolean).join(' · ');
    sub.append(document.createTextNode(parts + (parts ? ' · ' : '')));
    const v = idx[s.id];
    if (v) {
      const dsn = daysSince(v.lastTs);
      sub.append(Object.assign(el('span', dsn > 90 ? 'stale' : 'fresh', `最終訪問 ${dsn}日前（${v.count}回）`)));
    } else sub.append(el('span', 'stale', '未訪問'));
    b.append(sub);
    b.onclick = () => { S.shop = s; S.draft = newDraft(s); S.open = { basic: true, observe: false, talk: false, issue: false, photos: false }; window.scrollTo(0, 0); render(); };
    return b;
  };

  function renderList() {
    listWrap.textContent = '';
    const q = norm(S.q);
    let list = base.filter(s => !S.fPref || s.pref === S.fPref);
    if (q) list = list.filter(s => norm(s.label + s.address + s.pref + s.companyName).includes(q));
    if (S.sortStale) {
      list = [...list].sort((a, b) => {
        const la = idx[a.id] ? idx[a.id].lastTs : '', lb = idx[b.id] ? idx[b.id].lastTs : '';
        return la.localeCompare(lb);
      });
    }
    if (!q && !S.fCompany && !S.fBrand && !S.fPref && !S.sortStale) {
      const recent = Object.entries(idx).sort((a, b) => b[1].lastTs.localeCompare(a[1].lastTs)).slice(0, 5).map(x => x[0]);
      const freq = Object.entries(idx).sort((a, b) => b[1].count - a[1].count).slice(0, 5).map(x => x[0]);
      const ids = [...new Set([...recent, ...freq])];
      const picks = ids.map(id => S.stores.find(s => s.id === id)).filter(Boolean);
      if (picks.length) {
        listWrap.append(el('div', 'group-title', '最近・よく行く'));
        picks.forEach(s => listWrap.append(shopRow(s)));
        listWrap.append(el('div', 'group-title', `すべて（${list.length}店）`));
      }
    } else {
      listWrap.append(el('div', 'group-title', `${list.length}店`));
    }
    list.slice(0, S.limit).forEach(s => listWrap.append(shopRow(s)));
    if (list.length > S.limit) {
      const more = el('button', 'more-btn', `さらに表示（残り${list.length - S.limit}店）`);
      more.onclick = () => { S.limit += PAGE; renderList(); };
      listWrap.append(more);
    }
    const add = el('button', 'link-btn', '見つからない → 店舗を手入力で追加');
    add.onclick = () => { S.addingManual = true; render(); };
    listWrap.append(add);
  }
  renderList();
}

/* ---------- 描画: 手入力店舗の追加 ---------- */
function renderManualAdd(root) {
  const bar = el('div', 'backbar');
  const back = el('button', null, '←');
  back.onclick = () => { S.addingManual = false; render(); };
  bar.append(back, el('h1', null, '店舗を手入力で追加'));
  root.append(bar);
  const card = el('div', 'card');
  const m = S.manualDraft || (S.manualDraft = { name: '', brand: '', company: '', pref: '', address: '' });
  const field = (label, key, placeholder, listId) => {
    card.append(el('div', 'field-label', label));
    const i = el('input'); i.type = 'text'; i.placeholder = placeholder || ''; i.value = m[key];
    if (listId) i.setAttribute('list', listId);
    i.oninput = () => { m[key] = i.value; };
    card.append(i);
  };
  field('店名（必須）', 'name', '例: ○○モール店');
  const brands = [...new Set([...(S.master ? S.master.brands.map(b => b.name) : []), '競合', 'その他'])];
  const dl1 = el('datalist'); dl1.id = 'dl-brand'; brands.forEach(b => { const o = el('option'); o.value = b; dl1.append(o); });
  field('ブランド', 'brand', '既存ブランド名 / 競合 / その他', 'dl-brand');
  card.append(dl1);
  const cos = [...new Set([...(S.master ? S.master.companies.map(c => c.name) : []), '他社', 'その他'])];
  const dl2 = el('datalist'); dl2.id = 'dl-co'; cos.forEach(c => { const o = el('option'); o.value = c; dl2.append(o); });
  field('会社', 'company', '既存会社名 / 他社', 'dl-co');
  card.append(dl2);
  card.append(el('div', 'field-label', '都道府県'));
  const sel = el('select');
  const o0 = el('option', null, '（未選択）'); o0.value = ''; sel.append(o0);
  PREFS.forEach(p => { const o = el('option', null, p); o.value = p; if (m.pref === p) o.selected = true; sel.append(o); });
  sel.onchange = () => { m.pref = sel.value; };
  card.append(sel);
  field('住所・場所メモ', 'address', '任意');
  const save = el('button', 'save-btn', '追加して記録に進む');
  save.onclick = async () => {
    if (!m.name.trim()) { toast('店名を入れてください'); return; }
    const s = {
      id: 'm_' + uid(), name: m.name.trim(), label: `${m.brand.trim() ? m.brand.trim() + ' ' : ''}${m.name.trim()}`,
      brandIds: [], brandNames: m.brand.trim() ? [m.brand.trim()] : [], companyId: '', companyName: m.company.trim(),
      pref: m.pref, postal_code: '', address: m.address.trim(), phone: '', business_hours: '', image: null, updatedAt: null, manual: true,
    };
    await dbPut('stores', s);
    S.stores.push(s);
    S.manualDraft = null; S.addingManual = false;
    S.shop = s; S.draft = newDraft(s); S.open = { basic: true, observe: false, talk: false, issue: false, photos: false };
    toast('店舗を追加しました');
    render();
  };
  card.append(save);
  root.append(card);
}

/* ---------- 描画: 記録フォーム ---------- */
function renderForm(root) {
  const s = S.shop, d = S.draft;
  const bar = el('div', 'backbar');
  const back = el('button', null, '←');
  back.onclick = () => {
    const dirty = d.memo || d.photos.length || d.talk.memo || d.issue.memo || d.basic.slot || d.basic.mode;
    if (dirty && !confirm('入力内容を破棄して戻りますか？')) return;
    S.shop = null; S.draft = null; render();
  };
  bar.append(back, el('h1', null, s.label));
  root.append(bar);
  const info = [s.companyName, s.pref + s.address, s.business_hours ? '営業 ' + s.business_hours : ''].filter(Boolean).join(' · ');
  root.append(el('div', 'shop-info', info));

  // 過去の訪問（複数回訪問の履歴）
  const past = S.visits.filter(v => v.shopId === s.id).sort((a, b) => b.ts.localeCompare(a.ts));
  const hist = el('div', 'history');
  if (past.length) {
    hist.append(document.createTextNode(`過去の訪問 ${past.length}回: `));
    past.slice(0, 4).forEach(v => hist.append(el('span', null, fmtTs(v.ts).slice(0, -6) + (v.issue && v.issue.judge ? ' ' + judgeShort(v.issue.judge) : ''))));
    if (past.length > 4) hist.append(el('span', null, '…'));
  } else hist.append(document.createTextNode('初回訪問'));
  root.append(hist);

  const section = (key, title, doneText, build) => {
    const dt = el('details', 'sec'); dt.open = !!S.open[key];
    const sm = el('summary'); sm.append(el('span', null, title));
    if (doneText) sm.append(el('span', 'done', doneText));
    dt.append(sm);
    const body = el('div', 'body');
    build(body);
    dt.append(body);
    dt.ontoggle = () => { S.open[key] = dt.open; };
    root.append(dt);
  };

  // A. 訪問基本
  const basicDone = [labelOf(BASIC.slot, d.basic.slot), labelOf(BASIC.mode, d.basic.mode), ...d.basic.companions].filter(Boolean).join('・');
  section('basic', 'A 訪問基本', basicDone, (b) => {
    b.append(el('div', 'field-label', '訪問日時（同じ店舗に何度でも記録できる）'));
    const dtIn = el('input'); dtIn.type = 'datetime-local'; dtIn.value = toLocalInput(d.ts);
    dtIn.onchange = () => { if (dtIn.value) d.ts = new Date(dtIn.value).toISOString(); };
    b.append(dtIn);
    chipRow(b, '時間帯', BASIC.slot, () => d.basic.slot, v => { d.basic.slot = v; });
    chipRow(b, '訪問形態', BASIC.mode, () => d.basic.mode, v => { d.basic.mode = v; });
    chipRow(b, '同行者（複数可）', BASIC.companions, () => d.basic.companions, v => { d.basic.companions = v; }, { multi: true });
    chipRow(b, '目的（複数可）', BASIC.purposes, () => d.basic.purposes, v => { d.basic.purposes = v; }, { multi: true });
    b.append(el('div', 'field-label', '実食（注文品）'));
    const meal = el('input'); meal.type = 'text'; meal.value = d.basic.meal.items; meal.placeholder = '例: 明太子パスタ 1,280円';
    meal.oninput = () => { d.basic.meal.items = meal.value; };
    b.append(meal);
    chipRow(b, '価格妥当性', RATINGS, () => d.basic.meal.priceJudge, v => { d.basic.meal.priceJudge = v; }, { rate: true });
  });

  // B. 観察
  const obsDone = OBSERVE.filter(a => d.observe[a.key].r).map(a => a.label.split(' ')[0] + labelOf(RATINGS, d.observe[a.key].r)).join(' ');
  section('observe', 'B 観察（◎○△＋補足）', obsDone, (b) => {
    OBSERVE.forEach(a => {
      const ax = el('div', 'axis');
      const head = el('div', 'axis-head');
      head.append(el('span', 'name', a.label));
      chipRow(head, null, RATINGS, () => d.observe[a.key].r, v => { d.observe[a.key].r = v; }, { rate: true, noLabel: true });
      ax.append(head);
      chipRow(ax, null, a.tags, () => d.observe[a.key].tags, v => { d.observe[a.key].tags = v; }, { multi: true, small: true, noLabel: true });
      b.append(ax);
    });
  });

  // C. 対話
  const talkDone = [...d.talk.roles, labelOf(TALK.mood, d.talk.mood)].filter(Boolean).join('・');
  section('talk', 'C 対話（店長・スタッフ）', talkDone, (b) => {
    chipRow(b, '相手（複数可）', TALK.roles, () => d.talk.roles, v => { d.talk.roles = v; }, { multi: true });
    chipRow(b, 'テーマ（複数可）', TALK.themes, () => d.talk.themes, v => { d.talk.themes = v; }, { multi: true });
    chipRow(b, '温度感', TALK.mood, () => d.talk.mood, v => { d.talk.mood = v; });
    b.append(el('div', 'field-label', '発言要旨（役職まで・氏名は書かない）'));
    const ta = el('textarea'); ta.value = d.talk.memo;
    ta.oninput = () => { d.talk.memo = ta.value; };
    b.append(ta);
  });

  // D. 課題・アクション
  const issueDone = [labelOf(ISSUE.judge, d.issue.judge), d.issue.priority ? '重要度' + labelOf(ISSUE.priority, d.issue.priority) : ''].filter(Boolean).join('・');
  section('issue', 'D 課題・アクション', issueDone, (b) => {
    chipRow(b, '判定', ISSUE.judge, () => d.issue.judge, v => { d.issue.judge = v; }, { warn: true });
    chipRow(b, '重要度', ISSUE.priority, () => d.issue.priority, v => { d.issue.priority = v; });
    chipRow(b, '宛先（複数可）', ISSUE.to, () => d.issue.to, v => { d.issue.to = v; }, { multi: true });
    b.append(el('div', 'field-label', 'フォロー期限（任意）'));
    const due = el('input'); due.type = 'date'; due.value = d.issue.due;
    due.onchange = () => { d.issue.due = due.value; };
    b.append(due);
    b.append(el('div', 'field-label', '論点メモ'));
    const ta = el('textarea'); ta.value = d.issue.memo;
    ta.oninput = () => { d.issue.memo = ta.value; };
    b.append(ta);
  });

  // E. 写真
  section('photos', 'E 写真', d.photos.length ? `${d.photos.length}枚` : '', (b) => {
    chipRow(b, '次に撮る写真のタグ', PHOTO_TAGS, () => S.photoTag, v => { S.photoTag = v || '店内'; }, { small: true });
    const strip = el('div', 'photo-strip');
    d.photos.forEach(ph => {
      const w = el('div', 'del-photo');
      const img = el('img'); img.src = ph.data;
      const x = el('span', 'x', '×');
      x.onclick = () => { d.photos = d.photos.filter(q => q.id !== ph.id); render(); };
      w.append(img, x, el('div', null, ph.tag || ''));
      strip.append(w);
    });
    const add = el('button', 'add-photo', '＋');
    const file = el('input'); file.type = 'file'; file.accept = 'image/*'; file.capture = 'environment'; file.hidden = true;
    file.onchange = async () => {
      if (!file.files.length) return;
      try {
        const data = await shrinkImage(file.files[0]);
        d.photos.push({ id: uid(), tag: S.photoTag, data });
        S.open.photos = true;
        render();
      } catch { toast('写真の取込に失敗'); }
    };
    add.onclick = () => file.click();
    strip.append(add, file);
    b.append(strip);
  });

  // 全体メモ・保存
  const card = el('div', 'card');
  card.append(el('div', 'field-label', 'メモ（全体所感・その他）'));
  const ta = el('textarea'); ta.value = d.memo;
  ta.oninput = () => { d.memo = ta.value; };
  card.append(ta);
  const save = el('button', 'save-btn', 'この訪問を保存');
  save.onclick = async () => {
    const rec = { id: uid(), ...JSON.parse(JSON.stringify(d)) };
    await dbPut('visits', rec);
    S.visits.push(rec);
    S.shop = null; S.draft = null;
    toast(`保存しました（${rec.brand ? rec.brand + ' ' : ''}${rec.shopName}）`);
    window.scrollTo(0, 0);
    render();
  };
  card.append(save);
  root.append(card);
}

/* ---------- 描画: 記録タブ ---------- */
function summarizeRates(r) {
  const out = [];
  OBSERVE.forEach(a => { const o = (r.observe || {})[a.key]; if (o && o.r) out.push({ label: a.label.split(' ')[0], r: o.r }); });
  return out;
}
function renderRecords(root) {
  root.append(el('h1', null, `記録（${S.visits.length}件）`));
  if (!S.visits.length) {
    root.append(el('p', 'empty', 'まだ記録がありません。\n訪問タブから店舗を選んで記録してください。'));
    return;
  }
  const filters = el('div', 'filters');
  const cos = [...new Set(S.visits.map(v => v.company).filter(Boolean))];
  if (cos.length > 1) chipRow(filters, null, cos, () => S.recFilterCo, v => { S.recFilterCo = v; }, { small: true, noLabel: true });
  chipRow(filters, null, ISSUE.judge.map(j => ({ key: j.key, label: judgeShort(j.key) })), () => S.recFilterJudge, v => { S.recFilterJudge = v; }, { small: true, noLabel: true });
  root.append(filters);

  const list = S.visits.filter(v => (!S.recFilterCo || v.company === S.recFilterCo) && (!S.recFilterJudge || (v.issue || {}).judge === S.recFilterJudge));
  [...list].sort((a, b) => b.ts.localeCompare(a.ts)).forEach(r => {
    const c = el('div', 'rec');
    const head = el('div', 'head');
    const jd = (r.issue || {}).judge;
    head.append(el('span', null, fmtTs(r.ts) + (r.basic && r.basic.slot ? ' ' + labelOf(BASIC.slot, r.basic.slot) : '')));
    if (jd) head.append(el('span', 'judge-tag judge-' + jd, judgeShort(jd)));
    c.append(head);
    const loc = el('div', 'loc');
    if (r.brand) loc.append(el('span', 'brand-tag', r.brand));
    loc.append(document.createTextNode(r.shopName + (r.company ? `（${r.company}）` : '')));
    c.append(loc);
    const rates = summarizeRates(r);
    if (rates.length) {
      const rw = el('div', 'rates');
      rates.forEach(x => { const b = el('b', x.r, x.label + labelOf(RATINGS, x.r)); rw.append(b); });
      c.append(rw);
    }
    const tagBits = [];
    if (r.basic) { tagBits.push(labelOf(BASIC.mode, r.basic.mode), ...(r.basic.companions || []), ...(r.basic.purposes || [])); }
    OBSERVE.forEach(a => { const o = (r.observe || {})[a.key]; if (o && o.tags.length) tagBits.push(...o.tags); });
    if (r.talk) tagBits.push(...(r.talk.roles || []), ...(r.talk.themes || []), labelOf(TALK.mood, r.talk.mood));
    const bits = tagBits.filter(Boolean);
    if (bits.length) c.append(el('div', 'tags', bits.join('・')));
    if (r.basic && r.basic.meal && r.basic.meal.items) c.append(el('div', 'memo', '実食: ' + r.basic.meal.items + (r.basic.meal.priceJudge ? ' ' + labelOf(RATINGS, r.basic.meal.priceJudge) : '')));
    const memoBlock = (label, text) => { if (!text) return; const m = el('div', 'memo'); m.append(el('b', null, label + ' '), document.createTextNode(text)); c.append(m); };
    memoBlock('対話', (r.talk || {}).memo);
    memoBlock('論点', (r.issue || {}).memo + ((r.issue || {}).to && r.issue.to.length ? `（宛先: ${r.issue.to.join('・')}${r.issue.due ? ' 期限' + r.issue.due : ''}）` : ''));
    memoBlock('', r.memo);
    if (r.photos && r.photos.length) {
      const th = el('div', 'thumbs');
      r.photos.forEach(p => { if (p.data) { const i = el('img'); i.src = p.data; i.title = p.tag || ''; th.append(i); } });
      c.append(th);
    }
    const del = el('button', 'del', '削除');
    del.onclick = async () => {
      if (!confirm('この記録を削除しますか？')) return;
      await dbDel('visits', r.id);
      S.visits = S.visits.filter(x => x.id !== r.id);
      render();
    };
    c.append(del);
    root.append(c);
  });
}

/* ---------- 描画: 設定タブ ---------- */
function renderSettings(root) {
  root.append(el('h1', null, '設定・保全'));

  const b1 = el('div', 'set-block card');
  b1.append(el('h2', null, '店舗マスター（公式サイトから取得）'));
  const m = S.master;
  b1.append(el('div', 'set-note', m ? `取得: ${fmtTs(m.fetchedAt)}・${m.counts.shop}店 / ${m.counts.brand}ブランド / ${m.counts.company}社` : '未取得'));
  const fetchBtn = el('button', null, '店舗マスターを更新');
  fetchBtn.onclick = async () => {
    fetchBtn.disabled = true;
    try { const mm = await fetchMaster(); toast(`${mm.counts.shop}店を取得`); S.masterErr = null; render(); }
    catch (e) { toast('取得失敗: ' + e.message); fetchBtn.disabled = false; }
  };
  b1.append(fetchBtn, el('div', 'set-note', '起動時に24時間経過していれば自動更新。閉店で公式から消えた店舗の記録は店名を保持したまま残る。'));
  const manual = S.stores.filter(s => s.manual);
  if (manual.length) {
    b1.append(el('div', 'field-label', `手入力店舗（${manual.length}）`));
    manual.forEach(s => {
      const r = el('div', 'manual-row');
      const dl = el('button', null, '削除');
      dl.onclick = async () => {
        if (!confirm(`「${s.label}」を店舗リストから削除しますか？（記録は残ります）`)) return;
        await dbDel('stores', s.id); S.stores = S.stores.filter(x => x.id !== s.id); render();
      };
      r.append(el('span', null, s.label), dl);
      b1.append(r);
    });
  }
  root.append(b1);

  const b2 = el('div', 'set-block card');
  b2.append(el('h2', null, 'エクスポート'));
  const last = S.meta.lastExportAt;
  b2.append(el('div', 'set-note', last ? `前回エクスポート: ${fmtTs(last)}（以降 ${S.visits.filter(v => v.ts > last).length}件）` : '未エクスポート'));
  const ex1 = el('button', null, '写真込みJSONを書き出し（全件）');
  ex1.onclick = () => exportJSON('all');
  const ex2 = el('button', null, '写真込みJSONを書き出し（前回以降のみ）');
  ex2.onclick = () => exportJSON('since');
  const ex3 = el('button', null, 'テキストのみコピー（チャット貼付用）');
  ex3.onclick = () => exportJSON('text');
  b2.append(ex1, ex2, ex3, el('div', 'set-note', '写真込み＝共有シートからAirDrop/ファイルでMacへ → shop-visit/data/exports/ に置いてClaudeに「店舗訪問記録を取り込んで」。テキストのみ＝クリップボードへ。'));
  root.append(b2);

  const b3 = el('div', 'set-block card');
  b3.append(el('h2', null, 'インポート（マージ）'));
  const file = el('input'); file.type = 'file'; file.accept = '.json,application/json';
  file.onchange = async () => {
    if (!file.files.length) return;
    try {
      const j = JSON.parse(await file.files[0].text());
      if (j.format !== EXPORT_FORMAT) throw new Error('format不一致');
      let n = 0;
      for (const r of j.records || []) { await dbPut('visits', r); n++; }
      for (const s of j.manual_stores || []) { await dbPut('stores', s); }
      S.visits = await dbAll('visits'); S.stores = await dbAll('stores');
      toast(`${n}件をマージ取込`);
      render();
    } catch (e) { toast('取込失敗: ' + e.message); }
  };
  b3.append(file);
  root.append(b3);

  const b4 = el('div', 'set-block card');
  b4.append(el('h2', null, 'データ削除'));
  const clr = el('button', 'danger', '全記録を削除');
  clr.onclick = async () => {
    if (!confirm('全記録を削除します。エクスポート済みですか？')) return;
    await dbClear('visits');
    S.visits = [];
    toast('削除しました');
    render();
  };
  b4.append(clr, el('div', 'set-note', `記録はこの端末のIndexedDBにのみ保存（外部送信なし）。${APP_VERSION}`));
  root.append(b4);
}

async function exportJSON(mode) {
  const now = new Date().toISOString();
  const since = mode === 'since' ? (S.meta.lastExportAt || null) : null;
  let recs = S.visits.filter(v => !since || v.ts > since);
  if (mode === 'text') recs = recs.map(r => ({ ...r, photos: (r.photos || []).map(p => ({ id: p.id, tag: p.tag })) }));
  if (!recs.length) { toast('書き出す記録がありません'); return; }
  const payload = {
    format: EXPORT_FORMAT,
    exported_at: now,
    app: APP_VERSION,
    master: S.master ? { fetched_at: S.master.fetchedAt, counts: S.master.counts } : null,
    range: { since, until: now },
    records: recs,
    manual_stores: S.stores.filter(s => s.manual),
  };
  const json = JSON.stringify(payload, null, 1);
  if (mode === 'text') {
    try { await navigator.clipboard.writeText(json); toast(`${recs.length}件をコピーしました`); }
    catch { prompt('コピーしてください', json); }
    return;
  }
  const name = `shopvisit_${now.slice(0, 10)}${since ? '_diff' : ''}.json`;
  const blob = new Blob([json], { type: 'application/json' });
  let done = false;
  if (navigator.canShare && navigator.canShare({ files: [new File([blob], name)] })) {
    try { await navigator.share({ files: [new File([blob], name, { type: 'application/json' })] }); done = true; }
    catch (e) { if (e && e.name === 'AbortError') return; }
  }
  if (!done) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  S.meta.lastExportAt = now;
  await dbPut('meta', { key: 'lastExportAt', value: now });
  toast(`${recs.length}件を書き出しました`);
  render();
}

/* ---------- ルート描画 ---------- */
function render() {
  const root = $('#app');
  root.textContent = '';
  document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === S.tab));
  const badge = $('#recBadge');
  badge.hidden = !S.visits.length;
  badge.textContent = S.visits.length;
  if (S.tab === 'visit') renderVisit(root);
  else if (S.tab === 'records') renderRecords(root);
  else renderSettings(root);
}

document.querySelectorAll('.nav button').forEach(b => {
  b.onclick = () => { S.tab = b.dataset.tab; render(); };
});

(async function init() {
  render(); // 先に描画（IndexedDB読込を待たない）
  const [visits, stores, master, lastExp] = await Promise.all([dbAll('visits'), dbAll('stores'), dbGet('meta', 'master'), dbGet('meta', 'lastExportAt')]);
  S.visits = visits; S.stores = stores; S.master = master || null;
  S.meta.lastExportAt = lastExp ? lastExp.value : null;
  render();
  refreshMasterIfStale();
  window.addEventListener('online', refreshMasterIfStale);
})();
