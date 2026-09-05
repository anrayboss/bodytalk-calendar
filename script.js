/* ============================================================
   script.js — bodytalk-calendar
   GitHub JSON as DB | Role-based | GitHub PAT auth
   ============================================================ */

// ──────────────────────────────────────────
//  CONFIG & STATE
// ──────────────────────────────────────────
const REPO_OWNER = 'anrayboss';
const REPO_NAME  = 'bodytalk-calendar';
const BRANCH     = 'main';
const RAW_BASE   = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}`;
const API_BASE   = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`;

let state = {
  events: [],
  config: { roles: {} },
  fileSha: { events: null, config: null },
  currentDate: new Date(),
  calView: 'month',      // 'month' | 'week' | 'day'
  activeEvent: null,
  user: null,            // { token, username, avatarUrl, role }
  searchQuery: '',
  undoStack: [],
  redoStack: [],
};

// ──────────────────────────────────────────
//  INIT
// ──────────────────────────────────────────
async function init() {
  await loadConfig();
  await loadEvents();
  restoreAuth();
  renderCalendar();
  renderTextList();
  setupKeyboard();
}

async function loadConfig() {
  try {
    const r = await fetch(`${RAW_BASE}/config.json?t=${Date.now()}`);
    state.config = await r.json();
  } catch (e) {
    console.warn('config.json load failed', e);
  }
}

async function loadEvents() {
  showSyncStatus(true);
  try {
    const r = await fetch(`${RAW_BASE}/events.json?t=${Date.now()}`);
    const data = await r.json();
    state.events = data.events || [];
    // Also get the file SHA for writing
    if (state.user?.token) {
      await fetchFileSha('events.json', 'events');
    }
    updateLastSync();
  } catch (e) {
    console.error('events.json load failed', e);
    showToast('讀取活動資料失敗', 'error');
  }
  showSyncStatus(false);
}

async function fetchFileSha(path, key) {
  try {
    const r = await ghAPI(`${API_BASE}/contents/${path}`);
    if (r.ok) {
      const d = await r.json();
      state.fileSha[key] = d.sha;
    }
  } catch (e) {}
}

// ──────────────────────────────────────────
//  AUTH
// ──────────────────────────────────────────
function restoreAuth() {
  const stored = localStorage.getItem('bt-pat');
  if (stored) {
    const parsed = JSON.parse(stored);
    state.user = parsed;
    updateAuthUI();
    fetchFileSha('events.json', 'events');
    fetchFileSha('config.json', 'config');
  }
}

async function saveAuth() {
  const token = document.getElementById('pat-input').value.trim();
  if (!token) return;
  showSyncStatus(true);
  try {
    const r = await fetch('https://api.github.com/user', {
      headers: { Authorization: `token ${token}`, Accept: 'application/vnd.github.v3+json' }
    });
    if (!r.ok) { showToast('Token 無效，請重新確認', 'error'); showSyncStatus(false); return; }
    const u = await r.json();
    const role = state.config.roles[u.login] || 'collaborator';
    state.user = { token, username: u.login, avatarUrl: u.avatar_url, role };
    localStorage.setItem('bt-pat', JSON.stringify(state.user));
    await fetchFileSha('events.json', 'events');
    await fetchFileSha('config.json', 'config');
    updateAuthUI();
    closeAuthModal();
    showToast(`歡迎回來，${u.login}！`);
  } catch (e) {
    showToast('驗證失敗，請檢查網路', 'error');
  }
  showSyncStatus(false);
}

function logout() {
  state.user = null;
  localStorage.removeItem('bt-pat');
  updateAuthUI();
  closeAuthModal();
  renderCalendar();
  showToast('已登出');
}

