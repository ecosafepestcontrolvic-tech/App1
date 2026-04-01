

// ============================================================
// src/state.js
// ============================================================

// ============================================================
// MODAL / CONFIRM HELPERS
// ============================================================
var _confirmCallback = null;
function showConfirm(title, msg, okLabel, okClass, cb) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMsg').textContent = msg;
  var okBtn = document.getElementById('confirmOkBtn');
  okBtn.textContent = okLabel || 'Confirm';
  okBtn.className = 'btn ' + (okClass || 'btn-p');
  _confirmCallback = cb;
  document.getElementById('confirmModal').classList.add('show');
}
function closeConfirmModal() {
  document.getElementById('confirmModal').classList.remove('show');
  _confirmCallback = null;
}
function _confirmOk() {
  closeConfirmModal();
  if (_confirmCallback) _confirmCallback();
}

// ============================================================
// GENERATING OVERLAY
// ============================================================
function showGenOverlay(title, sub) {
  document.getElementById('genTitle').textContent = title || 'Generating Report';
  document.getElementById('genSub').textContent = sub || 'AI is analysing your data...';
  document.getElementById('genOverlay').classList.add('show');
}
function hideGenOverlay() {
  document.getElementById('genOverlay').classList.remove('show');
}

// ============================================================
// CHARACTER COUNTER
// ============================================================
function updateCommentCounter(el) {
  var len = el.value.length;
  var max = 1000;
  var counter = document.getElementById('commentCounter');
  if (counter) {
    counter.textContent = len + ' / ' + max;
    counter.className = 'input-counter' + (len > max * 0.9 ? ' warn' : '') + (len > max ? ' over' : '');
  }
}

// ============================================================
// SITE SEARCH FILTER
// ============================================================
function filterSiteList(query) {
  var q = query.toLowerCase().trim();
  var items = document.querySelectorAll('#siteList .site-item');
  items.forEach(function(item) {
    var text = item.textContent.toLowerCase();
    item.style.display = (!q || text.indexOf(q) >= 0) ? '' : 'none';
  });
}

// ============================================================
// PROGRESS BAR UPDATE
// ============================================================
function updateProgressBar(screen) {
  var fill = document.getElementById('hdrProgressFill');
  var bar = document.getElementById('hdrProgress');
  if (!fill || !bar) return;
  if (screen < 1 || screen > 4) { bar.style.display = 'none'; return; }
  bar.style.display = 'block';
  fill.style.width = (screen / 4 * 100) + '%';
}

// ============================================================
// HOME STATS ROW
// ============================================================
function renderHomeStats() {
  var row = document.getElementById('homeStatsRow');
  if (!row) return;
  var jobs = [];
  try { jobs = JSON.parse(localStorage.getItem('es_sched') || '[]'); } catch(e) {}
  var today = new Date().toISOString().slice(0,10);
  var todayJobs = jobs.filter(function(j){ return j.date === today && j.active !== false; });
  var done = todayJobs.filter(function(j){ return j.done; }).length;
  var total = todayJobs.length;
  var pending = total - done;

  if (!total) { row.style.display = 'none'; return; }
  row.style.display = 'flex';
  row.innerHTML = [
    {val: total, lbl: 'Jobs Today', color: null},
    {val: done, lbl: 'Completed', color: done > 0 ? 'var(--gd)' : 'var(--di)'},
    {val: pending, lbl: 'Remaining', color: pending > 0 ? 'var(--a)' : 'var(--gd)'}
  ].map(function(s) {
    return '<div class="stat-card"><div class="stat-val"' + (s.color ? ' style="color:' + s.color + '"' : '') + '>' + s.val + '</div><div class="stat-lbl">' + s.lbl + '</div></div>';
  }).join('');
}

// ============================================================
// STATE
// ============================================================
var S = {
  sites: [],
  selectedSite: null,
  editingSiteIdx: -1,
  stations: {},   // { 'ir': [{num:1,val:'Nil'},...], 'er': [...], ... }
  products: [],
  currentScreen: 1,
  popTarget: null  // { group, idx }
};

// ============================================================
// src/supabase.js
// ============================================================
// ============================================================
// SUPABASE CLOUD SYNC
// ============================================================
var SB_URL = 'https://xfnrchffempbnitcfvgu.supabase.co';
var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhmbnJjaGZmZW1wYm5pdGNmdmd1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNTIyOTgsImV4cCI6MjA4NzkyODI5OH0.dfK-bVwPQIBjnObDlpAl3KLhk3Mt4qsgjvFGz9c012A';

// ── Supabase key validation ──────────────────────────────
// The REST API requires a JWT anon key (starts with eyJ...).
// sb_publishable_ keys only work with the JS SDK v2, not raw fetch.
// We load the real anon key from localStorage if it's been configured.
function getSbKey() {
  var stored = localStorage.getItem('es_sb_anon_key');
  return (stored && stored.length > 50) ? stored : SB_KEY;
}
function getSbUrl() {
  var stored = localStorage.getItem('es_sb_url');
  return (stored && stored.startsWith('https://')) ? stored : SB_URL;
}
function isSbConfigured() {
  var key = getSbKey();
  // A valid Supabase anon JWT starts with eyJ
  return key && key.startsWith('eyJ');
}

function sbHeaders() {
  var key = getSbKey();
  return {
    'Content-Type': 'application/json',
    'apikey': key,
    'Authorization': 'Bearer ' + key,
    'Prefer': 'return=representation'
  };
}

async function sbGet(table, params) {
  if (!isSbConfigured()) throw new Error('Supabase not configured — anon key missing');
  var url = getSbUrl() + '/rest/v1/' + table + '?order=created_at.asc';
  if (params) url += '&' + params;
  var fetchPromise = fetch(url, { headers: sbHeaders() }).then(function(resp) {
    if (!resp.ok) {
      return resp.text().catch(function(){ return ''; }).then(function(body) {
        throw new Error('sbGet ' + table + ' HTTP ' + resp.status + (body ? ': ' + body.slice(0,120) : ''));
      });
    }
    return resp.json();
  });
  var timeoutPromise = new Promise(function(_, reject) {
    setTimeout(function() { reject(new Error('Request timed out — Supabase may be paused or URL is wrong')); }, 10000);
  });
  return Promise.race([fetchPromise, timeoutPromise]);
}

