const $ = (sel, root = document) => root.querySelector(sel);

let snapshot = null;
let toastTimer = null;

const PRIORITY_ORDER = { critica: 0, alta: 1, media: 2, baja: 3 };

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

function prioKey(value) {
  const key = normalize(value);
  return key === 'critica' ? 'critica' : key;
}

function dateValue(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function openTasks() {
  return (snapshot?.state?.tasks || []).filter((t) => !t.done);
}

function projectById(id) {
  return (snapshot?.data?.projects || []).find((p) => p.id === id);
}

function showToast(message) {
  let toast = $('.w-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'w-toast';
    $('#widget').appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2000);
}

function render() {
  if (!snapshot) return;
  const projects = snapshot.data.projects || [];
  const attention = [...(snapshot.data.attention || [])].sort(
    (a, b) => (PRIORITY_ORDER[prioKey(a.priority)] ?? 9) - (PRIORITY_ORDER[prioKey(b.priority)] ?? 9)
  );
  const tasks = openTasks().sort(
    (a, b) => (PRIORITY_ORDER[normalize(a.priority)] ?? 2) - (PRIORITY_ORDER[normalize(b.priority)] ?? 2)
  );
  const active = projects.filter((p) => ['activo', 'operativo'].includes(p.status));
  const critical = attention.filter((a) => prioKey(a.priority) === 'critica');
  const urgent = attention.filter((a) => ['critica', 'alta'].includes(prioKey(a.priority)));

  const now = dateValue(snapshot.now) || new Date();
  const stamp = new Intl.DateTimeFormat('es-MX', { weekday: 'short', day: '2-digit', month: 'short' })
    .format(now)
    .replaceAll('.', '')
    .toUpperCase();
  $('#w-date').textContent = stamp;

  $('#w-open-count').textContent = String(tasks.length);
  $('#w-summary').textContent = `${active.length} frentes activos · ${critical.length} críticos`;
  $('#w-task-count').textContent = String(tasks.length);
  $('#w-attention-count').textContent = String(urgent.length);

  const avg = Math.round(active.reduce((sum, p) => sum + p.progress, 0) / Math.max(1, active.length));
  $('#w-pulse-fill').style.width = `${avg}%`;
  $('#w-pulse-label').textContent = `${avg}% AVANCE`;

  const visibleTasks = tasks.slice(0, 3);
  $('#w-tasks').innerHTML = visibleTasks.length
    ? visibleTasks
        .map((t) => {
          const p = projectById(t.projectId);
          return `<div class="w-task" data-task-id="${esc(t.id)}">
            <button class="w-task-check" data-toggle="${esc(t.id)}" title="Marcar como hecha">
              <svg viewBox="0 0 24 24" fill="none"><path d="m5 12 4.2 4.2L19 6.5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <span class="w-task-title" title="${esc(t.title)}">${esc(t.title)}</span>
            <span class="w-task-prio ${esc(normalize(t.priority))}" title="${esc(p?.shortName || 'Sin proyecto')}"></span>
          </div>`;
        })
        .join('') +
      (tasks.length > 3 ? `<button class="w-task-more" id="w-more-tasks"><b>+${tasks.length - 3}</b> más en el panel</button>` : '')
    : `<div class="w-task-empty">Sin pendientes. Añade uno abajo.</div>`;

  const suggestions = attention.filter((a) => !tasks.some((t) => normalize(t.title) === normalize(a.title))).slice(0, 3);
  $('#w-attention').innerHTML = suggestions.length
    ? suggestions
        .map((a) => {
          const p = projectById(a.projectId);
          return `<button class="w-attn ${prioKey(a.priority)}" data-open-project="${esc(a.projectId)}" title="${esc(a.title)}">
            <span class="w-attn-dot"></span>
            <span class="w-attn-text"><b>${esc(p?.shortName || '—')}</b> · ${esc(a.title)}</span>
            <span class="w-attn-add" data-add-attention="${esc(a.id)}" title="Añadir a pendientes">
              <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
            </span>
          </button>`;
        })
        .join('')
    : `<div class="w-task-empty">Nada urgente pendiente.</div>`;

  const radar = [...projects].sort((a, b) => b.progress - a.progress).slice(0, 4);
  $('#w-radar').innerHTML = radar
    .map(
      (p) => `<div class="w-radar-row" style="--accent:${p.accent}" title="${esc(p.shortName)} · ${p.progress}%">
        <span class="w-radar-dot"></span>
        <span class="w-radar-name">${esc(p.shortName)}</span>
        <span class="w-radar-track"><i style="width:${p.progress}%"></i></span>
        <b>${p.progress}%</b>
      </div>`
    )
    .join('');

  $('#w-dots').innerHTML = projects
    .map(
      (p) =>
        `<span class="w-dot" style="--accent:${p.accent}; --opacity:${(0.28 + p.progress / 145).toFixed(2)}" title="${esc(p.shortName)} · ${p.progress}%"></span>`
    )
    .join('');

  bindDynamic();
}

function addAttention(id) {
  const item = (snapshot.data.attention || []).find((a) => a.id === id);
  if (!item) return;
  if (openTasks().some((t) => normalize(t.title) === normalize(item.title))) {
    showToast('Ya está en tu lista.');
    return;
  }
  const priority = prioKey(item.priority) === 'critica' ? 'alta' : prioKey(item.priority);
  window.pulso.addTask({ title: item.title, projectId: item.projectId, priority }).then((next) => {
    snapshot = next;
    render();
    showToast('Añadido a pendientes.');
  });
}

function bindDynamic() {
  document.querySelectorAll('[data-toggle]').forEach((el) => {
    el.onclick = (event) => {
      event.stopPropagation();
      window.pulso.toggleTask(el.dataset.toggle).then((next) => {
        snapshot = next;
        render();
      });
    };
  });

  document.querySelectorAll('[data-add-attention]').forEach((el) => {
    el.onclick = (event) => {
      event.stopPropagation();
      addAttention(el.dataset.addAttention);
    };
  });

  document.querySelectorAll('[data-open-project]').forEach((el) => {
    el.onclick = () => window.pulso.showMain();
  });

  const more = $('#w-more-tasks');
  if (more) more.onclick = () => window.pulso.showMain();
}

function updatePin(desktopMode) {
  const pin = $('#w-pin');
  pin.classList.toggle('is-pinned', desktopMode);
  pin.title = desktopMode ? 'Anclado al escritorio · clic para modo ventana' : 'Volver al escritorio';
}

async function init() {
  snapshot = await window.pulso.getState();
  render();
  updatePin(Boolean(snapshot.state.settings.widgetDesktop));

  $('#w-pin').onclick = async () => {
    const current = Boolean(snapshot.state.settings.widgetDesktop);
    snapshot = await window.pulso.setSettings({ widgetDesktop: !current });
    updatePin(!current);
    render();
    showToast(!current ? 'Anclado al escritorio.' : 'Modo ventana flotante.');
  };

  $('#w-open').onclick = () => window.pulso.showMain();
  $('#w-open-panel').onclick = () => window.pulso.showMain();
  $('#w-close').onclick = () => window.pulso.hideWidget();

  $('#w-dots').addEventListener('click', () => window.pulso.showMain());

  $('#w-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const input = $('#w-input');
    const title = input.value.trim();
    if (!title) {
      input.focus();
      return;
    }
    window.pulso.addTask({ title, priority: 'media', projectId: null }).then((next) => {
      snapshot = next;
      input.value = '';
      render();
      input.focus();
      showToast('Pendiente añadido.');
    });
  });

  window.pulso.onStateChanged((payload) => {
    snapshot = payload;
    updatePin(Boolean(payload.state.settings.widgetDesktop));
    render();
  });

  $('#w-refresh').onclick = async () => {
    snapshot = await window.pulso.reload();
    render();
    showToast('Actualizado.');
  };

  setInterval(async () => {
    try {
      snapshot = await window.pulso.getState();
      render();
    } catch {
      // Se reintenta en el siguiente ciclo.
    }
  }, 20000);
}

init().catch((error) => {
  console.error(error);
  document.body.innerHTML = `<div style="padding:24px;color:#ff9c9c;font-family:Consolas;font-size:11px">No se pudo cargar el widget: ${esc(error.message)}</div>`;
});
