const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const PRIORITY_ORDER = { critica: 0, alta: 1, media: 2, baja: 3 };
const VIEW_LABELS = {
  resumen: 'RESUMEN',
  proyectos: 'CARTERA',
  atencion: 'SEMÁFORO',
  pendientes: 'TU LISTA',
  fuentes: 'TRAZABILIDAD',
  ajustes: 'PREFERENCIAS'
};

let snapshot = null;
let currentView = 'resumen';
let attentionFilter = 'todas';
let taskFilter = 'abiertas';
let widgetVisible = false;
let toastTimer = null;
let aiModalProject = null;
let aiResult = null;
let aiFiles = null;
let aiWriteResult = null;
let aiBusy = false;
let aiApplied = false;
let aiError = null;
let lastProjectId = null;
let projectDraft = null;
let projectInput = { folder: '', name: '' };
let projectBusy = false;
let projectError = null;
let projectAdded = null;

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function priorityKey(value) {
  return normalize(value).replace('critica', 'critica');
}

function priorityLabel(value) {
  const key = normalize(value);
  if (key === 'critica') return 'Crítica';
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function statusMeta(status) {
  const map = {
    activo: { label: 'Activo', order: 0 },
    operativo: { label: 'Operativo', order: 1 },
    pausado: { label: 'Pausado', order: 2 },
    'por-iniciar': { label: 'Por iniciar', order: 3 }
  };
  return map[status] || { label: status, order: 9 };
}

function projects() {
  return snapshot?.data?.projects || [];
}

function projectById(id) {
  return projects().find((p) => p.id === id);
}

function attentionItems() {
  return [...(snapshot?.data?.attention || [])].sort(
    (a, b) => (PRIORITY_ORDER[priorityKey(a.priority)] ?? 9) - (PRIORITY_ORDER[priorityKey(b.priority)] ?? 9)
  );
}

function openTasks() {
  return (snapshot?.state?.tasks || []).filter((t) => !t.done);
}

function dateValue(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function longDate(value) {
  const d = dateValue(value) || new Date();
  const text = new Intl.DateTimeFormat('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(d);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function shortDate(value) {
  const d = dateValue(value);
  if (!d) return '—';
  return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short' }).format(d).replace('.', '');
}

function monthStamp(value) {
  const d = dateValue(value) || new Date();
  return new Intl.DateTimeFormat('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
    .format(d)
    .replace('.', '')
    .toUpperCase();
}

function relativeDay(value) {
  const d = dateValue(value);
  if (!d) return 'sin fecha';
  const now = dateValue(snapshot?.now) || new Date();
  const days = Math.max(0, Math.floor((now.setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000));
  if (days === 0) return 'hoy';
  if (days === 1) return 'ayer';
  if (days < 7) return `hace ${days} días`;
  return shortDate(value);
}

function showToast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2800);
}

function severityClass(priority) {
  const map = { critica: 'critical', alta: 'high', media: 'medium', baja: 'low' };
  return `sev-${map[priorityKey(priority)] || 'low'}`;
}

/* ------------------------------------------------------------------ render */

function renderAll() {
  if (!snapshot) return;
  renderChrome();
  renderHero();
  renderAttentionPreview();
  renderProjectGrid();
  renderDecisions();
  renderActivity();
  renderProjectTable();
  renderAttentionFull();
  renderTaskProjectOptions();
  renderTasks();
  renderSources();
  renderSettings();
  renderAiSettings();
  bindDynamic();
}

function renderChrome() {
  const now = snapshot.now;
  $('#date-line').textContent = longDate(now);
  $('#hero-date').textContent = monthStamp(now);
  $('#nav-projects').textContent = String(projects().length);
  $('#nav-attention').textContent = String(attentionItems().length);
  $('#nav-attention-2').textContent = String(attentionItems().filter((a) => ['crítica', 'alta'].includes(a.priority)).length);
  $('#nav-tasks').textContent = String(openTasks().length);
  $('#attention-total-inline').textContent = String(attentionItems().length);

  const time = new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit' }).format(dateValue(now) || new Date());
  $('#side-sync').textContent = `Actualizado ${time}`;

  const top = attentionItems()[0];
  if (top) {
    const p = projectById(top.projectId);
    $('#side-focus-text').textContent = `${p ? p.shortName : 'Proyecto'}: ${top.title}.`;
    $('#side-focus-button').onclick = () => openProject(top.projectId);
  }

  $('#view-eyebrow').textContent = VIEW_LABELS[currentView] || 'RESUMEN';
  $('#btn-widget').textContent = '';
  $('#btn-widget').insertAdjacentHTML(
    'beforeend',
    `<svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="4.5" width="17" height="13" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M8 21h8M12 17.5V21" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg><span>${widgetVisible ? 'Ocultar' : 'Widget'}</span>`
  );
  $('#btn-widget-side').title = 'Mostrar u ocultar el widget';
}

function renderHero() {
  const all = projects();
  const active = all.filter((p) => ['activo', 'operativo'].includes(p.status));
  const paused = all.filter((p) => p.status === 'pausado');
  const notStarted = all.filter((p) => p.status === 'por-iniciar');
  const attention = attentionItems();
  const critical = attention.filter((a) => priorityKey(a.priority) === 'critica');
  const avg = Math.round(all.reduce((sum, p) => sum + p.progress, 0) / Math.max(1, all.length));

  const top = attention[0];
  const second = attention[1];
  const firstName = top ? projectById(top.projectId)?.shortName : '';
  const secondName = second ? projectById(second.projectId)?.shortName : '';

  $('#hero-title').innerHTML = `${active.length} frentes vivos.<br><em>${critical.length} piden tu atención ya.</em>`;
  $('#hero-sub').textContent = `${firstName || 'Un proyecto'} necesita mover «${top?.title || 'el siguiente paso'}»; ${secondName || 'otro frente'} suma «${second?.title || 'otra señal'}». El resto avanza a su ritmo: abre la cartera completa para ver el siguiente paso de cada frente.`;

  $('#hero-stats').innerHTML = [
    ['Proyectos', all.length],
    ['Activos', active.length],
    ['En pausa', paused.length],
    ['Por iniciar', notStarted.length],
    ['Decisiones', snapshot.data.decisions.length]
  ]
    .map(([label, value]) => `<div class="hero-stat"><strong>${value}</strong><span>${label}</span></div>`)
    .join('');

  const gauge = $('#gauge-fill');
  const circumference = 2 * Math.PI * 58;
  gauge.style.strokeDasharray = String(circumference);
  gauge.style.strokeDashoffset = String(circumference * (1 - avg / 100));
  $('#gauge-value').textContent = `${avg}%`;

  const mini = [...active]
    .sort((a, b) => b.progress - a.progress)
    .slice(0, 6)
    .map(
      (p) => `<div class="hero-mini-row" style="--accent:${p.accent}"><i></i><span>${esc(p.shortName)}</span><b>${p.progress}%</b></div>`
    )
    .join('');
  $('#hero-mini').innerHTML = mini;
}

function renderAttentionPreview() {
  const items = attentionItems().slice(0, 4);
  $('#attention-preview').innerHTML = items
    .map((item) => {
      const p = projectById(item.projectId);
      const key = priorityKey(item.priority);
      return `<button class="attention-row ${severityClass(item.priority)}" data-project="${esc(item.projectId)}">
        <span class="attention-sev"><i></i>${esc(priorityLabel(item.priority))}</span>
        <span class="attention-main"><strong>${esc(item.title)}</strong><span>${esc(item.detail)}</span></span>
        <span class="attention-project" style="--accent:${p?.accent || '#8b95a7'}"><i></i>${esc(p?.shortName || '—')}</span>
        <span class="attention-when">${esc(item.when || '')}</span>
      </button>`;
    })
    .join('');
}

function renderProjectGrid() {
  $('#project-grid').innerHTML = projects()
    .map((p, index) => {
      const status = statusMeta(p.status);
      const next = p.next?.[0];
      return `<article class="project-card" style="--accent:${p.accent}; --i:${index}" data-project="${esc(p.id)}" tabindex="0">
        <div class="card-top">
          <span class="status-pill"><i></i>${esc(status.label)}</span>
          <span class="card-index">${String(index + 1).padStart(2, '0')}</span>
        </div>
        <h3>${esc(p.shortName)}</h3>
        <div class="card-stage">${esc(p.stage)}</div>
        <p class="card-summary">${esc(p.summary)}</p>
        <div class="progress-row">
          <div class="progress-track"><i style="width:${p.progress}%"></i></div>
          <strong>${p.progress}%</strong>
        </div>
        <div class="card-next">
          <span>Siguiente</span>
          <p>${esc(next?.title || 'Definir el siguiente paso')}</p>
        </div>
        <div class="card-foot">
          <span>${p.sources?.length ? `movido ${relativeDay(p.lastActivity)}` : 'sin documentos'}</span>
          <div class="card-foot-actions">
            <button class="agent-quick" data-agent-menu="${esc(p.id)}" title="Ejecutar un agente en la carpeta raíz">
              <svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="m7 9 3 3-3 3M12.5 15H17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
              Abrir con
            </button>
            <button data-project="${esc(p.id)}">Ver detalle →</button>
          </div>
        </div>
      </article>`;
    })
    .join('');
}

function renderDecisions() {
  const list = snapshot.data.decisions || [];
  $('#decisions-count').textContent = String(list.length);
  $('#decisions-list').innerHTML = list
    .map((d) => {
      const p = projectById(d.projectId);
      return `<button class="decision-item" style="--accent:${p?.accent || '#8b95a7'}" data-project="${esc(d.projectId)}" title="${esc(d.detail)}">
        <i></i>
        <span><strong>${esc(d.title)}</strong><span>${esc(p?.shortName || '')} · ${esc(d.detail)}</span></span>
        <b>DECIDIR</b>
      </button>`;
    })
    .join('');
}

function renderActivity() {
  const events = [];
  for (const p of projects()) {
    for (const s of p.sources || []) {
      if (s.exists && s.modified) {
        events.push({ project: p, source: s, modified: s.modified });
      }
    }
  }
  events.sort((a, b) => String(b.modified).localeCompare(String(a.modified)));
  const top = events.slice(0, 6);
  $('#activity-list').innerHTML = top.length
    ? top
        .map((e) => {
          const file = e.source.relative.split('/').pop();
          return `<button class="activity-item" style="--accent:${e.project.accent}" data-doc-project="${esc(e.project.id)}" data-doc="${esc(e.source.relative)}">
            <time>${esc(relativeDay(e.modified))}</time>
            <i></i>
            <div><strong>${esc(file)}</strong><span>${esc(e.project.shortName)}</span></div>
          </button>`;
        })
        .join('')
    : `<div class="empty-state"><strong>Sin actividad registrada</strong><p>Los documentos no tienen fecha de modificación legible.</p></div>`;
}

function renderProjectTable() {
  const all = [...projects()].sort((a, b) => {
    const sa = statusMeta(a.status).order;
    const sb = statusMeta(b.status).order;
    return sa - sb || b.progress - a.progress;
  });

  $('#projects-legend').innerHTML = ['activo', 'operativo', 'pausado', 'por-iniciar']
    .map((s) => `<span style="--accent:${all.find((p) => p.status === s)?.accent || '#8b95a7'}"><i></i>${statusMeta(s).label}</span>`)
    .join('');

  $('#project-table').innerHTML = all
    .map((p) => {
      const status = statusMeta(p.status);
      const next = p.next?.[0];
      return `<div class="project-row" style="--accent:${p.accent}" data-project="${esc(p.id)}" tabindex="0">
        <span class="project-row-name"><i class="dot"></i><span><strong>${esc(p.name)}</strong><span>${esc(status.label)} · ${esc(p.stage)}</span></span></span>
        <span class="project-row-next">${esc(next?.title || 'Sin siguiente paso definido')}</span>
        <span class="project-row-progress"><span class="progress-track"><i style="width:${p.progress}%"></i></span><b>${p.progress}%</b></span>
        <span class="project-row-date">${p.sources?.length ? `movido ${relativeDay(p.lastActivity)}` : 'sin documentos'}</span>
        <span class="project-row-actions">
          <button class="row-agent" data-agent-menu="${esc(p.id)}" title="Abrir con un agente en la carpeta raíz">
            <svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="4.5" width="17" height="15" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="m7 9 3 3-3 3M12.5 15H17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <span class="project-row-arrow">→</span>
        </span>
      </div>`;
    })
    .join('');
}

function renderAttentionFull() {
  const all = attentionItems();
  const counts = {
    todas: all.length,
    critica: all.filter((a) => priorityKey(a.priority) === 'critica').length,
    alta: all.filter((a) => priorityKey(a.priority) === 'alta').length,
    media: all.filter((a) => priorityKey(a.priority) === 'media').length,
    baja: all.filter((a) => priorityKey(a.priority) === 'baja').length
  };
  for (const key of Object.keys(counts)) {
    const el = $(`#filter-count-${key}`);
    if (el) el.textContent = String(counts[key]);
  }
  $$('#attention-filters .filter-chip').forEach((btn) => {
    btn.classList.toggle('is-active', normalize(btn.dataset.filter) === attentionFilter);
  });

  const filtered = attentionFilter === 'todas' ? all : all.filter((a) => priorityKey(a.priority) === attentionFilter);

  $('#attention-full').innerHTML = filtered.length
    ? filtered
        .map((item) => {
          const p = projectById(item.projectId);
          return `<article class="attention-card ${severityClass(item.priority)}" style="--accent:${p?.accent || '#8b95a7'}">
            <span class="marker"></span>
            <div>
              <span class="attention-sev"><i></i>${esc(priorityLabel(item.priority))} · ${esc(p?.shortName || '—')}</span>
              <h3>${esc(item.title)}</h3>
              <p>${esc(item.detail)}</p>
              <div class="attention-actions">
                <button class="mini-button accent" data-add-attention="${esc(item.id)}">Añadir a pendientes</button>
                <button class="mini-button" data-project="${esc(item.projectId)}">Ver proyecto</button>
                <button class="mini-button" data-doc-project="${esc(item.projectId)}" data-doc="${esc(item.source)}">Abrir fuente</button>
              </div>
            </div>
            <div class="attention-card-meta">
              <span><b>${esc(item.owner)}</b><br>${esc(item.when)}</span>
              <span>${esc(item.source)}</span>
            </div>
          </article>`;
        })
        .join('')
    : `<div class="empty-state"><strong>Nada en este nivel</strong><p>No hay señales con esa prioridad.</p></div>`;
}

function renderTaskProjectOptions() {
  const select = $('#task-project');
  if (!select) return;
  const current = select.value;
  select.innerHTML = `<option value="">Sin proyecto</option>${projects()
    .map((p) => `<option value="${esc(p.id)}">${esc(p.shortName)}</option>`)
    .join('')}`;
  if (current && projects().some((p) => p.id === current)) select.value = current;
}

function renderTasks() {
  const tasks = [...(snapshot.state.tasks || [])].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const pa = PRIORITY_ORDER[normalize(a.priority)] ?? 2;
    const pb = PRIORITY_ORDER[normalize(b.priority)] ?? 2;
    return pa - pb || String(b.createdAt).localeCompare(String(a.createdAt));
  });

  $('#tasks-open-count').textContent = String(tasks.filter((t) => !t.done).length);

  const filtered = tasks.filter((t) => {
    if (taskFilter === 'abiertas') return !t.done;
    if (taskFilter === 'hechas') return t.done;
    return true;
  });

  $('#task-list').innerHTML = filtered.length
    ? filtered
        .map((t) => {
          const p = projectById(t.projectId);
          const prio = normalize(t.priority) || 'media';
          return `<div class="task-row ${t.done ? 'is-done' : ''}" data-task-id="${esc(t.id)}">
            <button class="task-check" data-toggle-task="${esc(t.id)}" title="${t.done ? 'Marcar como abierta' : 'Marcar como hecha'}">
              <svg viewBox="0 0 24 24" fill="none"><path d="m5 12 4.2 4.2L19 6.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <span class="task-title">${esc(t.title)}</span>
            <span class="task-project" style="--accent:${p?.accent || '#8b95a7'}"><i></i>${esc(p?.shortName || 'Sin proyecto')}</span>
            <span class="task-priority prio-${prio}">${esc(priorityLabel(t.priority))}</span>
            <button class="task-delete" data-delete-task="${esc(t.id)}" title="Eliminar">
              <svg viewBox="0 0 24 24" fill="none"><path d="M5 7h14M9 7V4.5h6V7M8 10v7.5M12 10v7.5M16 10v7.5M7 7l.8 12.5h8.4L17 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>`;
        })
        .join('')
    : `<div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" stroke-width="1.5"/><path d="m8 12 2.4 2.4L16 9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <strong>${taskFilter === 'hechas' ? 'Todavía no has cerrado nada' : 'La lista está limpia'}</strong>
        <p>${taskFilter === 'hechas' ? 'Cuando marques un pendiente, aparecerá aquí.' : 'Añade el primero arriba o desde cualquier señal de atención.'}</p>
      </div>`;

  $$('.task-filters .filter-chip[data-task-filter]').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.taskFilter === taskFilter);
  });
}