function updateAuthUI() {
  const u = state.user;
  const label = document.getElementById('auth-label');
  const loggedIn = document.getElementById('auth-logged-in');
  const avatar = document.getElementById('auth-avatar');
  const uname = document.getElementById('auth-username');
  const roleBadge = document.getElementById('auth-role-badge');
  const btnLogout = document.getElementById('btn-logout');
  const btnAdd = document.getElementById('btn-add-event');
  const btnAddMob = document.getElementById('btn-add-event-mobile');

  if (u) {
    label.textContent = u.username;
    loggedIn.classList.remove('hidden');
    avatar.src = u.avatarUrl;
    uname.textContent = u.username;
    roleBadge.textContent = u.role === 'admin' ? '⚙️ 管理員' : '👤 協作者';
    roleBadge.className = `text-xs ${u.role === 'admin' ? 'text-amber-500' : 'text-teal-500'}`;
    btnLogout.style.display = '';
    if (u.role === 'admin') {
      btnAdd.style.display = '';
      if (btnAddMob) btnAddMob.style.display = '';
    }
  } else {
    label.textContent = '設定登入';
    loggedIn.classList.add('hidden');
    btnLogout.style.display = 'none';
    btnAdd.style.display = 'none';
    if (btnAddMob) btnAddMob.style.display = 'none';
  }
}

// ──────────────────────────────────────────
//  CALENDAR RENDERING
// ──────────────────────────────────────────
function renderCalendar() {
  const container = document.getElementById('calendar-container');
  container.innerHTML = '';

  if (state.calView === 'month') renderMonth(container);
  else if (state.calView === 'week') renderWeek(container);
  else renderDay(container);

  updateCalTitle();
}

// --- MONTH VIEW ---
function renderMonth(container) {
  const d = state.currentDate;
  const year = d.getFullYear(), month = d.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDow = firstDay.getDay(); // 0=Sun

  const today = new Date(); today.setHours(0,0,0,0);

  // Header row (Sun–Sat)
  const header = document.createElement('div');
  header.className = 'cal-dow-header shrink-0';
  ['日','一','二','三','四','五','六'].forEach(d => {
    const c = document.createElement('div');
    c.className = 'cal-dow-cell';
    c.textContent = d;
    header.appendChild(c);
  });
  container.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'cal-month-grid';
  grid.style.gridAutoRows = '1fr';

  // Total cells: 6 rows × 7 cols = 42
  const totalCells = 42;
  for (let i = 0; i < totalCells; i++) {
    const dayOffset = i - startDow;
    const cellDate = new Date(year, month, dayOffset + 1);
    cellDate.setHours(0,0,0,0);
    const isThisMonth = cellDate.getMonth() === month;
    const isToday = cellDate.getTime() === today.getTime();

    const cell = document.createElement('div');
    cell.className = `cal-day-cell${!isThisMonth ? ' other-month' : ''}${isToday ? ' is-today' : ''}`;

    const num = document.createElement('div');
    num.className = 'cal-day-num';
    num.textContent = cellDate.getDate();
    cell.appendChild(num);

    // Events for this day
    const dateStr = fmtDate(cellDate);
    const dayEvts = getEventsForDate(dateStr);
    dayEvts.forEach(evt => {
      const chip = buildChip(evt);
      cell.appendChild(chip);
    });

    grid.appendChild(cell);
  }
  container.appendChild(grid);
}