async function sbUpsert(table, data, onConflict) {
  if (!isSbConfigured()) throw new Error('Supabase not configured');
  var url = getSbUrl() + '/rest/v1/' + table;
  if (onConflict) url += '?on_conflict=' + onConflict;
  var resp = await fetch(url, {
    method: 'POST',
    headers: Object.assign({}, sbHeaders(), { 'Prefer': 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify(data)
  });
  if (!resp.ok) {
    var err = await resp.text();
    throw new Error('sbUpsert ' + table + ' HTTP ' + resp.status + ': ' + err);
  }
  return resp.json();
}

async function sbInsert(table, data) {
  if (!isSbConfigured()) throw new Error('Supabase not configured');
  var url = getSbUrl() + '/rest/v1/' + table;
  var resp = await fetch(url, {
    method: 'POST',
    headers: sbHeaders(),
    body: JSON.stringify(data)
  });
  if (!resp.ok) {
    var errBody=''; try { errBody = await resp.text(); } catch(e) {}
    if (resp.status===403||resp.status===401) throw new Error('Permission denied (HTTP '+resp.status+') — disable RLS in Supabase Table Editor for the '+table+' table. '+errBody.slice(0,80));
    throw new Error('sbInsert '+table+' HTTP '+resp.status+' '+errBody.slice(0,60));
  }
  return resp.json();
}

async function sbUpdate(table, id, data, idCol) {
  if (!isSbConfigured()) throw new Error('Supabase not configured');
  idCol = idCol || 'id';
  var url = getSbUrl() + '/rest/v1/' + table + '?' + idCol + '=eq.' + id;
  var resp = await fetch(url, {
    method: 'PATCH',
    headers: sbHeaders(),
    body: JSON.stringify(data)
  });
  if (!resp.ok) throw new Error('sbUpdate ' + table + ' HTTP ' + resp.status);
  return resp.json();
}

async function sbDelete(table, id, idCol) {
  if (!isSbConfigured()) throw new Error('Supabase not configured');
  idCol = idCol || 'id';
  var url = getSbUrl() + '/rest/v1/' + table + '?' + idCol + '=eq.' + id;
  var resp = await fetch(url, { method: 'DELETE', headers: sbHeaders() });
  if (!resp.ok) throw new Error('sbDelete ' + table + ' HTTP ' + resp.status);
}

// ============================================================
// SYNC STATUS UI
// ============================================================


function showSyncStatus(msg, isError) {
  // Removed from header — caused layout shifts every sync operation.
  // Errors surface via showSyncBanner; status via the home screen status bar.
  if (isError && typeof _statusUpdateMasterDot === 'function') _statusUpdateMasterDot();
}

// ============================================================
// INITIAL CLOUD SYNC ON APP LOAD
// ============================================================
async function initialCloudSync() {
  // Before attempting any network calls, check if the key is valid
  if (!isSbConfigured()) {
    console.warn('Supabase anon key not configured. Enter your JWT anon key in Admin → Database tab.');
    // Don't try to open admin here — user may not be logged in yet
    // Just show a soft info banner that auto-dismisses
    // Show persistent setup banner — phone needs the DB key to sync
    showSyncBanner('⚙️ Database not set up on this device — log in as Admin and go to the Database tab to enter your Supabase key', true, function() {
      showAdmin(); showAdminTab('db');
    });
    return false;
  }

  showSyncStatus('⟳ Syncing...', false);
  try {
    // Load all credentials first (API key etc) before other data fetches
    await loadApiKeyFromCloud();
    var results = await Promise.allSettled([
      loadSitesFromCloud(),
      loadApiKeyFromCloud(),
      loadProdLibFromCloud(),
      loadTechsFromCloud().then(function(t){
      localStorage.setItem('es_techs', JSON.stringify(t));
      window._techsList = t;
      if (typeof renderLoginTechList === 'function') renderLoginTechList();
      if (typeof renderTechPicker === 'function') renderTechPicker();
    }),
      loadScheduleFromCloud().then(function(j){
      // Refresh home screen job cards if a tech is already logged in
      if (typeof AUTH !== 'undefined' && AUTH.loggedIn && !AUTH.isAdmin &&
          typeof activeTechIdx === 'number' && activeTechIdx >= 0 &&
          typeof showTechJobs === 'function') {
        showTechJobs(activeTechIdx);
      }
    })
    ]);
    var failed = results.filter(function(r){ return r.status === 'rejected'; });

    if (failed.length === 0) {
      showSyncStatus('✓ Synced', false);
      hideSyncBanner();
      recordSyncSuccess();
    } else if (failed.length === results.length) {
      // Diagnose the failure reason from the first error
      var firstErr = (failed[0].reason && failed[0].reason.message) || '';
      var msg;
      if (firstErr.indexOf('401') >= 0 || firstErr.indexOf('403') >= 0) {
        msg = '🔑 Database auth failed — anon key may be wrong. Tap to fix.';
      } else if (firstErr.indexOf('timed out') >= 0) {
        msg = '⏱ Database timed out — project may be paused. Tap to retry.';
      } else if (firstErr.indexOf('Load failed') >= 0 || firstErr.indexOf('NetworkError') >= 0 || firstErr.indexOf('Failed to fetch') >= 0) {
        msg = '📵 No internet connection — running on local data.';
      } else {
        msg = '⚠️ Cannot reach database (' + firstErr.slice(0, 60) + '). Tap to retry.';
      }
      showSyncBanner(msg, true);
      showSyncStatus('⚠ Offline', true);
    } else {
      showSyncStatus('⚠ Partial sync', true);
    }
    return failed.length < results.length;
  } catch(e) {
    console.warn('initialCloudSync failed:', e);
    showSyncBanner('⚠️ Cannot reach database. Tap to retry.', true);
    showSyncStatus('⚠ Offline', true);
    return false;
  }
}

function showSyncBanner(msg, isError, clickFn) {
  var existing = document.getElementById('sync-banner');
  if (existing) existing.remove();
  var banner = document.createElement('div');
  banner.id = 'sync-banner';
  banner.style.cssText = 'position:fixed;bottom:70px;left:50%;transform:translateX(-50%);width:calc(100% - 32px);max-width:488px;background:' + (isError ? '#c0392b' : '#008350') + ';color:#fff;padding:10px 16px;border-radius:10px;display:flex;align-items:center;justify-content:space-between;gap:10px;z-index:9999;font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,0.25)';
  var txt = document.createElement('span');
  txt.textContent = msg;
  var retryBtn = document.createElement('button');
  retryBtn.textContent = clickFn ? '⚙ Fix' : '↺ Retry';
  retryBtn.style.cssText = 'background:rgba(255,255,255,0.25);border:1px solid rgba(255,255,255,0.5);color:#fff;padding:4px 12px;border-radius:20px;font-size:12px;cursor:pointer;white-space:nowrap;flex-shrink:0';
  retryBtn.onclick = function() {
    banner.remove();
    if (clickFn) { clickFn(); return; }
    initialCloudSync().then(function(){
      populateTechSelects();
      populateSchedDropdowns();
      renderTechPicker();
      renderSiteList && renderSiteList();
    });
  };
  var closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'background:none;border:none;color:rgba(255,255,255,0.7);font-size:16px;cursor:pointer;padding:0 0 0 4px;flex-shrink:0;line-height:1';
  closeBtn.onclick = function() { banner.remove(); };
  banner.appendChild(txt);
  banner.appendChild(retryBtn);
  banner.appendChild(closeBtn);
  document.body.appendChild(banner);
  if (!isError) setTimeout(function(){ if(banner.parentNode) banner.remove(); }, 12000);
}

function hideSyncBanner() {
  var b = document.getElementById('sync-banner');
  if (b) b.remove();
}

// ============================================================
// src/auth.js
// ============================================================
// ============================================================
// AUTH STATE
// ============================================================
var AUTH = {
  loggedIn: false,
  isAdmin: false,
  techIdx: null,    // index into loadTechs()
  techName: null
};

// PIN storage helpers
function getPins() {
  try { return JSON.parse(localStorage.getItem('es_pins') || '{}'); } catch(e) { return {}; }
}
function savePins(pins) { localStorage.setItem('es_pins', JSON.stringify(pins)); }
function getTechPin(name) { return getPins()[name] || null; }
function setTechPin(name, pin) { var p = getPins(); p[name] = pin; savePins(p); }
function getAdminPin() { return localStorage.getItem('es_admin_pin') || '0000'; }
function setAdminPin(pin) { localStorage.setItem('es_admin_pin', pin); }

// ── Login flow ──────────────────────────────────────────
var _loginSelectedTech = null;
var _pinBuffer = '';
var _adminPinBuffer = '';
var _setPinBuffer = '';
var _setPinTarget = null;  // 'admin' | tech name
var _setPinConfirming = false;
var _setPinFirst = '';

function showLoginScreen() {
  document.getElementById('loginScreen').style.display = 'block';
  document.getElementById('loginCardStep1').style.display = 'block';
  document.getElementById('loginCardStep2').style.display = 'none';
  document.getElementById('loginCardAdmin').style.display = 'none';
  renderLoginTechList();
}

function hideLoginScreen() {
  document.getElementById('loginScreen').style.display = 'none';
}

function renderLoginTechList() {
  var techs = loadTechs();
  var list = document.getElementById('loginTechList');
  list.innerHTML = '';
  if (!techs.length) {
    list.innerHTML = '<div style="color:var(--di);font-size:13px;text-align:center;padding:16px">No technicians set up yet.<br>Ask your admin to add you.</div>';
    return;
  }
  techs.forEach(function(t, i) {
    var btn = document.createElement('button');
    btn.className = 'tech-login-btn';
    var av = document.createElement('div');
    av.className = 'tech-avatar';
    av.textContent = t.name.charAt(0).toUpperCase();
    var nm = document.createElement('span');
    nm.textContent = t.name;
    btn.appendChild(av); btn.appendChild(nm);
    (function(tech, idx) {
      btn.addEventListener('click', function() {
        _loginSelectedTech = { tech: tech, idx: idx };
        showPinEntry(tech);
      });
    })(t, i);
    list.appendChild(btn);
  });
}

function showPinEntry(tech) {
  _pinBuffer = '';
  document.getElementById('loginCardStep1').style.display = 'none';
  document.getElementById('loginCardStep2').style.display = 'block';
  document.getElementById('loginPinName').textContent = tech.name;
  document.getElementById('pinError').textContent = '';
  var hasPin = !!getTechPin(tech.name);
  document.getElementById('firstPinHint').textContent = hasPin ? '' : 'First login — set a new 4-digit PIN';
  updatePinDots('pd', _pinBuffer);
}

function loginBack() {
  _pinBuffer = '';
  _adminPinBuffer = '';
  document.getElementById('loginCardStep1').style.display = 'block';
  document.getElementById('loginCardStep2').style.display = 'none';
  document.getElementById('loginCardAdmin').style.display = 'none';
}

function pinKey(d) {
  if (_pinBuffer.length >= 4) return;
  _pinBuffer += d;
  updatePinDots('pd', _pinBuffer);
  if (_pinBuffer.length === 4) {
    setTimeout(function() { attemptLogin(_pinBuffer); }, 120);
  }
}

function pinDel() {
  _pinBuffer = _pinBuffer.slice(0, -1);
  updatePinDots('pd', _pinBuffer);
  document.getElementById('pinError').textContent = '';
}

var _pinAttempts = 0; var _pinLockUntil = 0;
function attemptLogin(pin) {
  if (Date.now() < _pinLockUntil) {
    var s = Math.ceil((_pinLockUntil-Date.now())/1000);
    document.getElementById('pinError').textContent = 'Too many attempts — wait '+s+'s';
    _pinBuffer=''; updatePinDots('pd',''); return;
  }
  var tech = _loginSelectedTech.tech;
  var stored = getTechPin(tech.name);
  if (!stored) { setTechPin(tech.name, pin); _pinAttempts=0; completeLogin(_loginSelectedTech.idx, tech.name, false); return; }
  if (pin === stored) {
    _pinAttempts=0; completeLogin(_loginSelectedTech.idx, tech.name, false);
  } else {
    _pinAttempts++;
    _pinBuffer=''; updatePinDots('pd','');
    if (_pinAttempts>=5) { _pinLockUntil=Date.now()+30000; _pinAttempts=0; document.getElementById('pinError').textContent='Too many attempts — locked 30s'; }
    else { var r=5-_pinAttempts; document.getElementById('pinError').textContent='Incorrect PIN. '+r+' attempt'+(r===1?'':'s')+' remaining.'; }
    document.getElementById('loginCardStep2').style.animation='none';
    setTimeout(function(){ document.getElementById('loginCardStep2').style.animation=''; },10);
  }
}

function showAdminPinEntry() {
  _adminPinBuffer = '';
  document.getElementById('loginCardStep1').style.display = 'none';
  document.getElementById('loginCardAdmin').style.display = 'block';
  document.getElementById('adminPinError').textContent = '';
  updatePinDots('apd', '');
}

function adminPinKey(d) {
  if (_adminPinBuffer.length >= 4) return;
  _adminPinBuffer += d;
  updatePinDots('apd', _adminPinBuffer);
  if (_adminPinBuffer.length === 4) {
    setTimeout(function() { attemptAdminLogin(_adminPinBuffer); }, 120);
  }
}

function adminPinDel() {
  _adminPinBuffer = _adminPinBuffer.slice(0, -1);
  updatePinDots('apd', _adminPinBuffer);
  document.getElementById('adminPinError').textContent = '';
}

var _adminPinAttempts = 0;
var _adminPinLockUntil = 0;

function attemptAdminLogin(pin) {
  if (Date.now() < _adminPinLockUntil) {
    var s = Math.ceil((_adminPinLockUntil - Date.now()) / 1000);
    document.getElementById('adminPinError').textContent = 'Too many attempts — wait ' + s + 's';
    _adminPinBuffer = ''; updatePinDots('apd', ''); return;
  }
  if (pin === getAdminPin()) {
    _adminPinAttempts = 0;
    completeLogin(null, 'Admin', true);
  } else {
    _adminPinAttempts++;
    _adminPinBuffer = ''; updatePinDots('apd', '');
    if (_adminPinAttempts >= 5) {
      _adminPinLockUntil = Date.now() + 30000;
      _adminPinAttempts = 0;
      document.getElementById('adminPinError').textContent = 'Too many attempts — locked 30s';
    } else {
      var r = 5 - _adminPinAttempts;
      document.getElementById('adminPinError').textContent = 'Incorrect PIN. ' + r + ' attempt' + (r===1?'':'s') + ' remaining.';
    }
  }
}

function completeLogin(techIdx, techName, isAdmin) {
  AUTH.loggedIn = true;
  AUTH.isAdmin = isAdmin;
  AUTH.techIdx = techIdx;
  AUTH.techName = techName;
  localStorage.setItem('es_session', JSON.stringify({ techIdx: techIdx, techName: techName, isAdmin: isAdmin, ts: Date.now() }));
  hideLoginScreen();
  updateHeaderForAuth();
  // Show manage library button for admins
  var mlb = document.getElementById('manageProdLibBtn');
  if (mlb) mlb.style.display = isAdmin ? '' : 'none';
  goHome();
}

function updateHeaderForAuth() {
  var badge = document.getElementById('userBadge');
  var avatar = document.getElementById('userBadgeAvatar');
  var name = document.getElementById('userBadgeName');
  var adminBtn = document.getElementById('adminBtn');

  badge.style.display = 'flex';
  avatar.textContent = AUTH.techName.charAt(0).toUpperCase();
  name.textContent = AUTH.isAdmin ? '★ Admin' : AUTH.techName.split(' ')[0];

  // Admin button only visible to admin
  adminBtn.style.display = AUTH.isAdmin ? '' : 'none';
}

function confirmSignOut() {
  signOut();
}

function signOut() {
  AUTH.loggedIn = false;
  AUTH.isAdmin = false;
  AUTH.techIdx = null;
  AUTH.techName = null;
  localStorage.removeItem('es_session');
  document.getElementById('userBadge').style.display = 'none';
  document.getElementById('adminBtn').style.display = 'none';
  document.getElementById('homeBtn').style.display = 'none';
  var soBtn = document.getElementById('techSignOutBtn'); if(soBtn) soBtn.style.display = 'none';
  document.getElementById('stepsBar').style.display = 'none';
  // Hide all screens
  document.querySelectorAll('.scr').forEach(function(s){ s.classList.remove('on'); });
  showLoginScreen();
}

function updatePinDots(prefix, buf) {
  for (var i = 0; i < 4; i++) {
    var dot = document.getElementById(prefix + i);
    if (dot) dot.className = 'pin-dot' + (i < buf.length ? ' filled' : '');
  }
}

// ── Set PIN overlay (admin sets tech PIN) ───────────────
function openSetPinOverlay(target, displayName) {
  _setPinTarget = target;
  _setPinBuffer = '';
  _setPinConfirming = false;
  _setPinFirst = '';
  document.getElementById('setPinTitle').textContent = 'Set PIN — ' + displayName;
  document.getElementById('setPinSubtitle').textContent = 'Enter a new 4-digit PIN';
  document.getElementById('setPinError').textContent = '';
  updatePinDots('spd', '');
  document.getElementById('setPinOverlay').classList.add('show');
}

function closePinOverlay() {
  document.getElementById('setPinOverlay').classList.remove('show');
  _setPinBuffer = ''; _setPinTarget = null; _setPinConfirming = false;
}

function setPinKey(d) {
  if (_setPinBuffer.length >= 4) return;
  _setPinBuffer += d;
  updatePinDots('spd', _setPinBuffer);
  if (_setPinBuffer.length === 4) {
    setTimeout(function() {
      if (!_setPinConfirming) {
        _setPinFirst = _setPinBuffer;
        _setPinBuffer = '';
        _setPinConfirming = true;
        document.getElementById('setPinSubtitle').textContent = 'Confirm your new PIN';
        document.getElementById('setPinError').textContent = '';
        updatePinDots('spd', '');
      } else {
        if (_setPinBuffer === _setPinFirst) {
          // Save
          if (_setPinTarget === 'admin') {
            setAdminPin(_setPinBuffer);
          } else {
            setTechPin(_setPinTarget, _setPinBuffer);
          }
          closePinOverlay();
          toast('✓ PIN updated');
        } else {
          _setPinBuffer = '';
          _setPinConfirming = false;
          _setPinFirst = '';
          document.getElementById('setPinSubtitle').textContent = 'PINs did not match. Try again.';
          document.getElementById('setPinError').textContent = '';
          updatePinDots('spd', '');
        }
      }
    }, 120);
  }
}

function setPinDel() {
  _setPinBuffer = _setPinBuffer.slice(0, -1);
  updatePinDots('spd', _setPinBuffer);
}

function changeAdminPin() {
  openSetPinOverlay('admin', 'Admin');
}

// ── Session restore ─────────────────────────────────────
function tryRestoreSession() {
  try {
    var raw = localStorage.getItem('es_session');
    if (!raw) return false;
    var sess = JSON.parse(raw);
    if (Date.now() - sess.ts > 12 * 60 * 60 * 1000) { localStorage.removeItem('es_session'); return false; }
    AUTH.loggedIn = true;
    AUTH.isAdmin = sess.isAdmin;
    AUTH.techIdx = sess.techIdx;
    AUTH.techName = sess.techName;
    updateHeaderForAuth();
    var mlb = document.getElementById('manageProdLibBtn');
    if (mlb) mlb.style.display = sess.isAdmin ? '' : 'none';
    window._techsList = loadTechs(); // ensure paste & parse has tech context
    return true;
  } catch(e) { return false; }
}

var GROUPS = [
  { key:'ir',  label:'Internal Rodent Stations',              sfKey:'ir',  cols:['Asset ID','Asset Name','Level of Activity'] },
  { key:'irt', label:'Internal Rodent Stations (Toxic)',      sfKey:'irt', cols:['Asset ID','Asset Name','Level of Activity'] },
  { key:'er',  label:'External Lockable Rodent Stations',     sfKey:'er',  cols:['Asset ID','Asset Name','Level of Activity'] },
  { key:'sp',  label:'Stored Product Pest Monitoring Devices',sfKey:'sp',  cols:['Asset ID','Asset Name','Level of Activity','Stored Product Insect Species'] },
  { key:'ilt', label:'Insect Light Traps',                    sfKey:'ilt', cols:['Asset ID','Asset Name','Moths','Flies','Small Flying Insects'] },
];

// ILT has 3 separate reading columns
var ILT_COLS = ['moths','flies','small'];
var ILT_LABELS = ['Stored Product Moths','Flies','Small Flying Insects'];

// Load saved data
function loadState() {
  try {
    var saved = localStorage.getItem('es_sites');
    if (saved) S.sites = JSON.parse(saved);
  } catch(e) {
    console.warn('loadState failed:', e.message);
    S.sites = [];
  }
}

function saveState() {
  localStorage.setItem('es_sites', JSON.stringify(S.sites));
}

// ============================================================
// URL RESET — add ?reset=1 to URL to clear session and login
// e.g. https://your-site.netlify.app/?reset=1
// ============================================================
(function() {
  if (window.location.search.indexOf('reset=1') >= 0) {
    localStorage.removeItem('es_session');
    localStorage.removeItem('es_sched');
    localStorage.removeItem('es_scheduled_jobs');
    window.history.replaceState({}, '', window.location.pathname);
    // showLoginScreen will be called by startup after this runs
  }
})();


// ============================================================
// src/navigation.js
// ============================================================
// ============================================================
// NAVIGATION
// ============================================================
function goScreen(n) {
  if (n < 1 || n > 4) { console.warn('goScreen: invalid screen', n); return; }
  document.querySelectorAll('.scr').forEach(function(s){ s.classList.remove('on'); });
  document.querySelectorAll('.stp').forEach(function(s,i){
    s.classList.remove('on','dn');
    if (i+1 < n) s.classList.add('dn');
    if (i+1 === n) s.classList.add('on');
  });
  document.getElementById('sc'+n).classList.add('on');
  S.currentScreen = n;
  updateProgressBar(n);
  if (n > 0 && typeof hideStatusBar === "function") hideStatusBar();
  window.scrollTo(0, 0);
}

function goStations() {
  if (S.selectedSite === null || S.selectedSite === undefined) { 
    toast('⚠️ Please select a site first'); 
    // Highlight the site list visually
    var siteList = document.getElementById('siteList');
    if (siteList) { siteList.style.outline = '2px solid var(--r)'; setTimeout(function(){ siteList.style.outline=''; }, 1500); }
    return; 
  }
  var tech = document.getElementById('j-tech').value.trim();
  if (!tech) { 
    toast('⚠️ Please select a technician');
    var techSel = document.getElementById('j-tech-sel');
    if (techSel) { techSel.style.borderColor = 'var(--r)'; techSel.focus(); setTimeout(function(){ techSel.style.borderColor=''; }, 1500); }
    return; 
  }
  // Remember last-used tech for next session
  localStorage.setItem('es_last_tech', tech);
  buildStations();
  goScreen(2);
}

// ============================================================
// SITE PROFILES
// ============================================================
function renderSiteList() {
  var list = document.getElementById('siteList');
  list.innerHTML = '';
  var searchWrap = document.getElementById('siteSearchWrap');
  if (searchWrap) searchWrap.style.display = S.sites.length > 3 ? '' : 'none';
  if (!S.sites.length) {
    var empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<div class="icon">🏢</div><div class="title">No Sites Yet</div><div class="msg">Add your first client site below to get started.</div>';
    list.appendChild(empty);
    return;
  }
  S.sites.forEach(function(site, i) {
    var item = el('div', 'site-item' + (S.selectedSite === i ? ' sel' : ''));
    var left = el('div');
    var nm = el('div','site-name'); nm.textContent = site.name;
    var mt = el('div','site-meta');
    mt.innerHTML = (site.addr ? '<span style="color:var(--tx);opacity:0.7">' + site.addr + '</span><br>' : '') + siteStationSummary(site);
    left.appendChild(nm); left.appendChild(mt);
    var acts = el('div','site-actions');
    var editBtn = el('button','btn btn-s btn-xs btn');
    editBtn.textContent = '✎ Edit';
    (function(idx){ editBtn.addEventListener('click', function(e){ e.stopPropagation(); editSite(idx); }); })(i);
    var delBtn = el('button','btn btn-d btn-xs btn');
    delBtn.textContent = '✕';
    (function(idx){ delBtn.addEventListener('click', function(e){ e.stopPropagation(); deleteSite(idx); }); })(i);
    acts.appendChild(editBtn); acts.appendChild(delBtn);
    item.appendChild(left); item.appendChild(acts);
    (function(idx){ item.addEventListener('click', function(){ selectSite(idx); }); })(i);
    list.appendChild(item);
  });
}

function siteStationSummary(site) {
  var parts = [];
  if (site.freq) parts.push(site.freq);
  if (site.ir)   parts.push(site.ir  + ' int. rodent');
  if (site.irt)  parts.push(site.irt + ' int. toxic');
  if (site.er)   parts.push(site.er  + ' ext. rodent');
  if (site.sp)   parts.push(site.sp  + ' SPP');
  if (site.ilt)  parts.push(site.ilt + ' ILT');
  if (site.contact) parts.push(site.contact);
  return parts.join(' · ') || 'No details configured';
}

function selectSite(idx) {
  S.selectedSite = idx;
  renderSiteList();
  // Pre-populate job fields from site profile
  var site = S.sites[idx];
  if (site.tech) {
    var tsel = document.getElementById('j-tech-sel');
    if (tsel) { tsel.value = site.tech; }
    document.getElementById('j-tech').value = site.tech;
  }
  toast('✓ ' + site.name + ' selected');
}

function showNewSite() {
  S.editingSiteIdx = -1;
  document.getElementById('siteFormTitle').textContent = 'New Site';
  document.getElementById('sf-name').value    = '';
  document.getElementById('sf-addr').value    = '';
  document.getElementById('sf-contact').value = '';
  document.getElementById('sf-phone').value   = '';
  document.getElementById('sf-email').value   = '';
  document.getElementById('sf-tech').value    = '';
  document.getElementById('sf-freq').value    = '';
  document.getElementById('sf-ir').value    = '0';
  document.getElementById('sf-er').value    = '0';
  document.getElementById('sf-sp').value    = '0';
  document.getElementById('sf-ilt').value   = '0';
  document.getElementById('sf-irt').value   = '0';
  document.getElementById('siteForm').style.display = 'block';
  document.getElementById('sf-name').focus();
}

function editSite(idx) {
  S.editingSiteIdx = idx;
  var s = S.sites[idx];
  document.getElementById('siteFormTitle').textContent = 'Edit Site';
  document.getElementById('sf-name').value    = s.name    || '';
  document.getElementById('sf-addr').value    = s.addr    || '';
  document.getElementById('sf-contact').value = s.contact || '';
  document.getElementById('sf-phone').value   = s.phone   || '';
  document.getElementById('sf-email').value   = s.email   || '';
  document.getElementById('sf-tech').value    = s.tech    || '';
  document.getElementById('sf-freq').value    = s.freq    || '';
  document.getElementById('sf-ir').value      = s.ir      || 0;
  document.getElementById('sf-er').value    = s.er    || 0;
  document.getElementById('sf-sp').value    = s.sp    || 0;
  document.getElementById('sf-ilt').value   = s.ilt   || 0;
  document.getElementById('sf-irt').value   = s.irt   || 0;
  document.getElementById('siteForm').style.display = 'block';
}

function hideSiteForm() {
  document.getElementById('siteForm').style.display = 'none';
}

function saveSite() {
  var name = document.getElementById('sf-name').value.trim();
  if (!name) { toast('⚠️ Enter a site name'); return; }
  var site = {
    name:    name,
    addr:    document.getElementById('sf-addr').value.trim(),
    contact: document.getElementById('sf-contact').value.trim(),
    phone:   document.getElementById('sf-phone').value.trim(),
    email:   document.getElementById('sf-email').value.trim(),
    tech:    document.getElementById('sf-tech').value.trim(),
    freq:    document.getElementById('sf-freq').value,
    ir:      parseInt(document.getElementById('sf-ir').value)  || 0,
    er:      parseInt(document.getElementById('sf-er').value)  || 0,
    sp:      parseInt(document.getElementById('sf-sp').value)  || 0,
    ilt:     parseInt(document.getElementById('sf-ilt').value) || 0,
    irt:     parseInt(document.getElementById('sf-irt').value) || 0,
  };
  if (S.editingSiteIdx >= 0) {
    S.sites[S.editingSiteIdx] = site;
    if (S.selectedSite === S.editingSiteIdx) S.selectedSite = S.editingSiteIdx;
    toast('✓ Site updated');
  } else {
    S.sites.push(site);
    S.selectedSite = S.sites.length - 1;
    toast('✓ Site saved');
  }
  // Save to cloud — pass site object directly (index may shift after push)
  saveSiteToCloud(site);
  hideSiteForm();
  renderSiteList();
}

function deleteSite(idx) {
  var removed = S.sites.splice(idx, 1)[0];
  if (S.selectedSite === idx) S.selectedSite = null;
  else if (S.selectedSite > idx) S.selectedSite--;
  if (removed && removed.id) deleteSiteFromCloud(removed);
  else saveState();
  renderSiteList();
  toast('✓ Site deleted');
}

// ============================================================
// src/sync.js
// ============================================================
// ============================================================
// SITES - CLOUD VERSIONS
// ============================================================
async function loadSitesFromCloud() {
  try {
    var rows = await sbGet('sites');
    var cloudSites = rows.map(function(r) {
      return { id:r.id, name:r.name, addr:r.addr||'', contact:r.contact||'', phone:r.phone||'', email:r.email||'',
               freq:r.freq||'Monthly', tech:r.def_tech||r.tech||'', defTech:r.def_tech||r.tech||'',
               ir:r.ir||(r.stations&&r.stations.ir)||0, irt:r.irt||(r.stations&&r.stations.irt)||0,
               er:r.er||(r.stations&&r.stations.er)||0, sp:r.sp||(r.stations&&r.stations.sp)||0,
               ilt:r.ilt||(r.stations&&r.stations.ilt)||0, stations:r.stations||{} };
    });
    var localSites = []; try { localSites = JSON.parse(localStorage.getItem('es_sites')||'[]'); } catch(e) {}
    var unsynced = localSites.filter(function(ls){ return !ls.id && !cloudSites.some(function(cs){ return cs.name===ls.name; }); });
    S.sites = cloudSites.concat(unsynced);
    localStorage.setItem('es_sites', JSON.stringify(S.sites));
    if (unsynced.length > 0) unsynced.forEach(function(site){ saveSiteToCloud(site).catch(function(e){ console.warn('site sync:',e); }); });
    return true;
  } catch(e) {
    console.warn('loadSitesFromCloud failed — using local:', e.message||e);
    try { var saved=localStorage.getItem('es_sites'); if(saved) S.sites=JSON.parse(saved); } catch(e2) {}
    return false;
  }
}
async function saveSiteToCloud(site) {
  try {
    var payload = {
      name: site.name,
      addr: site.addr || '',
      contact: site.contact || '',
      phone: site.phone || '',
      email: site.email || '',
      freq: site.freq || 'Monthly',
      def_tech: site.defTech || site.tech || '',
      ir:  site.ir  || 0,
      er:  site.er  || 0,
      irt: site.irt || 0,
      sp:  site.sp  || 0,
      ilt: site.ilt || 0,
      stations: site.stations || {},
      updated_at: new Date().toISOString()
    };
    if (site.id) {
      payload.id = site.id;
      await sbUpsert('sites', payload, 'id');
    } else {
      var result = await sbInsert('sites', payload);
      if (result && result[0]) site.id = result[0].id;
    }
    localStorage.setItem('es_sites', JSON.stringify(S.sites));
    showSyncStatus('✓ Synced');
    return true;
  } catch(e) {
    console.warn('saveSiteToCloud failed:', e);
    site.id = null; // mark as unsynced so keepalive retry picks it up
    localStorage.setItem('es_sites', JSON.stringify(S.sites));
    showSyncStatus('⚠ Saved locally only — tap to retry', true);
    _sbWasOffline = true;
    return false;
  }
}

async function deleteSiteFromCloud(site) {
  try {
    if (site.id) await sbDelete('sites', site.id);
    localStorage.setItem('es_sites', JSON.stringify(S.sites));
    showSyncStatus('✓ Deleted');
  } catch(e) {
    console.warn('deleteSiteFromCloud failed:', e);
    localStorage.setItem('es_sites', JSON.stringify(S.sites));
  }
}

// ============================================================
// TECHNICIANS - CLOUD VERSIONS
// ============================================================
async function loadTechsFromCloud() {
  try {
    var rows = await sbGet('technicians');
    // Deduplicate by name — keep the first occurrence (lowest id)
    var seen = {};
    var techs = [];
    rows.forEach(function(r) {
      var key = (r.name || '').trim().toLowerCase();
      if (!seen[key]) {
        seen[key] = true;
        techs.push({ id: r.id, name: r.name, lic: r.lic || '' });
      }
    });
    localStorage.setItem('es_techs', JSON.stringify(techs));
    return techs;
  } catch(e) {
    console.warn('loadTechsFromCloud failed, using local:', e);
    try {
      var saved = localStorage.getItem('es_techs');
      return saved ? JSON.parse(saved) : [];
    } catch(e2) { return []; }
  }
}

async function saveTechToCloud(tech) {
  try {
    var payload = { name: tech.name, lic: tech.lic || '' };
    var result = await sbInsert('technicians', payload);
    if (result && result[0]) {
      tech.id = result[0].id;
      // Update the stored array so the cloud ID persists across reloads
      var techs = loadTechs();
      var idx = techs.findIndex(function(t){ return t.name === tech.name; });
      if (idx >= 0) { techs[idx].id = tech.id; localStorage.setItem('es_techs', JSON.stringify(techs)); }
    }
    showSyncStatus('✓ Synced');
    return tech;
  } catch(e) {
    console.warn('saveTechToCloud failed:', e);
    showSyncStatus('⚠ Saved locally only — tap to retry', true);
    return tech;
  }
}

async function deleteTechFromCloud(techId) {
  try {
    if (techId) await sbDelete('technicians', techId);
    showSyncStatus('✓ Deleted');
  } catch(e) {
    console.warn('deleteTechFromCloud failed:', e);
  }
}

// ============================================================
// SCHEDULED JOBS - CLOUD VERSIONS
// ============================================================
async function loadScheduleFromCloud() {
  try {
    var rows = await sbGet('scheduled_jobs');
    var jobs = rows.map(function(r) {
      return {
        id: r.id,
        techName: r.tech_name,
        siteName: r.site_name,
        siteAddr: r.site_addr || '',
        date: r.date,
        time: r.time || '',
        notes: r.notes || '',
        done: r.done || false,
        active: r.active !== false,
        _synced: true   // came from cloud — do not re-insert
      };
    });
    localStorage.setItem('es_sched', JSON.stringify(jobs));
    return jobs;
  } catch(e) {
    console.warn('loadScheduleFromCloud failed, using local:', e);
    try {
      var saved = localStorage.getItem('es_sched');
      return saved ? JSON.parse(saved) : [];
    } catch(e2) { return []; }
  }
}

async function saveJobToCloud(job) {
  try {
    var payload = {
      tech_name: job.techName,
      site_name: job.siteName,
      site_addr: job.siteAddr || '',
      date: job.date,
      time: job.time || null,
      notes: job.notes || null,
      done: job.done || false,
      active: job.active !== false
    };
    var result = await sbInsert('scheduled_jobs', payload);
    if (result && result[0]) {
      job.id = result[0].id; // replace local numeric id with cloud UUID
      // Persist the updated id back to localStorage
      var sched = loadSchedule();
      var match = sched.find(function(x){ return String(x.id) === String(job._localId || job.id) || x.id === job.id; });
      if (!match) {
        // Fallback: find by content match
        match = sched.find(function(x){ return x.techName === job.techName && x.siteName === job.siteName && x.date === job.date && !x._synced; });
      }
      if (match) { match.id = job.id; match._synced = true; saveSchedule(sched); }
    }
    showSyncStatus('✓ Synced');
    return job;
  } catch(e) {
    console.warn('saveJobToCloud failed:', e);
    showSyncBanner('⚠️ Job saved locally but NOT synced to cloud: ' + e.message + ' — tap to retry', true, function(){
      saveJobToCloud(job);
    });
    return job;
  }
}

async function updateJobInCloud(jobId, updates) {
  try {
    var payload = {};
    if (updates.done !== undefined) payload.done = updates.done;
    if (updates.active !== undefined) payload.active = updates.active;
    await sbUpdate('scheduled_jobs', jobId, payload);
  } catch(e) {
    console.warn('updateJobInCloud failed:', e);
  }
}

async function deleteJobFromCloud(jobId) {
  try {
    await sbDelete('scheduled_jobs', jobId);
  } catch(e) {
    console.warn('deleteJobFromCloud failed:', e);
  }
}

// ============================================================
// API KEY - CLOUD VERSIONS
// ============================================================
async function saveApiKeyToCloud(key) {
  try {
    await sbUpsert('app_config', { key: 'anthropic_api_key', value: key, updated_at: new Date().toISOString() }, 'key');
  } catch(e) {
    console.warn('saveApiKeyToCloud failed:', e);
  }
}

async function loadApiKeyFromCloud() {
  try {
    var rows = await sbGet('app_config', 'key=eq.anthropic_api_key');
    if (rows && rows[0] && rows[0].value) {
      var cloudKey = rows[0].value;
      localStorage.setItem('es_api_key', cloudKey);
      return cloudKey;
    }
    // Nothing in cloud yet — return whatever is local, don't overwrite with empty
    return localStorage.getItem('es_api_key') || '';
  } catch(e) {
    // Cloud failed — return whatever is in localStorage
    return localStorage.getItem('es_api_key') || '';
  }
}

// ============================================================
// STARTUP — run cloud sync then show login or home
// ============================================================
initialCloudSync().then(function() {
  populateTechSelects();
  populateSchedDropdowns();
  if (tryRestoreSession()) {
    goHome(); // sets activeTechIdx from AUTH.techIdx
    // goHome already shows jobs from localStorage.
    // initialCloudSync (above) will have refreshed jobs from cloud
    // and called showTechJobs again. But in case of timing, do one more refresh:
    if (typeof activeTechIdx === 'number' && activeTechIdx >= 0) {
      showTechJobs(activeTechIdx);
    }
    recordSyncSuccess();
  } else {
    showLoginScreen();
  }
}).catch(function() {
  showSyncBanner('⚠️ Could not connect to database. Running in offline mode. Tap to retry.', true);
  populateTechSelects();
  populateSchedDropdowns();
  if (tryRestoreSession()) {
    goHome();
  } else {
    showLoginScreen();
  }
});

// ============================================================
// SUPABASE KEEPALIVE
// ============================================================
// Pings Supabase every 20 seconds to prevent free-tier auto-pause.
// Skips ping when the browser tab is hidden (battery friendly).
var _keepaliveTimer = null;
var _sbWasOffline = false;

async function startKeepalive() {
  if (_keepaliveTimer) return;
  _keepaliveTimer = setInterval(async function() {
    if (document.hidden) return;
    if (!isSbConfigured()) return;
    try {
      var resp = await fetch(getSbUrl() + '/rest/v1/sites?limit=1&select=id', { headers: sbHeaders() });
      if (resp.ok) {
        if (_sbWasOffline) {
          // Only update UI when recovering from offline — not on every ping
          _sbWasOffline = false;
          showSyncStatus('↺ Reconnected — syncing...', false);
          // Re-fetch jobs from cloud so phone gets latest schedule
          try {
            var freshJobs = await loadScheduleFromCloud();
            if (freshJobs) {
              if (typeof activeTechIdx === 'number' && activeTechIdx >= 0) showTechJobs(activeTechIdx);
            }
          } catch(e) {}
          showSyncStatus('✓ Synced', false);
          recordSyncSuccess();
          hideSyncBanner();
        }
        // Silently successful — no UI update needed
      } else {
        if (!_sbWasOffline) {
          _sbWasOffline = true;
          showSyncStatus('⚠ Saved locally only — tap to retry', true);
        }
      }
    } catch(e) {
      _sbWasOffline = true;
    }
  }, 5000);
}

function stopKeepalive() {
  if (_keepaliveTimer) { clearInterval(_keepaliveTimer); _keepaliveTimer = null; }
}

async function pushLocalChangesToCloud() {
  try {
    for (var i = 0; i < S.sites.length; i++) {
      if (!S.sites[i].id) await saveSiteToCloud(S.sites[i]);
    }
    var sched = loadSchedule();
    for (var j = 0; j < sched.length; j++) {
      var jj = sched[j];
      // Local IDs are Date.now() = 13-digit ms timestamps (> 1e12)
      // Cloud IDs are small auto-increment integers (< 1e12)
      // Only push jobs with local timestamp IDs that haven't been synced
      var isLocalId = typeof jj.id === 'number' && jj.id > 1000000000000;
      if (isLocalId && !jj._synced) await saveJobToCloud(jj);
    }
    // Push unsynced local reports
    try {
      var localReports = JSON.parse(localStorage.getItem('es_local_reports') || '[]');
      var unsyncedRpts = localReports.filter(function(r){ return !r._synced; });
      for (var k = 0; k < unsyncedRpts.length; k++) {
        var rpt = unsyncedRpts[k];
        var payload = { site_name:rpt.site_name, site_id:rpt.site_id, tech:rpt.tech,
          date:rpt.date, job_num:rpt.job_num||'', ext_act:rpt.ext_act, int_act:rpt.int_act,
          issues:rpt.issues, infest:rpt.infest, comments:rpt.comments||'',
          stations:rpt.stations, products:rpt.products,
          created_at:rpt.created_at||new Date().toISOString() };
        await sbInsert('service_reports', payload);
        _markReportSynced(rpt._localId);
      }
      if (unsyncedRpts.length > 0) recordSyncSuccess();
    } catch(e) { console.warn('report sync failed:', e); }
  } catch(e) { console.warn('pushLocalChangesToCloud:', e.message || e); }
}

// Start keepalive immediately (not waiting for 'load' which may already have fired)
if (isSbConfigured()) startKeepalive();
window.addEventListener('beforeunload', stopKeepalive);


// ============================================================
// src/keepalive.js
// ============================================================
// ============================================================
// SUPABASE KEEPALIVE
// ============================================================
// Pings Supabase every 20 seconds to prevent free-tier auto-pause.
// Skips ping when the browser tab is hidden (battery friendly).
var _keepaliveTimer = null;
var _sbWasOffline = false;

async function startKeepalive() {
  if (_keepaliveTimer) return;
  _keepaliveTimer = setInterval(async function() {
    if (document.hidden) return;
    if (!isSbConfigured()) return;
    try {
      var resp = await fetch(getSbUrl() + '/rest/v1/sites?limit=1&select=id', { headers: sbHeaders() });
      if (resp.ok) {
        if (_sbWasOffline) {
          // Only update UI when recovering from offline — not on every ping
          _sbWasOffline = false;
          showSyncStatus('↺ Reconnected — syncing...', false);
          // Re-fetch jobs from cloud so phone gets latest schedule
          try {
            var freshJobs = await loadScheduleFromCloud();
            if (freshJobs) {
              if (typeof activeTechIdx === 'number' && activeTechIdx >= 0) showTechJobs(activeTechIdx);
            }
          } catch(e) {}
          showSyncStatus('✓ Synced', false);
          recordSyncSuccess();
          hideSyncBanner();
        }
        // Silently successful — no UI update needed
      } else {
        if (!_sbWasOffline) {
          _sbWasOffline = true;
          showSyncStatus('⚠ Saved locally only — tap to retry', true);
        }
      }
    } catch(e) {
      _sbWasOffline = true;
    }
  }, 5000);
}

function stopKeepalive() {
  if (_keepaliveTimer) { clearInterval(_keepaliveTimer); _keepaliveTimer = null; }
}

async function pushLocalChangesToCloud() {
  try {
    for (var i = 0; i < S.sites.length; i++) {
      if (!S.sites[i].id) await saveSiteToCloud(S.sites[i]);
    }
    var sched = loadSchedule();
    for (var j = 0; j < sched.length; j++) {
      var jj = sched[j];
      // Local IDs are Date.now() = 13-digit ms timestamps (> 1e12)
      // Cloud IDs are small auto-increment integers (< 1e12)
      // Only push jobs with local timestamp IDs that haven't been synced
      var isLocalId = typeof jj.id === 'number' && jj.id > 1000000000000;
      if (isLocalId && !jj._synced) await saveJobToCloud(jj);
    }
    // Push unsynced local reports
    try {
      var localReports = JSON.parse(localStorage.getItem('es_local_reports') || '[]');
      var unsyncedRpts = localReports.filter(function(r){ return !r._synced; });
      for (var k = 0; k < unsyncedRpts.length; k++) {
        var rpt = unsyncedRpts[k];
        var payload = { site_name:rpt.site_name, site_id:rpt.site_id, tech:rpt.tech,
          date:rpt.date, job_num:rpt.job_num||'', ext_act:rpt.ext_act, int_act:rpt.int_act,
          issues:rpt.issues, infest:rpt.infest, comments:rpt.comments||'',
          stations:rpt.stations, products:rpt.products,
          created_at:rpt.created_at||new Date().toISOString() };
        await sbInsert('service_reports', payload);
        _markReportSynced(rpt._localId);
      }
      if (unsyncedRpts.length > 0) recordSyncSuccess();
    } catch(e) { console.warn('report sync failed:', e); }
  } catch(e) { console.warn('pushLocalChangesToCloud:', e.message || e); }
}

// Start keepalive immediately (not waiting for 'load' which may already have fired)
if (isSbConfigured()) startKeepalive();
window.addEventListener('beforeunload', stopKeepalive);

// ============================================================
// src/core.js
// ============================================================
// ============================================================
// MODAL / CONFIRM HELPERS
// ============================================================
var _confirmCallback = null;
function showConfirm(title, msg, okLabel, okClass, cb) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMsg').textContent = msg;
  var okBtn = document.getElementById('confirmOkBtn');
  okBtn.textContent = okLabel || 'Confirm';
  okBtn.className = 'btn ' + (okClass || 'btn-p');
  _confirmCallback = cb;
  document.getElementById('confirmModal').classList.add('show');
}
function closeConfirmModal() {
  document.getElementById('confirmModal').classList.remove('show');
  _confirmCallback = null;
}
function _confirmOk() {
  closeConfirmModal();
  if (_confirmCallback) _confirmCallback();
}

// ============================================================
// GENERATING OVERLAY
// ============================================================
function showGenOverlay(title, sub) {
  document.getElementById('genTitle').textContent = title || 'Generating Report';
  document.getElementById('genSub').textContent = sub || 'AI is analysing your data...';
  document.getElementById('genOverlay').classList.add('show');
}
function hideGenOverlay() {
  document.getElementById('genOverlay').classList.remove('show');
}

// ============================================================
// CHARACTER COUNTER
// ============================================================
function updateCommentCounter(el) {
  var len = el.value.length;
  var max = 1000;
  var counter = document.getElementById('commentCounter');
  if (counter) {
    counter.textContent = len + ' / ' + max;
    counter.className = 'input-counter' + (len > max * 0.9 ? ' warn' : '') + (len > max ? ' over' : '');
  }
}

// ============================================================
// SITE SEARCH FILTER
// ============================================================
function filterSiteList(query) {
  var q = query.toLowerCase().trim();
  var items = document.querySelectorAll('#siteList .site-item');
  items.forEach(function(item) {
    var text = item.textContent.toLowerCase();
    item.style.display = (!q || text.indexOf(q) >= 0) ? '' : 'none';
  });
}

// ============================================================
// PROGRESS BAR UPDATE
// ============================================================
function updateProgressBar(screen) {
  var fill = document.getElementById('hdrProgressFill');
  var bar = document.getElementById('hdrProgress');
  if (!fill || !bar) return;
  if (screen < 1 || screen > 4) { bar.style.display = 'none'; return; }
  bar.style.display = 'block';
  fill.style.width = (screen / 4 * 100) + '%';
}

// ============================================================
// HOME STATS ROW
// ============================================================
function renderHomeStats() {
  var row = document.getElementById('homeStatsRow');
  if (!row) return;
  var jobs = [];
  try { jobs = JSON.parse(localStorage.getItem('es_sched') || '[]'); } catch(e) {}
  var today = new Date().toISOString().slice(0,10);
  var todayJobs = jobs.filter(function(j){ return j.date === today && j.active !== false; });
  var done = todayJobs.filter(function(j){ return j.done; }).length;
  var total = todayJobs.length;
  var pending = total - done;

  if (!total) { row.style.display = 'none'; return; }
  row.style.display = 'flex';
  row.innerHTML = [
    {val: total, lbl: 'Jobs Today', color: null},
    {val: done, lbl: 'Completed', color: done > 0 ? 'var(--gd)' : 'var(--di)'},
    {val: pending, lbl: 'Remaining', color: pending > 0 ? 'var(--a)' : 'var(--gd)'}
  ].map(function(s) {
    return '<div class="stat-card"><div class="stat-val"' + (s.color ? ' style="color:' + s.color + '"' : '') + '>' + s.val + '</div><div class="stat-lbl">' + s.lbl + '</div></div>';
  }).join('');
}


// ============================================================
// STATIONS
// ============================================================
function buildStations() {
  var site = S.sites[S.selectedSite];
  if (!site) { toast('⚠ No site selected'); goScreen(1); return; }
  document.getElementById('s2-title').textContent = site.name;
  document.getElementById('s2-sub').textContent = 'Tap each station to record activity';

  // Initialise station data (preserve existing if same site)
  GROUPS.forEach(function(g) {
    var count = site[g.sfKey] || 0;
    if (!S.stations[g.key] || S.stations[g.key].length !== count) {
      S.stations[g.key] = [];
      for (var i = 0; i < count; i++) {
        if (g.key === 'ilt') {
          S.stations[g.key].push({ num: i+1, moths:'Nil', flies:'Nil', small:'Nil' });
        } else if (g.key === 'sp') {
          S.stations[g.key].push({ num: i+1, val:'Nil', species:'-' });
        } else {
          S.stations[g.key].push({ num: i+1, val:'Nil' });
        }
      }
    }
  });

  renderStations();
}

function renderStations() {
  var wrap = document.getElementById('stationsContent');
  wrap.innerHTML = '';
  if (S.selectedSite === null || S.selectedSite === undefined || !S.sites[S.selectedSite]) return;
  var site = S.sites[S.selectedSite];
  var hasAny = false;

  GROUPS.forEach(function(g) {
    var count = site[g.sfKey] || 0;
    if (!count) return;
    hasAny = true;

    var card = el('div','card');
    // Header with station count editor
    var hdr = el('div','card-hdr');
    var left = el('div','card-hdr-left');
    var title = el('div','card-title'); title.textContent = g.label;
    var countBadge = el('span','badge b-nil'); countBadge.textContent = count + ' units';
    left.appendChild(title);
    var right = el('div','site-actions');
    // Quick count adjuster
    var countInput = el('input');
    countInput.type='number'; countInput.min='0'; countInput.value=count;
    countInput.style.cssText='width:56px;padding:4px 8px;font-size:13px;text-align:center';
    countInput.title = 'Adjust station count';
    (function(grp){ countInput.addEventListener('change', function(){
      var n = Math.max(0, parseInt(this.value)||0);
      S.sites[S.selectedSite][grp.sfKey] = n;
      saveState();
      buildStations();
    }); })(g);
    right.appendChild(countInput);
    // Quick "All Nil" button
    var allNilBtn = el('button','btn btn-s btn-xs btn');
    allNilBtn.textContent = 'All Nil';
    allNilBtn.title = 'Set all stations to Nil';
    allNilBtn.style.marginLeft = '4px';
    (function(grp){ allNilBtn.addEventListener('click', function(){
      if (!S.stations[grp.key]) return;
      S.stations[grp.key].forEach(function(stn){
        if (grp.key === 'ilt') { stn.moths='Nil'; stn.flies='Nil'; stn.small='Nil'; }
        else stn.val = 'Nil';
      });
      renderStations();
      toast('✓ All ' + grp.label + ' set to Nil');
    }); })(g);
    right.appendChild(allNilBtn);
    hdr.appendChild(left); hdr.appendChild(right);
    card.appendChild(hdr);

    var body = el('div','card-body');

    if (g.key === 'ilt') {
      // ILT: table layout
      var catchRow = el('div','toggle-row');
      var catchLbl = el('span','toggle-lbl'); catchLbl.textContent = 'Catch papers changed this service?';
      var toggle = el('div','toggle' + (S.stations.iltCatchChanged ? ' on' : ''));
      toggle.id = 'ilt-toggle';
      toggle.addEventListener('click', function(){
        S.stations.iltCatchChanged = !S.stations.iltCatchChanged;
        this.className = 'toggle' + (S.stations.iltCatchChanged ? ' on' : '');
      });
      catchRow.appendChild(catchLbl); catchRow.appendChild(toggle);
      body.appendChild(catchRow);
      var tbl = el('table','ilt-table');
      var thead = el('thead');
      var hrow = el('tr');
      ['#','Moths','Flies','Small Flying'].forEach(function(h){
        var th = el('th'); th.textContent = h; hrow.appendChild(th);
      });
      thead.appendChild(hrow); tbl.appendChild(thead);
      var tbody = el('tbody');
      S.stations.ilt.forEach(function(stn, i) {
        var row = el('tr');
        var numTd = el('td');
        numTd.style.cssText = 'font-family:Barlow Condensed,sans-serif;font-weight:700;font-size:15px';
        numTd.textContent = stn.num;
        row.appendChild(numTd);
        ILT_COLS.forEach(function(col){
          var td = el('td');
          var sel = el('select','ilt-sel');
          ['Nil','Low','Medium','High'].forEach(function(v){
            var opt = el('option'); opt.value=v; opt.textContent=v;
            if (stn[col]===v) opt.selected=true;
            sel.appendChild(opt);
          });
          (function(idx2, c){ sel.addEventListener('change', function(){
            S.stations.ilt[idx2][c] = this.value;
          }); })(i, col);
          td.appendChild(sel); row.appendChild(td);
        });
        tbody.appendChild(row);
      });
      tbl.appendChild(tbody);
      body.appendChild(tbl);
    } else if (g.key === 'sp') {
      // SPP: grid + species field
      var grid = el('div','stn-grid');
      S.stations[g.key].forEach(function(stn, i) {
        var btn = el('div', 'stn-btn stn-' + stn.val.toLowerCase());
        var num = el('div','stn-num'); num.textContent = stn.num;
        var val = el('div','stn-val'); val.textContent = stn.val;
        btn.appendChild(num); btn.appendChild(val);
        (function(grpKey, idx2){ btn.addEventListener('click', function(){
          openPopup(grpKey, idx2);
        }); })(g.key, i);
        grid.appendChild(btn);
      });
      body.appendChild(grid);
    } else {
      // Standard rodent stations: tap grid
      var grid2 = el('div','stn-grid');
      S.stations[g.key].forEach(function(stn, i) {
        var btn = el('div', 'stn-btn stn-' + stn.val.toLowerCase());
        var num = el('div','stn-num'); num.textContent = stn.num;
        var val = el('div','stn-val'); val.textContent = stn.val;
        btn.appendChild(num); btn.appendChild(val);
        (function(grpKey, idx2){ btn.addEventListener('click', function(){
          openPopup(grpKey, idx2);
        }); })(g.key, i);
        grid2.appendChild(btn);
      });
      body.appendChild(grid2);
      // Stats
      var stats = el('div','stats-row');
      var counts = countVals(S.stations[g.key]);
      [['Nil','b-nil'],['Low','b-low'],['Medium','b-med'],['High','b-high']].forEach(function(x){
        if (counts[x[0]]) {
          var b = el('span','badge '+x[1]); b.textContent = counts[x[0]] + ' ' + x[0];
          stats.appendChild(b);
        }
      });
      body.appendChild(stats);
    }

    card.appendChild(body);
    wrap.appendChild(card);
  });

  if (!hasAny) {
    var msg = el('div');
    msg.style.cssText='color:var(--mu);font-size:14px;text-align:center;padding:30px';
    msg.textContent = 'No stations configured for this site. Edit the site profile to add station counts.';
    wrap.appendChild(msg);
  }
}

function countVals(arr) {
  var c = { Nil:0, Low:0, Medium:0, High:0 };
  arr.forEach(function(s){ if (c[s.val] !== undefined) c[s.val]++; });
  return c;
}

// ============================================================
// POPUP
// ============================================================
function openPopup(grpKey, idx) {
  S.popTarget = { grpKey: grpKey, idx: idx };
  var g = GROUPS.find(function(x){ return x.key === grpKey; });
  var stn = S.stations[grpKey][idx];
  document.getElementById('popTitle').textContent = (g ? g.label : '') + ' — Station ' + stn.num;
  document.getElementById('stnOverlay').classList.add('show');
}

function closePopup() {
  document.getElementById('stnOverlay').classList.remove('show');
  S.popTarget = null;
}

function pickSev(val) {
  if (!S.popTarget) return;
  S.stations[S.popTarget.grpKey][S.popTarget.idx].val = val;
  closePopup();
  renderStations();
}

document.getElementById('stnOverlay').addEventListener('click', function(e){
  if (e.target === this) closePopup();
});

// ============================================================
// PRODUCTS
// ============================================================
function renderProducts() {
  var list = document.getElementById('prodList');
  list.innerHTML = '';
  S.products.forEach(function(p, i) {
    var row = el('div','prod-row');
    var rm = el('button','prod-rm'); rm.textContent = '✕';
    (function(idx){ rm.addEventListener('click', function(){ S.products.splice(idx,1); renderProducts(); }); })(i);
    row.appendChild(rm);
    var r1 = el('div','frow'); r1.style.marginBottom='8px';
    var f1 = el('div','fg');
    var l1 = el('label'); l1.textContent='Product Used';
    var i1 = el('input'); i1.type='text'; i1.placeholder='e.g. Generation First Strike'; i1.value=p.name||'';
    (function(idx){ i1.addEventListener('input', function(){ S.products[idx].name=this.value; }); })(i);
    f1.appendChild(l1); f1.appendChild(i1);
    var f2 = el('div','fg');
    var l2 = el('label'); l2.textContent='Active Constituent';
    var i2 = el('input'); i2.type='text'; i2.placeholder='e.g. 0.025g/1kg DIFETHIALONE'; i2.value=p.active||'';
    (function(idx){ i2.addEventListener('input', function(){ S.products[idx].active=this.value; }); })(i);
    f2.appendChild(l2); f2.appendChild(i2);
    r1.appendChild(f1); r1.appendChild(f2);
    var r2 = el('div','frow3');
    var f3=el('div','fg'), f4=el('div','fg'), f5=el('div','fg');
    var l3=el('label'); l3.textContent='Batch No.';
    var i3=el('input'); i3.type='text'; i3.placeholder='Batch #'; i3.value=p.batch||'';
    (function(idx){ i3.addEventListener('input', function(){ S.products[idx].batch=this.value; }); })(i);
    f3.appendChild(l3); f3.appendChild(i3);
    var l4=el('label'); l4.textContent='Amount Used';
    var i4=el('input'); i4.type='text'; i4.placeholder='e.g. 28'; i4.value=p.amount||'';
    (function(idx){ i4.addEventListener('input', function(){ S.products[idx].amount=this.value; }); })(i);
    f4.appendChild(l4); f4.appendChild(i4);
    var l5=el('label'); l5.textContent='Area Used';
    var i5=el('input'); i5.type='text'; i5.placeholder='Internal/External'; i5.value=p.area||'';
    (function(idx){ i5.addEventListener('input', function(){ S.products[idx].area=this.value; }); })(i);
    f5.appendChild(l5); f5.appendChild(i5);
    r2.appendChild(f3); r2.appendChild(f4); r2.appendChild(f5);
    var f6=el('div','fg'); f6.style.marginTop='8px';
    var l6=el('label'); l6.textContent='Reason for Use';
    var i6=el('input'); i6.type='text'; i6.placeholder='e.g. Rodent Control'; i6.value=p.reason||'';
    (function(idx){ i6.addEventListener('input', function(){ S.products[idx].reason=this.value; }); })(i);
    f6.appendChild(l6); f6.appendChild(i6);
    row.appendChild(r1); row.appendChild(r2); row.appendChild(f6);
    list.appendChild(row);
  });
}

function addProduct() {
  S.products.push({ name:'', active:'', batch:'', amount:'', area:'', reason:'' });
  renderProducts();
  setTimeout(function(){ document.getElementById('prodList').lastChild.scrollIntoView({behavior:'smooth'}); }, 50);
}

// ============================================================
// PRODUCT LIBRARY
// ============================================================
function loadProdLib() {
  try { return JSON.parse(localStorage.getItem('es_prod_lib') || '[]'); } catch(e) { return []; }
}
function saveProdLib(prods) { localStorage.setItem('es_prod_lib', JSON.stringify(prods)); }

function showProdLib() {
  renderProdLibList();
  document.getElementById('prodLibOverlay').classList.add('show');
}
function closeProdLib() {
  document.getElementById('prodLibOverlay').classList.remove('show');
}

function renderProdLibList() {
  var prods = loadProdLib();
  var list = document.getElementById('prodLibList');
  list.innerHTML = '';
  if (!prods.length) {
    list.innerHTML = '<div style="color:var(--di);font-size:13px;padding:12px;background:var(--s3);border-radius:var(--rs);border:1px dashed var(--bd);text-align:center;margin-bottom:12px">No products in library yet. Add one below.</div>';
    return;
  }
  prods.forEach(function(p, i) {
    var row = el('div');
    row.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid var(--bd)';
    var info = el('div'); info.style.flex = '1';
    var nm = el('div'); nm.style.cssText = 'font-family:Barlow Condensed,sans-serif;font-weight:700;font-size:15px;color:var(--tx)'; nm.textContent = p.name;
    var meta = el('div'); meta.style.cssText = 'font-size:11px;color:var(--mu);margin-top:2px';
    meta.textContent = [p.active, p.form, p.reason].filter(Boolean).join(' · ');
    info.appendChild(nm); info.appendChild(meta);
    var btns = el('div'); btns.style.cssText = 'display:flex;gap:6px;flex-shrink:0';
    var del = el('button','btn btn-d btn-xs btn'); del.textContent = '✕';
    (function(idx) {
      del.addEventListener('click', function() {
        var lib = loadProdLib();
        var removed = lib.splice(idx, 1)[0];
        saveProdLib(lib);
        if (removed && removed.id) deleteProdFromCloud(removed.id);
        renderProdLibList();
      });
    })(i);
    btns.appendChild(del);
    row.appendChild(info); row.appendChild(btns);
    list.appendChild(row);
  });
}

function addLibProduct() {
  var name = document.getElementById('pl-name').value.trim();
  if (!name) { toast('⚠ Enter a product name'); return; }
  var prod = {
    name:   name,
    active: document.getElementById('pl-active').value.trim(),
    form:   document.getElementById('pl-form').value.trim(),
    reason: document.getElementById('pl-reason').value.trim()
  };
  var lib = loadProdLib();
  lib.push(prod);
  saveProdLib(lib);
  saveProdToCloud(prod);
  document.getElementById('pl-name').value   = '';
  document.getElementById('pl-active').value = '';
  document.getElementById('pl-form').value   = '';
  document.getElementById('pl-reason').value = '';
  renderProdLibList();
  toast('✓ Product added to library');
}

// ── Picker (for technicians during report entry) ────────
function showProdPicker() {
  var prods = loadProdLib();
  var list = document.getElementById('prodPickList');
  list.innerHTML = '';
  if (!prods.length) {
    list.innerHTML = '<div style="color:var(--di);font-size:13px;text-align:center;padding:16px">No products in library yet.<br>Ask your admin to add products.</div>';
  } else {
    prods.forEach(function(p) {
      var btn = el('div','prod-library-btn');
      var icon = el('div');
      icon.style.cssText = 'width:34px;height:34px;border-radius:8px;background:linear-gradient(135deg,var(--g),var(--gd));display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0';
      icon.textContent = '🧪';
      var info = el('div');
      var nm = el('div','prod-library-name'); nm.textContent = p.name;
      var meta = el('div','prod-library-meta');
      meta.textContent = [p.active, p.form, p.reason].filter(Boolean).join(' · ');
      info.appendChild(nm); if (meta.textContent) info.appendChild(meta);
      btn.appendChild(icon); btn.appendChild(info);
      (function(prod) {
        btn.addEventListener('click', function() {
          S.products.push({
            name:   prod.name,
            active: prod.active || '',
            batch:  '',
            amount: '',
            area:   '',
            reason: prod.reason || ''
          });
          renderProducts();
          closeProdPicker();
          toast('✓ ' + prod.name + ' added');
          setTimeout(function(){ document.getElementById('prodList').lastChild.scrollIntoView({behavior:'smooth'}); }, 80);
        });
      })(p);
      list.appendChild(btn);
    });
  }
  document.getElementById('prodPickOverlay').classList.add('show');
}

function closeProdPicker() {
  document.getElementById('prodPickOverlay').classList.remove('show');
}

// ── Supabase sync for product library ──────────────────
async function loadProdLibFromCloud() {
  try {
    var rows = await sbGet('product_library');
    var prods = rows.map(function(r) {
      return { id: r.id, name: r.name, active: r.active||'', form: r.form||'', reason: r.reason||'' };
    });
    saveProdLib(prods);
    return prods;
  } catch(e) {
    console.warn('loadProdLibFromCloud failed, using local:', e.message || e);
    return loadProdLib();
  }
}

async function saveProdToCloud(prod) {
  try {
    var payload = { name: prod.name, active: prod.active||'', form: prod.form||'', reason: prod.reason||'' };
    var result = await sbInsert('product_library', payload);
    if (result && result[0]) {
      prod.id = result[0].id;
      // Update local cache with id
      var lib = loadProdLib();
      var match = lib.find(function(p){ return p.name === prod.name && !p.id; });
      if (match) { match.id = prod.id; saveProdLib(lib); }
    }
    showSyncStatus('✓ Synced');
  } catch(e) {
    console.warn('saveProdToCloud failed:', e.message || e);
    showSyncStatus('⚠ Saved locally only — tap to retry', true);
  }
}

async function deleteProdFromCloud(id) {
  try { await sbDelete('product_library', id); }
  catch(e) { console.warn('deleteProdFromCloud failed:', e.message || e); }
}


// ============================================================
// UTILS
// ============================================================
function el(tag, cls) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

var toastTimer;
function toast(msg) {
  var t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.classList.remove('show'); }, 2500);
}

function newReport() {
  S.stations = {};
  S.products = [];
  S_photos = [];
  S.selectedSite = null;
  document.getElementById('j-num').value = '';
  document.getElementById('svc-comments').value = '';
  document.getElementById('j-date').value = new Date().toISOString().slice(0,10);
  document.getElementById('ext-activity').value = 'Nil';
  document.getElementById('int-activity').value = 'Nil';
  document.getElementById('issues-reported').value = 'No';
  document.getElementById('infestation').value = 'No';
  var counter = document.getElementById('commentCounter');
  if (counter) counter.textContent = '0 / 1000';
  goHome();
  toast('✓ Cleared — ready for new report');
}

// ============================================================
// INIT
// ============================================================
document.getElementById('j-date').value = new Date().toISOString().slice(0,10);
// Restore last-used tech
var lastTech = localStorage.getItem('es_last_tech');
if (lastTech) document.getElementById('j-tech').value = lastTech;
loadState();
renderSiteList();
renderProducts();

// Step clicks
['stp1','stp2','stp3','stp4'].forEach(function(id, i) {
  document.getElementById(id).addEventListener('click', function() {
    if (i+1 <= S.currentScreen) goScreen(i+1);
  });
});

// ============================================================
// PHOTO MANAGEMENT
// ============================================================
var S_photos = [];

function addPhoto(input) {
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];
  var reader = new FileReader();
  reader.onload = function(e) {
    S_photos.push({ name: file.name, dataUrl: e.target.result, description: '' });
    renderPhotoList();
    input.value = '';
  };
  reader.readAsDataURL(file);
}

function renderPhotoList() {
  var list = document.getElementById('photoList');
  if (!list) return;
  list.innerHTML = '';
  S_photos.forEach(function(p, i) {
    // Card wrapper
    var card = el('div');
    card.style.cssText = 'background:var(--s2);border:1.5px solid var(--bd);border-radius:var(--rr);margin-bottom:10px;overflow:hidden';

    // Top row: thumbnail + description + delete
    var topRow = el('div');
    topRow.style.cssText = 'display:flex;align-items:flex-start;gap:10px;padding:10px';
    var img = el('img');
    img.src = p.dataUrl;
    img.style.cssText = 'width:64px;height:64px;object-fit:cover;border-radius:6px;flex-shrink:0';
    var info = el('div'); info.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:6px';

    // Description text input
    var inp = el('input');
    inp.type = 'text';
    inp.placeholder = 'Describe this condition (e.g. gap under door, hole in wall)...';
    inp.value = p.description || '';
    inp.style.cssText = 'width:100%;background:var(--s3);border:1px solid var(--bd);border-radius:4px;color:var(--tx);font-size:12px;padding:6px 8px;box-sizing:border-box';
    (function(idx) {
      inp.addEventListener('input', function() { S_photos[idx].description = this.value; });
    })(i);

    // Voice button row
    var voiceRow = el('div');
    voiceRow.style.cssText = 'display:flex;align-items:center;gap:6px';
    var voiceBtn = el('button');
    voiceBtn.id = 'photo-voice-btn-' + i;
    voiceBtn.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:11px;padding:4px 10px;border-radius:20px;border:1.5px solid var(--bd);background:var(--s3);cursor:pointer;color:var(--tx);white-space:nowrap';
    voiceBtn.innerHTML = '🎙️ <span>Dictate</span>';
    var voiceStatus = el('span');
    voiceStatus.id = 'photo-voice-status-' + i;
    voiceStatus.style.cssText = 'font-size:11px;color:#c0392b;display:none';
    voiceStatus.textContent = '🔴 Recording...';
    voiceRow.appendChild(voiceBtn);
    voiceRow.appendChild(voiceStatus);
    (function(idx) {
      voiceBtn.addEventListener('click', function() { togglePhotoVoice(idx); });
    })(i);

    info.appendChild(inp);
    info.appendChild(voiceRow);

    var rm = el('button'); rm.className = 'btn btn-d btn-xs btn'; rm.textContent = '✕';
    rm.style.cssText = 'flex-shrink:0';
    (function(idx) {
      rm.addEventListener('click', function() {
        stopPhotoVoice(idx);
        S_photos.splice(idx, 1);
        renderPhotoList();
      });
    })(i);

    topRow.appendChild(img); topRow.appendChild(info); topRow.appendChild(rm);
    card.appendChild(topRow);
    list.appendChild(card);
  });
}


// ============================================================
// PER-PHOTO VOICE DICTATION
// ============================================================
var _photoVoiceRecognitions = {};   // idx -> SpeechRecognition instance
var _photoVoiceActive = {};         // idx -> bool

function togglePhotoVoice(idx) {
  if (_photoVoiceActive[idx]) {
    stopPhotoVoice(idx);
  } else {
    startPhotoVoice(idx);
  }
}

function startPhotoVoice(idx) {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    toast('⚠ Voice input not supported on this browser.'); return;
  }
  // Stop any other active photo voice
  Object.keys(_photoVoiceActive).forEach(function(k) {
    if (_photoVoiceActive[k] && parseInt(k) !== idx) stopPhotoVoice(parseInt(k));
  });

  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var rec = new SR();
  rec.lang = 'en-AU';
  rec.continuous = false;  // iOS: restart pattern
  rec.interimResults = true;
  _photoVoiceRecognitions[idx] = rec;
  _photoVoiceActive[idx] = true;

  var btn = document.getElementById('photo-voice-btn-' + idx);
  var statusEl = document.getElementById('photo-voice-status-' + idx);
  var descInp = document.querySelector('#photoList .photo-desc-' + idx) ||
    (function() {
      // Find the input by position in photo list
      var inputs = document.getElementById('photoList').querySelectorAll('input[type=text]');
      return inputs[idx] || null;
    })();

  if (btn) { btn.style.borderColor = 'var(--r)'; btn.style.background = '#fdf0f0'; btn.innerHTML = '⏹ <span>Stop</span>'; }
  if (statusEl) { statusEl.style.display = ''; }

  var baseText = S_photos[idx] ? (S_photos[idx].description || '') : '';
  if (baseText && !baseText.endsWith(' ')) baseText += ' ';

  rec.onresult = function(event) {
    var interim = '', finalNew = '';
    for (var i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) finalNew += event.results[i][0].transcript + ' ';
      else interim += event.results[i][0].transcript;
    }
    if (finalNew) baseText = baseText + finalNew;
    if (S_photos[idx]) S_photos[idx].description = baseText.trim();
    // Update the visible input field
    var inp = document.getElementById('photoList') &&
      document.getElementById('photoList').querySelectorAll('input[type=text]')[idx];
    if (inp) inp.value = (baseText + interim).trim();
  };

  rec.onerror = function(e) {
    if (e.error === 'not-allowed') toast('⚠ Microphone access denied.');
    else if (e.error !== 'no-speech') toast('⚠ Voice error: ' + e.error);
    stopPhotoVoice(idx);
  };

  rec.onend = function() {
    if (_photoVoiceActive[idx]) {
      try { rec.start(); } catch(e) { stopPhotoVoice(idx); }
    }
  };

  try { rec.start(); } catch(e) {
    toast('⚠ Could not start microphone: ' + e.message);
    _photoVoiceActive[idx] = false;
  }
}