function renderSources() {
  $('#sources-list').innerHTML = projects()
    .map((p) => {
      const items = (p.sources || [])
        .map(
          (s) => `<button class="source-item ${s.exists ? '' : 'missing'}" data-doc-project="${esc(p.id)}" data-doc="${esc(s.relative)}">
            <svg viewBox="0 0 24 24" fill="none"><path d="M6 3.8h8l4 4V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.8a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.5"/><path d="M14 3.8v4h4" stroke="currentColor" stroke-width="1.5"/></svg>
            <span>${esc(s.relative)}</span>
            <time>${s.exists ? esc(shortDate(s.modified)) : 'falta'}</time>
          </button>`
        )
        .join('');

      return `<div class="source-group" style="--accent:${p.accent}">
        <div class="source-group-head"><i></i><strong>${esc(p.shortName)}</strong><span>${p.folderExists ? `${p.sourceCount}/${p.sources.length} docs` : 'carpeta no encontrada'}</span></div>
        ${items || `<div class="source-item missing"><span>Sin documentos en la carpeta.</span></div>`}
        <button class="source-item" data-project-folder="${esc(p.id)}">
          <svg viewBox="0 0 24 24" fill="none"><path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h4l2 2.2h7A1.5 1.5 0 0 1 20 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-12Z" stroke="currentColor" stroke-width="1.5"/></svg>
          <span>Abrir carpeta del proyecto</span>
        </button>
      </div>`;
    })
    .join('');
}

