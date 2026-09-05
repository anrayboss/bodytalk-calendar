/* ============================================================
   script.js -- bodytalk-calendar
   GitHub JSON as DB | Role-based | GitHub PAT auth
   ============================================================ */

// CONFIG & STATE
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
  calView: 'month',
  activeEvent: null,
  user: null,
  guestAdmin: false, // demo 模式：不需登入即可全功能編輯（只存 localStorage）
  searchQuery: '',
  undoStack: [],
  redoStack: [],
};

// 判斷是否有管理員權限（登入 admin 或 guestAdmin 模式）
function isAdminMode() { return state.guestAdmin || state.user?.role === 'admin'; }

// 切換 guestAdmin 模式
function toggleGuestAdmin() {
  state.guestAdmin = !state.guestAdmin;
  const btn = document.getElementById('btn-guest-admin');
  const btnMob = document.getElementById('btn-guest-admin-mob');
  if (state.guestAdmin) {
    if (btn) { btn.textContent = '🔓 訪客編輯中'; btn.classList.add('guest-admin-active'); }
    if (btnMob) { btnMob.textContent = '🔓'; btnMob.classList.add('guest-admin-active'); }
    showToast('訪客編輯模式：變更只存在本機，不會推送到 GitHub');
  } else {
    if (btn) { btn.textContent = '🔒 訪客模式'; btn.classList.remove('guest-admin-active'); }
    if (btnMob) { btnMob.textContent = '🔒'; btnMob.classList.remove('guest-admin-active'); }
    showToast('已關閉訪客編輯模式');
  }
  updateAuthUI();
  renderCalendar();
}

// INIT
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
    if (r.ok) state.config = await r.json();
  } catch (e) {
    console.warn('config.json load failed', e);
  }
}