function stopPhotoVoice(idx) {
  _photoVoiceActive[idx] = false;
  if (_photoVoiceRecognitions[idx]) {
    try { _photoVoiceRecognitions[idx].stop(); } catch(e) {}
    _photoVoiceRecognitions[idx] = null;
  }
  var btn = document.getElementById('photo-voice-btn-' + idx);
  var statusEl = document.getElementById('photo-voice-status-' + idx);
  if (btn) { btn.style.borderColor = 'var(--bd)'; btn.style.background = 'var(--s3)'; btn.innerHTML = '🎙️ <span>Dictate</span>'; }
  if (statusEl) { statusEl.style.display = 'none'; }
}

// ============================================================
// API KEY HELPERS
// ============================================================
var _DEFAULT_API_KEY = '';
function getApiKey() {
  var k = localStorage.getItem('es_api_key') || '';
  if (!k) { k = _DEFAULT_API_KEY; localStorage.setItem('es_api_key', k); }
  return k;
}

function saveApiKeyUI() {
  var inp = _getEl('api-key-input');
  var st  = _getEl('api-key-status');
  if (!inp || !inp.value.trim()) { if (st) { st.textContent = 'Enter a key first'; st.style.color = 'var(--mu)'; } return; }
  var apiKeyVal = inp.value.trim();
  localStorage.setItem('es_api_key', apiKeyVal);
  saveApiKeyToCloud(apiKeyVal);
  if (st) { st.textContent = '✓ Saved — AI features are now active'; st.style.color = 'var(--gd)'; }
  var warn = document.getElementById('ai-key-warning');
  if (warn) warn.style.display = 'none';
  saveApiKeyToCloud(apiKeyVal);
  setTimeout(function(){ if (typeof refreshStatusBar === 'function') refreshStatusBar(); }, 500);
}

// ── Supabase credential management ─────────────────────
function saveSbConfig() {
  var urlInp = _getEl('sb-url-input');
  var keyInp = _getEl('sb-key-input');
  var result = _getEl('sb-test-result');
  var url = urlInp ? urlInp.value.trim() : '';
  var key = keyInp ? keyInp.value.trim() : '';

  if (url && !url.startsWith('https://')) {
    if (result) { result.textContent = '⚠ URL must start with https://'; result.style.color = 'var(--r)'; }
    return;
  }
  if (key && !key.startsWith('eyJ')) {
    if (result) { result.innerHTML = '⚠ This does not look like a JWT anon key.<br>The key must start with <code>eyJ</code> — find it in Supabase → Project Settings → API → anon public.'; result.style.color = 'var(--r)'; }
    return;
  }
  if (url) localStorage.setItem('es_sb_url', url);
  if (key) localStorage.setItem('es_sb_anon_key', key);
  if (result) { result.textContent = '✓ Credentials saved — connecting…'; result.style.color = 'var(--gd)'; }
  updateDbConfigStatus();
  toast('✓ Database credentials saved — syncing…');
  // Trigger a full sync immediately so data appears without page reload
  setTimeout(function() {
    initialCloudSync().then(function() {
      populateTechSelects();
      populateSchedDropdowns();
      if (typeof renderManageSitesList === 'function') renderManageSitesList();
      if (typeof renderTechList === 'function') renderTechList();
      if (typeof startKeepalive === 'function') startKeepalive();
      toast('✓ Connected and synced');
      if (result) { result.textContent = '✓ Connected — data synced successfully'; result.style.color = 'var(--gd)'; }
      // Save credentials to app_config so other devices auto-configure
      _saveCredentialsToCloud();
    }).catch(function(e) {
      if (result) { result.textContent = '⚠ Saved but sync failed: ' + (e.message||'check URL and key'); result.style.color = 'var(--r)'; }
    });
  }, 200);
}

async function testSbConnection() {
  var result = _getEl('sb-test-result');
  if (!isSbConfigured()) {
    if (result) { result.innerHTML = '⚠ No valid key configured yet.<br>Enter your <code>eyJ...</code> anon key and tap Save first.'; result.style.color = 'var(--r)'; }
    return;
  }
  if (result) { result.innerHTML = '<span style="color:var(--mu)">⟳ Testing connection…</span>'; }

  var tables = ['sites','technicians','scheduled_jobs','service_reports','product_library','app_config'];
  var results = [];
  var allOk = true;

  for (var t of tables) {
    try {
      var resp = await fetch(getSbUrl()+'/rest/v1/'+t+'?limit=1&select=*', {
        headers: sbHeaders(),
        signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined
      });
      if (resp.ok) {
        results.push('<span style="color:#008350">✓ '+t+'</span>');
      } else if (resp.status === 401 || resp.status === 403) {
        results.push('<span style="color:#dc2626">✗ '+t+' (permission denied — disable RLS)</span>');
        allOk = false;
      } else if (resp.status === 404) {
        results.push('<span style="color:#d97706">⚠ '+t+' (table missing — create it)</span>');
        allOk = false;
      } else {
        results.push('<span style="color:#dc2626">✗ '+t+' (HTTP '+resp.status+')</span>');
        allOk = false;
      }
    } catch(e) {
      results.push('<span style="color:#dc2626">✗ '+t+' ('+( e.message||'error')+')</span>');
      allOk = false;
    }
  }

  if (result) {
    var summary = allOk
      ? '<strong style="color:#008350">✓ All tables accessible — sync should work</strong><br>'
      : '<strong style="color:#dc2626">⚠ Some tables have issues — see details below</strong><br>';
    if (!allOk) {
      summary += '<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;padding:8px;margin:6px 0;font-size:11px;color:#78350f">'
        + 'To fix permission errors: Supabase → Table Editor → each table → RLS → <strong>Disable RLS</strong></div>';
    }
    result.innerHTML = summary + results.join('<br>');
  }

  if (allOk) {
    updateDbConfigStatus();
    showSyncStatus('✓ Connected', false);
    recordSyncSuccess();
  }
}

function updateDbConfigStatus() {
  var el = document.getElementById('db-config-status');
  if (!el) return;
  var url = getSbUrl();
  var key = getSbKey();
  var configured = isSbConfigured();
  if (configured) {
    el.style.background = 'rgba(168,192,55,0.08)';
    el.style.borderColor = 'rgba(45,107,60,0.3)';
    el.style.color = 'var(--gd)';
    el.innerHTML = '✅ <strong>Configured</strong><br><span style="font-size:11px;opacity:0.8">URL: ' + url.replace('https://','') + '<br>Key: ' + key.slice(0,12) + '...' + key.slice(-6) + '</span>';
  } else {
    el.style.background = 'rgba(217,64,64,0.06)';
    el.style.borderColor = 'rgba(217,64,64,0.25)';
    el.style.color = '#a02020';
    el.innerHTML = '❌ <strong>Not configured</strong> — using bundled key which does not work with direct REST.<br><span style="font-size:11px">Enter your JWT anon key below to enable cloud sync.</span>';
  }

  // Pre-fill inputs with current values
  var urlInp = document.getElementById('sb-url-input');
  var keyInp = document.getElementById('sb-key-input');
  if (urlInp && url) urlInp.value = url;
  if (keyInp && configured) keyInp.value = key;
}

// Populate API key field when admin opens


// ============================================================
// RECOMMENDATION ENGINE
// ============================================================

function buildStationReport() {
  var lines = [];
  GROUPS.forEach(function(g) {
    var stns = S.stations[g.key];
    if (!stns || !stns.length) return;
    var nil = 0, low = 0, med = 0, high = 0;
    var activeDetails = [];
    stns.forEach(function(stn) {
      var v;
      if (g.key === 'ilt') {
        var vals = [stn.moths, stn.flies, stn.small];
        var order = ['High','Medium','Low','Nil'];
        v = 'Nil';
        for (var oi = 0; oi < order.length; oi++) {
          if (vals.indexOf(order[oi]) >= 0) { v = order[oi]; break; }
        }
        if (v !== 'Nil') activeDetails.push('Station ' + stn.num + ': Moths=' + (stn.moths||'Nil') + ' Flies=' + (stn.flies||'Nil') + ' SmallFlying=' + (stn.small||'Nil'));
      } else {
        v = stn.val || 'Nil';
        if (v !== 'Nil') activeDetails.push('Station ' + stn.num + ': ' + v);
      }
      if (v === 'Nil') nil++;
      else if (v === 'Low') low++;
      else if (v === 'Medium') med++;
      else if (v === 'High') high++;
    });
    var total = stns.length;
    var pct = Math.round(((low + med + high) / total) * 100);
    lines.push(g.label + ': ' + total + ' stations checked, ' + pct + '% active (Nil=' + nil + ' Low=' + low + ' Med=' + med + ' High=' + high + ')');
    if (activeDetails.length) lines.push('  Active stations: ' + activeDetails.join(', '));
  });
  return lines.length ? lines.join('\n') : 'No station data recorded';
}

function buildPromptLines(site, extAct, intAct, issuesRep, infest, comments) {
  var lines = [];
  lines.push('You are a senior pest management consultant specialising in Australian commercial pest control.');
  lines.push('Analyse this service report and provide professional recommendations in the exact format below.');
  lines.push('');
  lines.push('SITE: ' + site.name + ' | ' + (site.addr || '') + ' | Service frequency: ' + (site.freq || 'Not specified'));
  lines.push('EXTERNAL RODENT ACTIVITY: ' + extAct);
  lines.push('INTERNAL RODENT ACTIVITY: ' + intAct);
  lines.push('CLIENT REPORTED ISSUES: ' + (issuesRep || 'None'));
  lines.push('SIGNIFICANT INFESTATION: ' + (infest || 'No'));
  lines.push('TECHNICIAN COMMENTS: ' + (comments || 'None'));
  lines.push('');
  lines.push('STATION DATA:');
  lines.push(buildStationReport());
  if (S.products.length) {
    var prods = S.products.filter(function(p) { return p.name; }).map(function(p) {
      return p.name + (p.active ? ' (' + p.active + ')' : '') + (p.area ? ' — ' + p.area : '');
    });
    if (prods.length) lines.push('PRODUCTS APPLIED: ' + prods.join('; '));
  }
  if (S_photos.length) {
    var descs = S_photos.filter(function(p) { return p.description; }).map(function(p) { return p.description; });
    if (descs.length) lines.push('CONDUCIVE CONDITIONS PHOTOGRAPHED: ' + descs.join('; '));
  }
  lines.push('');
  lines.push('Provide your response in EXACTLY this format:');
  lines.push('');
  lines.push('## SERVICE SUMMARY');
  lines.push('2-3 paragraph professional summary of the overall pest situation, what was done, and trajectory of the program. Written for a client facilities manager. Formal Australian English.');
  lines.push('');
  lines.push('## RECOMMENDATIONS');
  lines.push('A numbered list of recommended actions in this EXACT format for each item:');
  lines.push('NUM|ACTION TEXT|PRIORITY');
  lines.push('Where PRIORITY is one of: HIGH / MEDIUM / LOW');
  lines.push('Example: 1|Install compliant draught strips to all external-facing doors. Clearance must not exceed 5mm for mouse exclusion.|HIGH');
  lines.push('Provide 4-8 recommendations specific to the data above. Each action must be precise — name what to do, where, and why. No generic advice.');
  lines.push('');
  lines.push('## CLIENT COMMUNICATION');
  lines.push('Exactly what must be communicated to the QA/Facilities Manager. State urgency. Specify actions required from the client before next service. 2-3 sentences.');
  if (S_photos.length && S_photos.filter(function(p) { return p.description; }).length) {
    lines.push('');
    lines.push('## CONDUCIVE CONDITIONS');
    lines.push('For each photographed condition: state the condition, the pest risk, the required rectification with specific materials/tolerances, and applicable AS/NCC reference.');
  }
  lines.push('');
  lines.push('CRITICAL: Be specific to this exact site and data. Reference Australian Standards. No boilerplate. The RECOMMENDATIONS section must use the NUM|ACTION|PRIORITY pipe-delimited format exactly.');
  return lines;
}

async function generateRecs(site, extAct, intAct, issuesRep, infest, comments) {
  var el2 = document.getElementById('rpt-recs');
  if (!el2) return;

  el2.innerHTML = '<div style="padding:20px;text-align:center;color:#888;font-size:12px;border-top:1px solid #eee;margin-top:16px">Analysing station data and generating recommendations...</div>';

  var apiKey = getApiKey();

  if (apiKey) {
    try {
      var promptLines = buildPromptLines(site, extAct, intAct, issuesRep, infest, comments);
      var prompt = promptLines.join('\n');

      var resp = await fetch('https://api.anthropic.com/v1/messages', {
      signal: AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 1400,
          messages: [{ role: 'user', content: prompt }]
        })
      });

      if (!resp.ok) { resp.text().then(function(b){ console.error('API HTTP ' + resp.status + ':', b.slice(0,200)); }).catch(function(){}); throw new Error('HTTP ' + resp.status); }
      var data = await resp.json();
      var text = data.content[0].text;
      el2.innerHTML = renderRecsHTML(text);
      return;
    } catch(err) {
      console.warn('AI recs failed, using rule-based fallback:', err);
    }
  }

  // Rule-based fallback
  el2.innerHTML = ruleBasedRecs(site, extAct, intAct, issuesRep, infest, comments);
}

// ============================================================
// RENDER AI TEXT INTO STYLED HTML — Museums Vic format
// ============================================================
function renderRecsHTML(text) {
  var html = '<div style="margin-top:16px">';
  var parts = text.split(/\n##\s+/);

  parts.forEach(function(part) {
    if (!part.trim()) return;
    var nlIdx = part.indexOf('\n');
    var heading = (nlIdx >= 0 ? part.slice(0, nlIdx) : part).trim().toUpperCase();
    var body = (nlIdx >= 0 ? part.slice(nlIdx + 1) : '').trim();
    if (!body) return;

    // ── RECOMMENDATIONS — render as numbered priority table ──
    if (heading.indexOf('RECOMMEND') >= 0) {
      html += '<div style="background:#008350;color:#fff;padding:6px 12px;font-family:Barlow Condensed,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;border-radius:4px;margin:16px 0 8px">Recommendations</div>';
      html += '<table style="width:100%;border-collapse:collapse;margin-bottom:12px">';
      html += '<thead><tr>';
      html += '<th style="background:#008350;color:#fff;padding:6px 10px;text-align:center;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.3px;width:32px">#</th>';
      html += '<th style="background:#008350;color:#fff;padding:6px 10px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.3px">Recommended Action</th>';
      html += '<th style="background:#008350;color:#fff;padding:6px 10px;text-align:center;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.3px;width:70px">Priority</th>';
      html += '</tr></thead><tbody>';

      var rowNum = 0;
      body.split('\n').forEach(function(line) {
        line = line.trim();
        if (!line) return;
        // Try pipe-delimited format: NUM|ACTION|PRIORITY
        var pipeParts = line.split('|');
        if (pipeParts.length === 3) {
          rowNum++;
          var num = pipeParts[0].trim().replace(/^\d+\.?\s*/, '') || String(rowNum);
          var action = pipeParts[1].trim();
          var priority = pipeParts[2].trim().toUpperCase();
          var priColor = priority === 'HIGH' ? '#b91c1c' : priority === 'MEDIUM' ? '#b45309' : '#008350';
          var priBg    = priority === 'HIGH' ? '#fee2e2' : priority === 'MEDIUM' ? '#ffedd5' : '#dcfce7';
          var rowBg    = rowNum % 2 === 0 ? '#f9fafb' : '#fff';
          html += '<tr>';
          html += '<td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;font-weight:700;text-align:center;color:#005c38;font-size:13px;font-family:Barlow Condensed,sans-serif;background:' + rowBg + '">' + rowNum + '</td>';
          html += '<td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;vertical-align:top;line-height:1.55;background:' + rowBg + '">' + action + '</td>';
          html += '<td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;text-align:center;background:' + rowBg + '"><span style="display:inline-block;padding:2px 8px;border-radius:10px;font-weight:700;font-size:10px;letter-spacing:0.5px;background:' + priBg + ';color:' + priColor + '">' + priority + '</span></td>';
          html += '</tr>';
        } else {
          // Fallback: numbered line
          var m = line.match(/^(\d+)\.?\s+(.+)/);
          if (m) {
            rowNum++;
            var rowBg2 = rowNum % 2 === 0 ? '#f9fafb' : '#fff';
            html += '<tr>';
            html += '<td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;font-weight:700;text-align:center;color:#005c38;font-size:13px;font-family:Barlow Condensed,sans-serif;background:' + rowBg2 + '">' + rowNum + '</td>';
            html += '<td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;vertical-align:top;line-height:1.55;background:' + rowBg2 + '" colspan="2">' + m[2] + '</td>';
            html += '</tr>';
          }
        }
      });
      html += '</tbody></table>';

    // ── SERVICE SUMMARY ──
    } else if (heading.indexOf('SERVICE SUMMARY') >= 0 || heading.indexOf('SUMMARY') >= 0) {
      html += '<div style="background:#008350;color:#fff;padding:6px 12px;font-family:Barlow Condensed,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;border-radius:4px;margin:16px 0 8px">Service Summary</div>';
      html += '<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px 14px;font-size:11.5px;line-height:1.7;color:#374151">';
      body.split('\n\n').forEach(function(para) {
        if (para.trim()) html += '<p style="margin:0 0 8px 0">' + para.trim() + '</p>';
      });
      html += '</div>';

    // ── CLIENT COMMUNICATION ──
    } else if (heading.indexOf('CLIENT') >= 0) {
      html += '<div style="background:#008350;color:#fff;padding:6px 12px;font-family:Barlow Condensed,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;border-radius:4px;margin:16px 0 8px">Client Communication</div>';
      html += '<div style="background:#fffbeb;border:1px solid #fcd34d;border-left:3px solid #d97706;border-radius:4px;padding:10px 14px;font-size:11.5px;line-height:1.65;color:#374151">' + body.replace(/\n/g,'<br>') + '</div>';

    // ── CONDUCIVE CONDITIONS ──
    } else if (heading.indexOf('CONDUCIVE') >= 0) {
      html += '<div style="background:#008350;color:#fff;padding:6px 12px;font-family:Barlow Condensed,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;border-radius:4px;margin:16px 0 8px">Conducive Condition Rectification</div>';
      html += '<div style="font-size:11.5px;line-height:1.65;color:#374151">' + body.replace(/\n/g,'<br>') + '</div>';

    // ── ANY OTHER SECTION ──
    } else {
      html += '<div style="background:#008350;color:#fff;padding:6px 12px;font-family:Barlow Condensed,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;border-radius:4px;margin:16px 0 8px">' + heading + '</div>';
      html += '<div style="font-size:11.5px;line-height:1.65;color:#374151;padding:8px 0">' + body.replace(/\n/g,'<br>') + '</div>';
    }
  });

  html += '</div>';
  return html;
}

// ============================================================
// RULE-BASED FALLBACK
// ============================================================
function ruleBasedRecs(site, extAct, intAct, issuesRep, infest, comments) {
  var hasILT = S.stations.ilt && S.stations.ilt.length && S.stations.ilt.some(function(s) { return s.moths !== 'Nil' || s.flies !== 'Nil' || s.small !== 'Nil'; });
  var hasSPP = S.stations.sp && S.stations.sp.length && S.stations.sp.some(function(s) { return s.val && s.val !== 'Nil'; });
  var extHigh = extAct === 'High';
  var extMed  = extAct === 'Medium';
  var extLow  = extAct === 'Low';
  var intActive = intAct !== 'Nil';
  var intHigh = intAct === 'High';
  var intMed  = intAct === 'Medium';

  // ── Service Summary ──────────────────────────────────────────────────
  var summaryText = '';
  if (extHigh || intHigh) {
    summaryText = 'The overall level of pest activity at this service visit is characterised by elevated rodent pressure';
    if (extHigh && intHigh) summaryText += ' across both the internal and external areas of the site';
    else if (extHigh) summaryText += ' at the external perimeter of the site';
    else summaryText += ' within the building interior';
    summaryText += '. This level of activity is consistent with an established population and requires immediate intervention beyond standard baiting.';
  } else if (extMed || intMed) {
    summaryText = 'A moderate level of pest activity was recorded at this service visit. While the program is performing, activity levels indicate that conditions exist on site that are supporting an ongoing rodent population.';
  } else if (extLow || intAct === 'Low') {
    summaryText = 'Low-level pest activity was recorded at this service visit. All control devices were inspected, cleaned, and replenished. The program is performing as intended and activity is within manageable parameters.';
  } else {
    summaryText = 'No significant pest activity was detected at this service visit. All bait stations and monitoring devices were inspected, cleaned, and replenished. The current program is performing effectively and conditions are consistent with successful ongoing suppression.';
  }
  if (comments) summaryText += ' ' + comments.split('.')[0] + '.';

  // ── Recommendations ───────────────────────────────────────────────────
  var recs = []; // { action, priority }
  if (extHigh) {
    recs.push({ action: 'Increase external bait station service frequency to fortnightly until activity reduces to Low or Nil across two consecutive visits. Review bait consumption at each visit and document findings.', priority: 'HIGH' });
    recs.push({ action: 'Assess external bait consumption rate and consider switching to a second-generation anticoagulant (e.g. brodifacoum) if resistance is suspected. Ensure compliance with APVMA label restrictions for bait rotation and non-target species protection.', priority: 'HIGH' });
  }
  if (extMed) {
    recs.push({ action: 'Monitor external bait consumption closely at the next service visit. If Medium activity persists across two consecutive visits, increase service frequency and review bait placement strategy.', priority: 'MEDIUM' });
  }
  if (intHigh || intMed) {
    recs.push({ action: 'Escalate internal rodent control — confirm client QA/Facilities Manager approval before placing additional internal bait stations. Document all internal placement locations on the site plan and record in the chemical register per AEPMA Code of Practice requirements.', priority: 'HIGH' });
    recs.push({ action: 'Conduct a detailed internal inspection of roof void, sub-floor, and wall cavities. Identify all rodent entry points (gaps >6mm for mice, >12mm for rats), photograph evidence, and provide client with a written conducive conditions and proofing report.', priority: 'HIGH' });
  }
  if (intAct === 'Low') {
    recs.push({ action: 'Review internal bait station positions and consider repositioning any stations recording consistent Nil activity to known harbourage or transit areas identified during this inspection.', priority: 'MEDIUM' });
  }
  if (hasILT) {
    recs.push({ action: 'Review ILT placement relative to light sources, entry points, and high-traffic areas. Clean catch trays and replace UV tubes if older than 12 months. Discuss external light spill management with the client to reduce flying insect attraction to entry points.', priority: 'MEDIUM' });
  }
  if (hasSPP) {
    recs.push({ action: 'Inspect all stored product and dry goods areas. Recommend client implement FIFO stock rotation and inspect incoming deliveries. Consider pheromone trap deployment to identify species and concentration of activity.', priority: 'MEDIUM' });
  }
  if (issuesRep === 'Yes') {
    recs.push({ action: 'Follow up on all client-reported pest issues in writing. Confirm that identified issues have been addressed and document response actions in the service record.', priority: 'HIGH' });
  }
  if (S_photos && S_photos.length) {
    recs.push({ action: 'Address all conducive conditions photographed during this service visit. Provide the client with a written rectification notice specifying required works, responsible party, and recommended completion timeframe for each item.', priority: 'MEDIUM' });
  }
  if (!recs.length) {
    recs.push({ action: 'Maintain current program at the scheduled service frequency. No escalation is required at this time. Confirm next service date with the client.', priority: 'LOW' });
  }

  // ── Client Communication ─────────────────────────────────────────────
  var clientMsg = '';
  if (extHigh || intHigh || infest === 'Yes') {
    clientMsg = 'Notify the QA/Facilities Manager of elevated pest pressure immediately. Provide a written summary of findings and confirm all escalation measures in writing. Request the client review waste management, delivery inspection procedures, and external bin placement before the next service visit.';
  } else if (extMed || intMed || issuesRep === 'Yes') {
    clientMsg = 'Advise the Facilities Manager that moderate activity has been recorded and that the program is being actively managed. Confirm any required client-side hygiene or structural actions verbally and follow up in writing.';
  } else {
    clientMsg = 'Provide the client with written confirmation that all control devices were checked and serviced at this visit. Advise that activity levels are at or below expected thresholds and the current program is performing as intended.';
  }

  // ── Build HTML ────────────────────────────────────────────────────────
  var html = '<div style="margin-top:16px">';

  // Service Summary
  html += '<div style="background:#008350;color:#fff;padding:6px 12px;font-family:Barlow Condensed,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;border-radius:4px;margin:16px 0 8px">Service Summary</div>';
  html += '<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:12px 14px;font-size:11.5px;line-height:1.7;color:#374151">' + summaryText + '</div>';

  // Recommendations table
  html += '<div style="background:#008350;color:#fff;padding:6px 12px;font-family:Barlow Condensed,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;border-radius:4px;margin:16px 0 8px">Recommendations</div>';
  html += '<table style="width:100%;border-collapse:collapse;margin-bottom:12px">';
  html += '<thead><tr>';
  html += '<th style="background:#008350;color:#fff;padding:6px 10px;text-align:center;font-size:10px;font-weight:700;text-transform:uppercase;width:32px">#</th>';
  html += '<th style="background:#008350;color:#fff;padding:6px 10px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase">Recommended Action</th>';
  html += '<th style="background:#008350;color:#fff;padding:6px 10px;text-align:center;font-size:10px;font-weight:700;text-transform:uppercase;width:70px">Priority</th>';
  html += '</tr></thead><tbody>';
  recs.forEach(function(r, i) {
    var priColor = r.priority === 'HIGH' ? '#b91c1c' : r.priority === 'MEDIUM' ? '#b45309' : '#008350';
    var priBg    = r.priority === 'HIGH' ? '#fee2e2' : r.priority === 'MEDIUM' ? '#ffedd5' : '#dcfce7';
    var rowBg    = i % 2 === 0 ? '#fff' : '#f9fafb';
    html += '<tr>';
    html += '<td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;font-weight:700;text-align:center;color:#005c38;font-size:13px;font-family:Barlow Condensed,sans-serif;background:' + rowBg + '">' + (i+1) + '</td>';
    html += '<td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;vertical-align:top;line-height:1.55;background:' + rowBg + '">' + r.action + '</td>';
    html += '<td style="padding:7px 10px;border-bottom:1px solid #e5e7eb;text-align:center;background:' + rowBg + '"><span style="display:inline-block;padding:2px 8px;border-radius:10px;font-weight:700;font-size:10px;letter-spacing:0.5px;background:' + priBg + ';color:' + priColor + '">' + r.priority + '</span></td>';
    html += '</tr>';
  });
  html += '</tbody></table>';

  // Client Communication
  html += '<div style="background:#008350;color:#fff;padding:6px 12px;font-family:Barlow Condensed,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;border-radius:4px;margin:16px 0 8px">Client Communication</div>';
  html += '<div style="background:#fffbeb;border:1px solid #fcd34d;border-left:3px solid #d97706;border-radius:4px;padding:10px 14px;font-size:11.5px;line-height:1.65;color:#374151">' + clientMsg + '</div>';

  html += '</div>';
  return html;
}


// ============================================================
// PHOTO SECTION IN REPORT
// ============================================================
function buildPhotoSectionHTML() {
  if (!S_photos || !S_photos.length) return '';
  var html = '<div class="sec-head">Conducive Condition Photos</div>';
  html += '<div id="photo-recs-container">';
  S_photos.forEach(function(p, i) {
    html += '<div id="photo-rec-' + i + '" style="margin-bottom:16px;border:1px solid #ddd;border-radius:6px;overflow:hidden;page-break-inside:avoid">';
    // Photo
    html += '<div style="background:#f5f5f5;text-align:center;padding:8px">';
    html += '<img src="' + p.dataUrl + '" style="max-width:100%;max-height:260px;object-fit:contain;border-radius:4px">';
    html += '</div>';
    // Tech description
    if (p.description) {
      html += '<div style="padding:8px 12px;background:#fafafa;border-top:1px solid #eee;font-size:11px;color:#555">';
      html += '<strong>Technician note:</strong> ' + p.description;
      html += '</div>';
    }
    // AI analysis placeholder
    html += '<div id="photo-ai-' + i + '" style="padding:10px 12px;border-top:1px solid #eee;font-size:11px;color:#888;font-style:italic">Analysing photo...</div>';
    html += '</div>';
  });
  html += '</div>';
  return html;
}

// ============================================================
// ANALYSE EACH PHOTO WITH CLAUDE VISION
// ============================================================
async function analysePhotoWithAI(photo, index, apiKey) {
  var container = document.getElementById('photo-ai-' + index);
  if (!container) return;

  container.innerHTML = '<div style="padding:10px 12px;font-size:11px;color:#888;font-style:italic">🔍 Analysing photo' + (photo.description ? ' and technician notes' : '') + '...</div>';

  var match = photo.dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!match) {
    container.innerHTML = buildPhotoFallback(photo.description, index);
    return;
  }
  var mediaType = match[1];
  var base64Data = match[2];

  // Build the text prompt — richer when technician has spoken notes
  var techNotes = (photo.description || '').trim();
  var promptParts = [
    'You are a senior AEPMA-accredited pest management consultant conducting a commercial property inspection in Australia.',
    'Your role is to analyse this photo alongside the technician field observations and produce a professional, standards-referenced assessment suitable for a formal pest management service report.'
  ];
  if (techNotes) {
    promptParts.push('');
    promptParts.push('TECHNICIAN FIELD NOTES: "' + techNotes + '"');
    promptParts.push('');
    promptParts.push('Your tasks:');
    promptParts.push('1. Analyse the photo to identify exactly what conducive condition is present.');
    promptParts.push('2. Rewrite the raw field notes into polished, professional report language — preserve all factual content but elevate the terminology to AEPMA/industry standard. This refined version will appear directly in the client report.');
    promptParts.push('3. Assess pest risk, identify precise rectification steps, and rate urgency.');
  } else {
    promptParts.push('');
    promptParts.push('Analyse the photo and identify the conducive condition, pest risks, required rectification, and urgency.');
  }
  promptParts.push('');
  promptParts.push('Respond in EXACTLY this format — do not add extra headings or sections:');
  promptParts.push('');
  promptParts.push('CONDITION: [One precise sentence identifying the specific conducive condition — use technical pest management terminology]');
  promptParts.push('');
  if (techNotes) {
    promptParts.push('REFINED FIELD NOTE: [Rewrite the technician observations into professional report language. Keep all facts. Use formal terminology. 2-3 sentences max. This text goes directly into the client report.]');
    promptParts.push('');
  }
  promptParts.push('PEST RISK: [Specific Australian pest species this condition facilitates — Mus musculus, Rattus rattus, Rattus norvegicus, cockroach species etc — explain the ingress/harbourage mechanism and reference Australian pest behaviour patterns]');
  promptParts.push('');
  promptParts.push('RECTIFICATION: [Numbered step-by-step remediation. Cite specific standards: NCC/BCA Section F (pest exclusion), AS 1428.1 (accessible design clearances where relevant), AS 3660.1 (termite management where relevant), AEPMA Code of Practice. Specify materials, dimensions (e.g. gap tolerance <6mm mice, <12mm rats), and responsible party (facilities/building manager)]');
  promptParts.push('');
  promptParts.push('URGENCY: [HIGH / MEDIUM / LOW — one sentence commercial justification referencing likelihood of pest activity at this type of site]');
  promptParts.push('');
  promptParts.push('Rules: Be specific. No generic advice. Every rectification step must name a material or standard. If you cannot see the full condition clearly, rely on the technician notes and state what you can confirm visually.');

  var userContent = [
    {
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data: base64Data }
    },
    {
      type: 'text',
      text: promptParts.join('\n')
    }
  ];

  try {
    var resp = await fetch('https://api.anthropic.com/v1/messages', {
      signal: AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 900,
        messages: [{ role: 'user', content: userContent }]
      })
    });

    if (!resp.ok) { resp.text().then(function(b){ console.error('API HTTP ' + resp.status + ':', b.slice(0,200)); }).catch(function(){}); throw new Error('HTTP ' + resp.status); }
    var data = await resp.json();
    var text = data.content[0].text;
    container.innerHTML = renderPhotoAnalysis(text, index, !!techNotes);
  } catch(err) {
    console.warn('Photo analysis failed for photo ' + index + ':', err);
    container.innerHTML = buildPhotoFallback(photo.description, index);
  }
}

function renderPhotoAnalysis(text, index, hasTechNotes) {
  var keys = ['CONDITION', 'REFINED FIELD NOTE', 'PEST RISK', 'RECTIFICATION', 'URGENCY'];
  var sections = {};
  keys.forEach(function(k) { sections[k] = ''; });
  var currentKey = null;

  text.split('\n').forEach(function(line) {
    var matched = false;
    keys.forEach(function(key) {
      if (line.startsWith(key + ':')) {
        currentKey = key;
        sections[key] = line.slice(key.length + 1).trim();
        matched = true;
      }
    });
    if (!matched && currentKey && line.trim()) {
      sections[currentKey] += ' ' + line.trim();
    }
  });

  // Format numbered steps in RECTIFICATION as a visual list
  function formatSteps(txt) {
    if (!txt) return '';
    // Convert "1. Step one 2. Step two" into HTML list items
    var stepped = txt.replace(/(\d+)\.\s+/g, function(m, n) {
      return (n === '1' ? '' : '<br>') + '<strong>' + n + '.</strong> ';
    });
    return stepped;
  }

  var urgency = (sections.URGENCY || '').toUpperCase();
  var isHigh   = urgency.indexOf('HIGH') >= 0;
  var isMed    = urgency.indexOf('MEDIUM') >= 0;
  var urgencyCol = isHigh ? '#c0392b' : isMed ? '#e67e22' : '#27ae60';
  var urgencyBg  = isHigh ? '#fdf0ef' : isMed ? '#fef9f0' : '#f0faf0';
  var urgencyLabel = isHigh ? 'HIGH' : isMed ? 'MEDIUM' : 'LOW';

  var html = '<div style="font-style:normal">';

  // ── Condition ──
  if (sections.CONDITION) {
    html += '<div style="background:#e8f0fa;padding:8px 12px;border-bottom:1px solid #ddd">';
    html += '<div style="font-family:Barlow Condensed,sans-serif;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#1e4a7a;margin-bottom:3px">🔍 Condition Identified</div>';
    html += '<div style="font-size:11.5px;color:#1a1a2e;font-weight:600">' + sections.CONDITION + '</div>';
    html += '</div>';
  }

  // ── Refined Field Note (AI-polished version of tech comment) ──
  if (sections['REFINED FIELD NOTE']) {
    html += '<div style="background:#fffbea;padding:8px 12px;border-bottom:1px solid #ddd;border-left:3px solid #e6a817">';
    html += '<div style="font-family:Barlow Condensed,sans-serif;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#7a5a10;margin-bottom:3px">✏️ Refined Field Note <span style="font-weight:400;font-style:italic;text-transform:none;letter-spacing:0">(AI-refined for report)</span></div>';
    html += '<div style="font-size:11.5px;color:#3d2e00;line-height:1.6;font-style:italic">"' + sections['REFINED FIELD NOTE'] + '"</div>';
    html += '</div>';
  }

  // ── Pest Risk ──
  if (sections['PEST RISK']) {
    html += '<div style="background:#fdf3e0;padding:8px 12px;border-bottom:1px solid #ddd">';
    html += '<div style="font-family:Barlow Condensed,sans-serif;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#7a4a10;margin-bottom:3px">🐀 Pest Risk</div>';
    html += '<div style="font-size:11.5px;color:#333;line-height:1.6">' + sections['PEST RISK'] + '</div>';
    html += '</div>';
  }

  // ── Rectification ──
  if (sections.RECTIFICATION) {
    html += '<div style="background:#e8f5e0;padding:8px 12px;border-bottom:1px solid #ddd">';
    html += '<div style="font-family:Barlow Condensed,sans-serif;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#005c38;margin-bottom:3px">🔧 Required Rectification</div>';
    html += '<div style="font-size:11.5px;color:#1a2e1a;line-height:1.7">' + formatSteps(sections.RECTIFICATION) + '</div>';
    html += '</div>';
  }

  // ── Urgency badge ──
  if (sections.URGENCY) {
    html += '<div style="background:' + urgencyBg + ';padding:8px 12px;display:flex;align-items:flex-start;gap:8px">';
    html += '<span style="display:inline-block;font-family:Barlow Condensed,sans-serif;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:' + urgencyCol + ';color:#fff;white-space:nowrap;flex-shrink:0;margin-top:1px">⚡ ' + urgencyLabel + '</span>';
    html += '<span style="font-size:11px;color:#333;line-height:1.5">' + sections.URGENCY.replace(/^(HIGH|MEDIUM|LOW)[^a-zA-Z]*/i,'') + '</span>';
    html += '</div>';
  }

  html += '</div>';
  return html;
}