function renderSettings() {
  const settings = snapshot.state.settings || {};
  setSwitch('#toggle-widget-start', Boolean(settings.showWidgetOnStart));
  setSwitch('#toggle-pin', Boolean(settings.widgetDesktop));
  setSwitch('#toggle-login', Boolean(settings.launchAtLogin));
  $('#state-path').textContent = snapshot.paths.state;
  $('#data-path').textContent = snapshot.paths.data;
}

function setSwitch(selector, value) {
  const el = $(selector);
  if (!el) return;
  el.classList.toggle('is-on', value);
  el.setAttribute('aria-checked', String(value));
}

function renderAiSettings() {
  const ai = snapshot?.ai;
  if (!ai) return;

  const provider = $('#ai-provider');
  const model = $('#ai-model');
  const models = $('#ai-models');
  const key = $('#ai-key');
  if (!provider || !model || !models || !key) return;

  const signature = ai.providers.map((item) => item.id).join('|');
  if (provider.dataset.signature !== signature) {
    provider.innerHTML = ai.providers
      .map((item) => `<option value="${esc(item.id)}">${esc(item.label)}</option>`)
      .join('');
    provider.dataset.signature = signature;
  }
  if (document.activeElement !== provider) provider.value = ai.provider;
  if (document.activeElement !== model) model.value = ai.model;

  const current = ai.providers.find((item) => item.id === provider.value) || ai.providers[0];
  models.innerHTML = (current?.models || []).map((item) => `<option value="${esc(item)}"></option>`).join('');
  model.placeholder = current?.model || 'modelo';

  if (document.activeElement !== key) key.value = '';
  key.placeholder = ai.hasKey ? `Guardada · ${ai.maskedKey}` : 'Pega tu clave…';

  const status = $('#ai-key-status');
  status.textContent = ai.hasKey
    ? `Clave cifrada en este equipo · ${ai.maskedKey}`
    : 'Sin clave: la IA y el chat en terminal están desactivados.';
  status.classList.toggle('is-ok', Boolean(ai.hasKey));
}

function selectedAiProvider() {
  const id = $('#ai-provider')?.value;
  return (snapshot?.ai?.providers || []).find((item) => item.id === id) || null;
}

/* ------------------------------------------------------------------ drawer */