// --- WEEK VIEW ---
function renderWeek(container) {
  const d = state.currentDate;
  const weekStart = new Date(d);
  weekStart.setDate(d.getDate() - d.getDay()); // Sunday
  weekStart.setHours(0,0,0,0);

  const today = new Date(); today.setHours(0,0,0,0);

  const wrap = document.createElement('div');
  wrap.className = 'cal-week-wrap';

  // Header
  const hdr = document.createElement('div');
  hdr.className = 'cal-week-header';
  const timePad = document.createElement('div');
  timePad.className = 'w-[52px]';
  hdr.appendChild(timePad);

  const dows = ['日','一','二','三','四','五','六'];
  for (let i = 0; i < 7; i++) {
    const date = new Date(weekStart); date.setDate(weekStart.getDate() + i);
    const isToday = date.getTime() === today.getTime();
    const cell = document.createElement('div');
    cell.className = `week-day-head${isToday ? ' is-today' : ''}`;
    cell.innerHTML = `<div class="dow">${dows[i]}</div><div class="dom">${date.getDate()}</div>`;
    hdr.appendChild(cell);
  }
  wrap.appendChild(hdr);

  // Body
  const body = document.createElement('div');
  body.className = 'cal-week-body';

  // Time column
  const timeCol = document.createElement('div');
  timeCol.className = 'cal-week-time-col shrink-0';
  for (let h = 0; h < 24; h++) {
    const slot = document.createElement('div');
    slot.className = 'cal-week-time-slot';
    slot.textContent = h === 0 ? '' : `${h}:00`;
    timeCol.appendChild(slot);
  }
  body.appendChild(timeCol);

  // Days
  const daysGrid = document.createElement('div');
  daysGrid.className = 'cal-week-days';

  for (let i = 0; i < 7; i++) {
    const date = new Date(weekStart); date.setDate(weekStart.getDate() + i);
    const dateStr = fmtDate(date);
    const col = document.createElement('div');
    col.className = 'cal-week-day-col';

    // Hour lines
    for (let h = 0; h < 24; h++) {
      const line = document.createElement('div');
      line.className = 'week-hour-line';
      col.appendChild(line);
    }

    // Events
    const dayEvts = getEventsForDate(dateStr);
    dayEvts.forEach(evt => {
      const block = buildWeekEvtBlock(evt, 48);
      col.appendChild(block);
    });
    daysGrid.appendChild(col);
  }
  body.appendChild(daysGrid);
  wrap.appendChild(body);
  container.appendChild(wrap);
}