function buildPhotoFallback(description, index) {
  // Rule-based fallback when no API key or API fails
  var desc = (description || '').toLowerCase();
  var condition = description || 'Conducive condition observed';
  var risk = 'This condition may facilitate pest entry or harbourage.';
  var rect = 'Assess and remediate condition. Provide written rectification notice to client and document in site file.';
  var urgency = 'MEDIUM';
  var urgencyCol = '#e67e22';
  var urgencyBg = '#fef9f0';

  if (desc.indexOf('hole') >= 0 || desc.indexOf('gap') >= 0 || desc.indexOf('crack') >= 0) {
    risk = 'Gaps and holes are primary entry points for Rattus rattus and Mus musculus. Mice can pass through openings as small as 6mm; rats require 12mm or greater.';
    rect = 'Seal with rodent-proof materials: galvanised steel mesh (minimum 26 gauge / 0.5mm aperture), stainless steel wool packed firmly and backed with polyurethane sealant, or concrete patch compound. Refer to AS 3660 and AEPMA Proofing Guidelines for approved materials. Issue written rectification request to building management with a 14-day completion timeframe.';
    urgency = 'HIGH'; urgencyCol = '#c0392b'; urgencyBg = '#fdf0ef';
  } else if (desc.indexOf('door') >= 0) {
    risk = 'Unsealed doors are the most common entry point for rodents and crawling insects. A 6mm gap under a standard door is sufficient for mouse entry.';
    rect = 'Install compliant door bottom seal or automatic drop seal reducing clearance to less than 6mm. Brush strips are acceptable for low-traffic doors. Refer to NCC/BCA Section F for minimum door sealing requirements. Confirm installation with facilities team prior to next service.';
    urgency = 'HIGH'; urgencyCol = '#c0392b'; urgencyBg = '#fdf0ef';
  } else if (desc.indexOf('drain') >= 0) {
    risk = 'Open drains provide harbourage and entry routes for Rattus norvegicus (Norway rat), which is an adept swimmer and commonly enters via drainage systems.';
    rect = 'Fit AEPMA-approved rodent-proof drain cover or stainless mesh guard with maximum 6mm aperture. Clear drain of debris. Schedule quarterly drain inspection as part of IPM program.';
    urgency = 'HIGH'; urgencyCol = '#c0392b'; urgencyBg = '#fdf0ef';
  } else if (desc.indexOf('bin') >= 0 || desc.indexOf('rubbish') >= 0 || desc.indexOf('waste') >= 0) {
    risk = 'Exposed waste is a primary food source and attractant for Rattus spp., Mus musculus, and German cockroach (Blattella germanica). Sustained food availability leads to rapid population establishment.';
    rect = 'Relocate bins minimum 3 metres from building perimeter. All waste bins must have tight-fitting lids and be placed on impervious, cleanable surfaces. Implement daily bin-lid compliance checks. Raise with QA/Facilities Manager in writing per AEPMA Code of Practice.';
    urgency = 'HIGH'; urgencyCol = '#c0392b'; urgencyBg = '#fdf0ef';
  } else if (desc.indexOf('pipe') >= 0 || desc.indexOf('cable') >= 0 || desc.indexOf('conduit') >= 0) {
    risk = 'Unsealed pipe and cable penetrations are travel routes for rodents moving between roof voids, wall cavities and occupied areas. Rattus rattus is a particularly adept climber and uses vertical runs frequently.';
    rect = 'Seal all penetrations with expanding foam rated for pest exclusion or proprietary pipe collar systems. Aperture must be reduced to less than 6mm around the penetration. Refer to AS 3660 for proofing specifications around service penetrations.';
    urgency = 'MEDIUM';
  }

  var html = '<div style="font-style:normal">';
  html += '<div style="background:#e8f0fa;padding:7px 12px;border-bottom:1px solid #ddd"><span style="font-family:Barlow Condensed,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#1e4a7a">🔍 Condition Identified</span><div style="margin-top:4px;font-size:11.5px;color:#222">' + condition + '</div></div>';
  html += '<div style="background:#fdf3e0;padding:7px 12px;border-bottom:1px solid #ddd"><span style="font-family:Barlow Condensed,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#7a4a10">🐀 Pest Risk</span><div style="margin-top:4px;font-size:11.5px;color:#222">' + risk + '</div></div>';
  html += '<div style="background:#e8f5e0;padding:7px 12px;border-bottom:1px solid #ddd"><span style="font-family:Barlow Condensed,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#005c38">🔧 Required Rectification</span><div style="margin-top:4px;font-size:11.5px;color:#222;line-height:1.6">' + rect + '</div></div>';
  html += '<div style="background:' + urgencyBg + ';padding:7px 12px;display:flex;align-items:center;gap:8px"><span style="font-family:Barlow Condensed,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:' + urgencyCol + '">⚡ Urgency</span><span style="font-size:11px;color:#333">' + urgency + '</span></div>';
  html += '</div>';
  return html;
}

// ============================================================
// ANALYSE ALL PHOTOS (runs after report renders)
// ============================================================
async function analyseAllPhotos(apiKey) {
  if (!S_photos || !S_photos.length) return;
  // Run analyses in parallel
  var promises = S_photos.map(function(p, i) {
    if (apiKey) {
      return analysePhotoWithAI(p, i, apiKey);
    } else {
      var container = document.getElementById('photo-ai-' + i);
      if (container) container.innerHTML = buildPhotoFallback(p.description, i);
      return Promise.resolve();
    }
  });
  return Promise.all(promises);
}


// ============================================================
// TREND ANALYSIS
// ============================================================
async function generateTrendAnalysis(site, current, history) {
  var el2 = document.getElementById('rpt-trend');
  if (!el2) return;

  el2.innerHTML = '<div style="padding:16px;text-align:center;color:#888;font-size:12px;border:1px solid #e0ecd0;border-radius:6px;margin:16px 0;background:#f9fdf5">📈 Analysing historical data across ' + history.length + ' previous visits...</div>';

  var apiKey = getApiKey();
  if (!apiKey) {
    el2.innerHTML = '';
    return;
  }

  // Build a structured summary of each historical visit
  var histSummary = history.slice().reverse().map(function(r, i) {
    var stns = typeof r.stations === 'string' ? JSON.parse(r.stations||'{}') : (r.stations || {});
    var lines = ['Visit ' + (i+1) + ' — ' + r.date + ' (Tech: ' + (r.tech||'Unknown') + ')'];
    lines.push('  Overall: External=' + (r.ext_act||'?') + ', Internal=' + (r.int_act||'?'));
    if (stns.er && stns.er.length) {
      var highs = stns.er.filter(function(s){return s.val==='High'||s.val==='Medium';}).map(function(s){return s.num+'('+s.val+')'});
      if (highs.length) lines.push('  External rodent hot spots: ' + highs.join(', '));
    }
    if (stns.ir && stns.ir.length) {
      var highs2 = stns.ir.filter(function(s){return s.val==='High'||s.val==='Medium';}).map(function(s){return s.num+'('+s.val+')'});
      if (highs2.length) lines.push('  Internal rodent hot spots: ' + highs2.join(', '));
    }
    if (stns.ilt && stns.ilt.length) {
      var iltHighs = stns.ilt.filter(function(s){return s.flies!=='Nil'||s.moths!=='Nil'||s.small!=='Nil';}).map(function(s){return s.num;});
      if (iltHighs.length) lines.push('  ILT activity at: ' + iltHighs.join(', '));
    }
    if (r.products && r.products.length) {
      lines.push('  Products applied: ' + r.products.filter(function(p){return p.name;}).map(function(p){return p.name;}).join(', '));
    }
    if (r.comments) lines.push('  Notes: ' + r.comments.slice(0,120));
    return lines.join('\n');
  }).join('\n\n');

  // Current visit summary
  var curStns = current.stations || {};
  var curLines = ['CURRENT VISIT — ' + current.date];
  curLines.push('  Overall: External=' + current.ext_act + ', Internal=' + current.int_act);
  if (curStns.er && curStns.er.length) {
    var curExt = curStns.er.filter(function(s){return s.val==='High'||s.val==='Medium';}).map(function(s){return s.num+'('+s.val+')'});
    if (curExt.length) curLines.push('  External rodent hot spots: ' + curExt.join(', '));
  }
  if (curStns.ir && curStns.ir.length) {
    var curInt = curStns.ir.filter(function(s){return s.val==='High'||s.val==='Medium';}).map(function(s){return s.num+'('+s.val+')'});
    if (curInt.length) curLines.push('  Internal rodent hot spots: ' + curInt.join(', '));
  }

  var prompt = 'You are an expert pest control analyst generating a Trend Analysis section for a professional pest control service report for ' + site.name + ' in Melbourne, Australia.\n\n'
    + 'HISTORICAL VISITS (oldest first):\n' + histSummary + '\n\n'
    + curLines.join('\n') + '\n\n'
    + 'Write a concise Trend Analysis section with these subsections using ## headings:\n'
    + '## ACTIVITY TREND\nIs activity increasing, decreasing or stable? Compare current to recent visits in 2-3 sentences.\n\n'
    + '## PERSISTENT HOT SPOTS\nWhich specific stations are consistently recording activity across multiple visits? Name them.\n\n'
    + '## TREATMENT EFFECTIVENESS\nHas treatment been working? Is activity reducing after applications or persisting/recurring?\n\n'
    + '## SEASONAL CONTEXT\nAny seasonal patterns visible in the data? What to expect in coming months given Melbourne seasonal patterns?\n\n'
    + 'Keep each subsection to 2-4 sentences. Be specific and data-driven. Do not use bullet points.';

  try {
    var resp = await fetch('https://api.anthropic.com/v1/messages', {
      signal: AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 900,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!resp.ok) { resp.text().then(function(b){ console.error('API HTTP ' + resp.status + ':', b.slice(0,200)); }).catch(function(){}); throw new Error('HTTP ' + resp.status); }
    var data = await resp.json();
    var text = data.content[0].text;
    el2.innerHTML = renderTrendHTML(text, history.length);
  } catch(err) {
    console.warn('Trend analysis failed:', err);
    el2.innerHTML = '';
  }
}

function renderTrendHTML(text, visitCount) {
  var sectionDefs = [
    { key: 'ACTIVITY',     icon: '📈', label: 'ACTIVITY TREND',          bgCol: '#e8f0fa', hdCol: '#1e4a7a' },
    { key: 'PERSISTENT',   icon: '📍', label: 'PERSISTENT HOT SPOTS',    bgCol: '#fae8e8', hdCol: '#7a1a1a' },
    { key: 'TREATMENT',    icon: '✅', label: 'TREATMENT EFFECTIVENESS',  bgCol: '#e8f5e0', hdCol: '#005c38' },
    { key: 'SEASONAL',     icon: '🌿', label: 'SEASONAL CONTEXT',         bgCol: '#fdf3e0', hdCol: '#7a4a10' }
  ];

  var wrap = '<div style="margin:16px 0;border:1px solid #c8e0b0;border-radius:6px;overflow:hidden">'
    + '<div style="background:#008350;color:#fff;padding:10px 14px;font-family:Barlow Condensed,sans-serif;font-size:14px;font-weight:700;letter-spacing:0.5px">📊 TREND ANALYSIS <span style="font-weight:400;font-size:11px;opacity:0.85;margin-left:8px">Based on ' + visitCount + ' previous visit' + (visitCount===1?'':'s') + '</span></div>'
    + '<div style="padding:2px 0">';

  var parts = text.split(/\n##\s+/);
  parts.forEach(function(part) {
    if (!part.trim()) return;
    var nlIdx = part.indexOf('\n');
    var heading = (nlIdx >= 0 ? part.slice(0, nlIdx) : part).trim().toUpperCase();
    var body = (nlIdx >= 0 ? part.slice(nlIdx + 1).trim() : '').replace(/\n/g, ' ').trim();
    if (!body) return;
    var def = sectionDefs[0];
    sectionDefs.forEach(function(d) { if (heading.indexOf(d.key) === 0) def = d; });
    wrap += '<div style="padding:10px 14px;border-bottom:1px solid #e8f0e0;background:' + def.bgCol + '">'
      + '<div style="font-family:Barlow Condensed,sans-serif;font-size:11px;font-weight:700;color:' + def.hdCol + ';letter-spacing:0.4px;margin-bottom:4px">' + def.icon + ' ' + def.label + '</div>'
      + '<div style="font-size:11px;color:#333;line-height:1.6">' + body + '</div>'
      + '</div>';
  });

  wrap += '</div></div>';
  return wrap;
}

// ============================================================
// SERVICE REPORTS - CLOUD VERSIONS
// ============================================================
async function saveReportToCloud(report) {
  _saveReportLocally(report);
  try {
    var payload = {
      site_name:  report.site_name,
      site_id:    report.site_id,
      tech:       report.tech,
      date:       report.date,
      job_num:    report.job_num || '',
      ext_act:    report.ext_act,
      int_act:    report.int_act,
      issues:     report.issues,
      infest:     report.infest,
      comments:   report.comments || '',
      stations:   report.stations,
      products:   report.products,
      created_at: new Date().toISOString()
    };
    await sbInsert('service_reports', payload);
    return true;
  } catch(e) {
    console.warn('saveReportToCloud failed:', e);
    return false;
  }
}

async function loadReportHistory(siteName, limit) {
  try {
    limit = limit || 10;
    var url = SB_URL + '/rest/v1/service_reports?site_name=eq.' + encodeURIComponent(siteName) + '&order=date.desc&limit=' + limit;
    var resp = await fetch(url, { headers: sbHeaders() });
    if (!resp.ok) { resp.text().then(function(b){ console.error('API HTTP ' + resp.status + ':', b.slice(0,200)); }).catch(function(){}); throw new Error('HTTP ' + resp.status); }
    var rows = await resp.json();
    // Exclude today's just-saved report (same date) to avoid counting current visit as history
    var today = new Date().toISOString().slice(0,10);
    return rows.filter(function(r){ return r.date !== today; });
  } catch(e) {
    console.warn('loadReportHistory failed:', e);
    return [];
  }
}

      hideGenOverlay();
      var errMsg = err.message || String(err);
      showSyncBanner('\u26A0 Report generation failed: ' + errMsg, true);
      console.error('_doBuildReport failed:', err);
    }
  }, 200);
}

document.getElementById('dictateOverlay').addEventListener('click', function(e){
  if (e.target === this) closeDictateOverlay();
});

// ============================================================
// VOICE TO TEXT
// ============================================================
var _voiceRecognition = null;
var _voiceActive = false;

function isSpeechSupported() {
  return ('webkitSpeechRecognition' in window) || ('SpeechRecognition' in window);
}

function toggleVoice(targetId, btnId, labelId, statusId) {
  if (!isSpeechSupported()) {
    toast('⚠ Voice not supported. Use Safari on iPhone or Chrome on Android.');
    return;
  }
  if (_voiceActive) {
    stopVoice(btnId, labelId, statusId);
  } else {
    startVoice(targetId, btnId, labelId, statusId);
  }
}

function startVoice(targetId, btnId, labelId, statusId) {
  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  _voiceRecognition = new SpeechRecognition();
  _voiceRecognition.lang = 'en-AU';
  _voiceRecognition.continuous = false;   // iOS Safari: false + auto-restart is more reliable
  _voiceRecognition.interimResults = true;

  var target = document.getElementById(targetId);
  var btn = document.getElementById(btnId);
  var lbl = document.getElementById(labelId);
  var status = document.getElementById(statusId);
  var baseText = target.value;
  var interimSpan = '';

  _voiceActive = true;
  if (btn) btn.style.background = '#fde8e8';
  if (btn) btn.style.borderColor = '#c0392b';
  if (lbl) lbl.textContent = '⏹ Stop';
  if (status) status.style.display = 'block';

  _voiceRecognition.onresult = function(event) {
    var interim = '';
    var final = '';
    for (var i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        final += event.results[i][0].transcript;
      } else {
        interim += event.results[i][0].transcript;
      }
    }
    if (final) {
      baseText = baseText + (baseText && !baseText.endsWith(' ') ? ' ' : '') + final;
    }
    target.value = baseText + (interim ? ' ' + interim : '');
  };

  _voiceRecognition.onerror = function(event) {
    console.warn('Voice error:', event.error);
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      toast('⚠ Microphone blocked. In Safari: Settings → Safari → Microphone → Allow for this site.');
    } else if (event.error === 'network') {
      toast('⚠ Voice needs internet connection.');
    } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
      toast('⚠ Voice error: ' + event.error);
    }
    stopVoice(btnId, labelId, statusId);
  };

  _voiceRecognition.onend = function() {
    if (_voiceActive) {
      // Auto-restart if still active (handles timeouts)
      try { _voiceRecognition.start(); } catch(e) { stopVoice(btnId, labelId, statusId); }
    }
  };

  try {
    _voiceRecognition.start();
  } catch(e) {
    toast('⚠ Could not start microphone: ' + e.message);
    stopVoice(btnId, labelId, statusId);
  }
}

function stopVoice(btnId, labelId, statusId) {
  _voiceActive = false;
  if (_voiceRecognition) {
    try { _voiceRecognition.stop(); } catch(e) {}
    _voiceRecognition = null;
  }
  var btn = document.getElementById(btnId);
  var lbl = document.getElementById(labelId);
  var status = document.getElementById(statusId);
  if (btn) { btn.style.background = ''; btn.style.borderColor = ''; }
  if (lbl) lbl.textContent = btnId === 'rptVoiceBtn' ? 'Start Dictating' : 'Dictate';
  if (status) status.style.display = 'none';
  toast('✓ Voice note saved');
}

function appendVoiceNoteToReport() {
  var noteText = document.getElementById('rpt-voice-text').value.trim();
  if (!noteText) { toast('⚠ No note to add — dictate something first'); return; }

  // Find or create a voice notes section in the report doc
  var existing = document.getElementById('rpt-voice-notes');
  if (!existing) {
    var footer = document.getElementById('reportDoc') ? 
      document.getElementById('reportDoc').querySelector('.footer') : null;
    var div = document.createElement('div');
    div.id = 'rpt-voice-notes';
    div.style.cssText = 'margin:16px 0;padding:12px 14px;border:1px solid #c8e0b0;border-radius:6px;background:#f9fdf5';
    div.innerHTML = '<div style="font-family:Barlow Condensed,sans-serif;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#008350;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #c8e0b0">🎙️ Field Notes</div>'
      + '<div id="rpt-voice-notes-content" style="font-size:11.5px;line-height:1.6;color:#333"></div>';
    if (footer) {
      footer.parentNode.insertBefore(div, footer);
    } else {
      document.getElementById('reportDoc').appendChild(div);
    }
  }

  var notesContent = document.getElementById('rpt-voice-notes-content');
  var ts = new Date().toLocaleTimeString('en-AU', {hour:'2-digit',minute:'2-digit'});
  notesContent.innerHTML += (notesContent.innerHTML ? '<br>' : '') + '<span style="color:#888;font-size:10px">[' + ts + ']</span> ' + noteText;

  document.getElementById('rpt-voice-text').value = '';
  toast('✓ Note added to report');
}


// ════════════════════════════════════════════════════════════════
// DESKTOP FORM HELPERS
// getElementById finds the HIDDEN mobile original on desktop.
// These helpers find the VISIBLE element in the active panel.
// ════════════════════════════════════════════════════════════════
function _getVal(id) {
  var daEl = document.querySelector('#desktop-admin-content .da-panel.da-on #' + id);
  if (daEl) return daEl.value || '';
  var el = document.getElementById(id);

// ============================================================
// src/screens/home.js
// ============================================================
// ============================================================
// HOME SCREEN
// ============================================================
var activeTechIdx = null;

function goHome() {
  document.getElementById('stepsBar').style.display = 'none';
  document.getElementById('homeBtn').style.display = 'none';
  var pb = document.getElementById('hdrProgress'); if (pb) pb.style.display = 'none';
  document.querySelectorAll('.scr').forEach(function(s){ s.classList.remove('on'); });
  document.getElementById('sc0').classList.add('on');
  S.currentScreen = 0;
  window.scrollTo(0, 0);
  renderHomeGreeting();
  renderHomeStats();

  // Auto-select the logged-in tech and show their jobs
  if (AUTH.loggedIn && !AUTH.isAdmin && AUTH.techIdx !== null) {
    activeTechIdx = AUTH.techIdx;
    renderTechPicker();
    showTechJobs(AUTH.techIdx);
  } else if (AUTH.isAdmin) {
    activeTechIdx = null;
    renderTechPicker();
    // Admin sees all techs — no auto-select
    document.getElementById('homeJobsSection').style.display = 'none';
    document.getElementById('pg-sub-home') && (document.getElementById('pg-sub-home').textContent = 'Select a technician to view their jobs');
  } else {
    renderTechPicker();
  }
  showStatusBar();
  // Quietly refresh jobs in background so home screen stays current
  if (isSbConfigured() && typeof loadScheduleFromCloud === 'function') {
    loadScheduleFromCloud().catch(function(){});
  }
}

function renderHomeGreeting() {
  var h = new Date().getHours();
  var greeting = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  var name = AUTH.techName ? ', ' + AUTH.techName.split(' ')[0] : '';
  document.getElementById('home-greeting').textContent = greeting + name;
  var today = new Date();
  document.getElementById('homeDateBadge').textContent = today.toLocaleDateString('en-AU', {weekday:'long', day:'numeric', month:'long'});
  renderHomeStats();
}

function renderTechPicker() {
  var techs = loadTechs();
  var list = document.getElementById('techPickList');
  list.innerHTML = '';

  // Technicians only see themselves — hide the picker entirely
  if (AUTH.loggedIn && !AUTH.isAdmin) {
    list.style.display = 'none';
    var lbl = document.getElementById('whoAreYouLabel'); if (lbl) lbl.style.display = 'none';
    var pgSub = document.getElementById('pg-sub-home'); if(pgSub) pgSub.textContent = "Here's your schedule for today";
    // Show sign-out button for logged-in techs
    var soBtn = document.getElementById('techSignOutBtn');
    if (soBtn) { soBtn.style.display = 'block'; soBtn.textContent = 'Sign Out (' + AUTH.techName + ')'; }
    return;
  }
  // Show the label when in tech-picker mode
  var lbl2 = document.getElementById('whoAreYouLabel'); if (lbl2) lbl2.style.display = '';

  list.style.display = '';
  var pgSub2 = document.getElementById('pg-sub-home'); if(pgSub2) pgSub2.textContent = 'Select a technician to view their jobs';
  // Hide sign-out button when in admin/tech-picker mode
  var soBtn = document.getElementById('techSignOutBtn'); if(soBtn) soBtn.style.display = 'none';

  if (!techs.length) {
    var msg = el('div');
    msg.style.cssText = 'color:var(--mu);font-size:13px;padding:10px;background:var(--s2);border-radius:var(--rr);border:1px solid var(--bd)';
    msg.innerHTML = 'No technicians set up yet. Tap <strong>⚙ Schedule</strong> above to add technicians and schedule jobs.';
    list.appendChild(msg);
    return;
  }
  techs.forEach(function(t, i) {
    var btn = el('div');
    btn.style.cssText = 'background:var(--s2);border:1.5px solid var(--bd);border-radius:var(--rr);padding:14px 16px;margin-bottom:8px;cursor:pointer;display:flex;align-items:center;gap:12px;transition:border-color 0.15s';
    if (activeTechIdx === i) btn.style.borderColor = 'var(--g)';
    var icon = el('div');
    icon.style.cssText = 'width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--g),var(--gd));display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:#fff;flex-shrink:0';
    icon.textContent = t.name.charAt(0).toUpperCase();
    var info = el('div');
    var nm = el('div'); nm.style.cssText = 'font-family:Barlow Condensed,sans-serif;font-size:17px;font-weight:700'; nm.textContent = t.name;
    var lic = el('div'); lic.style.cssText = 'font-size:12px;color:var(--mu)'; lic.textContent = t.lic ? 'Licence: ' + t.lic : '';
    info.appendChild(nm); if (t.lic) info.appendChild(lic);
    btn.appendChild(icon); btn.appendChild(info);
    if (activeTechIdx === i) {
      var tick = el('div'); tick.style.cssText = 'margin-left:auto;color:var(--g);font-size:20px'; tick.textContent = '✓';
      btn.appendChild(tick);
    }
    (function(idx){ btn.addEventListener('click', function(){
      activeTechIdx = idx;
      renderTechPicker();
      showTechJobs(idx);
    }); })(i);
    list.appendChild(btn);
  });
}

function showTechJobs(techIdx) {
  var techs = loadTechs();
  var tech = techs[techIdx];
  var today = todayStr();
  // Allow yesterday too — covers timezone edge cases where UTC date lags local
  var d = new Date(); d.setDate(d.getDate() - 1);
  var yesterday = d.toISOString().slice(0,10);
  var cutoff = yesterday;
  var techNameLower = (tech.name || '').trim().toLowerCase();
  var allMyJobs = loadSchedule().filter(function(j){
    var jTech = (j.techName || '').trim().toLowerCase();
    return jTech === techNameLower && j.active !== false;
  });
  var jobs = allMyJobs.filter(function(j){
    return j.date >= cutoff && !j.done;
  });
  // Sort by date, then time
  jobs.sort(function(a,b){
    if (a.date !== b.date) return a.date > b.date ? 1 : -1;
    return (a.time||'00:00') > (b.time||'00:00') ? 1 : -1;
  });

  var section = document.getElementById('homeJobsSection');
  var jobsList = document.getElementById('homeJobsList');
  var noJobs = document.getElementById('noJobsMsg');
  var firstName = tech.name.split(' ')[0];
  var lbl = document.getElementById('homeJobsLabel');
  if (lbl) lbl.textContent = jobs.length ? firstName + "'s Upcoming Jobs" : firstName + "'s Schedule";
  section.style.display = 'block';
  jobsList.innerHTML = '';

  if (!jobs.length) {
    // Check if there are past jobs (explains why nothing shows)
    var pastJobs = allMyJobs.filter(function(j){ return j.date < cutoff; });
    var doneJobs = allMyJobs.filter(function(j){ return j.done; });
    var nextJob = allMyJobs.filter(function(j){ return !j.done && j.date >= today; })
                            .sort(function(a,b){ return a.date > b.date ? 1 : -1; })[0];
    var msgEl = noJobs.querySelector('.msg');
    if (msgEl) {
      if (allMyJobs.length === 0) {
        msgEl.innerHTML = 'No jobs assigned yet.<br>Ask your supervisor to add jobs in the Schedule tab.';
      } else if (nextJob) {
        msgEl.innerHTML = 'Next job: <strong>' + nextJob.siteName + '</strong> on <strong>' + nextJob.date + '</strong>.<br>Schedule new jobs in the Schedule tab above.';
      } else {
        msgEl.innerHTML = 'All ' + allMyJobs.length + ' assigned job' + (allMyJobs.length!==1?'s are':' is') + ' in the past or marked done.<br>Ask your supervisor to schedule new jobs.';
      }
    }
    noJobs.style.display = 'block';
    return;
  }
  noJobs.style.display = 'none';

  jobs.forEach(function(job) {
    var card = el('div');
    card.style.cssText = 'background:var(--s2);border:1.5px solid var(--bd);border-radius:var(--rr);padding:14px 16px;margin-bottom:10px;cursor:pointer;transition:border-color 0.15s';
    card.onmouseenter = function(){ this.style.borderColor='var(--g)'; };
    card.onmouseleave = function(){ this.style.borderColor='var(--bd)'; };

    var top = el('div'); top.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:8px';
    var siteName = el('div');
    siteName.style.cssText = 'font-family:Barlow Condensed,sans-serif;font-size:18px;font-weight:700;color:var(--tx)';
    siteName.textContent = job.siteName;
    var badgeWrap = el('div'); badgeWrap.style.cssText = 'display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0';
    var dateBadge = el('span','badge b-nil'); dateBadge.style.cssText = 'font-size:11px;background:var(--g1);color:var(--g)';
    // Format date nicely: "Mon 30 Mar"
    try {
      var jd = new Date(job.date + 'T12:00:00');
      var isToday = job.date === today;
      dateBadge.textContent = isToday ? '📅 Today' : jd.toLocaleDateString('en-AU',{weekday:'short',day:'numeric',month:'short'});
      if (isToday) { dateBadge.style.background = '#dcfce7'; dateBadge.style.color = '#166534'; }
    } catch(e) { dateBadge.textContent = job.date; }
    var timeBadge = el('span','badge b-nil'); timeBadge.style.fontSize = '11px';
    timeBadge.textContent = job.time || 'Anytime';
    badgeWrap.appendChild(dateBadge); badgeWrap.appendChild(timeBadge);
    top.appendChild(siteName); top.appendChild(badgeWrap);

    var addr = el('div'); addr.style.cssText = 'font-size:12px;color:var(--mu);margin-top:3px'; addr.textContent = job.siteAddr || '';
    var notesDiv = el('div'); notesDiv.style.cssText = 'font-size:12px;color:var(--di);margin-top:2px'; notesDiv.textContent = job.notes || '';

    var footer = el('div'); footer.style.cssText = 'margin-top:10px;display:flex;gap:8px;flex-wrap:wrap';
    var openBtn = el('button','btn btn-p btn-sm'); openBtn.textContent = 'Open Report →';
    var dictBtn = el('button','btn btn-s btn-sm'); dictBtn.style.cssText = 'display:flex;align-items:center;gap:4px;background:var(--g);color:#1a2400;border:none'; dictBtn.innerHTML = '⚡ Quick Capture';
    var trendBtn = el('button','btn btn-s btn-sm'); trendBtn.innerHTML = '📊 Trends'; trendBtn.style.cssText = 'font-size:11px';
    var doneBtn = el('button','btn btn-s btn-sm'); doneBtn.textContent = job.done ? '✓ Done' : 'Mark Done';
    if (job.done) { doneBtn.style.color = 'var(--g)'; doneBtn.style.borderColor = 'var(--g)'; }
    footer.appendChild(openBtn); footer.appendChild(dictBtn); footer.appendChild(trendBtn); footer.appendChild(doneBtn);

    card.appendChild(top);
    if (job.siteAddr) card.appendChild(addr);
    if (job.notes) card.appendChild(notesDiv);
    card.appendChild(footer);

    (function(j){ 
      openBtn.addEventListener('click', function(e){ e.stopPropagation(); openJobReport(j); });
      dictBtn.addEventListener('click', function(e){ e.stopPropagation(); openDictateReport(j); });
      trendBtn.addEventListener('click', function(e){ e.stopPropagation(); showSiteHistory(j.siteName); });
      doneBtn.addEventListener('click', function(e){ e.stopPropagation(); markJobDone(String(j.id)); });
      card.addEventListener('click', function(){ openJobReport(j); });
    })(job);

    jobsList.appendChild(card);
  });
}

function openJobReport(job) {
  var techs = loadTechs();
  var tech = techs.find(function(t){ return t.name === job.techName; });
  var siteIdx = S.sites.findIndex(function(s){ return s.name === job.siteName; });

  // Pre-fill job setup
  if (siteIdx >= 0) {
    S.selectedSite = siteIdx;
  }
  document.getElementById('j-date').value = job.date;
  populateTechSelects();
  populateSchedDropdowns();
  if (tech) {
    var techVal = tech.name + (tech.lic ? ' Licence No. ' + tech.lic : '');
    document.getElementById('j-tech').value = techVal;
    var sel = document.getElementById('j-tech-sel');
    if (sel) sel.value = techVal;
  }
  if (job.notes) document.getElementById('j-num').value = job.notes;

  // Show steps bar and home button
  document.getElementById('stepsBar').style.display = 'flex';
  document.getElementById('homeBtn').style.display = 'inline-flex';
  var pb = document.getElementById('hdrProgress'); if (pb) pb.style.display = 'block';
  var pf = document.getElementById('hdrProgressFill'); if (pf) pf.style.width = '25%';

  // Go to screen 1 (job setup) with site pre-selected
  document.querySelectorAll('.scr').forEach(function(s){ s.classList.remove('on'); });
  document.querySelectorAll('.stp').forEach(function(s,i){
    s.classList.remove('on','dn');
    if (i === 0) s.classList.add('on');
  });
  document.getElementById('sc1').classList.add('on');
  S.currentScreen = 1;

  renderSiteList();
  window.scrollTo(0,0);
  toast('✓ ' + job.siteName + ' loaded');
}

function markJobDone(jobId) {
  var sched = loadSchedule();
  var job = sched.find(function(j){ return String(j.id) === String(jobId); });
  if (!job) { toast('⚠ Job not found'); return; }
  if (job) { job.done = !job.done; saveSchedule(sched); updateJobInCloud(job.id, {done: job.done}); }
  if (activeTechIdx !== null) showTechJobs(activeTechIdx);
  renderHomeStats();
}

// ============================================================
// src/screens/report.js
// ============================================================
// ============================================================
// REPORT BUILDER
// ============================================================
function buildReport() {
  var site = S.sites[S.selectedSite];
  if (!site) { toast('⚠ No site selected — please select a site first'); goScreen(1); return; }
  var tech = document.getElementById('j-tech').value.trim();
  var dateVal = document.getElementById('j-date').value;
  var jobNum = document.getElementById('j-num').value.trim();
  var comments = document.getElementById('svc-comments').value.trim();
  var extAct = document.getElementById('ext-activity').value;
  var intAct = document.getElementById('int-activity').value;
  var issuesRep = document.getElementById('issues-reported').value;
  var infest = document.getElementById('infestation').value;

  showGenOverlay('Building Report', 'Compiling your service data...');
  // Short delay so overlay renders before heavy DOM work
  setTimeout(function() { _doBuildReport(site, tech, dateVal, jobNum, comments, extAct, intAct, issuesRep, infest); }, 80);
}

function _doBuildReport(site, tech, dateVal, jobNum, comments, extAct, intAct, issuesRep, infest) {

  var dateStr = dateVal ? new Date(dateVal).toLocaleDateString('en-AU', {day:'2-digit',month:'short',year:'numeric'}) : new Date().toLocaleDateString('en-AU',{day:'2-digit',month:'short',year:'numeric'});
  var reportDateStr = new Date().toLocaleDateString('en-AU', {day:'2-digit',month:'short',year:'numeric'});
  var submissionId = Math.floor(10000000 + Math.random() * 90000000);

  // ── Store snapshot for trend/recs ──────────────────────────────────────
  window._lastReportData = {
    site: site, tech: tech, dateVal: dateVal, dateStr: dateStr,
    jobNum: jobNum, comments: comments,
    extAct: extAct, intAct: intAct, issuesRep: issuesRep, infest: infest
  };

  // ── Overall risk ───────────────────────────────────────────────────────
  var riskOrder = ['Nil','Low','Medium','High'];
  var riskIdx = Math.max(riskOrder.indexOf(extAct), riskOrder.indexOf(intAct));
  if (issuesRep === 'Yes' || infest === 'Yes') riskIdx = Math.max(riskIdx, 2);
  var risk = riskOrder[Math.max(0, riskIdx)] || 'Nil';
  var riskLabels = { 'Nil':'NIL ACTIVITY', 'Low':'LOW RISK', 'Medium':'ELEVATED RISK', 'High':'HIGH RISK' };
  var riskColors = { 'Nil':'#008350', 'Low':'#d97706', 'Medium':'#b45309', 'High':'#b91c1c' };
  var riskBgs    = { 'Nil':'#f0fdf4', 'Low':'#fffbeb', 'Medium':'#fff7ed', 'High':'#fef2f2' };
  var riskBorderColors = { 'Nil':'#86efac', 'Low':'#fcd34d', 'Medium':'#fb923c', 'High':'#f87171' };
  var riskColor  = riskColors[risk];
  var riskBg     = riskBgs[risk];
  var riskBorder = riskBorderColors[risk];

  // ── Severity helpers ───────────────────────────────────────────────────
  function sevStyle(v) {
    if (v==='High')   return 'font-weight:700;color:#b91c1c';
    if (v==='Medium') return 'font-weight:700;color:#b45309';
    if (v==='Low')    return 'font-weight:700;color:#d97706';
    return 'color:#008350;font-weight:600';
  }
  function sevBadge(v) {
    var col = v==='High'?'#b91c1c':v==='Medium'?'#b45309':v==='Low'?'#d97706':'#008350';
    var bg  = v==='High'?'#fee2e2':v==='Medium'?'#ffedd5':v==='Low'?'#fef3c7':'#dcfce7';
    return '<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-weight:700;font-size:10px;letter-spacing:0.5px;background:' + bg + ';color:' + col + '">' + (v||'Nil').toUpperCase() + '</span>';
  }

  // ── EcoSafe logo SVG ───────────────────────────────────────────────────
  var logoSVG = '<svg width="40" height="40" viewBox="0 0 28 28" fill="none">'
    + '<rect x="0" y="0" width="12" height="12" rx="2.5" fill="#B5DC17"/>'
    + '<rect x="14" y="0" width="12" height="12" rx="2.5" fill="#008350"/>'
    + '<rect x="0" y="14" width="12" height="12" rx="2.5" fill="#008350"/>'
    + '<rect x="14" y="14" width="12" height="12" rx="2.5" fill="#B5DC17"/>'
    + '</svg>';

  // ── Build HTML ─────────────────────────────────────────────────────────
  var D = '';

  D += '<style>';
  D += '@import url("https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&family=Barlow:wght@300;400;500;600&display=swap");';
  D += '*{box-sizing:border-box;margin:0;padding:0}';
  D += '.rpt{font-family:Barlow,Arial,sans-serif;color:#1f2937;font-size:11.5px;line-height:1.55}';

  // Header
  D += '.rpt-hdr{background:#005c38;padding:16px 20px;display:flex;justify-content:space-between;align-items:center;border-radius:8px 8px 0 0}';
  D += '.rpt-brand{font-family:Barlow Condensed,sans-serif;font-size:22px;font-weight:800;color:#fff;letter-spacing:-0.3px;line-height:1}';
  D += '.rpt-brand-sub{font-size:9px;font-weight:700;letter-spacing:2px;color:rgba(255,255,255,0.65);text-transform:uppercase;margin-top:2px}';
  D += '.rpt-contact{text-align:right;font-size:9.5px;color:rgba(255,255,255,0.75);line-height:1.8}';
  D += '.rpt-contact strong{color:#fff}';
  D += '.rpt-green-bar{height:4px;background:#B5DC17;margin-bottom:18px}';

  // Title
  D += '.rpt-doc-title{font-family:Barlow Condensed,sans-serif;font-size:20px;font-weight:800;color:#005c38;letter-spacing:0.2px;margin-bottom:2px}';
  D += '.rpt-doc-sub{font-size:12px;color:#6b7280;margin-bottom:16px}';

  // Section headers
  D += '.sec-hdr{background:#008350;color:#fff;padding:6px 12px;font-family:Barlow Condensed,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;border-radius:4px;margin:16px 0 8px}';

  // KV table
  D += '.kv{width:100%;border-collapse:collapse;margin-bottom:12px}';
  D += '.kv td{padding:5px 10px;border:1px solid #e5e7eb;font-size:11px;vertical-align:top}';
  D += '.kv td:first-child{font-weight:600;color:#6b7280;width:40%;background:#f9fafb;white-space:nowrap}';
  D += '.kv tr:nth-child(even) td{background:#f0fdf4}.kv tr:nth-child(even) td:first-child{background:#dcfce7}';

  // Inspection area cards
  D += '.area-card{border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;margin-bottom:12px}';
  D += '.area-hdr{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#f9fafb;border-bottom:1px solid #e5e7eb}';
  D += '.area-name{font-family:Barlow Condensed,sans-serif;font-size:14px;font-weight:700;color:#1f2937}';
  D += '.area-body{padding:0}';
  D += '.area-row{display:flex;border-bottom:1px solid #f3f4f6;font-size:11px}';
  D += '.area-row:last-child{border-bottom:none}';
  D += '.area-label{font-weight:700;color:#6b7280;padding:7px 10px;width:35%;flex-shrink:0;background:#fafafa;font-size:10.5px}';
  D += '.area-value{padding:7px 10px;flex:1;line-height:1.55}';

  // Station table
  D += '.stn-tbl{width:100%;border-collapse:collapse;font-size:11px;margin-bottom:4px}';
  D += '.stn-tbl th{background:#008350;color:#fff;padding:5px 8px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.3px}';
  D += '.stn-tbl td{padding:5px 8px;border-bottom:1px solid #e5e7eb}';
  D += '.stn-tbl tr:nth-child(even) td{background:#f9fafb}';
  D += '.stn-tbl tr:last-child td{border-bottom:none}';
  D += '.key-note{font-size:10px;color:#6b7280;padding:4px 8px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:4px;margin-top:4px}';

  // Recommendations table
  D += '.rec-tbl{width:100%;border-collapse:collapse;margin-bottom:12px}';
  D += '.rec-tbl th{background:#008350;color:#fff;padding:6px 10px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.3px}';
  D += '.rec-tbl th:first-child{width:32px;text-align:center}';
  D += '.rec-tbl th:last-child{width:70px;text-align:center}';
  D += '.rec-tbl td{padding:7px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;vertical-align:top;line-height:1.55}';
  D += '.rec-tbl tr:nth-child(even) td{background:#f9fafb}';
  D += '.rec-tbl td:first-child{font-weight:700;text-align:center;color:#005c38;font-size:13px}';
  D += '.rec-tbl td:last-child{text-align:center}';

  // Photo grid
  D += '.photo-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px}';
  D += '.photo-card{border:1px solid #e5e7eb;border-radius:6px;overflow:hidden}';
  D += '.photo-card img{width:100%;display:block;aspect-ratio:1;object-fit:cover}';
  D += '.photo-caption{font-size:10px;color:#6b7280;padding:5px 7px;background:#f9fafb;font-style:italic;border-top:1px solid #e5e7eb}';

  // Declaration
  D += '.decl-box{background:#f0fdf4;border:1px solid #86efac;border-radius:6px;padding:10px 14px;font-size:10.5px;color:#166534;line-height:1.65;font-style:italic;margin-bottom:12px}';

  // Footer
  D += '.rpt-footer{background:#005c38;padding:10px 16px;border-radius:4px;font-size:9px;color:rgba(255,255,255,0.8);text-align:center;letter-spacing:0.3px;margin-top:16px}';
  D += '</style>';

  D += '<div class="rpt">';

  // ── Header ─────────────────────────────────────────────────────────────
  D += '<div class="rpt-hdr">';
  D += '<div style="display:flex;align-items:center;gap:10px">' + logoSVG;
  D += '<div><div class="rpt-brand">ecosafe</div><div class="rpt-brand-sub">Pest Control</div></div></div>';
  D += '<div class="rpt-contact"><strong>EcoSafe Pest Control Pty Ltd</strong><br>Lic. No. A023509 &nbsp;|&nbsp; 1300 852 339<br>accounts@ecosafepestcontrol.com.au</div>';
  D += '</div>';
  D += '<div class="rpt-green-bar"></div>';

  // ── Title ──────────────────────────────────────────────────────────────
  D += '<div class="rpt-doc-title">PEST MANAGEMENT SERVICE REPORT</div>';
  D += '<div class="rpt-doc-sub">' + site.name + (dateStr ? '&nbsp;&nbsp;·&nbsp;&nbsp;' + dateStr : '') + '</div>';

  // ── Job Details ────────────────────────────────────────────────────────
  D += '<div class="sec-hdr">Job Details</div>';
  D += '<table class="kv">';
  D += '<tr><td>Client</td><td>' + site.name + (site.addr ? ' &mdash; ' + site.addr : '') + '</td></tr>';
  if (site.contact) D += '<tr><td>Site Contact</td><td>' + site.contact + (site.phone ? ' &nbsp;|&nbsp; ' + site.phone : '') + '</td></tr>';
  D += '<tr><td>Service Date</td><td>' + dateStr + '</td></tr>';
  D += '<tr><td>Report Date</td><td>' + reportDateStr + '</td></tr>';
  if (jobNum) D += '<tr><td>Job / Reference No.</td><td>' + jobNum + '</td></tr>';
  D += '<tr><td>Technician &amp; Licence No.</td><td>' + tech + '</td></tr>';
  D += '<tr><td>Service Type</td><td>' + (site.freq || 'Routine Pest Management') + '</td></tr>';
  D += '<tr><td>Submission ID</td><td>' + submissionId + '</td></tr>';
  D += '</table>';

  // ── Products in job details (like Museums Vic) ─────────────────────────
  var validProds = (S.products || []).filter(function(p){ return p.name; });
  if (validProds.length) {
    validProds.forEach(function(p) {
      D += '<table class="kv" style="margin-top:-10px">';
      D += '<tr><td>Product Used</td><td>' + p.name + (p.active ? ' &mdash; ' + p.active : '') + '</td></tr>';
      if (p.batch)  D += '<tr><td>Batch No.</td><td>' + p.batch + '</td></tr>';
      if (p.amount) D += '<tr><td>Amount Applied</td><td>' + p.amount + '</td></tr>';
      if (p.area)   D += '<tr><td>Area Applied</td><td>' + p.area + '</td></tr>';
      D += '</table>';
    });
  }

  // ── Overall Risk Assessment ────────────────────────────────────────────
  D += '<div class="sec-hdr">Overall Risk Assessment</div>';
  D += '<div style="border:2px solid ' + riskBorder + ';border-radius:6px;background:' + riskBg + ';padding:12px 14px;margin-bottom:12px">';
  D += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">';
  D += '<span style="background:' + riskColor + ';color:#fff;font-family:Barlow Condensed,sans-serif;font-size:12px;font-weight:700;padding:3px 12px;border-radius:12px;letter-spacing:0.5px">';
  if (risk === 'Medium') D += '⚠ ELEVATED RISK';
  else if (risk === 'High') D += '🔴 HIGH RISK';
  else if (risk === 'Low') D += '🟡 LOW RISK';
  else D += '✓ NIL ACTIVITY';
  D += '</span></div>';
  // Build risk narrative from data
  var riskLines = [];
  if (extAct !== 'Nil') riskLines.push('External rodent activity recorded as <strong>' + extAct + '</strong>.');
  if (intAct !== 'Nil') riskLines.push('Internal rodent activity recorded as <strong>' + intAct + '</strong>.');
  if (issuesRep === 'Yes') riskLines.push('Pest-related issues reported by client.');
  if (infest === 'Yes') riskLines.push('Signs of significant infestation detected.');
  if (comments && comments.length > 20) riskLines.push(comments.split('.')[0] + '.');
  if (!riskLines.length) riskLines.push('No significant pest activity detected at this service visit. All control devices checked, cleaned and replenished.');
  D += '<div style="font-size:11.5px;color:' + riskColor + ';line-height:1.65">' + riskLines.join('\\n') + '</div>';
  D += '</div>';

  // ── Inspection Observations ────────────────────────────────────────────
  D += '<div class="sec-hdr">Inspection Observations</div>';

  // Group stations for display
  var grpDefs = [
    { key:'ir',  label:'Internal Rodent Stations',               keyNote:'Key: Nil = 0 | Low = 1 rodent or &le;25% bait | Medium = 2 rodents or 26&ndash;50% | High = 3+ rodents or 51%+' },
    { key:'irt', label:'Internal Rodent Stations (Toxic)',        keyNote:'Key: Nil = 0 | Low = 1 rodent or &le;25% bait | Medium = 2 rodents or 26&ndash;50% | High = 3+ rodents or 51%+' },
    { key:'er',  label:'External Lockable Rodent Stations',       keyNote:'Key: Nil = 0 | Low = 1 rodent or &le;25% bait | Medium = 2 rodents or 26&ndash;50% | High = 3+ rodents or 51%+' },
    { key:'sp',  label:'Stored Product Pest Monitoring Devices',  keyNote:'Key: Nil = 0 | Low = 1&ndash;5 | Medium = 6&ndash;10 | High = 11+' },
    { key:'ilt', label:'Insect Light Traps',                      keyNote:'Key: Nil = 0 | Low = 1&ndash;50 catches | Medium = 51&ndash;100 | High = 100+' }
  ];

  var hasStations = false;
  grpDefs.forEach(function(g) {
    var stns = S.stations[g.key];
    if (!stns || !stns.length) return;
    hasStations = true;

    // Count activity
    var counts = { Nil:0, Low:0, Medium:0, High:0 };
    stns.forEach(function(s) {
      var v = g.key === 'ilt' ? (s.moths === 'High' || s.flies === 'High' || s.small === 'High' ? 'High' : s.moths === 'Medium' || s.flies === 'Medium' || s.small === 'Medium' ? 'Medium' : s.moths === 'Low' || s.flies === 'Low' || s.small === 'Low' ? 'Low' : 'Nil') : (s.val || 'Nil');
      if (counts[v] !== undefined) counts[v]++;
    });
    var activeCount = counts.Low + counts.Medium + counts.High;
    var overallActivity = counts.High > 0 ? 'High' : counts.Medium > 0 ? 'Medium' : counts.Low > 0 ? 'Low' : 'Nil';

    D += '<div class="area-card">';
    D += '<div class="area-hdr"><span class="area-name">' + g.label + '</span>' + sevBadge(overallActivity) + '</div>';
    D += '<div class="area-body">';

    // Station data table
    D += '<div style="padding:8px 10px">';
    if (g.key === 'ilt') {
      D += '<table class="stn-tbl"><thead><tr><th>#</th><th>Moths</th><th>Flies</th><th>Small Flying Insects</th></tr></thead><tbody>';
      stns.forEach(function(s) {
        D += '<tr><td style="font-weight:700">' + s.num + '</td>';
        D += '<td style="' + sevStyle(s.moths||'Nil') + '">' + (s.moths||'Nil') + '</td>';
        D += '<td style="' + sevStyle(s.flies||'Nil') + '">' + (s.flies||'Nil') + '</td>';
        D += '<td style="' + sevStyle(s.small||'Nil') + '">' + (s.small||'Nil') + '</td></tr>';
      });
      D += '</tbody></table>';
      if (S.stations.iltCatchChanged !== undefined) {
        D += '<div class="key-note">Catch papers changed this service: ' + (S.stations.iltCatchChanged ? 'Yes' : 'No') + '</div>';
      }
    } else {
      D += '<table class="stn-tbl"><thead><tr><th>#</th><th>Activity Level</th>' + (g.key === 'sp' ? '<th>Species Identified</th>' : '') + '</tr></thead><tbody>';
      stns.forEach(function(s) {
        D += '<tr><td style="font-weight:700">' + s.num + '</td>';
        D += '<td style="' + sevStyle(s.val||'Nil') + '">' + (s.val||'Nil') + '</td>';
        if (g.key === 'sp') D += '<td>' + (s.species || '&mdash;') + '</td>';
        D += '</tr>';
      });
      D += '</tbody></table>';
    }
    D += '<div class="key-note">' + g.keyNote + '</div>';

    // Activity summary row
    if (activeCount > 0) {
      D += '<div style="margin-top:8px;font-size:11px;line-height:1.6;color:#374151;padding:6px 8px;background:#fffbeb;border-radius:4px;border:1px solid #fcd34d">';
      D += '<strong>' + activeCount + ' of ' + stns.length + ' station' + (stns.length > 1 ? 's' : '') + '</strong> recorded activity at this service visit.';
      if (counts.High)   D += ' <strong style="color:#b91c1c">' + counts.High + ' High</strong>';
      if (counts.Medium) D += ' <strong style="color:#b45309">' + counts.Medium + ' Medium</strong>';
      if (counts.Low)    D += ' <strong style="color:#d97706">' + counts.Low + ' Low</strong>';
      D += '</div>';
    } else {
      D += '<div style="margin-top:8px;font-size:11px;color:#008350;padding:5px 8px;background:#f0fdf4;border-radius:4px;border:1px solid #86efac">All stations recorded Nil activity at this service visit.</div>';
    }
    D += '</div>';
    D += '</div></div>';
  });

  if (!hasStations) {
    D += '<div style="color:#6b7280;font-size:12px;padding:10px;background:#f9fafb;border-radius:6px;border:1px solid #e5e7eb">No station data recorded for this visit.</div>';
  }

  // ── Technician Comments ────────────────────────────────────────────────
  if (comments) {
    D += '<div class="sec-hdr">Technician Observations</div>';
    D += '<div style="background:#f9fafb;border:1px solid #e5e7eb;border-left:3px solid #B5DC17;border-radius:4px;padding:10px 14px;font-size:11.5px;line-height:1.7;color:#374151">' + comments.replace(/\n/g,'<br>') + '</div>';
  }

  // ── Photos ─────────────────────────────────────────────────────────────
  if (S_photos && S_photos.length) {
    D += '<div class="sec-hdr">Photographic Evidence</div>';
    D += '<p style="font-size:11px;color:#6b7280;margin-bottom:10px;font-style:italic">The following photographs were captured during the service visit and support the observations and recommendations detailed in this report.</p>';
    D += buildPhotoSectionHTML();
  }

  // ── Service Summary placeholder ────────────────────────────────────────
  D += '<div id="rpt-trend"></div>';

  // ── Recommendations placeholder (filled by AI) ─────────────────────────
  D += '<div id="rpt-recs"></div>';

  // ── Technician Declaration ─────────────────────────────────────────────
  D += '<div class="sec-hdr">Technician Declaration</div>';
  D += '<table class="kv" style="margin-bottom:10px">';
  D += '<tr><td>Submitted By</td><td>' + tech + '</td></tr>';
  D += '<tr><td>Service Date</td><td>' + dateStr + '</td></tr>';
  D += '<tr><td>Report Date</td><td>' + reportDateStr + '</td></tr>';
  D += '<tr><td>Submission ID</td><td>' + submissionId + '</td></tr>';
  D += '</table>';
  D += '<div class="decl-box">I declare that the information contained in this service report is true and accurate to the best of my knowledge, and that all pest management activities were conducted in accordance with the relevant Australian Standards, the Pest Management Act, and the product label requirements for all chemicals applied.</div>';

  // ── Footer ─────────────────────────────────────────────────────────────
  D += '<div class="rpt-footer">For service enquiries, additional treatments, or to discuss these findings, please contact EcoSafe Pest Control on <strong>1300 852 339</strong> or email <strong>accounts@ecosafepestcontrol.com.au</strong></div>';
  D += '</div>';

  document.getElementById('reportDoc').innerHTML = D;
  hideGenOverlay();
  goScreen(4);

  // ── Save snapshot to cloud ─────────────────────────────────────────────
  var reportSnapshot = {
    _localId: 'lr_'+Date.now()+'_'+Math.random().toString(36).slice(2,6),
    site_name: site.name, site_id: site.id || null,
    tech: tech, date: dateVal || new Date().toISOString().slice(0,10),
    job_num: jobNum, ext_act: extAct, int_act: intAct,
    issues: issuesRep, infest: infest, comments: comments,
    stations: JSON.parse(JSON.stringify(S.stations)),
    products: JSON.parse(JSON.stringify(S.products))
  };
  saveReportToCloud(reportSnapshot).catch(function(e){ console.warn('saveReportToCloud failed:', e); });
  if (typeof invalidateSiteMemoryCache === 'function' && site) invalidateSiteMemoryCache(site.name);

  // ── AI recommendations + trend analysis ───────────────────────────────
  var _apiKey = getApiKey();
  loadReportHistory(site.name, 10).then(function(history) {
    generateRecs(site, extAct, intAct, issuesRep, infest, comments).catch(function(e) {
      console.warn('generateRecs failed:', e);
      var re = document.getElementById('rpt-recs');
      if (re) re.innerHTML = ruleBasedRecs(site, extAct, intAct, issuesRep, infest, comments);
    });
    if (history && history.length >= 2) {
      generateTrendAnalysis(site, reportSnapshot, history).catch(function(e) {
        console.warn('generateTrendAnalysis failed:', e);
      });
    }
  }).catch(function() {
    generateRecs(site, extAct, intAct, issuesRep, infest, comments).catch(function(e) {
      console.warn('generateRecs failed:', e);
      var re = document.getElementById('rpt-recs');
      if (re) re.innerHTML = ruleBasedRecs(site, extAct, intAct, issuesRep, infest, comments);
    });
  });
  analyseAllPhotos(_apiKey).catch(function(e){ console.warn('Photo analysis failed:', e); });
}


function sevClass(v) {
  if (v==='Low') return 'low-cell';
  if (v==='Medium') return 'med-cell';
  if (v==='High') return 'high-cell';
  return 'nil-cell';
}

// ============================================================
// src/features/quick-capture.js
// ============================================================
// ============================================================
// QUICK CAPTURE — 3-tab overlay (Dictate / Photos / Review)
// ============================================================
var _dictJob        = null;
var _dictRecognition = null;
var _dictActive     = false;
var _dictFinalText  = '';
var _dictParsedData = null;
var _qcPhotos       = [];   // [{dataUrl, name, caption}]

// ── Tab switching ───────────────────────────────────────────
function showQCTab(tab) {
  ['voice','photos','review'].forEach(function(t) {
    var btn   = document.getElementById('qc-tab-' + t);
    var panel = document.getElementById('qc-panel-' + t);
    var active = t === tab;
    if (btn)   { btn.style.background = active ? 'var(--g)' : 'transparent'; btn.style.color = active ? '#1a2400' : 'var(--mu)'; }
    if (panel) { panel.style.display  = active ? 'flex'    : 'none'; }
  });
}

// ── Open / close ────────────────────────────────────────────
function openDictateReport(job) {
  _dictJob        = job;
  _dictFinalText  = '';
  _dictParsedData = null;
  _qcPhotos       = [];

  // Reset voice tab
  document.getElementById('dictateTranscript').innerHTML = '<span style="color:var(--di)">Your speech will appear here...</span>';
  document.getElementById('dictStartBtn').style.display = '';
  document.getElementById('dictStopBtn').style.display  = 'none';
  setDictStatus('ready');

  // Reset photo tab
  renderQCPhotoList();

  // Reset review tab
  document.getElementById('qcReviewContent').innerHTML = '<div style="color:var(--di);font-size:13px;text-align:center;padding:20px">Tap Parse &amp; Review on the Dictate tab to begin.</div>';
  document.getElementById('qcReviewStatus').style.background = '#f0faf0';
  document.getElementById('qcReviewStatus').style.borderColor = '#c8e0b0';
  document.getElementById('qcReviewStatus').style.color = '#008350';
  document.getElementById('qcReviewStatus').textContent = 'Review the extracted data below, then tap Generate Report.';
  var gb = document.getElementById('qcGenerateBtn'); if (gb) gb.style.display = 'none';

  // Set site label
  var lbl = document.getElementById('qcSiteLabel');
  if (lbl) lbl.textContent = job ? job.siteName + (job.date ? '  ·  ' + formatDate(job.date) : '') : '';

  showQCTab('voice');
  document.getElementById('dictateOverlay').classList.add('show');

  // Load site memory in background — show recurring patterns
  if (job && job.siteName) {
    var memCard = document.getElementById('qcMemoryCard');
    if (memCard) {
      memCard.style.display = 'block';
      memCard.innerHTML = '<div style="font-size:11px;color:var(--mu);font-style:italic">Loading site history…</div>';
      loadSiteMemory(job.siteName).then(function(lines) {
        if (!memCard) return;
        if (!lines || !lines.length) { memCard.style.display = 'none'; return; }
        memCard.innerHTML = '<div style="font-size:10px;font-weight:700;text-transform:uppercase;'
          + 'letter-spacing:0.8px;color:var(--gd);margin-bottom:4px">⚡ Site Memory — ' + job.siteName + '</div>'
          + lines.map(function(l){ return '<div style="font-size:11px;color:var(--tx);padding:2px 0;'
            + 'border-bottom:1px solid var(--bd);line-height:1.4">• ' + l + '</div>'; }).join('');
      }).catch(function(){ if (memCard) memCard.style.display = 'none'; });
    }
  }
}

function closeDictateOverlay() {
  stopDictation();
  document.getElementById('dictateOverlay').classList.remove('show');
}

// ── Status box ──────────────────────────────────────────────
function setDictStatus(state) {
  var box = document.getElementById('dictateStatusBox');
  if (!box) return;
  if (state === 'ready') {
    box.style.background = '#f0faf0'; box.style.borderColor = '#c8e0b0'; box.style.color = '#008350';
    box.innerHTML = '<strong>Speak everything in one go.</strong> Station readings, products, conducive conditions, and observations. AI will extract and structure it all.<br><span style="font-size:11px;color:#555;font-style:italic">"E1 nil, E2 high, I1 low. Ditrac batch 1234, 150g external. Gap under rear door, fresh gnaw marks near E2."</span>';
  } else if (state === 'recording') {
    box.style.background = '#fdf0f0'; box.style.borderColor = '#f5c6c6'; box.style.color = '#c0392b';
    box.innerHTML = '\uD83D\uDD34 <strong>Recording\u2026</strong> Speak clearly. Include station IDs, activity levels, products used, and any observations. Tap \u23F9 Stop when done.';
  } else if (state === 'parsing') {
    box.style.background = '#f0f4ff'; box.style.borderColor = '#c0cff5'; box.style.color = '#1a3a7a';
    box.innerHTML = '\uD83D\uDD0D <strong>Parsing with AI\u2026</strong> Extracting all data from your note.';
  }
}

// ── Voice recording ─────────────────────────────────────────
function startDictation() {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    toast('\u26A0 Voice not supported \u2014 use Safari on iPhone or Chrome on Android.'); return;
  }
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  _dictRecognition = new SR();
  _dictRecognition.lang = 'en-AU';
  _dictRecognition.continuous = false;
  _dictRecognition.interimResults = true;
  _dictActive = true;

  document.getElementById('dictStartBtn').style.display = 'none';
  document.getElementById('dictStopBtn').style.display  = '';
  setDictStatus('recording');

  var baseText = _dictFinalText;
  _dictRecognition.onresult = function(event) {
    var interim = '', finalNew = '';
    for (var i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) finalNew += event.results[i][0].transcript + ' ';
      else interim += event.results[i][0].transcript;
    }
    if (finalNew) baseText = baseText + finalNew;
    _dictFinalText = baseText;
    document.getElementById('dictateTranscript').innerHTML =
      (baseText + (interim ? '<em style="color:var(--di)">' + interim + '</em>' : '')) ||
      '<span style="color:var(--di)">Listening\u2026</span>';
  };
  _dictRecognition.onerror = function(e) {
    if (e.error === 'not-allowed') toast('\u26A0 Microphone blocked \u2014 check browser permissions.');
    else if (e.error !== 'no-speech' && e.error !== 'aborted') toast('\u26A0 Voice error: ' + e.error);
    stopDictation();
  };
  _dictRecognition.onend = function() {
    if (_dictActive) { try { _dictRecognition.start(); } catch(e) { stopDictation(); } }
  };
  try { _dictRecognition.start(); } catch(e) {
    toast('\u26A0 Could not start microphone: ' + e.message);
    stopDictation();
  }
}