function openProject(projectId) {
  const p = projectById(projectId);
  if (!p) return;
  lastProjectId = p.id;
  const status = statusMeta(p.status);
  const next = p.next || [];
  const docs = p.sources || [];
  const agents = snapshot.agents || [];

  $('#drawer-content').innerHTML = `
    <div class="drawer-top">
      <span class="section-kicker">DETALLE DEL PROYECTO</span>
      <button class="drawer-close" id="drawer-close" title="Cerrar">
        <svg viewBox="0 0 24 24" fill="none"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      </button>
    </div>
    <div class="drawer-hero" style="--accent:${p.accent}">
      <span class="status-pill"><i></i>${esc(status.label)}</span>
      <h1>${esc(p.name)}</h1>
      <div class="drawer-stage">${esc(p.stage)}</div>
      <p>${esc(p.summary)}</p>
      <div class="drawer-progress">
        <div class="progress-track"><i style="width:${p.progress}%"></i></div>
        <strong>${p.progress}%</strong>
      </div>
      <div class="drawer-metrics">
        ${(p.metrics || []).map((m) => `<div class="drawer-metric"><span>${esc(m.label)}</span><strong>${esc(m.value)}</strong></div>`).join('')}
      </div>
    </div>

    <div class="drawer-section">
      <h2>Ejecutar en la carpeta raíz</h2>
      <div class="agent-grid">
        ${agents
          .map(
            (a) => `<button class="agent-button ${a.available ? '' : 'is-unavailable'}" data-launch-agent="${esc(a.id)}" data-agent-project="${esc(p.id)}" ${a.available ? '' : 'disabled'} title="${esc(a.available ? `Abrir ${a.label} en ${p.folder}` : `${a.label}: ${a.hint}`)}">
              <span class="agent-icon">${esc(agentBadge(a))}</span>
              <span class="agent-copy"><strong>${esc(a.label)}</strong><small>${esc(a.available ? a.hint : a.hint || 'no instalado')}</small></span>
              <span class="agent-status"></span>
            </button>`
          )
          .join('')}
      </div>
      <p class="agent-note">Abre una consola PowerShell nueva en <code>${esc(p.folder)}</code>. <strong>deepseek</strong> inicia un chat en terminal con la API configurada en Ajustes; <strong>harness</strong> abre <code>dsh web</code> si está instalado.</p>
    </div>

    <div class="drawer-section">
      <h2>Documentación</h2>
      ${documentationBlock(p)}
      <div class="drawer-ai">
        <button class="ghost-button" data-ai-project="${esc(p.id)}">Actualizar con IA</button>
      </div>
    </div>

    <div class="drawer-section">
      <h2>Qué ya está hecho</h2>
      <div class="drawer-list">
        ${(p.done || []).map((item) => `<div class="drawer-list-item"><span class="tick"><svg viewBox="0 0 24 24" fill="none"><path d="m5 12 4.2 4.2L19 6.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span>${esc(item)}</span></div>`).join('')}
      </div>
    </div>

    <div class="drawer-section">
      <h2>Siguiente</h2>
      <div class="drawer-list">
        ${next
          .map(
            (item) => `<div class="next-item">
              <div class="next-item-head"><strong>${esc(item.title)}</strong><span class="pill ${normalize(item.priority) === 'critica' ? 'critical' : normalize(item.priority)}">${esc(priorityLabel(item.priority))}</span></div>
              <p>${esc(item.detail)}</p>
              <div class="next-meta"><span class="pill">${esc(item.effort || 'Sin estimar')}</span></div>
            </div>`
          )
          .join('') || '<div class="drawer-list-item">Sin siguiente paso definido.</div>'}
      </div>
    </div>

    <div class="drawer-section">
      <h2>Riesgos abiertos</h2>
      <div class="drawer-list">
        ${(p.risks || []).map((item) => `<div class="risk-item"><span>${esc(item)}</span></div>`).join('') || '<div class="drawer-list-item">Sin riesgos documentados.</div>'}
      </div>
    </div>

    <div class="drawer-section">
      <h2>Documentos leídos</h2>
      <div class="drawer-docs">
        ${docs
          .map(
            (s) => `<button class="drawer-doc" data-doc-project="${esc(p.id)}" data-doc="${esc(s.relative)}">
              <svg viewBox="0 0 24 24" fill="none"><path d="M6 3.8h8l4 4V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.8a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.5"/><path d="M14 3.8v4h4M8.5 12h7M8.5 15.5h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
              <span>${esc(s.relative)}</span><time>${s.exists ? esc(shortDate(s.modified)) : 'falta'}</time>
            </button>`
          )
          .join('') || '<div class="drawer-doc"><span>Sin documentos. Solo existe la carpeta.</span></div>'}
      </div>
    </div>

    <div class="drawer-actions">
      <button class="ghost-button" data-project-folder="${esc(p.id)}">Abrir carpeta</button>
      <button class="primary-button" data-add-project-task="${esc(p.id)}">Añadir pendiente</button>
    </div>
  `;

  $('#drawer').classList.add('is-open');
  $('#drawer').setAttribute('aria-hidden', 'false');
  $('#drawer-overlay').classList.add('is-open');
  $('#drawer-content').scrollTop = 0;
  bindDynamic();
}

function closeDrawer() {
  $('#drawer').classList.remove('is-open');
  $('#drawer').setAttribute('aria-hidden', 'true');
  $('#drawer-overlay').classList.remove('is-open');
}

function agentBadge(agent) {
  if (agent.id === 'deepclaude') return 'dC';
  if (agent.id === 'claude') return 'C';
  if (agent.id === 'opencode') return '</>';
  if (agent.id === 'deepseek') return '›_';
  return 'DS';
}

function docStateMeta(state) {
  const map = {
    completa: { label: 'Completa', className: 'ok' },
    parcial: { label: 'Parcial', className: 'partial' },
    'no-existe': { label: 'Sin documentación', className: 'missing' }
  };
  return map[state] || { label: 'Sin analizar', className: 'missing' };
}

function documentationBlock(project) {
  const info = project.ai?.documentation;
  const existing = (project.sources || []).filter((source) => source.exists).length;

  if (!info) {
    return `<div class="ai-box">
      <p class="muted">${existing ? `${existing} documento(s) detectados en la carpeta.` : 'La carpeta no tiene documentos de texto.'} Actualiza con IA para mapear cómo está llevada la documentación y qué falta.</p>
    </div>`;
  }

  const meta = docStateMeta(info.state);
  const canonical = (info.canonical || [])
    .map(
      (item) => `<div class="doc-canonical-row">
        <code title="${esc(item.path)}">${esc(item.path)}</code>
        <em class="${item.status === 'falta' ? 'is-falta' : ''}">${esc(item.status)}</em>
      </div>`
    )
    .join('');

  const plan = (info.plan || []).length
    ? `<ul class="doc-plan">${info.plan.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`
    : '';

  return `<div class="doc-map">
    <div class="doc-map-head">
      <span class="ai-badge ${meta.className}">${esc(meta.label)}</span>
      <span>${project.ai?.updatedAt ? shortDate(project.ai.updatedAt) : ''}</span>
    </div>
    ${info.summary ? `<p class="ai-box muted">${esc(info.summary)}</p>` : ''}
    ${canonical ? `<div class="doc-canonical">${canonical}</div>` : ''}
    ${plan}
    ${project.ai?.createdFiles?.length ? `<p class="ai-note">Creados: ${esc(project.ai.createdFiles.join(', '))}</p>` : ''}
  </div>`;
}

/* --------------------------------------------------------- modal proyecto */

function openProjectModal() {
  projectDraft = null;
  projectInput = { folder: '', name: '' };
  projectBusy = false;
  projectError = null;
  projectAdded = null;
  $('#project-modal').classList.add('is-open');
  $('#project-modal').setAttribute('aria-hidden', 'false');
  $('#project-overlay').classList.add('is-open');
  renderProjectModal();
  setTimeout(() => $('#project-folder')?.focus(), 80);
}

function closeProjectModal() {
  $('#project-modal').classList.remove('is-open');
  $('#project-modal').setAttribute('aria-hidden', 'true');
  $('#project-overlay').classList.remove('is-open');
}

function renderProjectModal() {
  const body = $('#project-body');
  if (!body) return;
  const aiReady = Boolean(snapshot?.ai?.ready);

  if (projectAdded) {
    body.innerHTML = `
      <div class="ai-result-head">
        <div>
          <h3>${esc(projectAdded.name)} ya está en el panel</h3>
          <p>${projectAdded.analyzed ? 'Se añadió con el análisis de la IA y su mapa de documentación.' : 'Se añadió con la documentación detectada en la carpeta.'}</p>
        </div>
        <span class="ai-badge ok">Añadido</span>
      </div>
      <div class="ai-box">
        <h4>Carpeta</h4>
        <div class="ai-doc-row"><code>${esc(projectAdded.folder)}</code><span>${projectAdded.documents} documento(s)</span></div>
      </div>
      <div class="ai-actions">
        <button class="ghost-button" id="project-add-another">Añadir otro</button>
        <button class="primary-button" id="project-open-new">Ver proyecto</button>
      </div>`;
    $('#project-add-another').onclick = () => {
      projectDraft = null;
      projectInput = { folder: '', name: '' };
      projectAdded = null;
      renderProjectModal();
      setTimeout(() => $('#project-folder')?.focus(), 60);
    };
    $('#project-open-new').onclick = () => {
      const id = projectAdded.id;
      closeProjectModal();
      switchView('proyectos');
      openProject(id);
    };
    return;
  }

  if (projectBusy) {
    body.innerHTML = `<div class="ai-loading"><span class="spinner"></span><span>${esc(projectBusy === 'preview' ? 'Leyendo la carpeta y consultando a la IA…' : 'Guardando el proyecto…')}</span></div>`;
    return;
  }

  if (projectDraft) {
    const result = projectDraft.result;
    const docs = projectDraft.docs || [];
    const meta = result ? docStateMeta(result.documentation.state) : null;
    body.innerHTML = `
      <div class="ai-result-head">
        <div>
          <h3>${esc(projectDraft.name || 'Proyecto')}</h3>
          <p>${esc(result?.summary || 'Carpeta lista para añadir al panel.')}</p>
        </div>
        ${meta ? `<span class="ai-badge ${meta.className}">${esc(meta.label)}</span>` : '<span class="ai-badge partial">Sin analizar</span>'}
      </div>
      <div class="ai-changes">
        <div class="ai-change"><span>Estado</span><strong>${esc(result?.status || 'por-iniciar')}</strong></div>
        <div class="ai-change"><span>Avance</span><strong>${result?.progress ?? 0}%</strong></div>
        <div class="ai-change"><span>Documentos</span><strong>${docs.length}</strong></div>
        <div class="ai-change"><span>Pasos</span><strong>${result?.next?.length ?? 0}</strong></div>
      </div>
      <div class="ai-grid">
        <div class="ai-box">
          <h4>Carpeta</h4>
          <div class="ai-doc-row"><code title="${esc(projectDraft.folder)}">${esc(projectDraft.folder)}</code></div>
          <div class="ai-doc-row"><span>Nombre</span><span>${esc(projectDraft.name)}</span></div>
        </div>
        <div class="ai-box">
          <h4>Documentos detectados (${docs.length})</h4>
          ${docs.length
            ? docs.slice(0, 6).map((doc) => `<div class="ai-doc-row"><code>${esc(doc.relative)}</code><span>${esc(shortDate(doc.modified))}</span></div>`).join('')
            : '<p class="muted">La carpeta no tiene documentos de texto. Se añadirá igualmente.</p>'}
        </div>
      </div>
      ${result?.documentation?.plan?.length ? `<div class="ai-box"><h4>Cómo organizar la documentación</h4><ul>${result.documentation.plan.map((item) => `<li>${esc(item)}</li>`).join('')}</ul></div>` : ''}
      ${projectError ? `<div class="ai-error" style="margin-top:12px">${esc(projectError)}</div>` : ''}
      <div class="ai-actions">
        <button class="ghost-button" id="project-back">Volver</button>
        <button class="ghost-button" id="project-add-plain">Añadir sin análisis</button>
        <button class="primary-button" id="project-add">${result ? 'Añadir proyecto' : 'Añadir proyecto'}</button>
      </div>
      <p class="ai-note">Pulso solo lee la carpeta. No mueve, renombra ni sobrescribe archivos.</p>`;
    $('#project-back').onclick = () => {
      projectDraft = null;
      projectError = null;
      renderProjectModal();
    };
    $('#project-add-plain').onclick = () => addProjectFromModal(false);
    $('#project-add').onclick = () => addProjectFromModal(Boolean(result));
    return;
  }

  body.innerHTML = `
    <p class="ai-intro">Elige una carpeta del equipo. Pulso detecta su documentación y, si quieres, la IA resume el estado y propone cómo organizarla. <strong>No se escribe nada en la carpeta.</strong></p>
    <label class="ai-label" for="project-folder">Carpeta del proyecto</label>
    <div class="project-folder-row">
      <input class="ai-select" id="project-folder" type="text" spellcheck="false" autocomplete="off" placeholder="C:\\Users\\tu-usuario\\Proyectos\\mi-proyecto" value="${esc(projectInput.folder)}" />
      <button class="ghost-button" id="project-browse">Elegir…</button>
    </div>
    <label class="ai-label" for="project-name" style="margin-top:12px">Nombre en el panel</label>
    <input class="ai-select" id="project-name" type="text" maxlength="80" autocomplete="off" placeholder="Se usa el nombre de la carpeta si lo dejas vacío" value="${esc(projectInput.name)}" />
    <div class="ai-provider-line">
      <span class="sync-dot"></span>
      ${aiReady
        ? `<span>${esc(snapshot.ai.providerLabel)}</span><b>${esc(snapshot.ai.model)}</b><span>· listo para analizar</span>`
        : '<span>Sin clave de API: puedes añadir el proyecto igualmente y analizarlo más tarde.</span>'}
    </div>
    ${projectError ? `<div class="ai-error">${esc(projectError)}</div>` : ''}
    <div class="ai-actions">
      <button class="ghost-button" id="project-analyze" ${aiReady ? '' : 'disabled title="Añade una clave de API en Ajustes para analizar con IA"'}>Analizar con IA</button>
      <button class="ghost-button" id="project-add-plain">Añadir sin IA</button>
      <button class="primary-button" id="project-add">Añadir proyecto</button>
    </div>
    <p class="ai-note">La carpeta debe existir en este equipo. Se aceptan rutas con <code>%VARIABLES%</code>, <code>~</code> o relativas a la carpeta de Pulso.</p>`;

  $('#project-browse').onclick = pickProjectFolder;
  if (aiReady) $('#project-analyze')?.addEventListener('click', analyzeProjectFolder);
  $('#project-add-plain').onclick = () => addProjectFromModal(false);
  $('#project-add').onclick = () => addProjectFromModal(false);
  $('#project-folder').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') addProjectFromModal(false);
  });
  $('#project-name').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') addProjectFromModal(false);
  });
}

async function pickProjectFolder() {
  const picked = await window.pulso.pickProjectFolder();
  if (!picked?.ok) return;
  const folder = $('#project-folder');
  const name = $('#project-name');
  if (folder) folder.value = picked.path;
  if (name && !name.value.trim()) {
    name.value = picked.path.split(/[\\/]/).filter(Boolean).pop() || '';
  }
  projectInput = { folder: folder?.value || '', name: name?.value || '' };
  folder?.focus();
}

async function analyzeProjectFolder() {
  const folder = $('#project-folder')?.value.trim();
  const name = $('#project-name')?.value.trim() || '';
  projectInput = { folder: folder || '', name };
  if (!folder) {
    projectError = 'Escribe o elige una carpeta.';
    renderProjectModal();
    return;
  }
  projectBusy = 'preview';
  projectError = null;
  renderProjectModal();

  const response = await window.pulso.aiProjectPreview(folder);
  projectBusy = false;
  if (!response.ok) {
    projectError = response.error;
    renderProjectModal();
    return;
  }

  projectDraft = {
    folder: response.folder,
    name: name || response.suggestedName,
    result: response.result,
    provider: response.provider,
    model: response.model,
    docs: response.docs || []
  };
  renderProjectModal();
}

async function addProjectFromModal(analyzed) {
  const draft = projectDraft;
  const typedFolder = $('#project-folder')?.value.trim();
  const typedName = $('#project-name')?.value.trim() || '';
  if (!draft && (typedFolder || typedName)) {
    projectInput = { folder: typedFolder || '', name: typedName };
  }
  const folder = draft?.folder || typedFolder || projectInput.folder;
  if (!folder) {
    projectError = 'Escribe o elige una carpeta.';
    renderProjectModal();
    return;
  }

  projectBusy = 'add';
  projectError = null;
  renderProjectModal();

  const payload = {
    folder,
    name: draft?.name || typedName || projectInput.name || ''
  };
  if (analyzed && draft?.result) {
    payload.result = draft.result;
    payload.provider = draft.provider;
    payload.model = draft.model;
  }

  const response = await window.pulso.addProject(payload);
  projectBusy = false;
  if (!response.ok) {
    projectError = response.error;
    if (!projectDraft) projectDraft = null;
    renderProjectModal();
    return;
  }

  snapshot = response.snapshot;
  const project = snapshot.data.projects.find((item) => item.id === response.projectId);
  projectAdded = {
    id: response.projectId,
    name: project?.shortName || payload.name || 'Proyecto',
    folder: project?.folder || folder,
    documents: project?.sourceCount || 0,
    analyzed: Boolean(analyzed && draft?.result)
  };
  projectDraft = null;
  projectInput = { folder: '', name: '' };
  renderAll();
  renderProjectModal();
  showToast(`${projectAdded.name} añadido al panel.`);
}

/* --------------------------------------------------------------- modal IA */

function openAiModal(projectId) {
  const target = projectById(projectId) ? projectId : projects()[0]?.id || null;
  aiModalProject = target;
  aiResult = null;
  aiFiles = null;
  aiWriteResult = null;
  aiBusy = false;
  aiApplied = false;
  aiError = null;
  $('#ai-modal').classList.add('is-open');
  $('#ai-modal').setAttribute('aria-hidden', 'false');
  $('#ai-overlay').classList.add('is-open');
  renderAiModal();
}

function closeAiModal() {
  $('#ai-modal').classList.remove('is-open');
  $('#ai-modal').setAttribute('aria-hidden', 'true');
  $('#ai-overlay').classList.remove('is-open');
}

function aiProjectOptions(selected) {
  return projects()
    .map((p) => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.shortName)} · ${esc(p.stage)}</option>`)
    .join('');
}