async function loadEvents() {
  showSyncStatus(true);
  try {
    const r = await fetch(`${RAW_BASE}/events.json?t=${Date.now()}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    state.events = data.events || [];
    if (state.user?.token) await fetchFileSha('events.json', 'events');
    updateLastSync();
  } catch (e) {
    console.error('events.json load failed', e);
    showToast('讀取活動資料失敗 (請確認檔案已推送到 GitHub)', 'error');
  }
  showSyncStatus(false);
}

async function fetchFileSha(path, key) {
  try {
    const r = await ghAPI(`${API_BASE}/contents/${path}`);
    if (r.ok) { const d = await r.json(); state.fileSha[key] = d.sha; }
  } catch (e) {}
}

// AUTH
function restoreAuth() {
  const stored = localStorage.getItem('bt-pat');
  if (stored) {
    try {
      state.user = JSON.parse(stored);
      updateAuthUI();
      fetchFileSha('events.json', 'events');
      fetchFileSha('config.json', 'config');
    } catch(e) { localStorage.removeItem('bt-pat'); }
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
    const role = state.config.roles?.[u.login] || 'collaborator';
    state.user = { token, username: u.login, avatarUrl: u.avatar_url, role };
    localStorage.setItem('bt-pat', JSON.stringify(state.user));
    await fetchFileSha('events.json', 'events');
    await fetchFileSha('config.json', 'config');
    updateAuthUI();
    renderCalendar();
    closeAuthModal();
    showToast(`歡迎，${u.login}！（${role === 'admin' ? '管理員' : '協作者'}）`);
  } catch (e) {
    showToast('驗證失敗，請檢查網路', 'error');
  }
  showSyncStatus(false);
}

function logout() {
  state.user = null;
  localStorage.removeItem('bt-pat');
  updateAuthUI();
  renderCalendar();
  closeAuthModal();
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
    roleBadge.className = 'text-xs ' + (u.role === 'admin' ? 'text-amber-500' : 'text-teal-500');
    btnLogout.style.display = '';
    if (isAdminMode()) {
      btnAdd.style.display = '';
      if (btnAddMob) btnAddMob.style.display = '';
    }
  } else {
    label.textContent = '設定登入';
    loggedIn.classList.add('hidden');
    btnLogout.style.display = 'none';
    // guestAdmin 模式下仍顯示新增按鈕
    btnAdd.style.display = state.guestAdmin ? '' : 'none';
    if (btnAddMob) btnAddMob.style.display = state.guestAdmin ? '' : 'none';
  }
}

// CALENDAR RENDERING
function renderCalendar() {
  const container = document.getElementById('calendar-container');
  container.innerHTML = '';
  if (state.calView === 'month') renderMonth(container);
  else if (state.calView === 'week') renderWeek(container);
  else renderDay(container);
  updateCalTitle();
}

// MONTH VIEW
function renderMonth(container) {
  const d = state.currentDate;
  const year = d.getFullYear(), month = d.getMonth();
  const firstDay = new Date(year, month, 1);
  const startDow = firstDay.getDay();
  const today = new Date(); today.setHours(0,0,0,0);

  const header = document.createElement('div');
  header.className = 'cal-dow-header shrink-0';
  ['日','一','二','三','四','五','六'].forEach(dw => {
    const c = document.createElement('div');
    c.className = 'cal-dow-cell';
    c.textContent = dw;
    header.appendChild(c);
  });
  container.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'cal-month-grid';
  grid.style.gridAutoRows = '1fr';

  for (let i = 0; i < 42; i++) {
    const cellDate = new Date(year, month, i - startDow + 1);
    cellDate.setHours(0,0,0,0);
    const isThisMonth = cellDate.getMonth() === month;
    const isToday = cellDate.getTime() === today.getTime();

    const cell = document.createElement('div');
    cell.className = 'cal-day-cell' + (!isThisMonth ? ' other-month' : '') + (isToday ? ' is-today' : '');

    const num = document.createElement('div');
    num.className = 'cal-day-num';
    num.textContent = cellDate.getDate();
    cell.appendChild(num);

    const dateStr = fmtDate(cellDate);
    getEventsForDate(dateStr).forEach(evt => cell.appendChild(buildCard(evt)));
    grid.appendChild(cell);
  }
  container.appendChild(grid);
}

// WEEK VIEW
function renderWeek(container) {
  const d = state.currentDate;
  const weekStart = new Date(d);
  weekStart.setDate(d.getDate() - d.getDay());
  weekStart.setHours(0,0,0,0);
  const today = new Date(); today.setHours(0,0,0,0);

  const wrap = document.createElement('div');
  wrap.className = 'cal-week-wrap';

  const hdr = document.createElement('div');
  hdr.className = 'cal-week-header';
  const pad = document.createElement('div');
  pad.className = 'w-[52px]';
  hdr.appendChild(pad);

  const dows = ['日','一','二','三','四','五','六'];
  for (let i = 0; i < 7; i++) {
    const date = new Date(weekStart); date.setDate(weekStart.getDate() + i);
    const isToday = date.getTime() === today.getTime();
    const cell = document.createElement('div');
    cell.className = 'week-day-head' + (isToday ? ' is-today' : '');
    cell.innerHTML = `<div class="dow">${dows[i]}</div><div class="dom">${date.getDate()}</div>`;
    hdr.appendChild(cell);
  }
  wrap.appendChild(hdr);

  const body = document.createElement('div');
  body.className = 'cal-week-body';

  const timeCol = document.createElement('div');
  timeCol.className = 'cal-week-time-col shrink-0';
  for (let h = 0; h < 24; h++) {
    const s = document.createElement('div');
    s.className = 'cal-week-time-slot';
    s.textContent = h === 0 ? '' : `${h}:00`;
    timeCol.appendChild(s);
  }
  body.appendChild(timeCol);

  const daysGrid = document.createElement('div');
  daysGrid.className = 'cal-week-days';
  for (let i = 0; i < 7; i++) {
    const date = new Date(weekStart); date.setDate(weekStart.getDate() + i);
    const col = document.createElement('div');
    col.className = 'cal-week-day-col';
    for (let h = 0; h < 24; h++) {
      const line = document.createElement('div'); line.className = 'week-hour-line'; col.appendChild(line);
    }
    getEventsForDate(fmtDate(date)).forEach(evt => col.appendChild(buildTimeBlock(evt, 48, 'week')));
    daysGrid.appendChild(col);
  }
  body.appendChild(daysGrid);
  wrap.appendChild(body);
  container.appendChild(wrap);
}

// DAY VIEW
function renderDay(container) {
  const d = new Date(state.currentDate);
  d.setHours(0,0,0,0);
  const dayEvts = getEventsForDate(fmtDate(d));

  const wrap = document.createElement('div');
  wrap.className = 'cal-day-wrap';

  const hdr = document.createElement('div');
  hdr.className = 'cal-day-header';
  hdr.innerHTML = `<p class="text-base font-bold text-slate-800 dark:text-slate-100">${d.toLocaleDateString('zh-TW', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</p>
    <p class="text-xs text-slate-400 mt-0.5">${dayEvts.length} 個活動</p>`;
  wrap.appendChild(hdr);

  const body = document.createElement('div');
  body.className = 'cal-day-body';

  const timeCol = document.createElement('div');
  timeCol.className = 'cal-day-time-col shrink-0';
  for (let h = 0; h < 24; h++) {
    const s = document.createElement('div');
    s.className = 'cal-day-time-slot';
    s.textContent = h === 0 ? '' : `${h}:00`;
    timeCol.appendChild(s);
  }
  body.appendChild(timeCol);

  const evtCol = document.createElement('div');
  evtCol.className = 'cal-day-events-col';
  for (let h = 0; h < 24; h++) {
    const line = document.createElement('div'); line.className = 'day-hour-line'; evtCol.appendChild(line);
  }
  dayEvts.forEach(evt => evtCol.appendChild(buildTimeBlock(evt, 64, 'day')));
  body.appendChild(evtCol);
  wrap.appendChild(body);
  container.appendChild(wrap);
}

// CARD builder - month view: title + bottom tags (no time)
function buildCard(evt) {
  const matched = state.searchQuery && (
    evt.title.toLowerCase().includes(state.searchQuery.toLowerCase()) ||
    (evt.host||'').toLowerCase().includes(state.searchQuery.toLowerCase())
  );

  const card = document.createElement('div');
  card.className = `evt-card evt-${evt.type}${matched ? ' search-match' : ''}`;

  const title = document.createElement('div');
  title.className = 'evt-card-title';
  title.textContent = cleanTitle(evt.title);
  card.appendChild(title);

  const tags = document.createElement('div');
  tags.className = 'evt-card-tags';

  if (evt.assignee) {
    const aTag = document.createElement('span');
    aTag.className = 'evt-tag evt-tag-assignee';
    aTag.innerHTML = `<img src="https://github.com/${evt.assignee}.png?size=16" style="width:10px;height:10px;border-radius:50%;display:inline;vertical-align:middle;margin-right:2px">${evt.assignee}`;
    tags.appendChild(aTag);
  } else {
    const emptyTag = document.createElement('span');
    emptyTag.className = 'evt-tag evt-tag-empty';
    emptyTag.textContent = '待認領';
    tags.appendChild(emptyTag);
  }

  if (evt.location) {
    const locTag = document.createElement('span');
    locTag.className = 'evt-tag evt-tag-loc';
    locTag.textContent = evt.location;
    tags.appendChild(locTag);
  }

  if (evt.host) {
    const hostTag = document.createElement('span');
    hostTag.className = 'evt-tag evt-tag-host';
    hostTag.textContent = evt.host;
    tags.appendChild(hostTag);
  }

  card.appendChild(tags);
  card.addEventListener('click', () => openEventModal(evt));
  return card;
}

// Time block - week/day view
function buildTimeBlock(evt, hourPx, mode) {
  const [sh, sm] = evt.start_time.split(':').map(Number);
  const [eh, em] = evt.end_time.split(':').map(Number);
  const top = (sh + sm/60) * hourPx;
  const height = Math.max(((eh + em/60) - (sh + sm/60)) * hourPx, 22);
  const colors = {
    public:      'background:#fef3c7;color:#92400e',
    course:      'background:#ede9fe;color:#5b21b6',
    study_group: 'background:#ccfbf1;color:#134e4a'
  };
  const block = document.createElement('div');
  block.className = mode === 'day' ? 'day-evt-block' : 'week-evt-block';
  block.style.cssText = `top:${top}px;height:${height}px;${colors[evt.type] || colors.public}`;
  block.innerHTML = `<div style="font-weight:600;font-size:9px">${evt.start_time}</div>
    <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px">${cleanTitle(evt.title)}</div>`;
  if (evt.assignee) block.title = `接待：${evt.assignee}`;
  block.addEventListener('click', () => openEventModal(evt));
  return block;
}

function cleanTitle(t) {
  const stripped = t.replace(/^[✨\s]*【[^】]*】/, '').trim() || t.replace(/^[✨\s]*/, '').trim();
  return stripped || t;
}

// CALENDAR TITLE & NAV
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
function goToday() { state.currentDate = new Date(); renderCalendar(); renderTextList(); }
function setCalView(v) {
  state.calView = v;
  document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active-view'));
  const btn = document.getElementById('btn-view-' + v);
  if (btn) btn.classList.add('active-view');
  renderCalendar();
}

// TEXT LIST
function renderTextList() {
  const el = document.getElementById('text-list');
  const d = state.currentDate;
  const year = d.getFullYear(), month = d.getMonth();

  const monthEvts = state.events
    .filter(e => { const ed = new Date(e.date); return ed.getFullYear()===year && ed.getMonth()===month; })
    .sort((a,b) => a.date.localeCompare(b.date) || a.start_time.localeCompare(b.start_time));

  if (!monthEvts.length) {
    el.innerHTML = '<p style="color:#94a3b8;text-align:center;padding:32px 0">本月尚無活動</p>';
    return;
  }

  let html = '';
  let lastDate = '';
  monthEvts.forEach(e => {
    if (e.date !== lastDate) {
      const dt = new Date(e.date);
      const label = dt.toLocaleDateString('zh-TW', { month:'numeric', day:'numeric', weekday:'short' });
      html += `<div class="tl-date-header">${label}</div>`;
      lastDate = e.date;
    }
    const assigneeTag = e.assignee ? ` <span style="color:#10b981">@${e.assignee}</span>` : '';
    html += `<div class="tl-event" onclick="openEventModalById('${e.id}')">${e.start_time} ${e.title}${assigneeTag}</div>`;
  });
  el.innerHTML = html;
}

function openEventModalById(id) {
  const evt = state.events.find(e => e.id === id);
  if (evt) openEventModal(evt);
}

function copyTextList() {
  const el = document.getElementById('text-list');
  navigator.clipboard.writeText(el.innerText).then(() => showToast('已複製到剪貼板'));
}

function toggleTextPanel() {
  const panel = document.getElementById('text-panel');
  const btnExpand = document.getElementById('btn-expand-text-panel');
  if (!panel) return;
  const isCollapsed = panel.classList.toggle('text-panel-collapsed');
  if (btnExpand) {
    if (isCollapsed) {
      btnExpand.classList.add('is-expanded');
    } else {
      btnExpand.classList.remove('is-expanded');
    }
  }
}

// EVENT MODAL
function openEventModal(evt) {
  state.activeEvent = evt;
  const u = state.user;
  const isAdmin = u?.role === 'admin';
  const isAssignee = u?.username === evt.assignee;

  const typeLabels = { public:'公益活動', course:'正式課程', study_group:'讀書會' };
  const typeCls = { public:'badge-public', course:'badge-course', study_group:'badge-study_group' };
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

  const regLink = document.getElementById('modal-reg-link');
  if (evt.registration_url) { regLink.href = evt.registration_url; regLink.style.display = ''; }
  else regLink.style.display = 'none';

  const aEl = document.getElementById('modal-assignee');
  if (evt.assignee) {
    aEl.innerHTML = `<img src="https://github.com/${evt.assignee}.png?size=64" class="assignee-avatar" alt="${evt.assignee}" onerror="this.style.display='none'">
      <div><p style="font-weight:600;font-size:14px">${evt.assignee}</p><p style="font-size:12px;color:#10b981">已認領接待</p></div>`;
  } else {
    aEl.innerHTML = '<p style="font-size:13px;color:#94a3b8">尚無人接待，快來認領！</p>';
  }

  const adminMode = isAdminMode();
  document.getElementById('btn-claim').style.display    = ((u || state.guestAdmin) && !evt.assignee) ? '' : 'none';
  document.getElementById('btn-unclaim').style.display  = ((u || state.guestAdmin) && (isAssignee || adminMode) && evt.assignee) ? '' : 'none';
  document.getElementById('btn-edit-event').style.display   = adminMode ? '' : 'none';
  document.getElementById('btn-delete-event').style.display = adminMode ? '' : 'none';

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
  if (val) { document.getElementById(fieldId).textContent = val; row.classList.remove('hidden'); }
  else row.classList.add('hidden');
}

// CLAIM / UNCLAIM
async function claimEvent() {
  if (!state.user && !state.guestAdmin) { openAuthModal(); return; }
  if (state.guestAdmin && !state.activeEvent.assignee) {
    const name = prompt('輸入接待者名稱（訪客模式）：', '');
    if (!name) return;
    await updateEventField(state.activeEvent.id, { assignee: name }, `認領活動：${state.activeEvent.title}`);
    const updated = state.events.find(e => e.id === state.activeEvent.id);
    if (updated) openEventModal(updated);
    return;
  }
  const evt = state.activeEvent;
  if (!evt) return;
  await updateEventField(evt.id, { assignee: state.user.username }, `認領活動：${evt.title}`);
  const updated = state.events.find(e => e.id === evt.id);
  if (updated) openEventModal(updated);
}
async function unclaimEvent() {
  const evt = state.activeEvent;
  if (!evt) return;
  await updateEventField(evt.id, { assignee: null }, `取消認領：${evt.title}`);
  const updated = state.events.find(e => e.id === evt.id);
  if (updated) openEventModal(updated);
}

// EVENT FORM
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
  if (state.activeEvent) { closeEventModal({ target: null }); openEventForm(state.activeEvent.id); }
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
    id:               evtId || 'evt_' + Date.now(),
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
  if (isEdit) state.events = state.events.map(ev => ev.id === evtId ? newEvt : ev);
  else state.events.push(newEvt);
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

// GITHUB API
async function updateEventField(evtId, fields, commitMsg) {
  pushUndo();
  state.events = state.events.map(e => e.id === evtId ? { ...e, ...fields } : e);
  await saveEventsToGitHub(commitMsg);
  renderCalendar(); renderTextList();
}
async function saveEventsToGitHub(commitMsg) {
  // guestAdmin 模式：只存 localStorage，不推 GitHub
  if (state.guestAdmin && !state.user?.token) {
    const content = { version:'1.0', updated_at: new Date().toISOString(), events: state.events };
    localStorage.setItem('bt-events-local', JSON.stringify(content));
    updateLastSync();
    showToast(`（訪客）${commitMsg} — 已存本機`);
    return;
  }
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
    if (r.ok) { const d = await r.json(); state.fileSha.events = d.content.sha; updateLastSync(); }
    else { const err = await r.json(); throw new Error(err.message); }
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

// UNDO / REDO
function pushUndo() { state.undoStack.push(JSON.stringify(state.events)); state.redoStack = []; updateUndoRedoUI(); }
function undoAction() {
  if (!state.undoStack.length) return;
  state.redoStack.push(JSON.stringify(state.events));
  state.events = JSON.parse(state.undoStack.pop());
  updateUndoRedoUI(); renderCalendar(); renderTextList();
}
function redoAction() {
  if (!state.redoStack.length) return;
  state.undoStack.push(JSON.stringify(state.events));
  state.events = JSON.parse(state.redoStack.pop());
  updateUndoRedoUI(); renderCalendar(); renderTextList();
}
function updateUndoRedoUI() {
  const noUndo = state.undoStack.length === 0;
  const noRedo = state.redoStack.length === 0;
  document.getElementById('btn-undo').disabled = noUndo;
  document.getElementById('btn-redo').disabled = noRedo;
  const undoMob = document.getElementById('btn-undo-mob');
  const redoMob = document.getElementById('btn-redo-mob');
  if (undoMob) undoMob.disabled = noUndo;
  if (redoMob) redoMob.disabled = noRedo;
}

// SEARCH
function handleSearch(val) { state.searchQuery = val.trim(); renderCalendar(); }
function getEventsForDate(dateStr) {
  let evts = state.events.filter(e => e.date === dateStr);
  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    evts = evts.filter(e => e.title.toLowerCase().includes(q) || (e.host||'').toLowerCase().includes(q));
  }
  return evts.sort((a,b) => a.start_time.localeCompare(b.start_time));
}

// SHARE
async function shareApp() {
  const url = window.location.href;
  const data = { title: '身體對話 活動月曆', text: '查看本月活動安排', url };
  if (navigator.share && navigator.canShare && navigator.canShare(data)) {
    try { await navigator.share(data); return; } catch(e) {}
  }
  navigator.clipboard.writeText(url).then(() => showToast('連結已複製到剪貼板'));
}

// AUTH MODAL
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

// MOBILE MENU
function toggleMobileMenu() { document.getElementById('mobile-menu').classList.toggle('hidden'); }

// THEME
function toggleTheme() { const isDark = document.documentElement.classList.toggle('dark'); localStorage.setItem('bt-theme', isDark ? 'dark' : 'light'); }

// TOAST
let toastTimer;
function showToast(msg, type='success') {
  document.getElementById('toast-icon').className = type === 'error'
    ? 'fa-solid fa-circle-xmark text-red-400' : 'fa-solid fa-circle-check text-teal-400';
  document.getElementById('toast-msg').textContent = msg;
  const el = document.getElementById('toast');
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}

// SYNC STATUS
function showSyncStatus(on) { document.getElementById('sync-status').style.display = on ? 'flex' : 'none'; }
function updateLastSync() {
  const el = document.getElementById('last-sync');
  el.textContent = '更新 ' + new Date().toLocaleTimeString('zh-TW', { hour:'2-digit', minute:'2-digit' });
  el.classList.remove('hidden');
}

// KEYBOARD SHORTCUTS
function setupKeyboard() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      ['event-modal','form-modal','auth-modal'].forEach(id => document.getElementById(id).classList.add('hidden'));
      document.body.style.overflow = '';
    }
    if ((e.ctrlKey||e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undoAction(); }
    if ((e.ctrlKey||e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redoAction(); }
  });
}

// UTILS
function fmtDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

// BOOT
document.addEventListener('DOMContentLoaded', init);