function stopDictation() {
  _dictActive = false;
  if (_dictRecognition) { try { _dictRecognition.stop(); } catch(e) {} _dictRecognition = null; }
  var sb = document.getElementById('dictStartBtn'); if (sb) sb.style.display = '';
  var st = document.getElementById('dictStopBtn');  if (st) st.style.display = 'none';
  if (_dictFinalText.trim()) setDictStatus('ready');
}

function clearDictation() {
  stopDictation();
  _dictFinalText = '';
  document.getElementById('dictateTranscript').innerHTML = '<span style="color:var(--di)">Your speech will appear here...</span>';
  setDictStatus('ready');
}

// ── Photo management ─────────────────────────────────────────
function addQCPhoto(input) {
  if (!input.files || !input.files.length) return;
  Array.from(input.files).forEach(function(file) {
    var reader = new FileReader();
    reader.onload = function(e) {
      _qcPhotos.push({ dataUrl: e.target.result, name: file.name, caption: '' });
      renderQCPhotoList();
    };
    reader.readAsDataURL(file);
  });
  input.value = '';
}

function renderQCPhotoList() {
  var list = document.getElementById('qcPhotoList');
  if (!list) return;
  if (!_qcPhotos.length) {
    list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--di);font-size:13px;border:2px dashed var(--bd);border-radius:var(--rr)">No photos yet \u2014 tap Add Photos</div>';
    return;
  }
  list.innerHTML = '';
  _qcPhotos.forEach(function(p, i) {
    var card = el('div');
    card.style.cssText = 'display:flex;gap:10px;background:var(--s2);border:1.5px solid var(--bd);border-radius:var(--rr);padding:10px;margin-bottom:8px;align-items:flex-start';
    var img = el('img');
    img.src = p.dataUrl;
    img.style.cssText = 'width:72px;height:72px;object-fit:cover;border-radius:6px;flex-shrink:0';
    var right = el('div'); right.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:6px';
    var inp = el('input');
    inp.type = 'text';
    inp.placeholder = 'Describe condition (e.g. gap under rear door, fresh gnaw marks)';
    inp.value = p.caption || '';
    inp.style.cssText = 'width:100%;background:var(--s3);border:1px solid var(--bd);border-radius:6px;color:var(--tx);font-size:12px;padding:6px 8px';
    (function(idx){ inp.addEventListener('input', function(){ _qcPhotos[idx].caption = this.value; }); })(i);
    var rm = el('button','btn btn-d btn-xs btn'); rm.textContent = '\u2715 Remove';
    rm.style.cssText = 'align-self:flex-start;font-size:11px';
    (function(idx){ rm.addEventListener('click', function(){ _qcPhotos.splice(idx,1); renderQCPhotoList(); }); })(i);
    right.appendChild(inp); right.appendChild(rm);
    card.appendChild(img); card.appendChild(right);
    list.appendChild(card);
  });
}