function renderAiModal() {
  const body = $('#ai-body');
  if (!body) return;
  const ai = snapshot?.ai;

  if (!ai) {
    body.innerHTML = '<div class="ai-empty"><strong>Sin conexión</strong>No se pudo leer la configuración de IA.</div>';
    return;
  }

  if (!ai.ready) {
    body.innerHTML = `
      <p class="ai-intro">Conecta tu propia API para que Pulso lea la documentación de una carpeta, la reordene y proponga los documentos que faltan. Todo se revisa antes de escribir.</p>
      <div class="ai-empty">
        <strong>Falta la clave de API</strong>
        Elige DeepSeek, OpenAI o Claude en Ajustes y pega tu clave. Se guarda cifrada en este equipo.
      </div>
      <div class="ai-actions">
        <button class="ghost-button" id="ai-go-settings">Abrir Ajustes</button>
      </div>`;
    $('#ai-go-settings').onclick = () => {
      closeAiModal();
      switchView('ajustes');
      $('#ai-provider')?.focus();
    };
    return;
  }

  if (aiBusy) {
    body.innerHTML = `<div class="ai-loading"><span class="spinner"></span><span>Leyendo documentos y consultando a ${esc(ai.providerLabel)}…</span></div>`;
    return;
  }

  if (aiWriteResult) {
    const created = aiWriteResult.created || [];
    const skipped = aiWriteResult.skipped || [];
    body.innerHTML = `
      <div class="ai-result-head">
        <div>
          <h3>Documentación creada</h3>
          <p>Los archivos nuevos ya están en la carpeta del proyecto y se añadieron a sus fuentes.</p>
        </div>
        <span class="ai-badge ok">Listo</span>
      </div>
      <div class="ai-box">
        <h4>Archivos creados (${created.length})</h4>
        ${created.length ? created.map((item) => `<div class="ai-doc-row"><code>${esc(item)}</code><span>nuevo</span></div>`).join('') : '<p class="muted">Ninguno.</p>'}
      </div>
      ${skipped.length ? `<div class="ai-box" style="margin-top:10px"><h4>Omitidos (${skipped.length})</h4>${skipped.map((item) => `<div class="ai-doc-row"><code>${esc(item.path)}</code><span>${esc(item.reason)}</span></div>`).join('')}</div>` : ''}
      <div class="ai-actions">
        <button class="ghost-button" id="ai-close-result">Cerrar</button>
        <button class="primary-button" id="ai-reanalyze">Analizar de nuevo</button>
      </div>`;
    $('#ai-close-result').onclick = closeAiModal;
    $('#ai-reanalyze').onclick = () => {
      aiWriteResult = null;
      aiResult = null;
      renderAiModal();
    };
    return;
  }

  if (aiFiles) {
    renderAiFiles();
    return;
  }

  if (aiResult) {
    renderAiResult();
    return;
  }

  body.innerHTML = `
    <p class="ai-intro">La IA lee los documentos de la carpeta y devuelve cómo está llevada la documentación, qué falta y un estado actualizado del proyecto. <strong>No se modifica nada hasta que lo confirmes.</strong></p>
    <label class="ai-label" for="ai-project-select">Proyecto</label>
    <select class="ai-select" id="ai-project-select">${aiProjectOptions(aiModalProject)}</select>
    <div class="ai-provider-line">
      <span class="sync-dot"></span>
      <span>${esc(ai.providerLabel)}</span>
      <b>${esc(ai.model)}</b>
      <span>· clave guardada</span>
    </div>
    ${aiError ? `<div class="ai-error">${esc(aiError)}</div>` : ''}
    <div class="ai-run-row">
      <button class="primary-button" id="ai-run">Analizar documentación</button>
    </div>
    <p class="ai-note">Se leen hasta 40 archivos .md, .txt o .rst (máximo 120 KB) y se envía su contenido al proveedor que elegiste. No se envían otros archivos ni rutas fuera de la carpeta del proyecto.</p>`;

  $('#ai-project-select').onchange = (event) => {
    aiModalProject = event.target.value;
  };
  $('#ai-run').onclick = runAiRemap;
}