// --- DAY VIEW ---
function renderDay(container) {
  const d = state.currentDate;
  d.setHours(0,0,0,0);
  const dateStr = fmtDate(d);
  const dayEvts = getEventsForDate(dateStr);

  const wrap = document.createElement('div');
  wrap.className = 'cal-day-wrap';

  const hdr = document.createElement('div');
  hdr.className = 'cal-day-header';
  const tw = d.toLocaleDateString('zh-TW', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  hdr.innerHTML = `<p class="text-base font-bold text-slate-800 dark:text-slate-100">${tw}</p>
                   <p class="text-xs text-slate-400 mt-0.5">${dayEvts.length} 個活動</p>`;
  wrap.appendChild(hdr);

  const body = document.createElement('div');
  body.className = 'cal-day-body';

  const timeCol = document.createElement('div');
  timeCol.className = 'cal-day-time-col shrink-0';
  for (let h = 0; h < 24; h++) {
    const slot = document.createElement('div');
    slot.className = 'cal-day-time-slot';
    slot.textContent = h === 0 ? '' : `${h}:00`;
    timeCol.appendChild(slot);
  }
  body.appendChild(timeCol);

  const evtCol = document.createElement('div');
  evtCol.className = 'cal-day-events-col';
  for (let h = 0; h < 24; h++) {
    const line = document.createElement('div');
    line.className = 'day-hour-line';
    evtCol.appendChild(line);
  }
  dayEvts.forEach(evt => {
    const block = buildWeekEvtBlock(evt, 64);
    block.className = block.className.replace('week-evt-block', 'day-evt-block');
    evtCol.appendChild(block);
  });
  body.appendChild(evtCol);
  wrap.appendChild(body);
  container.appendChild(wrap);
}

// ──────────────────────────────────────────
//  EVENT CHIP / BLOCK BUILDERS
// ──────────────────────────────────────────
function buildChip(evt) {
  const chip = document.createElement('div');
  const matched = state.searchQuery && evt.title.toLowerCase().includes(state.searchQuery.toLowerCase());
  chip.className = `evt-chip evt-${evt.type}${evt.assignee ? ' is-assigned' : ''}${matched ? ' search-match' : ''}`;

  if (evt.assignee) {
    chip.innerHTML = `<img src="https://github.com/${evt.assignee}.png?size=16" style="width:12px;height:12px;border-radius:50%;display:inline;vertical-align:middle;margin-right:3px"> ${evt.start_time} ${shortTitle(evt.title)}`;
  } else {
    chip.innerHTML = `${evt.start_time} ${shortTitle(evt.title)}`;
  }
  chip.addEventListener('click', () => openEventModal(evt));
  return chip;
}

function buildWeekEvtBlock(evt, hourPx) {
  const [sh, sm] = evt.start_time.split(':').map(Number);
  const [eh, em] = evt.end_time.split(':').map(Number);
  const top = (sh + sm/60) * hourPx;
  const height = Math.max(((eh + em/60) - (sh + sm/60)) * hourPx, 20);

  const colors = { public: 'background:#fef3c7;color:#92400e', course: 'background:#ede9fe;color:#5b21b6', study_group: 'background:#ccfbf1;color:#134e4a' };
  const block = document.createElement('div');
  block.className = 'week-evt-block';
  block.style.cssText = `top:${top}px;height:${height}px;${colors[evt.type]||colors.public}`;
  block.innerHTML = `<div style="font-weight:600">${evt.start_time}</div><div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${shortTitle(evt.title)}</div>`;
  if (evt.assignee) block.title = `接待：${evt.assignee}`;
  block.addEventListener('click', () => openEventModal(evt));
  return block;
}

function shortTitle(t) {
  // Remove leading 【...】 bracket group, keep the rest; truncate at 12 chars
  const stripped = t.replace(/^[✨\s]*【[^】]*】/, '').trim() || t.replace(/^[✨\s]*/, '');
  return stripped.length > 14 ? stripped.slice(0,14) + '…' : stripped;
}

// ──────────────────────────────────────────
//  CALENDAR TITLE & NAV
// ──────────────────────────────────────────
function updateCalTitle() {
  const d = state.currentDate;
  const el = document.getElementById('cal-title');
  if (state.calView === 'month') {
    el.textContent = d.toLocaleDateString('zh-TW', { year:'numeric', month:'long' });
  } else if (state.calView === 'week') {
    const ws = new Date(d); ws.setDate(d.getDate() - d.getDay());
    const we = new Date(ws); we.setDate(ws.getDate() + 6);
    el.textContent = `${ws.getMonth()+1}/${ws.getDate()} – ${we.getMonth()+1}/${we.getDate()}`;
  } else {
    el.textContent = d.toLocaleDateString('zh-TW', { month:'long', day:'numeric', weekday:'short' });
  }
}

function navPrev() {
  const d = state.currentDate;
  if (state.calView === 'month') d.setMonth(d.getMonth()-1);
  else if (state.calView === 'week') d.setDate(d.getDate()-7);
  else d.setDate(d.getDate()-1);
  renderCalendar(); renderTextList();
}
function navNext() {
  const d = state.currentDate;
  if (state.calView === 'month') d.setMonth(d.getMonth()+1);
  else if (state.calView === 'week') d.setDate(d.getDate()+7);
  else d.setDate(d.getDate()+1);
  renderCalendar(); renderTextList();
}
function goToday() {
  state.currentDate = new Date();
  renderCalendar(); renderTextList();
}
function setCalView(v) {
  state.calView = v;
  ['month','week','day'].forEach(vv => {
    const btn = document.getElementById(`btn-view-${vv}`);
    if (btn) btn.classList.toggle('active-view', vv === v);
  });
  // also sync mobile buttons
  document.querySelectorAll('.view-btn').forEach(b => {
    const matches = b.onclick?.toString().includes(`'${v}'`) || b.getAttribute('onclick')?.includes(`'${v}'`);
    if (matches) b.classList.add('active-view'); else b.classList.remove('active-view');
  });
  renderCalendar();
}

// ──────────────────────────────────────────
//  TEXT LIST
// ──────────────────────────────────────────
function renderTextList() {
  const el = document.getElementById('text-list');
  const d = state.currentDate;
  const year = d.getFullYear(), month = d.getMonth();

  const monthEvts = state.events
    .filter(e => { const ed = new Date(e.date); return ed.getFullYear()===year && ed.getMonth()===month; })
    .sort((a,b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time));

  if (monthEvts.length === 0) { el.innerHTML = '<p class="text-slate-400 text-center py-8">本月尚無活動</p>'; return; }

  let html = '';
  let lastDate = '';
  monthEvts.forEach(e => {
    if (e.date !== lastDate) {
      const dt = new Date(e.date);
      const label = dt.toLocaleDateString('zh-TW', { month:'numeric', day:'numeric', weekday:'short' });
      html += `<div class="tl-date-header">${label}</div>`;
      lastDate = e.date;
    }
    const assigneeTag = e.assignee ? ` <span class="text-teal-500">@${e.assignee}</span>` : '';
    html += `<div class="tl-event cursor-pointer hover:text-teal-500 transition" onclick='openEventModal(${JSON.stringify(e)})'>${e.start_time} ${e.title}${assigneeTag}</div>`;
  });
  el.innerHTML = html;
}

function copyTextList() {
  const el = document.getElementById('text-list');
  navigator.clipboard.writeText(el.innerText).then(() => showToast('已複製到剪貼板'));
}

// ──────────────────────────────────────────
//  EVENT MODAL
// ──────────────────────────────────────────
function openEventModal(evt) {
  state.activeEvent = evt;
  const u = state.user;
  const isAdmin = u?.role === 'admin';
  const isAssignee = u?.username === evt.assignee;

  // Populate
  const typeLabels = { public:'公益活動', course:'正式課程', study_group:'讀書會' };
  const typeCls    = { public:'badge-public', course:'badge-course', study_group:'badge-study_group' };
  const badge = document.getElementById('modal-type-badge');
  badge.textContent = typeLabels[evt.type] || evt.type;
  badge.className = `inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${typeCls[evt.type] || 'badge-public'}`;

  document.getElementById('modal-title').textContent = evt.title;

  const dt = new Date(evt.date);
  document.getElementById('modal-date').textContent = dt.toLocaleDateString('zh-TW', { year:'numeric', month:'long', day:'numeric', weekday:'long' });
  document.getElementById('modal-time').textContent = `${evt.start_time} – ${evt.end_time}`;

  setInfoRow('modal-location-row', 'modal-location', evt.location);
  setInfoRow('modal-host-row', 'modal-host', evt.host);
  setInfoRow('modal-notes-row', 'modal-notes', evt.notes);

  // Reg link
  const regLink = document.getElementById('modal-reg-link');
  if (evt.registration_url) {
    regLink.href = evt.registration_url;
    regLink.style.display = '';
  } else {
    regLink.style.display = 'none';
  }

  // Assignee display
  const aEl = document.getElementById('modal-assignee');
  if (evt.assignee) {
    aEl.innerHTML = `
      <img src="https://github.com/${evt.assignee}.png?size=64" class="assignee-avatar" alt="${evt.assignee}" onerror="this.style.display='none'">
      <div>
        <p class="font-semibold text-slate-800 dark:text-slate-100 text-sm">${evt.assignee}</p>
        <p class="text-xs text-teal-500">已認領接待</p>
      </div>`;
  } else {
    aEl.innerHTML = `<p class="text-sm text-slate-400 flex items-center gap-2"><i class="fa-regular fa-circle-question"></i> 尚無人接待，快來認領！</p>`;
  }

  // Buttons visibility
  const btnClaim   = document.getElementById('btn-claim');
  const btnUnclaim = document.getElementById('btn-unclaim');
  const btnEdit    = document.getElementById('btn-edit-event');
  const btnDelete  = document.getElementById('btn-delete-event');

  const canClaim = u && !evt.assignee;
  const canUnclaim = u && (isAssignee || isAdmin) && evt.assignee;
  btnClaim.style.display    = canClaim ? '' : 'none';
  btnUnclaim.style.display  = canUnclaim ? '' : 'none';
  btnEdit.style.display     = isAdmin ? '' : 'none';
  btnDelete.style.display   = isAdmin ? '' : 'none';

  document.getElementById('event-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeEventModal(e) {
  if (e && e.target !== document.getElementById('event-modal')) return;
  document.getElementById('event-modal').classList.add('hidden');
  document.body.style.overflow = '';
  state.activeEvent = null;
}

function setInfoRow(rowId, fieldId, val) {
  const row = document.getElementById(rowId);
  if (val) {
    document.getElementById(fieldId).textContent = val;
    row.classList.remove('hidden');
  } else {
    row.classList.add('hidden');
  }
}

// ──────────────────────────────────────────
//  CLAIM / UNCLAIM
// ──────────────────────────────────────────
async function claimEvent() {
  if (!state.user) { openAuthModal(); return; }
  const evt = state.activeEvent;
  if (!evt) return;
  await updateEventField(evt.id, { assignee: state.user.username }, `認領活動：${evt.title}`);
  openEventModal(state.events.find(e => e.id === evt.id));
}

async function unclaimEvent() {
  const evt = state.activeEvent;
  if (!evt) return;
  await updateEventField(evt.id, { assignee: null }, `取消認領：${evt.title}`);
  openEventModal(state.events.find(e => e.id === evt.id));
}

// ──────────────────────────────────────────
//  EVENT FORM
// ──────────────────────────────────────────
function openEventForm(evtId) {
  const isEdit = !!evtId;
  document.getElementById('form-modal-title').textContent = isEdit ? '編輯活動' : '新增活動';
  document.getElementById('form-event-id').value = evtId || '';

  if (isEdit) {
    const e = state.events.find(ev => ev.id === evtId);
    if (!e) return;
    document.getElementById('form-title').value    = e.title;
    document.getElementById('form-type').value     = e.type;
    document.getElementById('form-date').value     = e.date;
    document.getElementById('form-start').value    = e.start_time;
    document.getElementById('form-end').value      = e.end_time;
    document.getElementById('form-location').value = e.location || '';
    document.getElementById('form-host').value     = e.host || '';
    document.getElementById('form-url').value      = e.registration_url || '';
    document.getElementById('form-notes').value    = e.notes || '';
  } else {
    document.getElementById('event-form').reset();
    document.getElementById('form-date').value = fmtDate(new Date());
  }

  document.getElementById('form-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function editCurrentEvent() {
  if (state.activeEvent) {
    closeEventModal({ target: null });
    openEventForm(state.activeEvent.id);
  }
}

function closeFormModal(e) {
  if (e && e.target !== document.getElementById('form-modal')) return;
  document.getElementById('form-modal').classList.add('hidden');
  document.body.style.overflow = '';
}

async function submitEventForm(e) {
  e.preventDefault();
  const evtId = document.getElementById('form-event-id').value;
  const isEdit = !!evtId;

  const newEvt = {
    id: evtId || `evt_${Date.now()}`,
    title:            document.getElementById('form-title').value.trim(),
    type:             document.getElementById('form-type').value,
    date:             document.getElementById('form-date').value,
    start_time:       document.getElementById('form-start').value,
    end_time:         document.getElementById('form-end').value,
    location:         document.getElementById('form-location').value.trim(),
    host:             document.getElementById('form-host').value.trim(),
    registration_url: document.getElementById('form-url').value.trim(),
    notes:            document.getElementById('form-notes').value.trim(),
    assignee:         isEdit ? (state.events.find(ev=>ev.id===evtId)?.assignee||null) : null,
    external_id:      isEdit ? (state.events.find(ev=>ev.id===evtId)?.external_id||null) : null,
  };

  pushUndo();
  if (isEdit) {
    state.events = state.events.map(ev => ev.id === evtId ? newEvt : ev);
  } else {
    state.events.push(newEvt);
  }

  await saveEventsToGitHub(isEdit ? `編輯活動：${newEvt.title}` : `新增活動：${newEvt.title}`);
  closeFormModal({ target: null });
  renderCalendar(); renderTextList();
  showToast(isEdit ? '活動已更新' : '活動已新增');
}

async function deleteCurrentEvent() {
  const evt = state.activeEvent;
  if (!evt || !confirm(`確定要刪除「${evt.title}」嗎？`)) return;
  pushUndo();
  state.events = state.events.filter(e => e.id !== evt.id);
  await saveEventsToGitHub(`刪除活動：${evt.title}`);
  closeEventModal({ target: null });
  renderCalendar(); renderTextList();
  showToast('活動已刪除');
}

// ──────────────────────────────────────────
//  GITHUB API WRITE
// ──────────────────────────────────────────
async function updateEventField(evtId, fields, commitMsg) {
  pushUndo();
  state.events = state.events.map(e => e.id === evtId ? { ...e, ...fields } : e);
  await saveEventsToGitHub(commitMsg);
  renderCalendar(); renderTextList();
}

async function saveEventsToGitHub(commitMsg) {
  if (!state.user?.token) { showToast('請先設定 GitHub Token', 'error'); return; }
  showSyncStatus(true);
  try {
    const content = { version:'1.0', updated_at: new Date().toISOString(), events: state.events };
    const body = {
      message: `[calendar] ${commitMsg}`,
      content: btoa(unescape(encodeURIComponent(JSON.stringify(content, null, 2)))),
      sha: state.fileSha.events,
      branch: BRANCH,
      committer: { name: state.user.username, email: `${state.user.username}@users.noreply.github.com` }
    };
    const r = await ghAPI(`${API_BASE}/contents/events.json`, 'PUT', body);
    if (r.ok) {
      const d = await r.json();
      state.fileSha.events = d.content.sha;
      updateLastSync();
    } else {
      const err = await r.json();
      throw new Error(err.message);
    }
  } catch (err) {
    console.error(err);
    showToast(`儲存失敗：${err.message}`, 'error');
  }
  showSyncStatus(false);
}

async function ghAPI(url, method='GET', body) {
  const headers = { Accept: 'application/vnd.github.v3+json' };
  if (state.user?.token) headers.Authorization = `token ${state.user.token}`;
  const opts = { method, headers };
  if (body) { opts.body = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  return fetch(url, opts);
}

// ──────────────────────────────────────────
//  UNDO / REDO
// ──────────────────────────────────────────
function pushUndo() {
  state.undoStack.push(JSON.stringify(state.events));
  state.redoStack = [];
  updateUndoRedoUI();
}
function undoAction() {
  if (!state.undoStack.length) return;
  state.redoStack.push(JSON.stringify(state.events));
  state.events = JSON.parse(state.undoStack.pop());
  updateUndoRedoUI();
  renderCalendar(); renderTextList();
}
function redoAction() {
  if (!state.redoStack.length) return;
  state.undoStack.push(JSON.stringify(state.events));
  state.events = JSON.parse(state.redoStack.pop());
  updateUndoRedoUI();
  renderCalendar(); renderTextList();
}
function updateUndoRedoUI() {
  document.getElementById('btn-undo').disabled = state.undoStack.length === 0;
  document.getElementById('btn-redo').disabled = state.redoStack.length === 0;
}

// ──────────────────────────────────────────
//  SEARCH
// ──────────────────────────────────────────
function handleSearch(val) {
  state.searchQuery = val.trim();
  renderCalendar();
}

function getEventsForDate(dateStr) {
  let evts = state.events.filter(e => e.date === dateStr);
  if (state.searchQuery) {
    evts = evts.filter(e => e.title.toLowerCase().includes(state.searchQuery.toLowerCase())
      || (e.host||'').toLowerCase().includes(state.searchQuery.toLowerCase()));
  }
  return evts.sort((a,b) => a.start_time.localeCompare(b.start_time));
}

// ──────────────────────────────────────────
//  SHARE
// ──────────────────────────────────────────
async function shareApp() {
  const url = window.location.href;
  const data = { title: '身體對話 活動月曆', text: '查看本月活動安排', url };
  if (navigator.share && navigator.canShare && navigator.canShare(data)) {
    try { await navigator.share(data); return; } catch(e) {}
  }
  // Fallback: copy link
  navigator.clipboard.writeText(url).then(() => showToast('連結已複製到剪貼板'));
}

// ──────────────────────────────────────────
//  AUTH MODAL HELPERS
// ──────────────────────────────────────────
function openAuthModal() {
  document.getElementById('auth-modal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  if (state.user) document.getElementById('pat-input').value = state.user.token || '';
}
function closeAuthModal(e) {
  if (e && e.target !== document.getElementById('auth-modal')) return;
  document.getElementById('auth-modal').classList.add('hidden');
  document.body.style.overflow = '';
}
function togglePatVisibility() {
  const inp = document.getElementById('pat-input');
  const eye = document.getElementById('pat-eye');
  if (inp.type === 'password') { inp.type = 'text'; eye.className = 'fa-regular fa-eye-slash text-sm'; }
  else { inp.type = 'password'; eye.className = 'fa-regular fa-eye text-sm'; }
}

// ──────────────────────────────────────────
//  MOBILE MENU
// ──────────────────────────────────────────
function toggleMobileMenu() {
  const m = document.getElementById('mobile-menu');
  m.classList.toggle('hidden');
}

// ──────────────────────────────────────────
//  THEME
// ──────────────────────────────────────────
function toggleTheme() {
  const isDark = document.documentElement.classList.toggle('dark');
  localStorage.setItem('bt-theme', isDark ? 'dark' : 'light');
}

// ──────────────────────────────────────────
//  TOAST
// ──────────────────────────────────────────
let toastTimer;
function showToast(msg, type='success') {
  const el = document.getElementById('toast');
  const icon = document.getElementById('toast-icon');
  const msgEl = document.getElementById('toast-msg');
  msgEl.textContent = msg;
  icon.className = type === 'error'
    ? 'fa-solid fa-circle-xmark text-red-400 dark:text-red-500'
    : 'fa-solid fa-circle-check text-teal-400 dark:text-teal-600';
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}

// ──────────────────────────────────────────
//  SYNC STATUS
// ──────────────────────────────────────────
function showSyncStatus(on) {
  const el = document.getElementById('sync-status');
  el.classList.toggle('hidden', !on);
  el.style.display = on ? 'flex' : 'none';
}
function updateLastSync() {
  const el = document.getElementById('last-sync');
  el.textContent = `更新 ${new Date().toLocaleTimeString('zh-TW', { hour:'2-digit', minute:'2-digit' })}`;
  el.classList.remove('hidden');
}

// ──────────────────────────────────────────
//  KEYBOARD SHORTCUTS
// ──────────────────────────────────────────
function setupKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.getElementById('event-modal').classList.add('hidden');
      document.getElementById('form-modal').classList.add('hidden');
      document.getElementById('auth-modal').classList.add('hidden');
      document.body.style.overflow = '';
    }
    if ((e.ctrlKey||e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undoAction(); }
    if ((e.ctrlKey||e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redoAction(); }
  });
}

// ──────────────────────────────────────────
//  UTILS
// ──────────────────────────────────────────
function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
}

// ──────────────────────────────────────────
//  BOOT
// ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