// ── Parse & switch to review ─────────────────────────────────
async function runQCParse() {
  if (_dictActive) stopDictation();
  var transcript = _dictFinalText.trim();
  if (!transcript && !_qcPhotos.length) {
    toast('\u26A0 Add a voice note or photos first'); return;
  }

  var apiKey = getApiKey();
  if (!apiKey) {
    toast('\u26A0 No API key \u2014 go to \u2699 Schedule \u2192 AI Key tab');
    showQCTab('review');
    document.getElementById('qcReviewStatus').textContent = '\uD83D\uDD11 API key required \u2014 set it in \u2699 Schedule \u2192 AI Key tab.';
    document.getElementById('qcReviewStatus').style.background = '#fff8e0';
    document.getElementById('qcReviewStatus').style.borderColor = '#f5d878';
    document.getElementById('qcReviewStatus').style.color = '#7a5a10';
    return;
  }

  // Switch to review tab and show spinner
  showQCTab('review');
  document.getElementById('qcReviewStatus').style.background = '#f0f4ff';
  document.getElementById('qcReviewStatus').style.borderColor = '#c0cff5';
  document.getElementById('qcReviewStatus').style.color = '#1a3a7a';
  document.getElementById('qcReviewStatus').textContent = '\uD83D\uDD0D Parsing with AI\u2026 extracting all data from your note.';
  document.getElementById('qcReviewContent').innerHTML = '<div style="text-align:center;padding:24px"><div style="width:32px;height:32px;border:3px solid var(--bd);border-top-color:var(--g);border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 10px"></div><div style="font-size:12px;color:var(--mu)">Analysing your note\u2026</div></div>';
  var gb = document.getElementById('qcGenerateBtn'); if (gb) gb.style.display = 'none';

  // Build site context
  var job = _dictJob;
  var site = job ? S.sites.find(function(s){ return s.name === job.siteName; }) : null;
  var siteCtx = '';
  if (site) {
    var parts = [];
    GROUPS.forEach(function(g) { var c = site[g.sfKey]||0; if(c) parts.push(c + ' ' + g.label + ' (key:' + g.key + ', numbered 1-' + c + ')'); });
    siteCtx = parts.join('; ');
  }
  // Add photo captions to context
  var photoCaptions = _qcPhotos.filter(function(p){ return p.caption; }).map(function(p){ return p.caption; });

  var prompt = [
    'You are parsing a pest control field note for a commercial pest management company in Australia.',
    'Extract ALL information and return ONLY valid JSON \u2014 no markdown, no extra text.',
    '',
    'SITE: ' + (job ? job.siteName : 'Unknown') + (siteCtx ? ' | Stations: ' + siteCtx : ''),
    'TECHNICIAN NOTE: "' + (transcript || '(no verbal note \u2014 see photo captions)') + '"',
    photoCaptions.length ? 'PHOTO CAPTIONS: ' + photoCaptions.join('; ') : '',
    '',
    'Return this exact JSON:',
    '{',
    '  "ext_act": "Nil|Low|Medium|High",',
    '  "int_act": "Nil|Low|Medium|High",',
    '  "issues": "Yes|No",',
    '  "infest": "Yes|No",',
    '  "job_num": "string or null",',
    '  "comments": "polished professional summary of all observations for the report",',
    '  "stations": {',
    '    "ir":  [{"num":1,"val":"Nil|Low|Medium|High"}],',
    '    "irt": [{"num":1,"val":"Nil|Low|Medium|High"}],',
    '    "er":  [{"num":1,"val":"Nil|Low|Medium|High"}],',
    '    "sp":  [{"num":1,"val":"Nil|Low|Medium|High","species":"string or null"}],',
    '    "ilt": [{"num":1,"moths":"Nil|Low|Medium|High","flies":"Nil|Low|Medium|High","small":"Nil|Low|Medium|High"}]',
    '  },',
    '  "products": [{"name":"string","active":"string or empty","batch":"string or empty","amount":"string or empty","area":"string or empty"}],',
    '  "conducive_conditions": ["description of each conducive condition observed"],',
    '  "confidence": "high|medium|low",',
    '  "notes": "any assumptions made or unclear items"',
    '}',
    'Rules:',
    '- E/ext/external = er | I/int/internal = ir | IT/toxic/IRT = irt | SPP = sp | ILT = ilt',
    '- "all nil" or "all clear" = every station in that group is Nil',
    '- Infer ext_act and int_act from station data if not stated',
    '- comments = polished professional report language rewritten from raw field notes',
    '- Include conducive_conditions as a separate array even if mentioned in comments',
    '- Return ONLY the JSON object'
  ].filter(Boolean).join('\n');

  try {
    var resp = await fetch('https://api.anthropic.com/v1/messages', {
      signal: AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var data = await resp.json();
    var raw = data.content[0].text.trim().replace(/^```[a-z]*\n?/, '').replace(/```$/, '').trim();
    _dictParsedData = JSON.parse(raw);

    renderQCReview(_dictParsedData);
    document.getElementById('qcReviewStatus').style.background = '#f0faf0';
    document.getElementById('qcReviewStatus').style.borderColor = '#c8e0b0';
    document.getElementById('qcReviewStatus').style.color = '#008350';
    document.getElementById('qcReviewStatus').textContent = '\u2713 Parsed successfully \u2014 review below then tap Generate Report.';
    var gb2 = document.getElementById('qcGenerateBtn'); if (gb2) gb2.style.display = '';

  } catch(err) {
    console.warn('runQCParse failed:', err);
    var errMsg = err.message || String(err);
    if (errMsg.indexOf('401') >= 0) errMsg = 'API key invalid (401) \u2014 update it in \u2699 Schedule \u2192 AI Key tab.';
    else if (errMsg.indexOf('429') >= 0) errMsg = 'Rate limit \u2014 wait a moment and try again.';
    document.getElementById('qcReviewStatus').style.background = '#fff8e0';
    document.getElementById('qcReviewStatus').style.borderColor = '#f5d878';
    document.getElementById('qcReviewStatus').style.color = '#7a5a10';
    document.getElementById('qcReviewStatus').textContent = '\u26A0 ' + errMsg;
    document.getElementById('qcReviewContent').innerHTML = '<div style="color:#c0392b;font-size:12px;padding:8px">' + errMsg + '</div>';
  }
}

// ── Render review panel ──────────────────────────────────────
function renderQCReview(p) {
  var sev = function(v) {
    var c = v==='High'?'#b91c1c':v==='Medium'?'#b45309':v==='Low'?'#d97706':'#008350';
    var b = v==='High'?'#fee2e2':v==='Medium'?'#ffedd5':v==='Low'?'#fef3c7':'#dcfce7';
    return '<span style="display:inline-block;padding:1px 8px;border-radius:10px;font-weight:700;font-size:11px;background:' + b + ';color:' + c + '">' + (v||'Nil') + '</span>';
  };
  var row = function(label, val) {
    return '<div style="display:flex;justify-content:space-between;align-items:flex-start;padding:5px 0;border-bottom:1px solid var(--bd);font-size:12px;gap:8px"><span style="color:var(--mu);flex-shrink:0">' + label + '</span><span style="text-align:right">' + val + '</span></div>';
  };

  var html = '';

  // Activity summary
  html += '<div style="background:var(--s3);border-radius:8px;padding:10px 12px;margin-bottom:10px">';
  if (p.ext_act) html += row('External Activity', sev(p.ext_act));
  if (p.int_act) html += row('Internal Activity', sev(p.int_act));
  if (p.issues)  html += row('Issues Reported', p.issues);
  if (p.infest)  html += row('Infestation', p.infest);
  if (p.job_num) html += row('Job No.', p.job_num);
  html += '</div>';

  // Stations
  var stns = p.stations || {};
  var grpLabels = {ir:'Int. Rodent',irt:'Int. Toxic',er:'Ext. Rodent',sp:'SPP',ilt:'ILT'};
  var stnHTML = '';
  Object.keys(stns).forEach(function(key) {
    var arr = stns[key]; if (!arr || !arr.length) return;
    arr.forEach(function(s) {
      var v = key === 'ilt' ? (s.moths||'Nil') : (s.val||'Nil');
      var prefix = {ir:'I',irt:'IT',er:'E',sp:'S',ilt:'ILT'}[key]||key;
      stnHTML += '<span style="display:inline-block;margin:2px 3px;padding:2px 8px;background:var(--s3);border:1px solid var(--bd);border-radius:6px;font-size:11px">' +
        '<strong>' + prefix + s.num + '</strong> ' + sev(v) + '</span>';
    });
  });
  if (stnHTML) {
    html += '<div style="margin-bottom:10px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:var(--mu);margin-bottom:6px">Stations</div>' + stnHTML + '</div>';
  }

  // Products
  if (p.products && p.products.length) {
    html += '<div style="margin-bottom:10px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:var(--mu);margin-bottom:6px">Products</div>';
    p.products.filter(function(pr){ return pr.name; }).forEach(function(pr) {
      html += '<div style="font-size:12px;padding:4px 0;border-bottom:1px solid var(--bd)">';
      html += '<strong>' + pr.name + '</strong>';
      if (pr.active) html += ' <span style="color:var(--mu)">(' + pr.active + ')</span>';
      if (pr.batch)  html += ' &middot; Batch: ' + pr.batch;
      if (pr.amount) html += ' &middot; ' + pr.amount;
      html += '</div>';
    });
    html += '</div>';
  }

  // Conducive conditions
  if (p.conducive_conditions && p.conducive_conditions.length) {
    html += '<div style="margin-bottom:10px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:var(--mu);margin-bottom:6px">Conducive Conditions</div>';
    p.conducive_conditions.forEach(function(c) {
      html += '<div style="font-size:12px;padding:4px 8px;margin-bottom:4px;background:#fff8e0;border:1px solid #fcd34d;border-radius:4px">\uD83D\uDCCB ' + c + '</div>';
    });
    html += '</div>';
  }

  // Comments
  if (p.comments) {
    html += '<div style="margin-bottom:10px"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:var(--mu);margin-bottom:6px">Service Comments</div>';
    html += '<div style="font-size:12px;color:var(--tx);background:var(--s3);border-radius:6px;padding:8px 10px;line-height:1.6;font-style:italic">"' + p.comments + '"</div>';
    html += '</div>';
  }

  // Photos count
  if (_qcPhotos.length) {
    html += '<div style="font-size:12px;color:var(--gd);padding:6px 8px;background:#f0fdf4;border-radius:6px;border:1px solid #86efac">';
    html += '\uD83D\uDCF7 ' + _qcPhotos.length + ' photo' + (_qcPhotos.length > 1 ? 's' : '') + ' will be included in the report with AI analysis.';
    html += '</div>';
  }

  // Confidence
  if (p.confidence) {
    var cc = p.confidence === 'high' ? '#008350' : p.confidence === 'medium' ? '#d97706' : '#b91c1c';
    html += '<div style="margin-top:8px;font-size:11px;color:' + cc + ';font-weight:700">Parse confidence: ' + p.confidence.toUpperCase() + (p.notes ? ' \u00B7 ' + p.notes : '') + '</div>';
  }

  document.getElementById('qcReviewContent').innerHTML = html;
}

// ── Apply parsed data and generate report ────────────────────
function applyDictationToReport() {
  if (!_dictParsedData) { toast('\u26A0 No parsed data \u2014 go back and parse first.'); return; }
  var p   = _dictParsedData;
  var job = _dictJob;

  // Set up site/tech/date
  if (job) {
    var siteIdx = S.sites.findIndex(function(s){ return s.name === job.siteName; });
    if (siteIdx >= 0) S.selectedSite = siteIdx;
    document.getElementById('j-date').value = job.date || new Date().toISOString().slice(0,10);
    populateTechSelects();
    var techs = loadTechs();
    var tech = techs.find(function(t){ return t.name === job.techName; });
    if (tech) {
      var techVal = tech.name + (tech.lic ? ' Licence No. ' + tech.lic : '');
      document.getElementById('j-tech').value = techVal;
      var sel = document.getElementById('j-tech-sel');
      if (sel) sel.value = techVal;
    }
  }

  // Initialise stations — if site not in S.sites, add it temporarily
  if (S.selectedSite === null || S.selectedSite === undefined) {
    if (job && job.siteName) {
      // Site wasn't found — create a temporary entry so report still generates
      var tempSite = {
        name: job.siteName, addr: job.siteAddr || '',
        tech: job.techName || '', ir: 2, er: 2, irt: 0, sp: 0, ilt: 0
      };
      S.sites.push(tempSite);
      S.selectedSite = S.sites.length - 1;
      toast('⚠ Site not in list — generating with job details');
    } else {
      toast('⚠ No site selected — please open a job first');
      return;
    }
  }
  buildStations();

  if (p.job_num) { var jn = document.getElementById('j-num'); if(jn) jn.value = p.job_num; }

  var stns = p.stations || {};
  Object.keys(stns).forEach(function(key) {
    var arr = stns[key];
    if (!arr || !arr.length || !S.stations[key] || !S.stations[key].length) return;
    arr.forEach(function(dictStn) {
      var idx = dictStn.num - 1;
      if (idx < 0 || idx >= S.stations[key].length) return;
      if (key === 'ilt') {
        if (dictStn.moths) S.stations[key][idx].moths = dictStn.moths;
        if (dictStn.flies) S.stations[key][idx].flies = dictStn.flies;
        if (dictStn.small) S.stations[key][idx].small = dictStn.small;
      } else {
        if (dictStn.val) S.stations[key][idx].val = dictStn.val;
        if (dictStn.species) S.stations[key][idx].species = dictStn.species;
      }
    });
  });

  // Apply sc3 fields
  if (p.ext_act)  { var ea  = document.getElementById('ext-activity');    if(ea)  ea.value  = p.ext_act; }
  if (p.int_act)  { var ia  = document.getElementById('int-activity');    if(ia)  ia.value  = p.int_act; }
  if (p.issues)   { var isr = document.getElementById('issues-reported'); if(isr) isr.value = p.issues; }
  if (p.infest)   { var inf = document.getElementById('infestation');     if(inf) inf.value = p.infest; }

  // Build comments — combine parsed comments with conducive conditions
  var commentsText = p.comments || '';
  if (p.conducive_conditions && p.conducive_conditions.length) {
    var condText = 'Conducive conditions observed: ' + p.conducive_conditions.join('; ') + '.';
    commentsText = commentsText ? commentsText + ' ' + condText : condText;
  }
  if (commentsText) { var sc = document.getElementById('svc-comments'); if(sc) sc.value = commentsText; }

  // Apply products
  if (p.products && p.products.length) {
    S.products = p.products.filter(function(pr){ return pr.name; }).map(function(pr) {
      return { name: pr.name||'', active: pr.active||'', batch: pr.batch||'', amount: pr.amount||'', reason: '', area: pr.area||'' };
    });
    renderProducts();
  }

  // Transfer QC photos to S_photos for the report
  if (_qcPhotos.length) {
    S_photos = _qcPhotos.map(function(ph) {
      return { name: ph.name || 'photo', dataUrl: ph.dataUrl, description: ph.caption || '' };
    });
  }

  closeDictateOverlay();

  // Show steps bar and go straight to buildReport (skip manual screens)
  document.getElementById('stepsBar').style.display = 'flex';
  document.getElementById('homeBtn').style.display  = 'inline-flex';
  var pb = document.getElementById('hdrProgress'); if (pb) pb.style.display = 'block';
  renderSiteList();
  renderStations();

  // Generate directly
  showGenOverlay('Building Report', 'AI is generating your report\u2026');
  setTimeout(function() {
    try {
      var site   = S.sites[S.selectedSite];
      var tech   = document.getElementById('j-tech').value.trim();
      var dateV  = document.getElementById('j-date').value;
      var jobNum = document.getElementById('j-num').value.trim();
      var cmts   = document.getElementById('svc-comments').value.trim();
      var extA   = document.getElementById('ext-activity').value;
      var intA   = document.getElementById('int-activity').value;
      var issR   = document.getElementById('issues-reported').value;
      var infV   = document.getElementById('infestation').value;
      _doBuildReport(site, tech, dateV, jobNum, cmts, extA, intA, issR, infV);
    } catch(err) {
      hideGenOverlay();
      var errMsg = err.message || String(err);
      showSyncBanner('\u26A0 Report generation failed: ' + errMsg, true);
      console.error('_doBuildReport failed:', err);
    }
  }, 200);
}

document.getElementById('dictateOverlay').addEventListener('click', function(e){
  if (e.target === this) closeDictateOverlay();
});

// ============================================================
// VOICE TO TEXT
// ============================================================
var _voiceRecognition = null;
var _voiceActive = false;

function isSpeechSupported() {
  return ('webkitSpeechRecognition' in window) || ('SpeechRecognition' in window);
}

function toggleVoice(targetId, btnId, labelId, statusId) {
  if (!isSpeechSupported()) {
    toast('⚠ Voice not supported. Use Safari on iPhone or Chrome on Android.');
    return;
  }
  if (_voiceActive) {
    stopVoice(btnId, labelId, statusId);
  } else {
    startVoice(targetId, btnId, labelId, statusId);
  }
}

function startVoice(targetId, btnId, labelId, statusId) {
  var SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  _voiceRecognition = new SpeechRecognition();
  _voiceRecognition.lang = 'en-AU';
  _voiceRecognition.continuous = false;   // iOS Safari: false + auto-restart is more reliable
  _voiceRecognition.interimResults = true;

  var target = document.getElementById(targetId);
  var btn = document.getElementById(btnId);
  var lbl = document.getElementById(labelId);
  var status = document.getElementById(statusId);
  var baseText = target.value;
  var interimSpan = '';

  _voiceActive = true;
  if (btn) btn.style.background = '#fde8e8';
  if (btn) btn.style.borderColor = '#c0392b';
  if (lbl) lbl.textContent = '⏹ Stop';
  if (status) status.style.display = 'block';

  _voiceRecognition.onresult = function(event) {
    var interim = '';
    var final = '';
    for (var i = event.resultIndex; i < event.results.length; i++) {
      if (event.results[i].isFinal) {
        final += event.results[i][0].transcript;
      } else {
        interim += event.results[i][0].transcript;
      }
    }
    if (final) {
      baseText = baseText + (baseText && !baseText.endsWith(' ') ? ' ' : '') + final;
    }
    target.value = baseText + (interim ? ' ' + interim : '');
  };

  _voiceRecognition.onerror = function(event) {
    console.warn('Voice error:', event.error);
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      toast('⚠ Microphone blocked. In Safari: Settings → Safari → Microphone → Allow for this site.');
    } else if (event.error === 'network') {
      toast('⚠ Voice needs internet connection.');
    } else if (event.error !== 'no-speech' && event.error !== 'aborted') {
      toast('⚠ Voice error: ' + event.error);
    }
    stopVoice(btnId, labelId, statusId);
  };

  _voiceRecognition.onend = function() {
    if (_voiceActive) {
      // Auto-restart if still active (handles timeouts)
      try { _voiceRecognition.start(); } catch(e) { stopVoice(btnId, labelId, statusId); }
    }
  };

  try {
    _voiceRecognition.start();
  } catch(e) {
    toast('⚠ Could not start microphone: ' + e.message);
    stopVoice(btnId, labelId, statusId);
  }
}

function stopVoice(btnId, labelId, statusId) {
  _voiceActive = false;
  if (_voiceRecognition) {
    try { _voiceRecognition.stop(); } catch(e) {}
    _voiceRecognition = null;
  }
  var btn = document.getElementById(btnId);
  var lbl = document.getElementById(labelId);
  var status = document.getElementById(statusId);
  if (btn) { btn.style.background = ''; btn.style.borderColor = ''; }
  if (lbl) lbl.textContent = btnId === 'rptVoiceBtn' ? 'Start Dictating' : 'Dictate';
  if (status) status.style.display = 'none';
  toast('✓ Voice note saved');
}

function appendVoiceNoteToReport() {
  var noteText = document.getElementById('rpt-voice-text').value.trim();
  if (!noteText) { toast('⚠ No note to add — dictate something first'); return; }

  // Find or create a voice notes section in the report doc
  var existing = document.getElementById('rpt-voice-notes');
  if (!existing) {
    var footer = document.getElementById('reportDoc') ? 
      document.getElementById('reportDoc').querySelector('.footer') : null;
    var div = document.createElement('div');
    div.id = 'rpt-voice-notes';
    div.style.cssText = 'margin:16px 0;padding:12px 14px;border:1px solid #c8e0b0;border-radius:6px;background:#f9fdf5';
    div.innerHTML = '<div style="font-family:Barlow Condensed,sans-serif;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#008350;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #c8e0b0">🎙️ Field Notes</div>'
      + '<div id="rpt-voice-notes-content" style="font-size:11.5px;line-height:1.6;color:#333"></div>';
    if (footer) {

// ============================================================
// src/features/paste-parse.js
// ============================================================
// ============================================================
// PASTE & PARSE
// ============================================================
var _ppParsedData = null;

function openPasteParseOverlay() {
  _ppParsedData = null;
  document.getElementById('ppInput').value = '';
  ppClearPreview();
  setPPStatus('ready');
  document.getElementById('pasteParseOverlay').classList.add('show');
}

function closePasteParse() {
  document.getElementById('pasteParseOverlay').classList.remove('show');
}

function ppClearPreview() {
  _ppParsedData = null;
  document.getElementById('ppPreview').innerHTML = '<span style="color:var(--di)">Parsed data will appear here.</span>';
  document.getElementById('ppParseStatus').textContent = ' — tap Parse to begin';
  document.getElementById('ppApplyBtn').style.display = 'none';
}

function setPPStatus(state) {
  var box = document.getElementById('ppStatus');
  if (state === 'ready') {
    box.style.background = '#f0faf0'; box.style.borderColor = '#c8e0b0'; box.style.color = '#008350';
    box.innerHTML = '<strong>Paste any voice note or typed text.</strong> Include site name, job number, technician, stations, products and comments. AI will extract everything it finds.';
  } else if (state === 'parsing') {
    box.style.background = '#f0f4ff'; box.style.borderColor = '#c0cff5'; box.style.color = '#1a3a7a';
    box.innerHTML = '🔍 <strong>Parsing with AI...</strong> This takes a few seconds.';
  } else if (state === 'done') {
    box.style.background = '#f0faf0'; box.style.borderColor = '#c8e0b0'; box.style.color = '#008350';
    box.innerHTML = '✅ <strong>Ready to apply.</strong> Review the extracted data below, then tap <strong>Fill Report &amp; Generate</strong>.';
  } else if (state === 'error') {
    box.style.background = '#fff8e0'; box.style.borderColor = '#f5d878'; box.style.color = '#7a5a10';
    box.innerHTML = '⚠️ <strong>Could not parse.</strong> Make sure your API key is set in Schedule settings, or try rewording your note.';
  }
}

async function runPasteParse() {
  var text = (document.getElementById('ppInput').value || '').trim();
  if (!text) { toast('⚠ Paste some text first'); return; }

  var apiKey = getApiKey();
  if (!apiKey || apiKey === _DEFAULT_API_KEY) {
    setPPStatus('error');
    document.getElementById('ppStatus').innerHTML = '🔑 <strong>' + (!apiKey ? 'No API key set.' : 'Default API key is expired.') + '</strong> Enter your Anthropic API key to use AI parsing.<br><button onclick="closePasteParse();showAdmin();showAdminTab(\'ai\')" style="margin-top:8px;background:var(--gd);color:#fff;border:none;border-radius:6px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;font-family:Barlow,sans-serif">⚙ Set API Key Now →</button>';
    document.getElementById('ppPreview').innerHTML = '<span style="color:#c0392b">API key required to use AI parsing.</span>';
    return;
  }

  // Disable parse button while running
  var parseBtn = document.querySelector('#pasteParseOverlay .btn-p');
  if (parseBtn) { parseBtn.disabled = true; parseBtn.textContent = '⏳ Parsing...'; }

  setPPStatus('parsing');
  document.getElementById('ppParseStatus').textContent = ' — parsing...';
  document.getElementById('ppPreview').innerHTML = '<div style="text-align:center;padding:20px;color:var(--mu);font-size:13px">🔍 AI is reading your note...</div>';
  document.getElementById('ppApplyBtn').style.display = 'none';

  // Build site name list for context
  var siteNames = S.sites.map(function(s){ return s.name; }).join(', ') || 'none saved';
  // Build tech list from localStorage (always fresh)
  var techNames = loadTechs().map(function(t){ return t.name; }).join(', ') || 'none saved';

  var prompt = [
    'You are parsing a pest control field note spoken or typed by a technician in Australia.',
    'Extract every piece of structured data you can find and return ONLY valid JSON.',
    '',
    'KNOWN SITES: ' + siteNames,
    'KNOWN TECHNICIANS: ' + techNames,
    '',
    'FIELD NOTE:',
    '"' + text + '"',
    '',
    'Return ONLY this JSON structure (omit fields you cannot find, use null):',
    '{',
    '  "site_name": "exact match from known sites list if possible, else best guess",',
    '  "tech": "technician name",',
    '  "job_num": "job number as string",',
    '  "date": "YYYY-MM-DD or null for today",',
    '  "ext_act": "Nil|Low|Medium|High",',
    '  "int_act": "Nil|Low|Medium|High",',
    '  "issues": "Yes|No",',
    '  "infest": "Yes|No",',
    '  "comments": "full service comments as a clean professional sentence",',
    '  "stations": {',
    '    "ir":  [{"num":1,"val":"Nil|Low|Medium|High"}],',
    '    "irt": [{"num":1,"val":"Nil|Low|Medium|High"}],',
    '    "er":  [{"num":1,"val":"Nil|Low|Medium|High"}],',
    '    "sp":  [{"num":1,"val":"Nil|Low|Medium|High","species":"-"}],',
    '    "ilt": [{"num":1,"moths":"Nil|Low|Medium|High","flies":"Nil|Low|Medium|High","small":"Nil|Low|Medium|High"}]',
    '  },',
    '  "products": [',
    '    {"name":"product name","active":"active ingredient","batch":"batch number","amount":"e.g. 150g","area":"internal or external","reason":"e.g. Rodent Control"}',
    '  ],',
    '  "confidence": "high|medium|low",',
    '  "missing": "comma-separated list of important fields not found"',
    '}',
    '',
    'Rules:',
    '- Station prefixes: E/ext = er, I/int = ir, IT/toxic/IRT = irt, SPP = sp, ILT = ilt',
    '- "all nil", "all clear" means every station in that group is Nil',
    '- Numbers as words: one=1, two=2 etc',
    '- If date not mentioned use null (app will use today)',
    '- Match site name loosely (Monash = Monash University)',
    '- Return ONLY the JSON object, no markdown'
  ].join('\n');

  try {
    var resp = await fetch('https://api.anthropic.com/v1/messages', {
      signal: AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!resp.ok) { resp.text().then(function(b){ console.error('API HTTP ' + resp.status + ':', b.slice(0,200)); }).catch(function(){}); throw new Error('HTTP ' + resp.status); }
    var data = await resp.json();
    var raw = data.content[0].text.trim();
    if (raw.charAt(0) === '`') {
      raw = raw.replace(/^[`]{3}[a-z]*\n?/, '').replace(/[`]{3}$/, '').trim();
    }
    var parsed = JSON.parse(raw);
    _ppParsedData = parsed;
    renderPPPreview(parsed);
    setPPStatus('done');
    document.getElementById('ppParseStatus').textContent = ' — review then tap Fill Report';
    document.getElementById('ppApplyBtn').style.display = '';
  } catch(err) {
    console.warn('runPasteParse failed:', err);
    setPPStatus('error');
    document.getElementById('ppParseStatus').textContent = ' — parse failed';
    document.getElementById('ppPreview').innerHTML = '<span style="color:#c0392b">Error: ' + (err.message || 'unknown error') + '</span>';
  } finally {
    var parseBtn2 = document.querySelector('#pasteParseOverlay .btn-p:not(#ppApplyBtn)');
    if (parseBtn2) { parseBtn2.disabled = false; parseBtn2.textContent = '🔍 Parse Note'; }
  }
}

function renderPPPreview(p) {
  var html = '';
  var badge = function(label, val, good) {
    var col = good ? 'color:#008350' : 'color:var(--mu)';
    return '<span style="display:inline-flex;gap:4px;align-items:center;margin-right:8px"><span style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--mu)">' + label + '</span><span style="font-weight:600;' + col + '">' + (val || '—') + '</span></span>';
  };
  var actCol = function(v) {
    return v === 'High' ? '#c0392b' : v === 'Medium' ? '#ea580c' : v === 'Low' ? '#d97706' : '#008350';
  };

  // Job details row
  html += '<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--bd)">';
  html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:var(--mu);margin-bottom:5px">Job Details</div>';
  html += badge('Site', p.site_name, !!p.site_name);
  html += badge('Tech', p.tech, !!p.tech);
  html += badge('Job #', p.job_num, !!p.job_num);
  html += badge('Date', p.date || 'Today', true);
  html += '</div>';

  // Activity
  html += '<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--bd)">';
  html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:var(--mu);margin-bottom:5px">Activity Summary</div>';
  if (p.ext_act) html += '<span style="margin-right:10px"><span style="font-size:10px;font-weight:700;color:var(--mu)">EXT </span><span style="font-weight:700;color:' + actCol(p.ext_act) + '">' + p.ext_act + '</span></span>';
  if (p.int_act) html += '<span style="margin-right:10px"><span style="font-size:10px;font-weight:700;color:var(--mu)">INT </span><span style="font-weight:700;color:' + actCol(p.int_act) + '">' + p.int_act + '</span></span>';
  if (p.issues)  html += badge('Issues', p.issues, p.issues === 'No');
  if (p.infest)  html += badge('Infestation', p.infest, p.infest === 'No');
  html += '</div>';

  // Stations
  var stns = p.stations || {};
  var stnKeys = Object.keys(stns).filter(function(k){ return stns[k] && stns[k].length; });
  if (stnKeys.length) {
    var labels = { ir:'Int.Rodent', irt:'Int.Toxic', er:'Ext.Rodent', sp:'SPP', ilt:'ILT' };
    html += '<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--bd)">';
    html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:var(--mu);margin-bottom:6px">Stations (' + stnKeys.reduce(function(a,k){ return a + stns[k].length; }, 0) + ' total)</div>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:5px">';
    stnKeys.forEach(function(key) {
      stns[key].forEach(function(s) {
        var v = s.val || 'Nil';
        var cls = v === 'Nil' ? 'b-nil' : v === 'Low' ? 'b-low' : v === 'Medium' ? 'b-med' : 'b-high';
        var prefix = { ir:'I', irt:'IT', er:'E', sp:'S', ilt:'ILT' }[key] || key;
        html += '<span class="badge ' + cls + '" style="font-size:11px">' + prefix + s.num + ': ' + v + '</span>';
      });
    });
    html += '</div></div>';
  }

  // Products
  if (p.products && p.products.length) {
    html += '<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--bd)">';
    html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:var(--mu);margin-bottom:5px">Products (' + p.products.length + ')</div>';
    p.products.forEach(function(pr) {
      html += '<div style="margin-bottom:3px"><strong>' + (pr.name||'?') + '</strong>';
      if (pr.active) html += ' · ' + pr.active;
      if (pr.batch)  html += ' · Batch: ' + pr.batch;
      if (pr.amount) html += ' · ' + pr.amount;
      if (pr.area)   html += ' · ' + pr.area;
      html += '</div>';
    });
    html += '</div>';
  }

  // Comments
  if (p.comments) {
    html += '<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--bd)">';
    html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:var(--mu);margin-bottom:4px">Comments</div>';
    html += '<div style="font-style:italic;color:var(--tx)">"' + p.comments + '"</div>';
    html += '</div>';
  }

  // Confidence + missing
  var confCol = p.confidence === 'high' ? '#008350' : p.confidence === 'medium' ? '#d97706' : '#c0392b';
  html += '<div style="font-size:11px;color:' + confCol + ';font-weight:700">Confidence: ' + (p.confidence||'?').toUpperCase();
  if (p.missing) html += '<span style="color:#c0392b;font-weight:400"> · Missing: ' + p.missing + '</span>';
  html += '</div>';

  document.getElementById('ppPreview').innerHTML = html;
}

function applyParsedNote() {
  if (!_ppParsedData) { toast('⚠ Nothing to apply'); return; }
  var p = _ppParsedData;

  // ── Select site ──
  if (p.site_name) {
    var siteIdx = -1;
    var needle = p.site_name.toLowerCase();
    S.sites.forEach(function(s, i) {
      if (s.name.toLowerCase().indexOf(needle) >= 0 || needle.indexOf(s.name.toLowerCase()) >= 0) {
        if (siteIdx === -1) siteIdx = i;
      }
    });
    if (siteIdx >= 0) {
      S.selectedSite = siteIdx;
      renderSiteList();
    }
  }

  // ── Screen 1 fields ──
  if (p.tech) {
    var techSel = document.getElementById('j-tech-sel');
    if (techSel) {
      for (var i = 0; i < techSel.options.length; i++) {
        if (techSel.options[i].text.toLowerCase().indexOf(p.tech.toLowerCase()) >= 0) {
          techSel.value = techSel.options[i].value;
          document.getElementById('j-tech').value = techSel.options[i].text;
          break;
        }
      }
    }
  }
  if (p.date) {
    var dateEl = document.getElementById('j-date');
    if (dateEl) dateEl.value = p.date;
  }
  if (p.job_num) {
    var jobEl = document.getElementById('j-num');
    if (jobEl) jobEl.value = p.job_num;
  }

  // ── Stations ──
  if (p.stations && S.selectedSite !== null) {
    buildStations(); // initialise station arrays from site config
    var stns = p.stations;
    Object.keys(stns).forEach(function(key) {
      var arr = stns[key];
      if (!arr || !arr.length || !S.stations[key]) return;
      arr.forEach(function(dictStn) {
        var idx = dictStn.num - 1;
        if (idx < 0 || idx >= S.stations[key].length) return;
        if (key === 'ilt') {
          if (dictStn.moths !== undefined) S.stations[key][idx].moths = dictStn.moths;
          if (dictStn.flies !== undefined) S.stations[key][idx].flies = dictStn.flies;
          if (dictStn.small !== undefined) S.stations[key][idx].small = dictStn.small;
        } else {
          if (dictStn.val) S.stations[key][idx].val = dictStn.val;
          if (dictStn.species && dictStn.species !== '-') S.stations[key][idx].species = dictStn.species;
        }
      });
    });
  }

  // ── Products ──
  if (p.products && p.products.length) {
    S.products = p.products.map(function(pr) {
      return {
        name:   pr.name   || '',
        active: pr.active || '',
        batch:  pr.batch  || '',
        amount: pr.amount || '',
        area:   pr.area   || '',
        reason: pr.reason || ''
      };
    });
  }

  // ── Screen 3 fields ──
  var setSelect = function(id, val) {
    var el2 = document.getElementById(id);
    if (el2 && val) el2.value = val;
  };
  setSelect('ext-activity',    p.ext_act  || 'Nil');
  setSelect('int-activity',    p.int_act  || 'Nil');
  setSelect('issues-reported', p.issues   || 'No');
  setSelect('infestation',     p.infest   || 'No');
  if (p.comments) {
    var cmtEl = document.getElementById('svc-comments');
    if (cmtEl) cmtEl.value = p.comments;
  }

  closePasteParse();

  // Jump straight to report — skip through screens silently
  if (S.selectedSite !== null) {
    renderStations();
    renderProducts();
    renderSiteList();
    toast('✓ Report filled — generating...');
    setTimeout(function() { buildReport(); }, 600);
  } else {
    goScreen(1);
    toast('✓ Fields filled — select your site then generate report');
  }
}

document.getElementById('pasteParseOverlay').addEventListener('click', function(e) {
  if (e.target === this) closePasteParse();
});

// ============================================================
// src/features/trend.js
// ============================================================
// ============================================================
// TREND DASHBOARD
// ============================================================
var _trendSiteName  = '';
var _trendHistory   = [];
var _trendCurrentTab = 'overview';

function showTrendTab(tab) {
  ['overview','stations','products','history'].forEach(function(t) {
    var btn   = document.getElementById('td-tab-' + t);
    var panel = document.getElementById('td-panel-' + t);
    var active = t === tab;
    if (btn)   { btn.style.background = active ? 'var(--g)' : 'transparent'; btn.style.color = active ? 'var(--gtx)' : 'var(--mu)'; }
    if (panel) { panel.style.display  = active ? 'block' : 'none'; }
  });
  _trendCurrentTab = tab;
}

function showSiteHistory(siteName) {
  _trendSiteName = siteName;
  _trendHistory  = [];

  document.getElementById('siteHistoryName').textContent = siteName;
  document.getElementById('siteHistorySummary').innerHTML = '';
  document.getElementById('siteHistoryList').innerHTML = '<div style="text-align:center;padding:24px;color:var(--mu);font-size:13px"><div style="width:28px;height:28px;border:3px solid var(--bd);border-top-color:var(--g);border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 10px"></div>Loading history...</div>';
  document.getElementById('td-activity-chart').innerHTML = '';
  document.getElementById('td-station-heatmap').innerHTML = '';
  document.getElementById('td-products-list').innerHTML = '';
  document.getElementById('td-ai-analysis').innerHTML = '<div style="text-align:center;padding:20px;color:var(--mu);font-size:12px">Loading...</div>';

  showTrendTab('overview');
  document.getElementById('siteHistoryOverlay').classList.add('show');
  loadSiteHistoryData(siteName);
}

function closeSiteHistory() {
  document.getElementById('siteHistoryOverlay').classList.remove('show');
}

async function loadSiteHistoryData(siteName) {
  try {
    var url = getSbUrl() + '/rest/v1/service_reports?site_name=eq.' + encodeURIComponent(siteName) + '&order=date.desc&limit=100';
    var resp = await fetch(url, { headers: sbHeaders() });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var rows = await resp.json();

    _trendHistory = rows;

    if (!rows.length) {
      document.getElementById('siteHistoryList').innerHTML = '<div style="text-align:center;padding:30px;color:var(--mu);font-size:13px;background:var(--s3);border-radius:var(--rs);border:1px dashed var(--bd)">No service history found for this site.<br><span style="font-size:11px">History is recorded automatically each time a report is generated.</span></div>';
      document.getElementById('td-ai-analysis').innerHTML = '<div style="text-align:center;padding:20px;color:var(--mu);font-size:12px">No history to analyse yet.</div>';
      return;
    }

    // Render all tabs with data
    renderTrendSummaryStrip(rows);
    renderActivityChart(rows);
    renderStationHeatmap(rows);
    renderProductsTimeline(rows);
    renderVisitHistory(rows);
    runTrendAIAnalysis(rows).catch(function(e){ console.warn("runTrendAIAnalysis:", e); });

  } catch(e) {
    console.warn('loadSiteHistoryData failed:', e);
    document.getElementById('siteHistoryList').innerHTML = '<div style="text-align:center;padding:20px;color:#c0392b;font-size:13px">Could not load history — check database connection.</div>';
    document.getElementById('td-ai-analysis').innerHTML = '<div style="text-align:center;padding:20px;color:var(--mu);font-size:12px">Could not load history.</div>';
  }
}

// ── Summary strip ─────────────────────────────────────────────────────
function renderTrendSummaryStrip(rows) {
  var total    = rows.length;
  var lastVisit = rows[0].date;
  var actOrder = ['Nil','Low','Medium','High'];
  var highCount = 0, medCount = 0;
  rows.forEach(function(r) {
    var extAct = r.ext_act || 'Nil'; var intAct = r.int_act || 'Nil';
    var highest = actOrder[Math.max(actOrder.indexOf(extAct), actOrder.indexOf(intAct))];
    if (highest === 'High') highCount++;
    else if (highest === 'Medium') medCount++;
  });
  var avgActivity = highCount > total*0.3 ? 'High' : medCount > total*0.3 ? 'Medium' : 'Low';
  var avgCol = avgActivity==='High'?'b-high':avgActivity==='Medium'?'b-med':'b-nil';

  var html = [
    { val: total, lbl: 'Total Visits' },
    { val: formatHistDate(lastVisit), lbl: 'Last Service' },
    { val: highCount, lbl: 'High Activity' },
  ].map(function(s) {
    return '<div style="flex:1;min-width:0;background:var(--s1);border:1px solid var(--bd);border-radius:var(--rs);padding:10px 12px;box-shadow:var(--shadow-sm)">'
      + '<div style="font-family:Barlow Condensed,sans-serif;font-size:22px;font-weight:800;color:var(--tx)">' + s.val + '</div>'
      + '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--mu);margin-top:2px">' + s.lbl + '</div>'
      + '</div>';
  }).join('');
  document.getElementById('siteHistorySummary').innerHTML = html;
}

// ── Activity trend chart (pure CSS bar chart) ─────────────────────────
function renderActivityChart(rows) {
  var el = document.getElementById('td-activity-chart');
  if (!rows.length) { el.innerHTML = ''; return; }

  // Show last 12 visits max, oldest first
  var recent = rows.slice(0, 12).reverse();
  var actOrder = ['Nil','Low','Medium','High'];
  var colours  = { 'Nil':'#008350','Low':'#d97706','Medium':'#ea580c','High':'#dc2626' };
  var heights  = { 'Nil':15, 'Low':40, 'Medium':65, 'High':90 };

  var html = '<div style="margin-bottom:8px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;color:var(--gd)">Activity Trend — Last ' + recent.length + ' Visits</div>';
  html += '<div style="display:flex;align-items:flex-end;gap:4px;height:100px;padding:0 2px;border-bottom:2px solid var(--bd);margin-bottom:6px">';

  recent.forEach(function(r) {
    var extIdx = actOrder.indexOf(r.ext_act||'Nil');
    var intIdx = actOrder.indexOf(r.int_act||'Nil');
    var highest = actOrder[Math.max(extIdx, intIdx)];
    var col = colours[highest];
    var ht  = heights[highest];
    var dateShort = r.date ? r.date.slice(5) : '';  // MM-DD
    html += '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">'
      + '<div style="width:100%;background:' + col + ';border-radius:3px 3px 0 0;height:' + ht + 'px;min-height:4px;opacity:0.85;transition:opacity 0.15s" title="' + r.date + ': Ext ' + (r.ext_act||'Nil') + ' / Int ' + (r.int_act||'Nil') + '"></div>'
      + '</div>';
  });
  html += '</div>';

  // X-axis dates
  html += '<div style="display:flex;gap:4px;padding:0 2px">';
  recent.forEach(function(r) {
    var d = r.date ? r.date.slice(5).replace('-','/') : '';
    html += '<div style="flex:1;text-align:center;font-size:9px;color:var(--mu);overflow:hidden">' + d + '</div>';
  });
  html += '</div>';

  // Legend
  html += '<div style="display:flex;gap:10px;margin-top:8px;flex-wrap:wrap">';
  Object.entries(colours).forEach(function(e) {
    html += '<div style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--mu)">'
      + '<div style="width:10px;height:10px;border-radius:2px;background:' + e[1] + '"></div>' + e[0] + '</div>';
  });
  html += '</div>';

  el.innerHTML = '<div style="background:var(--s1);border:1px solid var(--bd);border-radius:var(--rr);padding:14px;box-shadow:var(--shadow-sm)">' + html + '</div>';
}

// ── Station heatmap ───────────────────────────────────────────────────
function renderStationHeatmap(rows) {
  var el = document.getElementById('td-station-heatmap');
  var actScore = { 'Nil':0, 'Low':1, 'Medium':2, 'High':3 };
  var grpLabels = { ir:'Internal Rodent', irt:'Internal Toxic', er:'External Rodent', sp:'SPP Monitor', ilt:'ILT' };

  // Build score map: { grpKey: { stationNum: [scores] } }
  var scoreMap = {};
  rows.forEach(function(r) {
    var stns = typeof r.stations === 'string' ? JSON.parse(r.stations||'{}') : (r.stations || {});
    Object.keys(stns).forEach(function(key) {
      var arr = stns[key]; if (!arr || !arr.length) return;
      if (!scoreMap[key]) scoreMap[key] = {};
      arr.forEach(function(s) {
        var num = s.num;
        if (!scoreMap[key][num]) scoreMap[key][num] = [];
        var v = key === 'ilt'
          ? Math.max(actScore[s.moths||'Nil'], actScore[s.flies||'Nil'], actScore[s.small||'Nil'])
          : actScore[s.val||'Nil'];
        scoreMap[key][num].push(v);
      });
    });
  });

  if (!Object.keys(scoreMap).length) {
    el.innerHTML = '<div style="color:var(--mu);font-size:13px;padding:16px;text-align:center">No station data in history yet.</div>';
    return;
  }

  var html = '';
  Object.keys(scoreMap).forEach(function(key) {
    var stations = scoreMap[key];
    var nums = Object.keys(stations).map(Number).sort(function(a,b){return a-b;});
    if (!nums.length) return;

    html += '<div style="margin-bottom:14px">';
    html += '<div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:0.8px;color:var(--gd);margin-bottom:8px">' + (grpLabels[key]||key) + '</div>';
    html += '<div style="display:flex;flex-wrap:wrap;gap:6px">';

    nums.forEach(function(num) {
      var scores = stations[num];
      var avg = scores.reduce(function(a,b){return a+b;},0) / scores.length;
      var maxScore = Math.max.apply(null, scores);
      var hitRate = scores.filter(function(s){return s>0;}).length / scores.length;

      // Colour based on average score
      var bg, border, textCol;
      if (avg >= 2.5) { bg='#fee2e2'; border='#ef4444'; textCol='#b91c1c'; }
      else if (avg >= 1.5) { bg='#ffedd5'; border='#f97316'; textCol='#c2410c'; }
      else if (avg >= 0.5) { bg='#fef3c7'; border='#f59e0b'; textCol='#b45309'; }
      else { bg='#dcfce7'; border='#4ade80'; textCol='#008350'; }

      var prefix = {ir:'I',irt:'IT',er:'E',sp:'S',ilt:'ILT'}[key]||key;
      var hitPct  = Math.round(hitRate * 100);

      html += '<div style="background:' + bg + ';border:1.5px solid ' + border + ';border-radius:8px;padding:8px 10px;min-width:56px;text-align:center;cursor:default" title="' + prefix + num + ': avg score ' + avg.toFixed(1) + '/3, active ' + hitPct + '% of visits">'
        + '<div style="font-family:Barlow Condensed,sans-serif;font-size:16px;font-weight:800;color:' + textCol + '">' + prefix + num + '</div>'
        + '<div style="font-size:10px;font-weight:700;color:' + textCol + ';margin-top:2px">' + hitPct + '%</div>'
        + '<div style="font-size:9px;color:' + textCol + ';opacity:0.7">' + scores.length + ' visits</div>'
        + '</div>';
    });

    html += '</div></div>';
  });

  // Heatmap key
  html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;padding:8px 0;border-top:1px solid var(--bd)">';
  html += '<div style="font-size:10px;color:var(--mu);font-weight:700">% = active visits &nbsp;</div>';
  [['#dcfce7','#008350','Rarely active'],['#fef3c7','#b45309','Sometimes active'],['#ffedd5','#c2410c','Often active'],['#fee2e2','#b91c1c','Persistent hot spot']].forEach(function(c) {
    html += '<div style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--mu)">'
      + '<div style="width:10px;height:10px;border-radius:2px;background:' + c[0] + ';border:1px solid ' + c[1] + '"></div>' + c[2] + '</div>';
  });
  html += '</div>';

  el.innerHTML = '<div style="background:var(--s1);border:1px solid var(--bd);border-radius:var(--rr);padding:14px;box-shadow:var(--shadow-sm)">' + html + '</div>';
}

// ── Products timeline ─────────────────────────────────────────────────
function renderProductsTimeline(rows) {
  var el = document.getElementById('td-products-list');

  // Build product usage map
  var prodMap = {};
  rows.forEach(function(r) {
    var prods = typeof r.products === 'string' ? JSON.parse(r.products||'[]') : (r.products || []);
    prods.filter(function(p){return p.name;}).forEach(function(p) {
      var key = p.name;
      if (!prodMap[key]) prodMap[key] = { name: p.name, active: p.active||'', uses:[], activityAfter:[] };
      prodMap[key].uses.push({ date: r.date, batch: p.batch||'', amount: p.amount||'', area: p.area||'', ext: r.ext_act||'Nil', int: r.int_act||'Nil' });
    });
  });

  var prods = Object.values(prodMap);
  if (!prods.length) {
    el.innerHTML = '<div style="color:var(--mu);font-size:13px;padding:16px;text-align:center">No product data in history yet.</div>';
    return;
  }

  // Sort by most recently used
  prods.sort(function(a,b) { return (b.uses[0]&&b.uses[0].date||'') > (a.uses[0]&&a.uses[0].date||'') ? 1 : -1; });

  var html = '';
  prods.forEach(function(p) {
    var useCount = p.uses.length;
    var lastUse  = p.uses[0] ? p.uses[0].date : '';
    var highActCount = p.uses.filter(function(u){ return u.ext==='High'||u.int==='High'; }).length;
    var effectPct = useCount > 1 ? Math.round((1 - highActCount/useCount) * 100) : null;

    html += '<div style="background:var(--s1);border:1px solid var(--bd);border-radius:var(--rr);padding:12px 14px;margin-bottom:10px;box-shadow:var(--shadow-sm)">';

    // Product header
    html += '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px">';
    html += '<div><div style="font-family:Barlow Condensed,sans-serif;font-size:16px;font-weight:700;color:var(--tx)">' + p.name + '</div>';
    if (p.active) html += '<div style="font-size:11px;color:var(--mu);margin-top:1px">' + p.active + '</div>';
    html += '</div>';
    html += '<div style="text-align:right;flex-shrink:0"><div style="font-size:18px;font-weight:800;font-family:Barlow Condensed,sans-serif;color:var(--gd)">' + useCount + '</div><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--mu)">uses</div></div>';
    html += '</div>';

    // Stats row
    html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">';
    html += '<span style="font-size:11px;background:var(--s3);border-radius:20px;padding:3px 10px;color:var(--mu)">Last: ' + formatHistDate(lastUse) + '</span>';
    if (effectPct !== null) {
      var eCol = effectPct >= 70 ? '#008350' : effectPct >= 40 ? '#d97706' : '#dc2626';
      html += '<span style="font-size:11px;background:var(--s3);border-radius:20px;padding:3px 10px;color:' + eCol + ';font-weight:700">' + effectPct + '% low-activity visits</span>';
    }
    html += '</div>';

    // Usage history (collapsed list)
    html += '<div style="border-top:1px solid var(--bd);padding-top:8px">';
    html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--mu);margin-bottom:6px">Usage History</div>';
    p.uses.slice(0,6).forEach(function(u) {
      var actCol = u.ext==='High'||u.int==='High' ? '#dc2626' : u.ext==='Medium'||u.int==='Medium' ? '#ea580c' : u.ext==='Low'||u.int==='Low' ? '#d97706' : '#008350';
      html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--s3);font-size:11px">';
      html += '<span style="color:var(--tx)">' + formatHistDate(u.date) + (u.amount ? ' · ' + u.amount : '') + (u.area ? ' · ' + u.area : '') + '</span>';
      html += '<span style="font-weight:700;color:' + actCol + '">' + (u.ext||'Nil') + ' / ' + (u.int||'Nil') + '</span>';
      html += '</div>';
    });
    if (p.uses.length > 6) html += '<div style="font-size:11px;color:var(--mu);padding-top:4px">+ ' + (p.uses.length-6) + ' more visits</div>';
    html += '</div>';

    html += '</div>';
  });

  el.innerHTML = html;
}

// ── Visit history list ────────────────────────────────────────────────
function renderVisitHistory(rows) {
  var list = document.getElementById('siteHistoryList');
  list.innerHTML = '';

  rows.forEach(function(r, i) {
    var card = document.createElement('div');
    card.style.cssText = 'border:1.5px solid var(--bd);border-radius:var(--rr);margin-bottom:10px;overflow:hidden;background:var(--s2);box-shadow:var(--shadow-sm)';

    var hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 12px;cursor:pointer;user-select:none';

    var left = document.createElement('div');
    var dateEl = document.createElement('div');
    dateEl.style.cssText = 'font-family:Barlow Condensed,sans-serif;font-weight:700;font-size:15px;color:var(--tx)';
    dateEl.textContent = formatHistDate(r.date);
    var meta = document.createElement('div');
    meta.style.cssText = 'font-size:11px;color:var(--mu);margin-top:2px';
    var metaParts = [];
    if (r.tech) metaParts.push('Tech: ' + r.tech);
    if (r.job_num) metaParts.push('Job #' + r.job_num);
    meta.textContent = metaParts.join(' · ');
    left.appendChild(dateEl); left.appendChild(meta);

    var right = document.createElement('div');
    right.style.cssText = 'display:flex;align-items:center;gap:6px;flex-shrink:0';
    var extAct = r.ext_act||'Nil', intAct = r.int_act||'Nil';
    var actBadge = function(label, val) {
      var cls = val==='High'?'b-high':val==='Medium'?'b-med':val==='Low'?'b-low':'b-nil';
      return '<span class="badge ' + cls + '" style="font-size:11px">' + label + ': ' + val + '</span>';
    };
    right.innerHTML = actBadge('Ext', extAct) + actBadge('Int', intAct);
    var chevron = document.createElement('span');
    chevron.style.cssText = 'font-size:12px;color:var(--mu);margin-left:4px;transition:transform 0.2s';
    chevron.textContent = '▼';
    right.appendChild(chevron);

    hdr.appendChild(left); hdr.appendChild(right);
    card.appendChild(hdr);

    var body = document.createElement('div');
    body.style.cssText = 'display:none;border-top:1px solid var(--bd);padding:12px;font-size:12px;line-height:1.7;color:var(--tx)';
    body.innerHTML = buildHistoryDetail(r);
    card.appendChild(body);

    hdr.addEventListener('click', function() {
      var open = body.style.display !== 'none';
      body.style.display = open ? 'none' : 'block';
      chevron.style.transform = open ? '' : 'rotate(180deg)';
    });

    if (i === 0) { body.style.display = 'block'; chevron.style.transform = 'rotate(180deg)'; }

    list.appendChild(card);
  });
}

// ── AI trend analysis ─────────────────────────────────────────────────
async function runTrendAIAnalysis(rows) {
  var el = document.getElementById('td-ai-analysis');
  var apiKey = getApiKey();

  if (!apiKey) {
    el.innerHTML = '<div style="background:var(--s3);border-radius:var(--rr);padding:12px 14px;font-size:12px;color:var(--mu)">Set an Anthropic API key in ⚙ Schedule → AI Key to enable AI trend analysis.</div>';
    return;
  }

  el.innerHTML = '<div style="background:var(--s1);border:1px solid var(--bd);border-radius:var(--rr);padding:14px;text-align:center;color:var(--mu);font-size:12px;box-shadow:var(--shadow-sm)"><div style="width:24px;height:24px;border:2px solid var(--bd);border-top-color:var(--g);border-radius:50%;animation:spin 0.8s linear infinite;margin:0 auto 8px"></div>AI is analysing ' + rows.length + ' visits...</div>';

  // Build comprehensive data summary for AI
  var sorted = rows.slice().reverse(); // oldest first
  var summary = sorted.map(function(r, i) {
    var stns = typeof r.stations === 'string' ? JSON.parse(r.stations||'{}') : (r.stations || {});
    var lines = ['Visit ' + (i+1) + ' | ' + r.date + ' | Tech: ' + (r.tech||'?')];
    lines.push('  Activity: Ext=' + (r.ext_act||'?') + ' Int=' + (r.int_act||'?') + (r.issues==='Yes'?' | Issues reported':'') + (r.infest==='Yes'?' | Infestation detected':''));

    // All active stations
    ['er','ir','irt','sp','ilt'].forEach(function(key) {
      var arr = stns[key]; if (!arr||!arr.length) return;
      var active = arr.filter(function(s){ return key==='ilt' ? (s.moths!=='Nil'||s.flies!=='Nil'||s.small!=='Nil') : s.val!=='Nil'; });
      if (active.length) {
        var prefix = {er:'E',ir:'I',irt:'IT',sp:'S',ilt:'ILT'}[key];
        lines.push('  ' + prefix + ' active: ' + active.map(function(s){ return prefix+s.num+'('+((key==='ilt')?'M:'+s.moths+'/F:'+s.flies:s.val)+')'; }).join(', '));
      }
    });

    // Products
    var prods = (r.products||[]).filter(function(p){return p.name;});
    if (prods.length) lines.push('  Products: ' + prods.map(function(p){return p.name+(p.amount?' '+p.amount:'');}).join('; '));
    if (r.comments) lines.push('  Notes: ' + r.comments.slice(0,100));
    return lines.join('\n');
  }).join('\n\n');

  var prompt = [
    'You are a senior pest management consultant analysing the complete service history for ' + _trendSiteName + ' in Melbourne, Australia.',
    'All ' + rows.length + ' service visits are shown below, oldest to most recent.',
    '',
    'SERVICE HISTORY:',
    summary,
    '',
    'Write a comprehensive Trend Analysis covering ALL of these areas. Use ## headings exactly as shown:',
    '',
    '## OVERALL TREND',
    'Is pest pressure at this site increasing, decreasing, or stable over the full history? Quantify where possible (e.g. "High activity visits dropped from 60% to 20% in the last 6 months"). 2-3 sentences.',
    '',
    '## PERSISTENT HOT SPOTS',
    'Which specific stations are consistently recording activity across multiple visits? Are any stations NEVER active? Name specific station IDs. What does this tell us about harbourage or entry points?',
    '',
    '## TREATMENT EFFECTIVENESS',
    'Is the current baiting/treatment program working? Reference specific products used and whether activity reduced in subsequent visits. Flag any concerning patterns (e.g. bait being ignored, activity not declining despite treatment).',
    '',
    '## SEASONAL PATTERNS',
    'Are there visible seasonal fluctuations in the data? When does activity peak at this site? Use Melbourne seasonal context (summer Dec-Feb, autumn Mar-May, winter Jun-Aug, spring Sep-Nov).',
    '',
    '## PROGRAMME RECOMMENDATIONS',
    'Based on the full history, what specific changes to the current program would you recommend? Be precise — name station numbers, suggest frequency changes, recommend product rotations, flag structural issues that keep recurring.',
    '',
    'Be data-driven and site-specific. Reference dates and station numbers. No generic advice.'
  ].join('\n');

  try {
    var resp = await fetch('https://api.anthropic.com/v1/messages', {
      signal: AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var data = await resp.json();
    var text = data.content[0].text;
    el.innerHTML = renderFullTrendHTML(text, rows.length);

  } catch(err) {
    console.warn('Trend AI failed:', err);
    el.innerHTML = '<div style="background:var(--s3);border-radius:var(--rr);padding:12px 14px;font-size:12px;color:var(--mu)">AI analysis unavailable: ' + (err.message||'unknown error') + '</div>';
  }
}

// ── Render full trend analysis ────────────────────────────────────────
function renderFullTrendHTML(text, visitCount) {
  var sectionDefs = [
    { key: 'OVERALL',      icon: '📈', label: 'Overall Trend',             bg: '#e8f0fa', hd: '#1e4a7a' },
    { key: 'PERSISTENT',   icon: '🎯', label: 'Persistent Hot Spots',      bg: '#fae8e8', hd: '#7a1a1a' },
    { key: 'TREATMENT',    icon: '✅', label: 'Treatment Effectiveness',    bg: '#e8f5e0', hd: '#005c38' },
    { key: 'SEASONAL',     icon: '🌿', label: 'Seasonal Patterns',         bg: '#fdf3e0', hd: '#7a4a10' },
    { key: 'PROGRAMME',    icon: '🔧', label: 'Programme Recommendations', bg: '#f0e8fa', hd: '#4a1a7a' },
  ];

  var html = '<div style="background:var(--s1);border:1px solid var(--bd);border-radius:var(--rr);overflow:hidden;box-shadow:var(--shadow-sm)">';
  html += '<div style="background:var(--gd);color:#fff;padding:10px 14px;font-family:Barlow Condensed,sans-serif;font-size:14px;font-weight:700;letter-spacing:0.5px">🤖 AI Trend Analysis <span style="font-weight:400;font-size:11px;opacity:0.8;margin-left:8px">Based on ' + visitCount + ' service visit' + (visitCount===1?'':'s') + '</span></div>';

  var parts = text.split(/\n##\s+/);
  parts.forEach(function(part) {
    if (!part.trim()) return;
    var nlIdx = part.indexOf('\n');
    var heading = (nlIdx >= 0 ? part.slice(0, nlIdx) : part).trim().toUpperCase();
    var body = (nlIdx >= 0 ? part.slice(nlIdx + 1).trim() : '').trim();
    if (!body) return;

    var def = sectionDefs[0];
    sectionDefs.forEach(function(d) { if (heading.indexOf(d.key) === 0) def = d; });

    html += '<div style="padding:12px 14px;border-bottom:1px solid #e8f0e0;background:' + def.bg + '">';
    html += '<div style="font-family:Barlow Condensed,sans-serif;font-size:12px;font-weight:700;color:' + def.hd + ';letter-spacing:0.4px;margin-bottom:6px;text-transform:uppercase">' + def.icon + ' ' + def.label + '</div>';
    // Render numbered lists properly
    var formatted = '';
    body.split('\n').forEach(function(line) {
      var m = line.match(/^(\d+)\.\s+(.+)/);
      if (m) {
        formatted += '<div style="display:flex;gap:8px;margin-bottom:5px"><span style="background:' + def.hd + ';color:#fff;border-radius:50%;width:18px;height:18px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;margin-top:1px">' + m[1] + '</span><span style="font-size:12px;line-height:1.55;color:#333">' + m[2] + '</span></div>';
      } else if (line.trim()) {
        formatted += '<p style="margin:0 0 4px;font-size:12px;line-height:1.6;color:#333">' + line.trim() + '</p>';
      }
    });
    html += formatted;
    html += '</div>';
  });

  html += '</div>';
  return html;
}

// ── Helper: history detail card ───────────────────────────────────────
function buildHistoryDetail(r) {
  var html = '';
  var fields = [['External Activity',r.ext_act],['Internal Activity',r.int_act],['Issues Reported',r.issues],['Infestation',r.infest]];
  html += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--bd)">';
  fields.forEach(function(f) {
    if (!f[1]) return;
    var col = f[1]==='High'?'#dc2626':f[1]==='Medium'?'#ea580c':f[1]==='Low'?'#d97706':'#008350';
    html += '<div><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:var(--mu)">' + f[0] + '</div>'
      + '<div style="font-weight:700;color:' + col + '">' + f[1] + '</div></div>';
  });
  html += '</div>';

  // Station summary
  var stns = typeof r.stations === 'string' ? JSON.parse(r.stations||'{}') : (r.stations || {});
  if (stns && typeof stns === 'object') {
    var stnParts = [];
    var grpLabels = {ir:'Int.Rodent',irt:'Int.Toxic',er:'Ext.Rodent',sp:'SPP',ilt:'ILT'};
    Object.keys(grpLabels).forEach(function(key) {
      var arr = stns[key]; if (!arr||!arr.length) return;
      var counts = {Nil:0,Low:0,Medium:0,High:0};
      arr.forEach(function(s){ var v=s.val||'Nil'; if(counts[v]!==undefined) counts[v]++; });
      var nonNil = arr.length - (counts.Nil||0);
      var label = grpLabels[key]+'('+arr.length+')';
      if (nonNil) {
        var parts2=[];
        if(counts.High)   parts2.push('<span style="color:#dc2626;font-weight:700">'+counts.High+' High</span>');
        if(counts.Medium) parts2.push('<span style="color:#ea580c;font-weight:700">'+counts.Medium+' Med</span>');
        if(counts.Low)    parts2.push('<span style="color:#d97706;font-weight:700">'+counts.Low+' Low</span>');
        stnParts.push('<strong>'+label+':</strong> '+parts2.join(', '));
      } else {
        stnParts.push('<strong>'+label+':</strong> <span style="color:#008350">All Nil</span>');
      }
    });
    if (stnParts.length) {
      html += '<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--bd)">';
      html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:var(--mu);margin-bottom:5px">Station Activity</div>';
      html += stnParts.join('<br>');
      html += '</div>';
    }
  }

  // Products
  var prods = typeof r.products === 'string' ? JSON.parse(r.products||'[]') : (r.products || []);
  if (prods && prods.length) {
    html += '<div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--bd)">';
    html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:var(--mu);margin-bottom:5px">Products Applied</div>';
    prods.forEach(function(p) {
      if (!p.name) return;
      var line = '<strong>' + p.name + '</strong>';
      if (p.active) line += ' (' + p.active + ')';
      if (p.amount) line += ' — ' + p.amount;
      if (p.area)   line += ' · ' + p.area;
      html += '<div>' + line + '</div>';
    });
    html += '</div>';
  }

  // Comments
  if (r.comments) {
    html += '<div>';
    html += '<div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.4px;color:var(--mu);margin-bottom:4px">Service Comments</div>';
    html += '<div style="color:var(--tx);font-style:italic;line-height:1.6">"' + r.comments + '"</div>';
    html += '</div>';
  }

  return html || '<div style="color:var(--mu);font-style:italic">No detail recorded.</div>';
}

function formatHistDate(dateStr) {
  if (!dateStr) return 'Unknown';
  try {
    var d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-AU', {day:'numeric',month:'short',year:'numeric'});
  } catch(e) { return dateStr; }
}

document.getElementById('siteHistoryOverlay').addEventListener('click', function(e) {
  if (e.target === this) closeSiteHistory();
});

// ============================================================
// src/features/site-memory.js
// ============================================================
      return '"'+(v||'').replace(/"/g,'""')+'"';
    }).join(',');
  });
  var csv = [headers.join(',')].concat(rows).join('\n');
  var blob = new Blob([csv], {type:'text/csv'});
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ecosafe-chemical-register-' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
  toast('\u2713 CSV exported');
}

// ════════════════════════════════════════════════════════════════
// SITE MEMORY — surfaces recurring conditions in Quick Capture
// Fetches last 5 reports for the site, asks AI to summarise patterns
// ════════════════════════════════════════════════════════════════
var _siteMemoryCache = {};

async function loadSiteMemory(siteName) {
  if (!siteName) return null;
  var cacheKey = 'mem_' + siteName;
  var cached = _siteMemoryCache[cacheKey];
  if (cached && (Date.now() - cached.ts) < 86400000) return cached.data;
  try {
    var history = await loadReportHistory(siteName, 5);
    if (!history || !history.length) return null;
    var apiKey = getApiKey();
    if (!apiKey) return null;
    var summaryLines = history.map(function(r, i) {
      return 'Visit '+(i+1)+' ('+( r.date||'?')+'): ext='+(r.ext_act||'N')+' int='+(r.int_act||'N')+' issues='+(r.issues||'none');
    }).join('; ');
    var prompt = 'Site: '+siteName+'\nRecent service history:\n'+summaryLines+'\n\nList 3-5 SHORT recurring issues or patterns to watch for today. Each on its own line, max 8 words each. No bullets, no headings.';
    var resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!resp.ok) return null;
    var data = await resp.json();
    var text = (data.content && data.content[0] && data.content[0].text) || '';
    var lines = text.split('\n').map(function(l){ return l.trim(); }).filter(function(l){ return l.length > 3; });
    _siteMemoryCache[cacheKey] = { ts: Date.now(), data: lines };
    return lines;
  } catch(e) {
    console.warn('loadSiteMemory failed:', e);
    return null;
  }
}