function renderAiResult() {
  const body = $('#ai-body');
  const response = aiResult;
  const result = response.result;
  const project = projectById(response.projectId);
  const meta = docStateMeta(result.documentation.state);

  const docs = response.docs.length
    ? response.docs
        .map((doc) => `<div class="ai-doc-row"><code title="${esc(doc.relative)}">${esc(doc.relative)}</code><span>${esc(shortDate(doc.modified))}</span></div>`)
        .join('')
    : '<p class="muted">No se encontró documentación de texto.</p>';

  const canonical = (result.documentation.canonical || []).length
    ? result.documentation.canonical
        .map(
          (item) => `<div class="ai-doc-row">
            <code title="${esc(item.role)}">${esc(item.path)}</code>
            <span>${esc(item.status)}</span>
          </div>`
        )
        .join('')
    : '<p class="muted">Sin archivos canónicos definidos.</p>';

  const plan = (result.documentation.plan || []).length
    ? `<ul>${result.documentation.plan.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`
    : '<p class="muted">Sin plan propuesto.</p>';

  const proposed = (result.documentation.proposed || []).length
    ? result.documentation.proposed
        .map(
          (item) => `<div class="ai-doc-row">
            <code title="${esc(item.purpose)}">${esc(item.path)}</code>
            <span>nuevo</span>
          </div>`
        )
        .join('')
    : '<p class="muted">No hace falta crear archivos.</p>';

  const canCreate = result.documentation.state !== 'completa' || result.documentation.proposed.length > 0;

  body.innerHTML = `
    <div class="ai-result-head">
      <div>
        <h3>${esc(project?.name || 'Proyecto')}</h3>
        <p>${esc(result.documentation.summary || 'Análisis completado.')}</p>
      </div>
      <span class="ai-badge ${meta.className}">${esc(meta.label)}</span>
    </div>

    <div class="ai-changes">
      <div class="ai-change"><span>Estado</span><strong>${esc(result.status)}</strong></div>
      <div class="ai-change"><span>Avance</span><strong>${result.progress}%</strong></div>
      <div class="ai-change"><span>Pasos</span><strong>${result.next.length}</strong></div>
      <div class="ai-change"><span>Riesgos</span><strong>${result.risks.length}</strong></div>
    </div>

    <div class="ai-grid">
      <div class="ai-box"><h4>Documentos leídos (${response.docs.length})</h4>${docs}</div>
      <div class="ai-box"><h4>Mapa canónico</h4>${canonical}</div>
    </div>
    <div class="ai-grid">
      <div class="ai-box"><h4>Cómo organizarla</h4>${plan}</div>
      <div class="ai-box"><h4>Archivos que faltan</h4>${proposed}</div>
    </div>
    <div class="ai-box">
      <h4>Resumen propuesto</h4>
      <p class="muted">${esc(result.summary || '—')}</p>
    </div>

    ${aiError ? `<div class="ai-error" style="margin-top:12px">${esc(aiError)}</div>` : ''}

    <div class="ai-actions">
      <button class="ghost-button" id="ai-again">Reanalizar</button>
      ${canCreate ? '<button class="ghost-button" id="ai-create">Crear documentación</button>' : ''}
      <button class="primary-button" id="ai-apply" ${aiApplied ? 'disabled' : ''}>${aiApplied ? 'Aplicado ✓' : 'Aplicar al panel'}</button>
    </div>
    <p class="ai-note">Aplicar actualiza estado, avance, resumen, pasos, riesgos y métricas del archivo de datos. Antes se guarda una copia con extensión <code>.bak</code>.</p>`;

  $('#ai-again').onclick = () => {
    aiResult = null;
    aiApplied = false;
    renderAiModal();
  };
  const create = $('#ai-create');
  if (create) create.onclick = previewAiDocs;
  $('#ai-apply').onclick = applyAiResult;
}

function renderAiFiles() {
  const body = $('#ai-body');
  const files = aiFiles;
  body.innerHTML = `
    <p class="ai-intro">Se crearán <strong>${files.length} documento(s)</strong> en la carpeta del proyecto. Nada se sobrescribe: si un archivo ya existe, se omite y se informa al final.</p>
    <div class="ai-files">
      ${files
        .map(
          (file) => `<div class="ai-file">
            <div class="ai-file-head"><code>${esc(file.path)}</code><span>${file.content.length} caracteres</span></div>
            <pre>${esc(file.content.slice(0, 700))}${file.content.length > 700 ? '\n…' : ''}</pre>
          </div>`
        )
        .join('')}
    </div>
    ${aiError ? `<div class="ai-error">${esc(aiError)}</div>` : ''}
    <div class="ai-actions">
      <button class="ghost-button" id="ai-back">Volver</button>
      <button class="primary-button" id="ai-write">Crear ${files.length} documento${files.length === 1 ? '' : 's'}</button>
    </div>`;

  $('#ai-back').onclick = () => {
    aiFiles = null;
    aiError = null;
    renderAiModal();
  };
  $('#ai-write').onclick = writeAiDocs;
}