function invalidateSiteMemoryCache(siteName) {
  var cacheKey = 'mem_' + siteName;
  delete _siteMemoryCache[cacheKey];
}

function emailReport() {
  var site = S.sites[S.selectedSite];
  var siteName = site ? site.name : 'Site';
  var siteEmail = site ? (site.email || '') : '';
  var subject = encodeURIComponent('EcoSafe Pest Management Service Report — ' + siteName);
  var body = encodeURIComponent('Please find attached your EcoSafe Pest Control service report for ' + siteName + '.\n\nBest regards,\nEcoSafe Pest Control\n1300 852 339\nreports@ecosafepestcontrol.com.au');
  window.open('mailto:' + siteEmail + '?subject=' + subject + '&body=' + body);
}

// Save Supabase + API credentials to app_config so all devices share them
async function _saveCredentialsToCloud() {
  try {
    var url = localStorage.getItem('es_sb_url') || '';
    var key = localStorage.getItem('es_sb_anon_key') || '';
    var apiKey = localStorage.getItem('es_api_key') || '';
    if (url) await sbUpsert('app_config', { key: 'sb_url', value: url, updated_at: new Date().toISOString() }, 'key');
    if (key) await sbUpsert('app_config', { key: 'sb_anon_key', value: key, updated_at: new Date().toISOString() }, 'key');
    if (apiKey) await sbUpsert('app_config', { key: 'anthropic_api_key', value: apiKey, updated_at: new Date().toISOString() }, 'key');
    // credentials saved
  } catch(e) { console.warn('[Config] Could not save credentials to cloud:', e); }
}