async function runAiRemap() {
  aiModalProject = $('#ai-project-select')?.value || aiModalProject;
  aiBusy = true;
  aiError = null;
  aiResult = null;
  aiFiles = null;
  aiApplied = false;
  renderAiModal();

  const response = await window.pulso.aiRemap(aiModalProject);
  aiBusy = false;
  if (!response.ok) {
    aiError = response.error;
    renderAiModal();
    return;
  }
  aiResult = response;
  renderAiModal();
}

async function applyAiResult() {
  if (!aiResult) return;
  aiBusy = true;
  aiError = null;
  renderAiModal();

  const response = await window.pulso.aiApply({
    projectId: aiModalProject,
    result: aiResult.result,
    provider: aiResult.provider,
    model: aiResult.model
  });
  aiBusy = false;
  if (!response.ok) {
    aiError = response.error;
    renderAiModal();
    return;
  }
  snapshot = response.snapshot;
  aiApplied = true;
  renderAll();
  renderAiModal();
  showToast('Panel actualizado. La copia anterior quedó en el archivo .bak.');
}

async function previewAiDocs() {
  if (!aiResult) return;
  aiBusy = true;
  aiError = null;
  renderAiModal();

  const response = await window.pulso.aiDocsPreview({
    projectId: aiModalProject,
    documentation: aiResult.result.documentation
  });
  aiBusy = false;
  if (!response.ok) {
    aiError = response.error;
    renderAiModal();
    return;
  }
  aiFiles = response.files;
  renderAiModal();
}

async function writeAiDocs() {
  if (!aiFiles) return;
  aiBusy = true;
  aiError = null;
  renderAiModal();

  const response = await window.pulso.aiDocsWrite({ projectId: aiModalProject, files: aiFiles });
  aiBusy = false;
  if (!response.ok && !(response.created || []).length) {
    aiError = response.error || 'No se pudo crear ningún documento.';
    renderAiModal();
    return;
  }
  snapshot = response.snapshot;
  aiFiles = null;
  aiResult = null;
  aiWriteResult = response;
  renderAll();
  renderAiModal();
  showToast(`${response.created.length} documento(s) creados.`);
}

function addAttentionTask(id) {
  const item = attentionItems().find((a) => a.id === id);
  if (!item) return;
  const exists = openTasks().some((t) => normalize(t.title) === normalize(item.title));
  if (exists) {
    showToast('Ese pendiente ya está en tu lista.');
    return;
  }
  const priority = priorityKey(item.priority) === 'critica' ? 'alta' : priorityKey(item.priority);
  window.pulso.addTask({ title: item.title, projectId: item.projectId, priority }).then((next) => {
    snapshot = next;
    renderAll();
    showToast('Añadido al widget de pendientes.');
  });
}

function closeAgentMenu() {
  const menu = $('#agent-menu');
  menu.classList.remove('is-open');
  menu.setAttribute('aria-hidden', 'true');
}

function openAgentMenu(projectId, anchor) {
  const p = projectById(projectId);
  if (!p) return;
  const agents = snapshot.agents || [];
  $('#agent-menu-project').textContent = p.shortName;
  $('#agent-menu-options').innerHTML = agents
    .map(
      (a) => `<button class="agent-option" data-launch-agent="${esc(a.id)}" data-agent-project="${esc(p.id)}" ${a.available ? '' : 'disabled'}>
        <span class="agent-dot"></span>
        <div><strong>${esc(a.label)}</strong><small>${esc(a.available ? a.hint : 'no instalado')}</small></div>
        <svg viewBox="0 0 24 24" fill="none"><path d="M14 4h6v6M20 4l-8.5 8.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 14.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>
      </button>`
    )
    .join('');

  const menu = $('#agent-menu');
  menu.classList.add('is-open');
  menu.setAttribute('aria-hidden', 'false');
  menu.style.left = '0px';
  menu.style.top = '0px';

  const anchorRect = anchor.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const menuHeight = menuRect.height || 280;
  let left = anchorRect.left;
  let top = anchorRect.bottom + 8;
  if (left + menuRect.width > window.innerWidth - 12) left = window.innerWidth - menuRect.width - 12;
  if (top + menuHeight > window.innerHeight - 12) top = anchorRect.top - menuHeight - 8;
  left = Math.max(12, left);
  top = Math.max(12, Math.min(top, window.innerHeight - menuHeight - 12));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  $$('#agent-menu [data-launch-agent]').forEach((el) => {
    el.onclick = (event) => {
      event.stopPropagation();
      launchAgentFromUi(el.dataset.agentProject, el.dataset.launchAgent);
    };
  });
}

function launchAgentFromUi(projectId, agentId) {
  const p = projectById(projectId);
  const agent = (snapshot.agents || []).find((a) => a.id === agentId);
  closeAgentMenu();
  window.pulso.launchAgent(projectId, agentId).then((result) => {
    if (result.ok) {
      showToast(`PowerShell abierta en ${p?.shortName || 'el proyecto'} con ${agent?.label || agentId}.`);
    } else {
      showToast(result.error || 'No se pudo ejecutar el agente.');
    }
  });
}

function addProjectTask(projectId) {
  const p = projectById(projectId);
  closeDrawer();
  switchView('pendientes');
  $('#task-project').value = projectId;
  $('#task-input').value = p ? `Revisar ${p.shortName}` : '';
  $('#task-input').focus();
  $('#task-input').select();
}

/* ------------------------------------------------------------------ actions */

function bindDynamic() {
  // Any element that points at a project opens the detail drawer.
  $$('[data-project]').forEach((el) => {
    el.onclick = (event) => {
      if (event.target.closest('[data-project-folder]')) return;
      if (event.target.closest('[data-agent-menu]')) return;
      openProject(el.dataset.project);
    };
    if (el.getAttribute('tabindex') === '0') {
      el.onkeydown = (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openProject(el.dataset.project);
        }
      };
    }
  });

  $$('[data-doc-project][data-doc]').forEach((el) => {
    el.onclick = async (event) => {
      event.stopPropagation();
      const result = await window.pulso.openDoc(el.dataset.docProject, el.dataset.doc);
      if (!result.ok) showToast(result.error || 'No se pudo abrir el documento.');
    };
  });

  $$('[data-project-folder]').forEach((el) => {
    el.onclick = async (event) => {
      event.stopPropagation();
      const result = await window.pulso.openProjectFolder(el.dataset.projectFolder);
      if (!result.ok) showToast(result.error || 'No se pudo abrir la carpeta.');
    };
  });

  $$('[data-agent-menu]').forEach((el) => {
    el.onclick = (event) => {
      event.stopPropagation();
      openAgentMenu(el.dataset.agentMenu, el);
    };
  });

  $$('[data-launch-agent][data-agent-project]').forEach((el) => {
    el.onclick = (event) => {
      event.stopPropagation();
      launchAgentFromUi(el.dataset.agentProject, el.dataset.launchAgent);
    };
  });

  $$('[data-add-attention]').forEach((el) => {
    el.onclick = (event) => {
      event.stopPropagation();
      addAttentionTask(el.dataset.addAttention);
    };
  });

  $$('[data-add-project-task]').forEach((el) => {
    el.onclick = (event) => {
      event.stopPropagation();
      addProjectTask(el.dataset.addProjectTask);
    };
  });

  $$('[data-ai-project]').forEach((el) => {
    el.onclick = (event) => {
      event.stopPropagation();
      openAiModal(el.dataset.aiProject);
    };
  });

  $$('[data-toggle-task]').forEach((el) => {
    el.onclick = () => {
      window.pulso.toggleTask(el.dataset.toggleTask).then((next) => {
        snapshot = next;
        renderAll();
      });
    };
  });

  $$('[data-delete-task]').forEach((el) => {
    el.onclick = () => {
      window.pulso.deleteTask(el.dataset.deleteTask).then((next) => {
        snapshot = next;
        renderAll();
        showToast('Pendiente eliminado.');
      });
    };
  });
}