// Load ALL credentials from app_config — called on startup
// This means phone auto-configures if admin ever set up on desktop
async function _loadCredentialsFromCloud() {
  if (!isSbConfigured()) return false;
  try {
    var rows = await sbGet('app_config');
    if (!rows || !rows.length) return false;
    var changed = false;
    rows.forEach(function(r) {
      if (r.key === 'sb_url' && r.value && !localStorage.getItem('es_sb_url')) {

// ============================================================
// src/admin/schedule.js
// ============================================================
// ============================================================
// ADMIN SCHEDULER
// ============================================================
var schedFilter = 'upcoming';

function showAdminTab(tab) {
  var tabs = ['sched', 'db', 'ai', 'people', 'archive', 'chem'];
  tabs.forEach(function(t) {
    var btn   = document.getElementById('adm-tab-' + t);
    var panel = document.getElementById('adm-panel-' + t);
    var active = (t === tab);
    if (btn)   { btn.style.background = active ? 'var(--g)' : 'transparent'; btn.style.color = active ? '#1a2400' : 'var(--mu)'; }
    if (panel) { panel.style.display  = active ? 'block' : 'none'; }
  });
  if (tab === 'db') { updateDbConfigStatus(); var r = document.getElementById('sb-test-result'); if (r) { r.style.display = 'none'; r.textContent = ''; } }
  if (tab === 'archive') loadArchive();
  if (tab === 'chem')    loadChemRegister();
  if (tab === 'ai') {
    var k = document.getElementById('api-key-input');
    if (k) k.value = getApiKey();
    var warn = document.getElementById('ai-key-warning');
    if (warn) warn.style.display = (getApiKey() === _DEFAULT_API_KEY) ? '' : 'none';
  }
}

function showAdmin() {
  if (!AUTH.isAdmin) { toast('⚠ Admin access required'); return; }
  populateSchedDropdowns();
  document.getElementById('sched-date').value = todayStr();
  var startTab = isSbConfigured() ? 'sched' : 'db';
  showAdminTab(startTab);
  filterSched('upcoming');
  document.getElementById('adminOverlay').classList.add('show');
}

function closeAdmin() {
  document.getElementById('adminOverlay').classList.remove('show');
  // Refresh home if visible
  if (activeTechIdx !== null) showTechJobs(activeTechIdx);
}

document.getElementById('adminOverlay').addEventListener('click', function(e){
  if (e.target === this) closeAdmin();
});

function populateSchedDropdowns() {
  var techs = loadTechs();
  var sites = S.sites;

  var tsel = document.getElementById('sched-tech');
  var cur = tsel.value;
  while (tsel.options.length > 1) tsel.remove(1);
  techs.forEach(function(t) {
    var o = el('option'); o.value = t.name; o.textContent = t.name;
    tsel.appendChild(o);
  });
  if (cur) tsel.value = cur;

  var ssel = document.getElementById('sched-site');
  var scur = ssel.value;
  while (ssel.options.length > 1) ssel.remove(1);
  sites.forEach(function(s) {
    var o = el('option'); o.value = s.name; o.textContent = s.name;
    ssel.appendChild(o);
  });
  if (scur) ssel.value = scur;
}

function scheduleJob() {
  var techName = _getVal('sched-tech');
  var siteName = _getVal('sched-site');
  var date     = _getVal('sched-date');
  var time     = _getVal('sched-time');
  var notes    = _getVal('sched-notes').trim();

  if (!techName) { toast('⚠️ Select a technician'); return; }
  if (!siteName) { toast('⚠️ Select a site'); return; }
  if (!date)     { toast('⚠️ Select a date'); return; }

  var site = S.sites.find(function(s){ return s.name === siteName; });
  var sched = loadSchedule();
  var freq  = _getVal('sched-freq');
  var tech2 = _getVal('sched-tech2');
  var newJob = {
    id: Date.now(),
    techName: techName,
    siteName: siteName,
    siteAddr: site ? site.addr : '',
    date: date,
    time: time,
    freq: freq,
    tech2: tech2,
    notes: notes,
    done: false,
    active: true
  };
  newJob._localId = newJob.id; // remember numeric id before cloud overwrites it
  sched.push(newJob);
  saveSchedule(sched);
  saveJobToCloud(newJob).then(function() {
    var s2 = loadSchedule();
    var m = s2.find(function(x){ return x._localId === newJob._localId || x.id === newJob.id; });
    if (m && m.id !== newJob.id) { m.id = newJob.id; m._synced = true; saveSchedule(s2); }
    toast('\u2713 Job synced to cloud for ' + techName);
  }).catch(function(e){
    showSyncBanner('⚠️ Job saved locally but cloud sync failed: ' + e.message, true);
  });
  toast('\u2713 Job scheduled for ' + techName + ' — syncing…');
  // Clear form fields in both mobile and desktop
  ['sched-notes','sched-time','sched-tech2'].forEach(function(id) {
    var el = _getEl(id); if (el) el.value = '';
  });
  filterSched(schedFilter);
  if (isDesktop()) { setTimeout(renderDaTodayGlance, 100); renderDaStatsBar().catch(function(){}); }
}

function filterSched(filter) {
  schedFilter = filter;
  ['upcoming','today','all'].forEach(function(f){
    var btn = document.getElementById('sf-' + f);
    if (btn) btn.style.background = f === filter ? 'var(--s3)' : '';
    if (btn) btn.style.color = f === filter ? 'var(--g)' : '';
  });
  renderSchedList(filter);
}

function renderSchedList(filter) {
  var sched = loadSchedule();
  var today = todayStr();
  var filtered = sched.filter(function(j){
    if (filter === 'today')    return j.date === today;
    if (filter === 'upcoming') return j.date >= today && j.active !== false;
    return true;
  });
  // Sort by date then time
  filtered.sort(function(a,b){
    var ad = a.date + (a.time||'00:00');
    var bd = b.date + (b.time||'00:00');
    return ad > bd ? 1 : -1;
  });

  var list = document.getElementById('schedJobsList');
  // Preserve scroll position of the admin panel so re-render doesn't jump
  var scrollParent = document.getElementById('adminScrollPane');
  var savedScroll = scrollParent ? scrollParent.scrollTop : 0;

  list.innerHTML = '';
  if (!filtered.length) {
    var empty = el('div'); empty.style.cssText='color:var(--di);font-size:13px;padding:12px 0';
    empty.textContent = 'No jobs found.'; list.appendChild(empty);
    if (scrollParent) scrollParent.scrollTop = savedScroll;
    return;
  }

  filtered.forEach(function(job) {
    var row = el('div');
    row.style.cssText = 'background:var(--s3);border:1px solid var(--bd);border-radius:var(--rs);padding:10px 12px;margin-bottom:8px;position:relative';
    if (job.done) row.style.opacity = '0.5';

    var top = el('div'); top.style.cssText='display:flex;align-items:center;gap:8px;margin-bottom:4px';
    var site = el('span'); site.style.cssText='font-family:Barlow Condensed,sans-serif;font-size:15px;font-weight:700'; site.textContent = job.siteName;
    var dateBadge = el('span','badge b-nil'); dateBadge.style.fontSize='10px';
    dateBadge.textContent = formatDate(job.date) + (job.time ? ' ' + job.time : '');
    top.appendChild(site); top.appendChild(dateBadge);

    var sub = el('div'); sub.style.cssText='font-size:12px;color:var(--mu)';
    sub.textContent = 'Tech: ' + job.techName + (job.notes ? ' · ' + job.notes : '');

    var acts = el('div'); acts.style.cssText='display:flex;gap:6px;margin-top:8px';
    var doneBtn = el('button','btn btn-s btn-xs btn');
    doneBtn.textContent = job.done ? '✓ Done' : 'Mark Done';
    if (job.done) doneBtn.style.color = 'var(--g)';
    var delBtn = el('button','btn btn-d btn-xs btn'); delBtn.textContent = '✕ Delete';
    acts.appendChild(doneBtn); acts.appendChild(delBtn);

    (function(j){
      doneBtn.addEventListener('click', function(){
        var s2 = loadSchedule();
        var jj = s2.find(function(x){ return x.id===j.id; });
        if (jj) { jj.done = !jj.done; saveSchedule(s2); updateJobInCloud(jj.id, {done: jj.done}); filterSched(schedFilter); }
      });
      delBtn.addEventListener('click', function(e){
        e.stopPropagation();
        e.preventDefault();
        var filtered = loadSchedule().filter(function(x){ return String(x.id) !== String(j.id); });
        saveSchedule(filtered);
        deleteJobFromCloud(j.id);
        filterSched(schedFilter);
        toast('✓ Job deleted');
      });
    })(job);

    row.appendChild(top); row.appendChild(sub); row.appendChild(acts);
    list.appendChild(row);
  });
  // Restore scroll position after DOM update
  if (scrollParent) requestAnimationFrame(function(){ scrollParent.scrollTop = savedScroll; });
}

// ============================================================
// SCHEDULE STORAGE
// ============================================================
function loadSchedule() {
  try { var s = localStorage.getItem('es_sched'); var r = s ? JSON.parse(s) : []; return Array.isArray(r) ? r : []; }
  catch(e) { return []; }
}

function saveSchedule(sched) {
  localStorage.setItem('es_sched', JSON.stringify(sched));
  localStorage.setItem('es_scheduled_jobs', JSON.stringify(sched));
}

function todayStr() {
  return new Date().toISOString().slice(0,10);
}

function formatDate(d) {
  if (!d) return '';
  var parts = d.split('-');
  var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return parseInt(parts[2]) + ' ' + months[parseInt(parts[1])-1];
}

// ============================================================
// OVERRIDE goScreen TO MANAGE STEPS BAR VISIBILITY
// ============================================================
var _origGoScreen = goScreen;
goScreen = function(n) {
  document.getElementById('stepsBar').style.display = n >= 1 ? 'flex' : 'none';
  document.getElementById('homeBtn').style.display = n >= 1 ? 'inline-flex' : 'none';
  if (n === 1) {
    populateTechSelects();
    populateSchedDropdowns();
    renderSiteList();
  }
  _origGoScreen(n);
};

// ============================================================
// OVERRIDE goHome BUTTON IN BNAV (back to home from sc1)
// ============================================================
// newReport merged above

// (cloud sync init moved to end of script)

// ============================================================
// src/admin/team-sites.js
// ============================================================
// ============================================================
// TECHNICIAN MANAGEMENT
// ============================================================
function loadTechs() {
  try {
    var saved = localStorage.getItem('es_techs');
    var t = saved ? JSON.parse(saved) : [];
    if (!Array.isArray(t)) return [];
    // Deduplicate in memory — prevents UI confusion from duplicate cloud records
    var seen = {};
    return t.filter(function(tech) {
      var key = (tech.name || '').trim().toLowerCase();
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  } catch(e) { return []; }
}

function saveTechs(techs) {
  localStorage.setItem('es_techs', JSON.stringify(techs));
}

function populateTechSelects() {
  var techs = loadTechs();
  window._techsList = techs; // keep in sync for paste & parse context
  var selects = ['j-tech-sel', 'sf-tech'];
  selects.forEach(function(id) {
    var sel = document.getElementById(id);
    if (!sel) return;
    var current = sel.value;
    // Clear options except first
    while (sel.options.length > 1) sel.remove(1);
    techs.forEach(function(t) {
      var opt = document.createElement('option');
      opt.value = t.name + ' Licence No. ' + t.lic;
      opt.textContent = t.name + ' — ' + t.lic;
      sel.appendChild(opt);
    });
    // Restore selection
    if (current) sel.value = current;
  });
}

function onTechSelect(val) {
  document.getElementById('j-tech').value = val;
  if (val) localStorage.setItem('es_last_tech', val);
}

function showManageTechs() {
  // If no local techs but Supabase is configured, try cloud first
  var localTechs = loadTechs();
  if (!localTechs.length && isSbConfigured()) {
    document.getElementById('techOverlay').classList.add('show');
    var list = document.getElementById('techList');
    if (list) list.innerHTML = '<div style="color:var(--mu);font-size:13px;padding:8px 0">Loading technicians…</div>';
    loadTechsFromCloud().then(function(t) {
      localStorage.setItem('es_techs', JSON.stringify(t));
      window._techsList = t;
      renderTechList();
      populateTechSelects();
      populateSchedDropdowns();
      if (isDesktop()) setTimeout(renderDesktopTeamPanel, 50);
    }).catch(function() { renderTechList(); });
  } else {
    renderTechList();
    document.getElementById('techOverlay').classList.add('show');
  }
}

function closeTechOverlay() {
  document.getElementById('techOverlay').classList.remove('show');
  populateTechSelects();
  populateSchedDropdowns();
  renderTechPicker();
  renderLoginTechList(); // refresh login screen if user goes back
}

// ============================================================
// MANAGE SITES OVERLAY
// ============================================================
var _editingSiteFromOverlay = -1;

function showManageSites() {
  _editingSiteFromOverlay = -1;
  populateMsTechSelect();
  renderManageSitesList();
  document.getElementById('manageSiteForm').style.display = 'none';
  document.getElementById('addSiteBtn').style.display = '';
  document.getElementById('sitesOverlay').classList.add('show');
}

function closeSitesOverlay() {
  document.getElementById('sitesOverlay').classList.remove('show');
  populateSchedDropdowns();
  renderSiteList();
}

function populateMsTechSelect() {
  var sel = document.getElementById('ms-tech');
  while (sel.options.length > 1) sel.remove(1);
  loadTechs().forEach(function(t) {
    var o = el('option'); o.value = t.name; o.textContent = t.name;
    sel.appendChild(o);
  });
}

function renderManageSitesList() {
  var list = document.getElementById('manageSitesList');
  list.innerHTML = '';
  if (!S.sites.length) {
    list.innerHTML = '<div style="color:var(--di);font-size:13px;padding:12px;background:var(--s3);border-radius:var(--rs);border:1px dashed var(--bd);text-align:center;margin-bottom:12px">No sites yet. Add your first site below.</div>';
    return;
  }
  S.sites.forEach(function(site, i) {
    var row = el('div');
    row.style.cssText = 'display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:11px 0;border-bottom:1px solid var(--bd)';
    var info = el('div'); info.style.flex = '1';
    var nm = el('div'); nm.style.cssText = 'font-family:Barlow Condensed,sans-serif;font-weight:700;font-size:15px;color:var(--tx)'; nm.textContent = site.name;
    var meta = el('div'); meta.style.cssText = 'font-size:11px;color:var(--mu);margin-top:2px';
    meta.textContent = [site.addr, site.freq, siteStationSummary(site)].filter(Boolean).join(' · ');
    info.appendChild(nm); info.appendChild(meta);
    var btns = el('div'); btns.style.cssText = 'display:flex;gap:6px;flex-shrink:0';
    var histBtn = el('button','btn btn-s btn-xs btn'); histBtn.textContent = '📊 Trends';
    var editBtn = el('button','btn btn-s btn-xs btn'); editBtn.textContent = '✎ Edit';
    var delBtn = el('button','btn btn-d btn-xs btn'); delBtn.textContent = '✕';
    (function(idx) {
      histBtn.addEventListener('click', function() { showSiteHistory(S.sites[idx].name); });
      editBtn.addEventListener('click', function() { editManagedSite(idx); });
      delBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        var removed = S.sites.splice(idx, 1)[0];
        if (removed && removed.id) deleteSiteFromCloud(removed);
        else saveState();
        if (S.selectedSite === idx) S.selectedSite = null;
        renderManageSitesList();
        toast('✓ Site deleted');
      });
    })(i);
    btns.appendChild(histBtn); btns.appendChild(editBtn); btns.appendChild(delBtn);
    row.appendChild(info); row.appendChild(btns);
    list.appendChild(row);
  });
}

function showManagedSiteForm() {
  _editingSiteFromOverlay = -1;
  document.getElementById('manageSiteFormTitle').textContent = 'New Site';
  document.getElementById('ms-name').value = '';
  document.getElementById('ms-addr').value = '';
  document.getElementById('ms-contact').value = '';
  document.getElementById('ms-phone').value = '';
  document.getElementById('ms-email').value = '';
  document.getElementById('ms-tech').value = '';
  document.getElementById('ms-freq').value = '';
  document.getElementById('ms-ir').value = '0';
  document.getElementById('ms-er').value = '0';
  document.getElementById('ms-sp').value = '0';
  document.getElementById('ms-ilt').value = '0';
  document.getElementById('ms-irt').value = '0';
  document.getElementById('manageSiteForm').style.display = 'block';
  document.getElementById('addSiteBtn').style.display = 'none';
  document.getElementById('ms-name').focus();
}

function editManagedSite(idx) {
  _editingSiteFromOverlay = idx;
  var s = S.sites[idx];
  document.getElementById('manageSiteFormTitle').textContent = 'Edit Site';
  document.getElementById('ms-name').value    = s.name    || '';
  document.getElementById('ms-addr').value    = s.addr    || '';
  document.getElementById('ms-contact').value = s.contact || '';
  document.getElementById('ms-phone').value   = s.phone   || '';
  document.getElementById('ms-email').value   = s.email   || '';
  document.getElementById('ms-tech').value    = s.tech    || '';
  document.getElementById('ms-freq').value    = s.freq    || '';
  document.getElementById('ms-ir').value      = s.ir  || 0;
  document.getElementById('ms-er').value      = s.er  || 0;
  document.getElementById('ms-sp').value      = s.sp  || 0;
  document.getElementById('ms-ilt').value     = s.ilt || 0;
  document.getElementById('ms-irt').value     = s.irt || 0;
  document.getElementById('manageSiteForm').style.display = 'block';
  document.getElementById('addSiteBtn').style.display = 'none';
}

function hideManagedSiteForm() {
  document.getElementById('manageSiteForm').style.display = 'none';
  document.getElementById('addSiteBtn').style.display = '';
}

async function saveManagedSite() {
  var name = document.getElementById('ms-name').value.trim();
  if (!name) { toast('⚠ Enter a site name'); return; }
  var site = {
    name:    name,
    addr:    document.getElementById('ms-addr').value.trim(),
    contact: document.getElementById('ms-contact').value.trim(),
    phone:   document.getElementById('ms-phone').value.trim(),
    email:   document.getElementById('ms-email').value.trim(),
    tech:    document.getElementById('ms-tech').value,
    defTech: document.getElementById('ms-tech').value,
    freq:    document.getElementById('ms-freq').value,
    ir:      parseInt(document.getElementById('ms-ir').value)  || 0,
    er:      parseInt(document.getElementById('ms-er').value)  || 0,
    sp:      parseInt(document.getElementById('ms-sp').value)  || 0,
    ilt:     parseInt(document.getElementById('ms-ilt').value) || 0,
    irt:     parseInt(document.getElementById('ms-irt').value) || 0,
  };
  var isEdit = _editingSiteFromOverlay >= 0;
  if (isEdit) { site.id = S.sites[_editingSiteFromOverlay].id; S.sites[_editingSiteFromOverlay] = site; }
  else { S.sites.push(site); }
  localStorage.setItem('es_sites', JSON.stringify(S.sites));
  hideManagedSiteForm();
  renderManageSitesList();
  populateSchedDropdowns();
  if (isDesktop() && typeof renderDesktopTeamPanel === 'function') setTimeout(renderDesktopTeamPanel, 100);
  toast((isEdit ? '\u2713 '+name+' updated' : '\u2713 '+name+' added') + ' — saving...');
  try {
    var ok = await saveSiteToCloud(site);
    if (ok) { localStorage.setItem('es_sites', JSON.stringify(S.sites)); toast('\u2713 '+name+(isEdit?' updated':' saved')); }
    else showSyncBanner('\u26a0 '+name+' saved locally — tap to check Database settings', true, function(){ showAdmin(); showAdminTab('db'); });
  } catch(e) {
    showSyncBanner('\u26a0 Site saved locally — cloud sync failed', true, function(){ showAdmin(); showAdminTab('db'); });
  }
}

document.getElementById('sitesOverlay').addEventListener('click', function(e){
  if (e.target === this) closeSitesOverlay();
});

function renderTechList() {
  var techs = loadTechs();
  var list = document.getElementById('techList');
  list.innerHTML = '';
  if (!techs.length) {
    var empty = el('div');
    empty.style.cssText = 'color:var(--di);font-size:13px;padding:8px 0 12px';
    empty.textContent = 'No technicians saved yet.';
    list.appendChild(empty);
    return;
  }
  techs.forEach(function(t, i) {
    var row = el('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--bd);gap:8px';
    var info = el('div');
    var nm = el('div'); nm.style.cssText = 'font-weight:700;font-size:14px'; nm.textContent = t.name;
    var lic = el('div'); lic.style.cssText = 'font-size:12px;color:var(--mu)';
    lic.textContent = (t.lic ? 'Lic: ' + t.lic : '') + (getTechPin(t.name) ? ' · PIN set ✓' : ' · No PIN set');
    info.appendChild(nm); info.appendChild(lic);
    var btns = el('div'); btns.style.cssText = 'display:flex;gap:6px;flex-shrink:0';
    var pinBtn = el('button','btn btn-s btn-xs btn');
    pinBtn.textContent = '🔑 PIN';
    (function(tech){ pinBtn.addEventListener('click', function(){
      openSetPinOverlay(tech.name, tech.name);
    }); })(t);
    var del = el('button', 'btn btn-d btn-xs btn');
    del.textContent = '✕';
    (function(idx){ del.addEventListener('click', function(){
      var techs2 = loadTechs();
      var removedTech = techs2.splice(idx, 1)[0];
      saveTechs(techs2);
      window._techsList = techs2;
      if (removedTech && removedTech.id) {
        deleteTechFromCloud(removedTech.id);
      } else if (removedTech) {
        // No cloud ID — try to find and delete by name
        sbGet('technicians').then(function(rows) {
          var match = rows.find(function(r){ return r.name === removedTech.name; });
          if (match && match.id) deleteTechFromCloud(match.id);
        }).catch(function(){});
      }
      renderTechList();
      populateTechSelects();
      populateSchedDropdowns();
      if (isDesktop() && typeof renderDesktopTeamPanel === 'function') {
        setTimeout(renderDesktopTeamPanel, 50);
      }
    }); })(i);
    btns.appendChild(pinBtn); btns.appendChild(del);
    row.appendChild(info); row.appendChild(btns);
    list.appendChild(row);
  });
}

function addTech() {
  var name = document.getElementById('nt-name').value.trim();
  var lic  = document.getElementById('nt-lic').value.trim();
  if (!name) { toast('⚠️ Enter technician name'); return; }
  var techs = loadTechs();
  // Check for duplicate
  if (techs.some(function(t){ return t.name.toLowerCase() === name.toLowerCase(); })) {
    toast('⚠️ Technician already exists'); return;
  }
  var newTech = { name: name, lic: lic };
  techs.push(newTech);
  saveTechs(techs);
  // Save to cloud and persist the returned ID
  saveTechToCloud(newTech).then(function(savedTech) {
    if (savedTech && savedTech.id) {
      var latest = loadTechs();
      var idx = latest.findIndex(function(t){ return t.name === savedTech.name && !t.id; });
      if (idx >= 0) { latest[idx].id = savedTech.id; saveTechs(latest); }
      if (isDesktop()) setTimeout(renderDesktopTeamPanel, 100);
    }
  }).catch(function(){});
  document.getElementById('nt-name').value = '';
  document.getElementById('nt-lic').value  = '';
  renderTechList();
  populateTechSelects();
  populateSchedDropdowns();
  if (isDesktop() && typeof renderDesktopTeamPanel === 'function') setTimeout(renderDesktopTeamPanel, 100);
  toast('\u2713 ' + name + ' added');
}

document.getElementById('techOverlay').addEventListener('click', function(e){
  if (e.target === this) closeTechOverlay();
});

// Init tech selects on load
populateTechSelects();
// Restore last selected tech
(function(){
  var last = localStorage.getItem('es_last_tech');
  if (last) {
    var sel = document.getElementById('j-tech-sel');
    if (sel) { sel.value = last; document.getElementById('j-tech').value = last; }
  }
})();

// ============================================================
// src/admin/desktop.js
// ============================================================
  return el ? (el.value || '') : '';
}
function _getEl(id) {
  var daEl = document.querySelector('#desktop-admin-content .da-panel.da-on #' + id);
  if (daEl) return daEl;
  return document.getElementById(id);
}
function _closePwaBanner() {
  var b = document.getElementById('pwa-banner');
  if (b) b.remove();
}

// ════════════════════════════════════════════════════════════════
// DESKTOP DASHBOARD FUNCTIONS
// ════════════════════════════════════════════════════════════════
var _daCurrentTab = 'sched';

function isDesktop() { return window.innerWidth >= 1100; }

function daShow(isAdmin) {
  var da = document.getElementById('desktop-admin');
  if (!da || !isDesktop()) return;
  var locked   = document.getElementById('desktop-admin-locked');
  var content2 = document.getElementById('desktop-admin-content');
  var userDiv  = document.getElementById('desktop-admin-user');
  da.style.display = 'flex';
  da.style.flexDirection = 'column';
  if (isAdmin) {
    if (locked)   locked.style.display   = 'none';
    if (content2) { content2.style.display = 'flex'; content2.style.flexDirection = 'column'; content2.style.flex = '1'; }
    if (userDiv)  userDiv.textContent = (typeof AUTH !== 'undefined' && AUTH.techName) ? AUTH.techName : 'Admin';
    daPopulateAll();
    try { populateSchedDropdowns(); } catch(e) {}
  } else {
    if (locked)   locked.style.display   = 'flex';
    if (content2) content2.style.display = 'none';
    if (userDiv)  userDiv.textContent    = '';
  }
}

function daShowTab(tab) {
  _daCurrentTab = tab;
  document.querySelectorAll('#desktop-admin-tabs button').forEach(function(btn, i) {
    var tabMap = ['sched','db','ai','people','archive','chem'];
    btn.classList.toggle('da-active', tabMap[i] === tab);
  });
  ['sched','db','ai','people','archive','chem'].forEach(function(t) {
    var p = document.getElementById('da-panel-' + t);
    if (p) p.classList.toggle('da-on', t === tab);
  });
  daSyncTabContent(tab);
  showAdminTab(tab);
}

function daSyncTabContent(tab) {
  var src  = document.getElementById('adm-panel-' + tab);
  var dest = document.getElementById('da-panel-' + tab);
  if (!src || !dest) return;
  dest.innerHTML = '';
  dest.appendChild(src.cloneNode(true));
  if (tab === 'people' && isDesktop()) {
    dest.querySelectorAll('button').forEach(function(btn) {
      var oc = btn.getAttribute('onclick') || '';
      if (oc.indexOf('closeAdmin()') >= 0)
        btn.setAttribute('onclick', oc.replace(/closeAdmin\(\);?/g, ''));
    });
    setTimeout(renderDesktopTeamPanel, 50);
  }
  if (tab === 'sched' && isDesktop()) {
    setTimeout(function() { populateSchedDropdowns(); }, 50);
  }
  if (tab === 'archive' && isDesktop()) {
    setTimeout(function() { if (typeof loadArchive === 'function') loadArchive(); }, 50);
  }
  if (tab === 'chem' && isDesktop()) {
    setTimeout(function() { if (typeof loadChemRegister === 'function') loadChemRegister(); }, 50);
  }
  if (tab === 'sched' && isDesktop()) {
    var glanceWrap = document.createElement('div');
    glanceWrap.style.marginBottom = '20px';
    glanceWrap.innerHTML = '<div style="font-family:Barlow Condensed,sans-serif;font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin-bottom:10px">Today at a Glance</div><div id="da-today-glance"></div>';
    dest.insertBefore(glanceWrap, dest.firstChild);
    setTimeout(renderDaTodayGlance, 100);
  }
}

function daPopulateAll() {
  ['sched','db','ai','people','archive','chem'].forEach(function(tab) {
    daSyncTabContent(tab);
  });
  daShowTab(_daCurrentTab);
  renderDaStatsBar().catch(function(){});
}

async function renderDaStatsBar() {
  var bar = document.getElementById('da-stats-bar');
  if (!bar) return;
  var jobs = []; try { jobs = JSON.parse(localStorage.getItem('es_scheduled_jobs') || '[]'); } catch(e) {}
  var today = new Date().toISOString().slice(0,10);
  var todayJobs = jobs.filter(function(j){ return j.date === today; });
  var upcomingJobs = jobs.filter(function(j){ return j.date >= today; });
  var sites = (typeof S !== 'undefined' && S.sites) ? S.sites : [];
  var techs = typeof loadTechs === 'function' ? loadTechs() : [];
  var reportsThisMonth = 0;
  if (typeof isSbConfigured === 'function' && isSbConfigured()) {
    try {
      var ms = new Date(); ms.setDate(1);
      var resp = await fetch(getSbUrl()+'/rest/v1/service_reports?date=gte.'+ms.toISOString().slice(0,10)+'&select=id', {headers:sbHeaders()});
      if (resp.ok) reportsThisMonth = (await resp.json()).length;
    } catch(e) {}
  }
  var stats = [
    {label:"Today's Jobs", value:todayJobs.length, icon:'📅', colour:'#005c38'},
    {label:'Upcoming',     value:upcomingJobs.length, icon:'🗓', colour:'#008350'},
    {label:'Active Sites', value:sites.length, icon:'📍', colour:'#6EC72E'},
    {label:'Team Members', value:techs.length, icon:'👥', colour:'#005c38'},
    {label:'Reports (month)', value:reportsThisMonth, icon:'📄', colour:'#008350'},
  ];
  bar.innerHTML = stats.map(function(s){
    return '<div style="background:#fff;border-radius:10px;padding:14px 18px;border:1px solid #e2e6ed;box-shadow:0 1px 4px rgba(0,0,0,0.05);display:flex;align-items:center;gap:12px;flex:1;min-width:0">'
      +'<div style="font-size:24px;flex-shrink:0">'+s.icon+'</div>'
      +'<div style="min-width:0"><div style="font-family:Barlow Condensed,sans-serif;font-size:28px;font-weight:800;color:'+s.colour+';line-height:1">'+s.value+'</div>'
      +'<div style="font-size:11px;color:#64748b;font-weight:600;margin-top:2px;text-transform:uppercase;letter-spacing:0.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+s.label+'</div></div></div>';
  }).join('');
}

function renderDaTodayGlance() {
  var el = document.getElementById('da-today-glance');
  if (!el) return;
  var jobs = []; try { jobs = JSON.parse(localStorage.getItem('es_scheduled_jobs') || '[]'); } catch(e) {}
  var today = new Date().toISOString().slice(0,10);
  var todayJobs = jobs.filter(function(j){ return j.date === today && j.status !== 'done'; })
    .sort(function(a,b){ return (a.time||'').localeCompare(b.time||''); });
  if (!todayJobs.length) { el.innerHTML = '<div style="color:#64748b;font-size:13px;padding:12px 0">No jobs scheduled for today.</div>'; return; }
  el.innerHTML = '<div style="display:flex;flex-direction:column;gap:8px">'+todayJobs.map(function(j){
    var sc = j.status==='done'?'#008350':j.status==='inprogress'?'#d97706':'#64748b';
    var sl = j.status==='done'?'✓ Done':j.status==='inprogress'?'⏳ In progress':'⏰ Scheduled';
    return '<div style="display:flex;align-items:center;gap:14px;background:#fff;border-radius:10px;padding:12px 16px;border:1px solid #e2e6ed;box-shadow:0 1px 3px rgba(0,0,0,0.04)">'
      +'<div style="font-size:22px">📍</div>'
      +'<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:14px;color:#1e293b">'+(j.siteName||'—')+'</div>'
      +'<div style="font-size:12px;color:#64748b;margin-top:2px">'+(j.time?j.time+' · ':'')+( j.techName||'')+'</div></div>'
      +'<div style="font-size:11px;font-weight:700;color:'+sc+';white-space:nowrap">'+sl+'</div></div>';
  }).join('')+'</div>';
}

function renderDesktopTeamPanel() {
  if (!isDesktop()) return;
  var dest = document.getElementById('da-panel-people');
  if (!dest) return;
  var techs = typeof loadTechs === 'function' ? loadTechs() : [];
  var sites = (typeof S !== 'undefined' && S.sites) ? S.sites : [];
  var techRows = techs.length ? techs.map(function(t){
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#fff;border-radius:8px;margin-bottom:6px;border:1px solid var(--bd);gap:10px">'
      +'<div><div style="font-weight:700;font-size:13px;color:var(--tx)">'+(t.name||'—')+'</div>'
      +'<div style="font-size:11px;color:var(--mu);margin-top:1px">'+(t.lic?'Lic: '+t.lic:'No licence')+'</div></div>'
      +'<button class="btn btn-s btn-sm" onclick="showManageTechs()" style="font-size:11px;padding:5px 10px">Edit</button></div>';
  }).join('') : '<div style="color:var(--mu);font-size:12px;padding:8px 0">No technicians added yet.</div>';
  var siteRows = sites.length ? sites.map(function(s){
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#fff;border-radius:8px;margin-bottom:6px;border:1px solid var(--bd);gap:10px">'
      +'<div style="min-width:0"><div style="font-weight:700;font-size:13px;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+(s.name||'—')+'</div>'
      +'<div style="font-size:11px;color:var(--mu);margin-top:1px">'+(s.addr||'No address')+'</div></div>'
      +'<button class="btn btn-s btn-sm" onclick="showManageSites()" style="font-size:11px;padding:5px 10px">Edit</button></div>';
  }).join('') : '<div style="color:var(--mu);font-size:12px;padding:8px 0">No sites added yet.</div>';
  dest.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">'
    +'<div><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">'
    +'<div style="font-family:Barlow Condensed,sans-serif;font-size:15px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:var(--tx)">👤 Technicians</div>'
    +'<button class="btn btn-p btn-sm" onclick="showManageTechs()" style="font-size:12px">+ Add Technician</button></div>'+techRows+'</div>'
    +'<div><div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">'
    +'<div style="font-family:Barlow Condensed,sans-serif;font-size:15px;font-weight:800;text-transform:uppercase;letter-spacing:0.5px;color:var(--tx)">🏢 Sites</div>'
    +'<button class="btn btn-p btn-sm" onclick="showManageSites()" style="font-size:12px">+ Add Site</button></div>'+siteRows+'</div></div>';
}

// Patch completeLogin / signOut to show/hide desktop panel
(function() {
  var _origComplete = typeof completeLogin === 'function' ? completeLogin : null;
  if (_origComplete) {
    completeLogin = function(techIdx, techName, isAdmin) {
      _origComplete(techIdx, techName, isAdmin);
      if (isDesktop()) daShow(isAdmin);
    };
  }
  var _origSignOut = typeof signOut === 'function' ? signOut : null;
  if (_origSignOut) {
    signOut = function() {
      _origSignOut();
      if (isDesktop()) daShow(false);
    };
  }
})();

// On resize, update desktop panel visibility
window.addEventListener('resize', function() {
  if (typeof AUTH !== 'undefined' && AUTH.loggedIn) {
    if (isDesktop()) daShow(AUTH.isAdmin);
    else {
      var da = document.getElementById('desktop-admin');
      if (da) da.style.display = 'none';
    }
  }
});

// On load, show desktop panel if already logged in
window.addEventListener('load', function() {
  setTimeout(function() {
    if (typeof AUTH !== 'undefined' && AUTH.loggedIn && isDesktop())
      daShow(AUTH.isAdmin);
  }, 500);
});

// Every 60s on home screen: refresh jobs from cloud + update status bar
setInterval(function() {
  if (typeof S === 'undefined' || S.currentScreen !== 0) return;
  if (typeof AUTH === 'undefined' || !AUTH.loggedIn) return;
  if (!isSbConfigured()) return;
  // Silently re-fetch jobs so phone stays in sync with desktop
  loadScheduleFromCloud().then(function(jobs) {
    if (!jobs) return;
    recordSyncSuccess();
    // Refresh job cards if a tech is selected
    if (typeof activeTechIdx === 'number' && activeTechIdx >= 0) {
      showTechJobs(activeTechIdx);
    }
    // Update status bar
    if (typeof _statusCheckSync === 'function') { _statusCheckSync(); _statusUpdateMasterDot(); }
  }).catch(function(){
    if (typeof _statusCheckSync === 'function') { _statusCheckSync(); _statusUpdateMasterDot(); }
  });
}, 60000);

// Populate desktop clone selects when populateSchedDropdowns runs
var _origPopSched = typeof populateSchedDropdowns === 'function' ? populateSchedDropdowns : null;
if (_origPopSched) {
  populateSchedDropdowns = function() {
    _origPopSched();

// ============================================================
// src/admin/archive.js
// ============================================================
    localStorage.setItem('es_local_reports', JSON.stringify(reports));
  } catch(e) { console.warn('_saveReportLocally:',e); }
}
function _markReportSynced(localId) {
  try {
    if (!localId) return;
    var reports = JSON.parse(localStorage.getItem('es_local_reports')||'[]');
    var idx = reports.findIndex(function(r){ return r._localId===localId; });
    if (idx>=0) { reports[idx]._synced=true; localStorage.setItem('es_local_reports',JSON.stringify(reports)); }
  } catch(e) {}
}

// ════════════════════════════════════════════════════════════════
// ARCHIVE TAB
// ════════════════════════════════════════════════════════════════
var _archiveCache = null;
var _archiveFiltered = [];

async function loadArchive() {
  var list = document.getElementById('archiveList');
  if (!list) return;
  list.innerHTML = '<div style="color:var(--mu);font-size:12px;padding:12px 0">Loading reports…</div>';

  try {
    var rows;
    if (isSbConfigured()) {
      var resp = await fetch(getSbUrl() + '/rest/v1/service_reports?order=date.desc&limit=200&select=id,site_name,tech,date,job_num,created_at', { headers: sbHeaders() });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      rows = await resp.json();
    } else {
      // Fall back to local reports
      rows = JSON.parse(localStorage.getItem('es_local_reports') || '[]');
      rows.sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });
    }
    _archiveCache = rows;

    // Populate site filter
    var siteFilter = document.getElementById('archive-site-filter');
    if (siteFilter) {
      var sites = [...new Set(rows.map(function(r){ return r.site_name; }).filter(Boolean))].sort();
      siteFilter.innerHTML = '<option value="">All Sites</option>' +
        sites.map(function(s){ return '<option value="'+s+'">'+s+'</option>'; }).join('');
    }
    filterArchive();
  } catch(e) {
    if (list) list.innerHTML = '<div style="color:var(--r);font-size:12px;padding:12px 0">Failed to load: ' + (e.message||'unknown error') + '</div>';
  }
}

function filterArchive() {
  if (!_archiveCache) { loadArchive(); return; }
  var search = (document.getElementById('archive-search') || {}).value || '';
  var siteVal = (document.getElementById('archive-site-filter') || {}).value || '';
  var q = search.toLowerCase();
  _archiveFiltered = _archiveCache.filter(function(r) {
    if (siteVal && r.site_name !== siteVal) return false;
    if (!q) return true;
    return ((r.site_name||'') + (r.tech||'') + (r.job_num||'') + (r.date||'')).toLowerCase().includes(q);
  });
  renderArchiveList();
}

function renderArchiveList() {
  var list = document.getElementById('archiveList');
  if (!list) return;
  if (!_archiveFiltered.length) {
    list.innerHTML = '<div style="color:var(--mu);font-size:12px;padding:12px 0">No reports found.</div>';
    return;

// ============================================================
// src/admin/chem-register.js
// ============================================================
  list.innerHTML = _archiveFiltered.map(function(r) {
    var d = r.date ? new Date(r.date).toLocaleDateString('en-AU',{day:'2-digit',month:'short',year:'numeric'}) : '—';
    return '<div style="display:flex;align-items:flex-start;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--bd);gap:8px">'
      + '<div style="min-width:0">'
      + '<div style="font-weight:700;font-size:13px;color:var(--tx);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (r.site_name||'—') + '</div>'
      + '<div style="font-size:11px;color:var(--mu);margin-top:2px">' + d + ' · ' + (r.tech||'—') + (r.job_num ? ' · #'+r.job_num : '') + '</div>'
      + '</div>'
      + '<div style="font-size:10px;color:var(--mu);white-space:nowrap;flex-shrink:0;padding-top:2px">ID: '+(r.id||r._localId||'local')+'</div>'
      + '</div>';
  }).join('');
}

// ════════════════════════════════════════════════════════════════
// CHEMICAL REGISTER TAB
// ════════════════════════════════════════════════════════════════
var _chemCache = null;
var _chemFiltered = [];

async function loadChemRegister() {
  var list = document.getElementById('chemRegisterList');
  if (!list) return;
  list.innerHTML = '<div style="color:var(--mu);font-size:12px;padding:12px 0">Loading chemical register…</div>';

  try {
    var rows;
    if (isSbConfigured()) {
      var resp = await fetch(getSbUrl() + '/rest/v1/service_reports?order=date.desc&limit=200&select=id,site_name,date,tech,products', { headers: sbHeaders() });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      rows = await resp.json();
    } else {
      rows = JSON.parse(localStorage.getItem('es_local_reports') || '[]');
    }

    // Flatten products from all reports
    var entries = [];
    rows.forEach(function(r) {
      var prods = r.products;
      if (typeof prods === 'string') { try { prods = JSON.parse(prods); } catch(e) { prods = []; } }
      if (!Array.isArray(prods)) prods = [];
      prods.forEach(function(p) {
        if (!p || !p.name) return;
        entries.push({
          date: r.date || '',
          site: r.site_name || '',
          tech: r.tech || '',
          product: p.name || '',
          rate: p.rate || p.dilution || '',
          area: p.area || p.location || '',
          batch: p.batch || p.epa || '',
          qty: p.qty || p.volume || ''
        });
      });
    });
    entries.sort(function(a,b){ return (b.date||'').localeCompare(a.date||''); });
    _chemCache = entries;

    // Populate site filter
    var siteFilter = document.getElementById('chem-site-filter');
    if (siteFilter) {
      var sites = [...new Set(entries.map(function(e){ return e.site; }).filter(Boolean))].sort();
      siteFilter.innerHTML = '<option value="">All Sites</option>' +
        sites.map(function(s){ return '<option value="'+s+'">'+s+'</option>'; }).join('');
    }
    filterChemRegister();
  } catch(e) {
    if (list) list.innerHTML = '<div style="color:var(--r);font-size:12px;padding:12px 0">Failed to load: ' + (e.message||'unknown error') + '</div>';
  }
}

function filterChemRegister() {
  if (!_chemCache) { loadChemRegister(); return; }
  var search = (document.getElementById('chem-search') || {}).value || '';
  var siteVal = (document.getElementById('chem-site-filter') || {}).value || '';
  var q = search.toLowerCase();
  _chemFiltered = _chemCache.filter(function(e) {
    if (siteVal && e.site !== siteVal) return false;
    if (!q) return true;
    return (e.product + e.site + e.tech + e.batch).toLowerCase().includes(q);
  });
  renderChemRegisterList();
}

function renderChemRegisterList() {
  var list = document.getElementById('chemRegisterList');
  if (!list) return;
  if (!_chemFiltered.length) {
    list.innerHTML = '<div style="color:var(--mu);font-size:12px;padding:12px 0">No chemical records found.</div>';
    return;
  }
  // Table view
  list.innerHTML = '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">'
    + '<thead><tr style="background:var(--s3);color:var(--mu);font-size:10px;text-transform:uppercase;letter-spacing:0.5px">'
    + ['Date','Site','Product','Rate/Dil','Area','Batch/EPA','Tech'].map(function(h){
        return '<th style="padding:8px 10px;text-align:left;white-space:nowrap;border-bottom:1px solid var(--bd)">'+h+'</th>';
      }).join('')
    + '</tr></thead><tbody>'
    + _chemFiltered.map(function(e, i) {
        var bg = i%2===0 ? '#fff' : 'var(--s3)';
        var d = e.date ? new Date(e.date).toLocaleDateString('en-AU',{day:'2-digit',month:'short',year:'2-digit'}) : '—';
        return '<tr style="background:'+bg+'">'
          + [d, e.site, e.product, e.rate, e.area, e.batch, e.tech].map(function(v){
              return '<td style="padding:7px 10px;border-bottom:1px solid var(--bd);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+(v||'—')+'</td>';
            }).join('')
          + '</tr>';
      }).join('')
    + '</tbody></table></div>'
    + '<div style="font-size:10px;color:var(--mu);margin-top:8px;padding:4px 0">'+ _chemFiltered.length +' records</div>';
}

function exportChemRegisterCSV() {
  if (!_chemFiltered || !_chemFiltered.length) { toast('No records to export'); return; }
  var headers = ['Date','Site','Product','Rate/Dilution','Area/Location','Batch/EPA No','Technician'];
  var rows = _chemFiltered.map(function(e) {

// ============================================================
// src/status-bar.js
// ============================================================
  div.innerHTML = '<span style="flex:1;line-height:1.4">'+msg+'</span>'
    +(_pwaPrompt&&!isIOS ? '<button onclick="_triggerInstall()" style="background:#B5DC17;color:#1a2400;border:none;border-radius:8px;padding:7px 12px;font-weight:700;font-size:12px;cursor:pointer;font-family:Barlow,sans-serif;white-space:nowrap">Install</button>' : '')
    +'<button onclick="_closePwaBanner()" style="background:none;border:none;color:rgba(255,255,255,0.7);font-size:18px;cursor:pointer;padding:0 2px">\u00d7</button>';
  document.body.appendChild(div);
  setTimeout(function(){var b=document.getElementById('pwa-banner');if(b)b.remove();}, 15000);
}
function _triggerInstall() {
  if (!_pwaPrompt) return;
  _pwaPrompt.prompt();
  _pwaPrompt.userChoice.then(function(r){ if(r.outcome==='accepted'){var b=document.getElementById('pwa-banner');if(b)b.remove();} _pwaPrompt=null; });
}

// ════════════════════════════════════════════════════════════════
// SYSTEM STATUS BAR
// ════════════════════════════════════════════════════════════════
function _statusSetIndicator(dotId,textId,subId,state,label,sub){
  var colours={ok:'#008350',warn:'#d97706',error:'#dc2626',pending:'#94a3b8'};
  var dot=document.getElementById(dotId),text=document.getElementById(textId),subEl=document.getElementById(subId);
  if(dot)dot.style.background=colours[state]||colours.pending;
  if(text){text.textContent=label;text.style.color=colours[state]||colours.pending;}
  if(subEl)subEl.textContent=sub||'';
}
function _statusUpdateMasterDot(){
  var dot=document.getElementById('statusDot'); if(!dot) return;
  var dbOk=document.getElementById('statusDbDot')&&document.getElementById('statusDbDot').style.background==='rgb(0, 131, 80)';
  var aiOk=document.getElementById('statusAiDot')&&document.getElementById('statusAiDot').style.background==='rgb(0, 131, 80)';
  dot.style.background=(!dbOk||!aiOk)?'#dc2626':'#008350';
}
async function _statusCheckDb(){
  _statusSetIndicator('statusDbDot','statusDbText','statusDbSub','pending','Checking…','');
  if(!isSbConfigured()){_statusSetIndicator('statusDbDot','statusDbText','statusDbSub','error','Not configured','Go to ⚙ Database tab to set up');return false;}
  try{
    var r=await fetch(getSbUrl()+'/rest/v1/sites?limit=1&select=id',{headers:sbHeaders(),signal:AbortSignal.timeout?AbortSignal.timeout(6000):undefined});
    if(r.ok){_statusSetIndicator('statusDbDot','statusDbText','statusDbSub','ok','Connected','Supabase Pro · data syncing');return true;}
    else if(r.status===401){_statusSetIndicator('statusDbDot','statusDbText','statusDbSub','error','Auth failed','API key invalid — re-enter in Database tab');return false;}
    else{_statusSetIndicator('statusDbDot','statusDbText','statusDbSub','warn','HTTP '+r.status,'Tap to retry');return false;}
  }catch(e){
    _statusSetIndicator('statusDbDot','statusDbText','statusDbSub','error',navigator.onLine?'Server unreachable':'No internet',navigator.onLine?'Tap to retry':'Data saved locally');return false;
  }
}
function _statusCheckAi(){
  var key=getApiKey();
  if(!key){_statusSetIndicator('statusAiDot','statusAiText','statusAiSub','error','Not configured','Go to ⚙ AI Key tab');return false;}
  if(!key.startsWith('sk-ant-')){_statusSetIndicator('statusAiDot','statusAiText','statusAiSub','warn','Key looks wrong','Should start with sk-ant-');return false;}
  _statusSetIndicator('statusAiDot','statusAiText','statusAiSub','ok','Key set','Quick Capture & AI report enabled');return true;
}
function _statusCheckSync(){
  var lastSync=localStorage.getItem('es_last_sync_ts');
  if(!lastSync){_statusSetIndicator('statusSyncDot','statusSyncText','statusSyncSub','pending','Never synced',isSbConfigured()?'Will sync shortly':'Set up database first');return;}
  var diff=Date.now()-parseInt(lastSync,10);
  var mins=Math.floor(diff/60000),hrs=Math.floor(diff/3600000);
  var t=mins<1?'Just now':mins<60?mins+'m ago':hrs<24?hrs+'h ago':Math.floor(hrs/24)+'d ago';
  if(diff>30*60*1000)_statusSetIndicator('statusSyncDot','statusSyncText','statusSyncSub','warn',t,'Tap to force sync now');
  else _statusSetIndicator('statusSyncDot','statusSyncText','statusSyncSub','ok',t,'All data synced');
}
async function refreshStatusBar(){
  var bar=document.getElementById('statusBar'); if(!bar||bar.style.display==='none') return;
  await _statusCheckDb(); _statusCheckAi(); _statusCheckSync(); _statusUpdateMasterDot();
  if(typeof AUTH!=='undefined' && AUTH.loggedIn && !AUTH.isAdmin &&
     typeof activeTechIdx==='number' && activeTechIdx>=0){
    try { var jobs=await loadScheduleFromCloud(); if(jobs) showTechJobs(activeTechIdx); } catch(e){}
  }
}
function showStatusBar(){
  var bar=document.getElementById('statusBar'); if(!bar) return;
  bar.style.maxHeight='400px';
  bar.style.marginBottom='14px';
  setTimeout(function(){refreshStatusBar();},200);
}
function hideStatusBar(){
  var bar=document.getElementById('statusBar'); if(!bar) return;
  bar.style.maxHeight='0';
  bar.style.marginBottom='0';
}
function recordSyncSuccess(){
  localStorage.setItem('es_last_sync_ts',Date.now().toString());
  var bar=document.getElementById('statusBar');
  if(bar&&bar.style.display!=='none'){_statusCheckSync();_statusUpdateMasterDot();}
}

function _saveReportLocally(report) {
  try {
    var reports = JSON.parse(localStorage.getItem('es_local_reports')||'[]');
    var localId = report._localId || ('lr_'+Date.now());
    report._localId = localId;
    var existing = reports.findIndex(function(r){ return r._localId===localId; });
    if (existing>=0) reports[existing]=report; else reports.push(report);

// ============================================================
// src/pwa.js
// ============================================================
    var daPanel = document.getElementById('da-panel-sched');
    if (!daPanel) return;
    var techs = typeof loadTechs === 'function' ? loadTechs() : [];
    var sites = (typeof S !== 'undefined' && S.sites) ? S.sites : [];
    var techOpts = '<option value="">— Select Tech —</option>'+techs.map(function(t){return '<option value="'+t.name+'">'+t.name+'</option>';}).join('');
    var siteOpts = '<option value="">— Select Site —</option>'+sites.map(function(s){return '<option value="'+s.name+'">'+s.name+'</option>';}).join('');
    var t = daPanel.querySelector('#sched-tech'); if(t) t.innerHTML = techOpts;
    var s2 = daPanel.querySelector('#sched-site'); if(s2) s2.innerHTML = siteOpts;
    var t2 = daPanel.querySelector('#sched-tech2'); if(t2) t2.innerHTML = '<option value="">— None —</option>'+techs.map(function(tc){return '<option value="'+tc.name+'">'+tc.name+'</option>';}).join('');
  };
}

// ════════════════════════════════════════════════════════════════
// PWA — Service Worker + Install Prompt
// ════════════════════════════════════════════════════════════════
(function() {
  if (!('serviceWorker' in navigator)) return;
  var swCode = [
    'const CACHE="ecosafe-v3";',
    'self.addEventListener("install",function(e){e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(["./"]);}). then(function(){return self.skipWaiting();}));});',
    'self.addEventListener("activate",function(e){e.waitUntil(caches.keys().then(function(keys){return Promise.all(keys.filter(function(k){return k!==CACHE;}).map(function(k){return caches.delete(k);}));}).then(function(){return self.clients.claim();}));});',
    'self.addEventListener("fetch",function(e){var u=e.request.url;if(u.includes("supabase.co")||u.includes("anthropic.com")||u.includes("googleapis")||u.includes("cdnjs")){e.respondWith(fetch(e.request).catch(function(){return caches.match(e.request);}));return;}e.respondWith(caches.match(e.request).then(function(c){if(c)return c;return fetch(e.request).then(function(r){if(!r||r.status!==200)return r;var cl=r.clone();caches.open(CACHE).then(function(ca){ca.put(e.request,cl);});return r;}).catch(function(){return caches.match("./");});}));});'
  ].join('\n');
  var blob = new Blob([swCode],{type:'application/javascript'});
  navigator.serviceWorker.register(URL.createObjectURL(blob),{scope:'./'})
    .then(function(r){})
    .catch(function(e){});
})();

var _pwaPrompt = null;
window.addEventListener('beforeinstallprompt', function(e){
  e.preventDefault(); _pwaPrompt = e;
  setTimeout(function(){
    if (!window.matchMedia('(display-mode: standalone)').matches) _showPwaHint();
  }, 4000);
});
window.addEventListener('appinstalled', function(){
  var b=document.getElementById('pwa-banner'); if(b)b.remove();
  if(typeof toast==='function') toast('\u2713 EcoSafe installed to home screen');
});
function _showPwaHint() {
  if (sessionStorage.getItem('pwa_shown')) return;
  sessionStorage.setItem('pwa_shown','1');
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  var msg = isIOS ? '\uD83D\uDCF2 Install EcoSafe: tap \uD83D\uDCE4 Share \u2192 Add to Home Screen'
                  : '\uD83D\uDCF2 Install EcoSafe as an app for offline access';
  var div = document.createElement('div');
  div.id = 'pwa-banner';

// ============================================================
// src/diagnostic.js
// ============================================================
      }
      if (r.key === 'sb_anon_key' && r.value && !localStorage.getItem('es_sb_anon_key')) {
        localStorage.setItem('es_sb_anon_key', r.value); changed = true;
      }
      if (r.key === 'anthropic_api_key' && r.value) {
        localStorage.setItem('es_api_key', r.value); changed = true;
      }
    });
    return changed;
  } catch(e) { return false; }
}

// ============================================================
// SYNC DIAGNOSTIC
// ============================================================
function openSyncDiag() {
  document.getElementById('syncDiagOverlay').classList.add('show');
  runSyncDiag();
}
function closeSyncDiag() {
  document.getElementById('syncDiagOverlay').classList.remove('show');
}

async function runSyncDiag() {
  var out = document.getElementById('diagResults');
  out.innerHTML = '<div style="color:#64748b">Running tests…</div>';
  var lines = [];

  function row(icon, label, val, color) {
    color = color || '#1e293b';
    lines.push('<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9">' +
      '<span style="color:#475569">' + icon + ' ' + label + '</span>' +
      '<span style="font-weight:700;color:' + color + '">' + val + '</span></div>');
    out.innerHTML = lines.join('');
  }

  // 1. Config check
  var url = getSbUrl();
  var key = getSbKey();
  row('🔗', 'Supabase URL', url.slice(0,40) + '…');
  row('🔑', 'Key starts with', key ? key.slice(0,12) + '…' : 'MISSING', key ? '#008350' : '#dc2626');
  row('✅', 'isSbConfigured()', isSbConfigured() ? 'YES' : 'NO', isSbConfigured() ? '#008350' : '#dc2626');

  // 2. Auth (session user)
  row('👤', 'Logged in as', AUTH.techName || 'Not logged in', AUTH.loggedIn ? '#008350' : '#dc2626');
  row('📋', 'Tech index', AUTH.techIdx !== null ? String(AUTH.techIdx) : 'null', AUTH.techIdx !== null ? '#008350' : '#dc2626');

  // 3. Local schedule
  var localJobs = loadSchedule();
  row('💾', 'Jobs in localStorage', String(localJobs.length));
  if (localJobs.length) {
    var names = [...new Set(localJobs.map(function(j){ return j.techName || '(none)'; }))];
    row('👷', 'Tech names in jobs', names.join(', '));
  }

  // 4. Tech list
  var techs = loadTechs();
  row('👥', 'Technicians loaded', String(techs.length));
  techs.forEach(function(t, i) {
    row('  #' + i, t.name, t.id ? '(cloud id: ' + String(t.id).slice(0,8) + '…)' : '(local only)');
  });

  // 5. Live Supabase: GET sites
  row('⏳', 'Testing sites table…', '');
  try {
    var r = await fetch(url + '/rest/v1/sites?limit=1&select=id', { headers: sbHeaders(), signal: AbortSignal.timeout(6000) });
    row('📋', 'GET sites', 'HTTP ' + r.status, r.ok ? '#008350' : '#dc2626');
  } catch(e) {
    row('📋', 'GET sites', 'ERROR: ' + e.message, '#dc2626');
  }

  // 6. Live Supabase: GET scheduled_jobs
  row('⏳', 'Testing scheduled_jobs…', '');
  try {
    var r2 = await fetch(url + '/rest/v1/scheduled_jobs?limit=50&select=id,tech_name,site_name,date,active,done', { headers: sbHeaders(), signal: AbortSignal.timeout(6000) });
    if (r2.ok) {
      var jobs = await r2.json();
      row('📅', 'GET scheduled_jobs', 'HTTP 200 · ' + jobs.length + ' rows', '#008350');
      if (jobs.length) {
        jobs.forEach(function(j) {
          row('  job', j.tech_name + ' / ' + j.site_name, j.date + (j.done ? ' DONE' : j.active === false ? ' INACTIVE' : ' ✓'));
        });
      } else {
        row('⚠️', 'No jobs in Supabase', 'Table is empty — jobs may not be saving', '#f59e0b');
      }
    } else {
      var body = ''; try { body = await r2.text(); } catch(e) {}
      row('📅', 'GET scheduled_jobs', 'HTTP ' + r2.status + ' ' + body.slice(0,60), '#dc2626');
      if (r2.status === 400 || r2.status === 42501) {
        row('🔒', 'RLS may be blocking reads', 'Disable RLS on scheduled_jobs in Supabase', '#dc2626');
      }
    }
  } catch(e) {
    row('📅', 'GET scheduled_jobs', 'ERROR: ' + e.message, '#dc2626');
  }

  // 7. Name match check
  if (AUTH.loggedIn && typeof activeTechIdx === 'number' && activeTechIdx >= 0) {
    var myTech = loadTechs()[activeTechIdx];
    if (myTech) {
      var myName = myTech.name.trim().toLowerCase();
      var localMatch = localJobs.filter(function(j){ return (j.techName||'').trim().toLowerCase() === myName; });
      row('🔍', 'Name match (' + myTech.name + ')', localMatch.length + ' jobs match locally');
    }
  }

  // 8. Test INSERT permission on scheduled_jobs
  row('⏳', 'Testing INSERT on scheduled_jobs…', '');
  try {
    var testPayload = {
      tech_name: '__diag_test__',
      site_name: '__diag_test__',
      site_addr: '',
      date: today,
      done: false,
      active: false
    };
    var today = new Date().toISOString().slice(0,10);
    testPayload.date = today;
    var ir = await fetch(url + '/rest/v1/scheduled_jobs', {
      method: 'POST',
      headers: sbHeaders(),
      body: JSON.stringify(testPayload),
      signal: AbortSignal.timeout(6000)
    });
    if (ir.ok || ir.status === 201) {
      var iBody = await ir.json();
      row('✅', 'INSERT scheduled_jobs', 'HTTP ' + ir.status + ' — WORKS', '#008350');
      // Clean up test row
      if (iBody && iBody[0] && iBody[0].id) {
        fetch(url + '/rest/v1/scheduled_jobs?id=eq.' + iBody[0].id, {
          method: 'DELETE', headers: sbHeaders()
        }).catch(function(){});
      }
    } else {
      var iErr = ''; try { iErr = await ir.text(); } catch(e2){}
      row('❌', 'INSERT scheduled_jobs', 'HTTP ' + ir.status + ' BLOCKED — ' + iErr.slice(0,80), '#dc2626');
      row('🔒', 'RLS is blocking writes', 'In Supabase: Table Editor → scheduled_jobs → RLS → Disable', '#dc2626');
    }
  } catch(e) {
    row('❌', 'INSERT test', 'ERROR: ' + e.message, '#dc2626');
  }

  row('✅', 'Diagnostic complete', new Date().toLocaleTimeString(), '#008350');
}


// ============================================================
// ONE-TIME DUPLICATE JOB CLEANUP
// ============================================================
async function cleanupDuplicateJobs() {
  if (!isSbConfigured()) { toast('⚠️ Not connected to database'); return; }
  toast('🧹 Loading jobs from Supabase…');
  try {
    var rows = await sbGet('scheduled_jobs');
    toast('Found ' + rows.length + ' total jobs — identifying duplicates…');

    // Group by tech+site+date — keep the one with the earliest-sorting id
    var seen = {};
    var keepIds = [];
    var toDelete = [];
    rows.forEach(function(r) {
      var key = (r.tech_name||'').trim().toLowerCase() + '|' +
                (r.site_name||'').trim().toLowerCase() + '|' +
                (r.date||'');
      if (!seen[key]) {
        seen[key] = r.id;
        keepIds.push(r.id);
      } else {
        toDelete.push(r.id);
      }
    });

    if (toDelete.length === 0) {
      toast('✅ No duplicates found — ' + rows.length + ' unique jobs.');
      localStorage.removeItem('es_sched');
      localStorage.removeItem('es_scheduled_jobs');
      await loadScheduleFromCloud();
      if (typeof activeTechIdx==='number' && activeTechIdx>=0) showTechJobs(activeTechIdx);
      if (typeof filterSched==='function') filterSched(schedFilter||'upcoming');
      return;
    }

    toast('Deleting ' + toDelete.length + ' duplicates (keeping ' + keepIds.length + ')…');

    // Bulk delete using Supabase IN filter — much faster than one-by-one
    // Supabase supports: DELETE /rest/v1/table?id=in.(uuid1,uuid2,...)
    var BATCH = 100; // Supabase URL length limit
    var deleted = 0;
    for (var i = 0; i < toDelete.length; i += BATCH) {
      var batch = toDelete.slice(i, i + BATCH);
      try {
        var delUrl = getSbUrl() + '/rest/v1/scheduled_jobs?id=in.(' + batch.join(',') + ')';
        var dr = await fetch(delUrl, { method: 'DELETE', headers: sbHeaders() });
        if (dr.ok) deleted += batch.length;
        else {
          var errBody = ''; try { errBody = await dr.text(); } catch(e2) {}
          toast('⚠️ Batch delete HTTP ' + dr.status + ': ' + errBody.slice(0,80));
        }
      } catch(e) { toast('⚠️ Batch delete error: ' + e.message); }
      // Small pause between batches
      await new Promise(function(res){ setTimeout(res, 200); });
    }

    // Clear localStorage and reload clean data
    localStorage.removeItem('es_sched');
    localStorage.removeItem('es_scheduled_jobs');
    var fresh = await loadScheduleFromCloud();
    if (typeof activeTechIdx==='number' && activeTechIdx>=0) showTechJobs(activeTechIdx);
    if (typeof filterSched==='function') filterSched(schedFilter||'upcoming');
    toast('✅ Done! Deleted ' + deleted + ' duplicates. ' + fresh.length + ' unique jobs remain.');
  } catch(e) {
    toast('❌ Cleanup failed: ' + e.message);
  }
}