function switchView(view) {
  currentView = view;
  $$('.view').forEach((el) => el.classList.toggle('is-active', el.id === `view-${view}`));
  $$('.nav-item').forEach((el) => el.classList.toggle('is-active', el.dataset.view === view));
  $('#view-eyebrow').textContent = VIEW_LABELS[view] || view.toUpperCase();
  $('.main-scroll').scrollTop = 0;
}

function finishTaskForm(event) {
  event.preventDefault();
  const input = $('#task-input');
  const title = input.value.trim();
  if (!title) {
    input.focus();
    return;
  }
  const projectId = $('#task-project').value || null;
  const priority = $('#task-priority').value;
  window.pulso.addTask({ title, projectId, priority }).then((next) => {
    snapshot = next;
    input.value = '';
    renderAll();
    input.focus();
    showToast('Pendiente añadido al widget.');
  });
}

function setSetting(patch, message) {
  window.pulso.setSettings(patch).then((next) => {
    snapshot = next;
    renderAll();
    if (message) showToast(message);
  });
}

function initEvents() {
  $$('[data-view]').forEach((el) => {
    el.addEventListener('click', () => switchView(el.dataset.view));
  });

  $('#btn-refresh').onclick = async () => {
    snapshot = await window.pulso.reload();
    renderAll();
    const stats = snapshot.refresh;
    if (!stats) {
      showToast('Fuentes releídas. Nada se modificó.');
      return;
    }
    const parts = [
      `${stats.projects} proyecto${stats.projects === 1 ? '' : 's'}`,
      `${stats.documents} documento${stats.documents === 1 ? '' : 's'}`
    ];
    if (stats.missingFolders.length) parts.push(`${stats.missingFolders.length} sin carpeta`);
    if (stats.missingDocs.length) parts.push(`${stats.missingDocs.length} sin documentación`);
    showToast(`Actualizado · ${parts.join(' · ')}`);
  };

  $('#btn-add-project').onclick = openProjectModal;
  $('#project-close').onclick = closeProjectModal;
  $('#project-overlay').onclick = closeProjectModal;

  $('#btn-ai').onclick = () => openAiModal(lastProjectId);
  $('#ai-close').onclick = closeAiModal;
  $('#ai-overlay').onclick = closeAiModal;

  $('#ai-provider').onchange = () => {
    const provider = selectedAiProvider();
    if (!provider) return;
    $('#ai-model').value = provider.model;
    $('#ai-model').placeholder = provider.model;
    $('#ai-models').innerHTML = provider.models.map((item) => `<option value="${esc(item)}"></option>`).join('');
  };

  $('#ai-key-link').onclick = () => window.pulso.openAiKeyPage($('#ai-provider').value);

  $('#ai-save').onclick = async () => {
    const apiKey = $('#ai-key').value.trim();
    if (!apiKey && !snapshot.ai?.hasKey) {
      showToast('Pega tu clave de API antes de guardar.');
      $('#ai-key').focus();
      return;
    }
    const payload = {
      provider: $('#ai-provider').value,
      model: $('#ai-model').value.trim()
    };
    if (apiKey) payload.apiKey = apiKey;
    snapshot = await window.pulso.setAiConfig(payload);
    renderAll();
    showToast(apiKey ? 'Clave guardada y cifrada en este equipo.' : 'Ajustes de IA guardados.');
  };

  $('#ai-test').onclick = async () => {
    const button = $('#ai-test');
    button.disabled = true;
    const original = button.textContent;
    button.textContent = 'Probando…';
    const result = await window.pulso.testAi();
    button.disabled = false;
    button.textContent = original;
    if (result.ok) {
      showToast(`Conexión correcta · ${result.provider} · ${result.model} · ${result.ms} ms`);
    } else {
      showToast(result.error || 'No se pudo conectar.');
    }
  };

  $('#btn-reload').onclick = async () => {
    snapshot = await window.pulso.reload();
    renderAll();
    showToast('Fuentes releídas.');
  };

  $('#btn-widget').onclick = async () => {
    const visible = await window.pulso.widgetVisibility();
    if (visible) {
      await window.pulso.hideWidget();
      showToast('Widget oculto. Vuelve a abrirlo cuando quieras.');
    } else {
      await window.pulso.showWidget();
      showToast('Widget anclado al escritorio.');
    }
  };

  $('#btn-widget-side').onclick = () => $('#btn-widget').click();

  $('#drawer-overlay').onclick = closeDrawer;

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if ($('#project-modal').classList.contains('is-open')) {
        closeProjectModal();
        return;
      }
      if ($('#ai-modal').classList.contains('is-open')) {
        closeAiModal();
        return;
      }
      closeAgentMenu();
      closeDrawer();
    }
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('#agent-menu') && !event.target.closest('[data-agent-menu]')) {
      closeAgentMenu();
    }
  });

  $('.main-scroll').addEventListener('scroll', closeAgentMenu, { passive: true });

  $('#attention-filters').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-filter]');
    if (!btn) return;
    attentionFilter = normalize(btn.dataset.filter);
    renderAttentionFull();
    bindDynamic();
  });

  $('.task-filters').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-task-filter]');
    if (!btn) return;
    taskFilter = btn.dataset.taskFilter;
    renderTasks();
    bindDynamic();
  });

  $('#task-form').addEventListener('submit', finishTaskForm);

  $('#clear-done').onclick = async () => {
    const done = (snapshot.state.tasks || []).filter((t) => t.done).length;
    if (!done) {
      showToast('No hay pendientes cerrados.');
      return;
    }
    snapshot = await window.pulso.clearDone();
    renderAll();
    showToast(`${done} pendiente${done === 1 ? '' : 's'} cerrado${done === 1 ? '' : 's'} fuera de la lista.`);
  };

  $('#toggle-widget-start').onclick = () => {
    const current = Boolean(snapshot.state.settings.showWidgetOnStart);
    setSetting({ showWidgetOnStart: !current }, !current ? 'El widget aparecerá al abrir Pulso.' : 'El widget no se abrirá automáticamente.');
  };

  $('#toggle-pin').onclick = () => {
    const current = Boolean(snapshot.state.settings.widgetDesktop);
    setSetting(
      { widgetDesktop: !current },
      !current ? 'Widget anclado al escritorio.' : 'Widget en modo ventana flotante.'
    );
  };

  $('#toggle-login').onclick = () => {
    const current = Boolean(snapshot.state.settings.launchAtLogin);
    setSetting({ launchAtLogin: !current }, !current ? 'Pulso se abrirá con Windows.' : 'Pulso ya no se abrirá solo.');
  };

  $('#btn-open-root').onclick = () => window.pulso.openRoot();
  $('#btn-open-state').onclick = () => window.pulso.openStateFolder();
  $('#btn-quit').onclick = () => window.pulso.quit();

  $('#side-focus-button').onclick = () => {
    const top = attentionItems()[0];
    if (top) openProject(top.projectId);
  };

  window.pulso.onStateChanged((payload) => {
    const scroll = $('.main-scroll').scrollTop;
    snapshot = payload;
    renderAll();
    $('.main-scroll').scrollTop = scroll;
  });

  window.pulso.onWidgetVisibility((visible) => {
    widgetVisible = visible;
    const label = $('#btn-widget span');
    if (label) label.textContent = visible ? 'Ocultar' : 'Widget';
  });
}

async function refreshWidgetLabel() {
  const label = $('#btn-widget span');
  if (!label) return;
  widgetVisible = await window.pulso.widgetVisibility();
  label.textContent = widgetVisible ? 'Ocultar' : 'Widget';
}

async function init() {
  snapshot = await window.pulso.getState();
  initEvents();
  renderAll();

  await refreshWidgetLabel();
  setTimeout(refreshWidgetLabel, 1200);
}

init().catch((error) => {
  console.error(error);
  document.body.innerHTML = `<div style="padding:40px;color:#ff9c9c;font-family:Consolas">No se pudo cargar Pulso: ${esc(error.message)}</div>`;
});
