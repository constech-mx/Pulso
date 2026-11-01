const {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  screen,
  Menu,
  Tray,
  nativeImage,
  safeStorage,
  dialog
} = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const ROOT = __dirname;
const APP_ICON = path.join(ROOT, 'assets', 'icon.png');
const DEMO_MODE = process.env.PULSO_DEMO === '1';
const DATA_FILE = path.join(ROOT, 'data', DEMO_MODE ? 'projects.demo.json' : 'projects.json');
const EXAMPLE_FILE = path.join(ROOT, 'data', 'projects.example.json');
const PRELOAD = path.join(ROOT, 'preload.js');
const SCREENSHOT_MODE = process.env.PULSO_SCREENSHOT === '1';

if (DEMO_MODE) {
  // La demo usa su propio estado para no mezclarse con los pendientes reales.
  const profile = SCREENSHOT_MODE ? 'pulso-demo-shots-profile' : 'pulso-demo-profile';
  app.setPath('userData', path.join(os.tmpdir(), profile));
}

const STATE_FILE = () => path.join(app.getPath('userData'), 'pulso-state.json');
const AI_CONFIG_FILE = () => path.join(app.getPath('userData'), 'ai-config.json');
const WIDGET_ONLY = process.argv.includes('--widget');

let mainWindow = null;
let widgetWindow = null;
let tray = null;
let refreshTrayMenu = null;
let quitting = false;
let widgetSaveTimer = null;
let widgetModeQueue = Promise.resolve();
let desktopPinState = false;

const defaultState = {
  tasks: [],
  settings: {
    widgetDesktop: true,
    widgetPinned: true,
    widgetEnabled: true,
    showWidgetOnStart: true,
    widgetOpacity: 0.97,
    launchAtLogin: false,
    widgetBounds: null
  }
};

const DEMO_TASKS = [
  {
    id: 'demo-task-1',
    title: 'Revisar el plan de migración de Atlas',
    projectId: 'atlas',
    priority: 'alta',
    done: false,
    createdAt: '2026-10-31T09:20:00.000Z'
  },
  {
    id: 'demo-task-2',
    title: 'Preparar la demo de Nébula para el jueves',
    projectId: 'nebula',
    priority: 'media',
    done: false,
    createdAt: '2026-10-31T11:05:00.000Z'
  },
  {
    id: 'demo-task-3',
    title: 'Actualizar el changelog de Vega',
    projectId: 'vega',
    priority: 'baja',
    done: false,
    createdAt: '2026-10-30T16:40:00.000Z'
  },
  {
    id: 'demo-task-4',
    title: 'Cerrar el informe de respaldos de Orión',
    projectId: 'orion',
    priority: 'media',
    done: true,
    createdAt: '2026-10-29T08:10:00.000Z'
  }
];

const AI_PROVIDERS = {
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    keysUrl: 'https://platform.deepseek.com/api_keys'
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    models: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini', 'o4-mini'],
    keysUrl: 'https://platform.openai.com/api-keys'
  },
  anthropic: {
    label: 'Claude',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-4-5',
    models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'],
    keysUrl: 'https://console.anthropic.com/settings/keys'
  }
};

const AI_TERMINAL_SCRIPT = path.join(ROOT, 'scripts', 'ai-terminal.js');

const DEEPCLAUDE_CANDIDATES = [
  process.env.DEEPCLAUDE_SCRIPT,
  'C:\\deepseek-proxy\\deepclaude\\deepclaude.ps1',
  path.join(os.homedir(), '.deepclaude', 'deepclaude.ps1'),
  path.join(os.homedir(), 'deepclaude', 'deepclaude.ps1')
].filter(Boolean);

const AGENT_DEFS = [
  {
    id: 'deepclaude',
    label: 'deepclaude',
    hint: 'Claude Code con backend DeepSeek',
    candidates: DEEPCLAUDE_CANDIDATES,
    commandNames: []
  },
  {
    id: 'claude',
    label: 'claude',
    hint: 'Claude Code',
    candidates: [path.join(os.homedir(), '.local', 'bin', 'claude.exe')],
    commandNames: ['claude.exe', 'claude.cmd', 'claude.ps1']
  },
  {
    id: 'opencode',
    label: 'opencode',
    hint: 'OpenCode',
    candidates: [],
    commandNames: ['opencode.cmd', 'opencode.exe', 'opencode.ps1']
  },
  {
    id: 'deepseek',
    label: 'deepseek',
    hint: 'Chat en terminal con tu API',
    kind: 'ai-terminal',
    candidates: [],
    commandNames: []
  },
  {
    id: 'harness',
    label: 'harness',
    hint: 'DeepSeek Harness · dsh web',
    kind: 'harness',
    candidates: [],
    commandNames: ['dsh.cmd', 'dsh.exe']
  }
];

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8');
}

/**
 * Convierte una carpeta escrita a mano en una ruta absoluta.
 * Acepta %VARIABLES%, ~ y rutas relativas a la carpeta de Pulso.
 */
function resolveProjectFolder(value) {
  let text = String(value || '').trim();
  if (!text) return '';
  text = text.replaceAll('/', path.sep);

  text = text.replace(/%([^%]+)%/g, (match, name) => {
    const exact = process.env[name];
    if (exact) return exact;
    const upper = process.env[name.toUpperCase()];
    return upper || match;
  });

  if (text === '~') text = os.homedir();
  else if (text.startsWith(`~${path.sep}`)) text = path.join(os.homedir(), text.slice(2));

  if (!path.isAbsolute(text)) text = path.join(ROOT, text);
  return path.normalize(text);
}

function sameFolder(a, b) {
  if (!a || !b) return false;
  const normalize = (value) => {
    try {
      return fs.realpathSync(value).toLowerCase();
    } catch {
      return path.resolve(value).toLowerCase();
    }
  };
  return normalize(a) === normalize(b);
}

function getState() {
  const saved = readJson(STATE_FILE(), {});
  return {
    tasks: Array.isArray(saved.tasks) ? saved.tasks : DEMO_MODE ? DEMO_TASKS : [],
    settings: { ...defaultState.settings, ...(saved.settings || {}) }
  };
}

function ensureDataFile() {
  if (fs.existsSync(DATA_FILE)) return;
  if (DEMO_MODE || !fs.existsSync(EXAMPLE_FILE)) return;
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.copyFileSync(EXAMPLE_FILE, DATA_FILE);
  } catch {
    // El panel mostrará una cartera vacía si no se puede crear el archivo.
  }
}

/* --------------------------------------------------------------- IA / API */

function encryptSecret(value) {
  const text = String(value || '');
  if (!text) return '';
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return `v1:${safeStorage.encryptString(text).toString('base64')}`;
    }
  } catch {
    // Se usa el respaldo local si el almacén del sistema no está disponible.
  }
  return `b64:${Buffer.from(text, 'utf8').toString('base64')}`;
}

function decryptSecret(value) {
  const text = String(value || '');
  if (!text) return '';
  try {
    if (text.startsWith('v1:') && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(text.slice(3), 'base64'));
    }
    if (text.startsWith('b64:')) return Buffer.from(text.slice(4), 'base64').toString('utf8');
  } catch {
    return '';
  }
  return '';
}

function maskKey(key) {
  const text = String(key || '');
  if (!text) return '';
  if (text.length <= 8) return '••••';
  return `${text.slice(0, 3)}••••${text.slice(-4)}`;
}

function readAiConfigRaw() {
  const saved = readJson(AI_CONFIG_FILE(), {});
  return {
    provider: AI_PROVIDERS[saved.provider] ? saved.provider : 'deepseek',
    model: typeof saved.model === 'string' ? saved.model : '',
    baseUrl: typeof saved.baseUrl === 'string' ? saved.baseUrl : '',
    key: typeof saved.key === 'string' ? saved.key : ''
  };
}

function readAiConfigSecret() {
  const raw = readAiConfigRaw();
  const provider = AI_PROVIDERS[raw.provider];
  return {
    provider: raw.provider,
    providerLabel: provider.label,
    model: raw.model || provider.model,
    baseUrl: raw.baseUrl || provider.baseUrl,
    key: decryptSecret(raw.key)
  };
}

function publicAiConfig() {
  const secret = readAiConfigSecret();
  const provider = AI_PROVIDERS[secret.provider];
  return {
    provider: secret.provider,
    providerLabel: provider.label,
    model: secret.model,
    baseUrl: secret.baseUrl,
    hasKey: Boolean(secret.key),
    maskedKey: maskKey(secret.key),
    ready: Boolean(secret.key),
    providers: Object.entries(AI_PROVIDERS).map(([id, item]) => ({
      id,
      label: item.label,
      model: item.model,
      models: item.models,
      baseUrl: item.baseUrl,
      keysUrl: item.keysUrl
    }))
  };
}

function validBaseUrl(value, fallback) {
  const text = String(value || '').trim() || fallback;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      return fallback;
    }
    return text.replace(/\/+$/, '');
  } catch {
    return fallback;
  }
}

function saveAiConfig(patch = {}) {
  const current = readAiConfigRaw();
  const providerId = AI_PROVIDERS[patch.provider] ? patch.provider : current.provider;
  const provider = AI_PROVIDERS[providerId];
  const providerChanged = providerId !== current.provider;
  const next = {
    provider: providerId,
    model: String(patch.model ?? current.model ?? '').trim().slice(0, 80) || provider.model,
    baseUrl: validBaseUrl(
      patch.baseUrl ?? (providerChanged ? provider.baseUrl : current.baseUrl),
      provider.baseUrl
    ),
    key: current.key
  };
  if (patch.clearKey) next.key = '';
  if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) {
    next.key = encryptSecret(patch.apiKey.trim());
  }
  writeJson(AI_CONFIG_FILE(), next);
  return publicAiConfig();
}

function aiErrorMessage(data, status) {
  const message =
    data?.error?.message ||
    data?.message ||
    data?.error?.type ||
    (typeof data?.error === 'string' ? data.error : '');
  return message ? `Error ${status}: ${message}` : `Error HTTP ${status}`;
}

async function aiRequest(messages, options = {}) {
  const secret = readAiConfigSecret();
  if (!secret.key) {
    throw new Error('Falta la clave de API. Añádela en Ajustes → Inteligencia artificial.');
  }
  const provider = AI_PROVIDERS[secret.provider];
  const maxTokens = Number(options.maxTokens) || 2600;
  const base = validBaseUrl(secret.baseUrl, provider.baseUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);

  try {
    if (secret.provider === 'anthropic') {
      const system = messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n');
      const rest = messages.filter((m) => m.role !== 'system');
      const response = await fetch(`${base}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': secret.key,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({ model: secret.model, max_tokens: maxTokens, system, messages: rest }),
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(aiErrorMessage(data, response.status));
      const text = (data.content || [])
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n');
      return { text, usage: data.usage || null, provider: secret.provider, model: secret.model };
    }

    const body = {
      model: secret.model,
      messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: maxTokens
    };
    if (options.json !== false) body.response_format = { type: 'json_object' };

    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${secret.key}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(aiErrorMessage(data, response.status));
    const text = data.choices?.[0]?.message?.content || '';
    return { text, usage: data.usage || null, provider: secret.provider, model: secret.model };
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('La petición tardó más de 2 minutos.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function testAiConnection() {
  const started = Date.now();
  try {
    const secret = readAiConfigSecret();
    const response = await aiRequest(
      [
        { role: 'system', content: 'Responde solo con la palabra OK.' },
        { role: 'user', content: 'Prueba de conexión.' }
      ],
      { maxTokens: 20, json: false, temperature: 0 }
    );
    return {
      ok: true,
      provider: secret.providerLabel,
      model: secret.model,
      ms: Date.now() - started,
      answer: String(response.text || '').trim().slice(0, 80)
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/* ------------------------------------------- documentos de cada proyecto */

const DOC_EXT = /\.(md|markdown|txt|rst)$/i;
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.github',
  '.idea',
  '.vscode',
  'dist',
  'build',
  'out',
  'target',
  'vendor',
  'venv',
  '.venv',
  '__pycache__',
  '.next',
  '.nuxt',
  'coverage',
  '.cache',
  'artifacts'
]);

function discoverDocs(folder, limit = 40) {
  const found = [];
  const walk = (dir, depth) => {
    if (found.length >= limit || depth > 3) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= limit) break;
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name.toLowerCase())) walk(abs, depth + 1);
        continue;
      }
      if (!entry.isFile() || !DOC_EXT.test(entry.name)) continue;
      try {
        const stat = fs.statSync(abs);
        if (stat.size > 400 * 1024) continue;
        found.push({
          relative: path.relative(folder, abs).split(path.sep).join('/'),
          absolute: abs,
          size: stat.size,
          modified: stat.mtime.toISOString()
        });
      } catch {
        // Un documento ilegible se omite sin detener el análisis.
      }
    }
  };
  walk(folder, 0);

  const score = (doc) => {
    const name = doc.relative.toLowerCase();
    let value = 0;
    if (/^readme\./.test(name)) value += 60;
    if (/^(agents|claude)\.md$/.test(name)) value += 40;
    if (/estado|status|handoff|traspaso/.test(name)) value += 30;
    if (/pendiente|todo|backlog|roadmap/.test(name)) value += 25;
    if (name.startsWith('docs/')) value += 15;
    return value;
  };
  return found.sort((a, b) => score(b) - score(a) || a.relative.localeCompare(b.relative));
}

// El panel se refresca a menudo; descubrir documentos en cada pintado sería
// costoso en carpetas grandes. Una caché muy corta mantiene el refresco ágil.
const docDiscoveryCache = new Map();

function discoverDocsCached(folder, limit = 40, ttl = 8000) {
  const key = `${folder}|${limit}`;
  const hit = docDiscoveryCache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.docs;
  const docs = discoverDocs(folder, limit);
  docDiscoveryCache.set(key, { at: Date.now(), docs });
  if (docDiscoveryCache.size > 120) {
    const oldest = [...docDiscoveryCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) docDiscoveryCache.delete(oldest[0]);
  }
  return docs;
}

function readDocBundle(folder, maxTotal = 120000) {
  const docs = discoverDocs(folder);
  const picked = [];
  let total = 0;
  for (const doc of docs) {
    if (total >= maxTotal) break;
    let text = '';
    try {
      text = fs.readFileSync(doc.absolute, 'utf8');
    } catch {
      continue;
    }
    text = String(text).replace(/\0/g, '').slice(0, 24000);
    if (!text.trim()) continue;
    total += text.length;
    picked.push({ ...doc, text });
  }
  return picked.sort((a, b) => a.relative.localeCompare(b.relative));
}

function safeDocPath(value) {
  const rel = String(value || '')
    .replaceAll('\\', '/')
    .trim()
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '');
  if (!rel || rel.length > 160) return null;
  if (rel.includes('..') || /^[a-zA-Z]:/.test(rel)) return null;
  if (!/\.(md|markdown)$/i.test(rel)) return null;
  const parts = rel.split('/');
  if (parts.length > 4) return null;
  if (parts.some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) return null;
  if (parts.some((part) => SKIP_DIRS.has(part.toLowerCase()))) return null;
  return rel;
}

function text(value, max = 400) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function list(value, max, map) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, max).map(map).filter(Boolean);
}

function sanitizeAiResult(raw, docs) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const existing = new Set(docs.map((doc) => doc.relative));
  const status = ['activo', 'operativo', 'pausado', 'por-iniciar'].includes(source.status)
    ? source.status
    : 'activo';
  const progress = Math.max(0, Math.min(100, Math.round(Number(source.progress) || 0)));
  const docInfo = source.documentation && typeof source.documentation === 'object' ? source.documentation : {};
  const state = ['completa', 'parcial', 'no-existe'].includes(docInfo.state)
    ? docInfo.state
    : docs.length
      ? 'parcial'
      : 'no-existe';

  const canonical = list(docInfo.canonical, 12, (item) => {
    const docPath = safeDocPath(item?.path);
    if (!docPath) return null;
    return {
      path: docPath,
      role: text(item?.role, 120),
      status: ['ok', 'desactualizado', 'falta'].includes(item?.status) ? item.status : 'ok'
    };
  });

  const proposed = list(docInfo.proposed, 6, (item) => {
    const docPath = safeDocPath(item?.path);
    if (!docPath) return null;
    return { path: docPath, purpose: text(item?.purpose, 160) };
  });

  return {
    status,
    stage: text(source.stage, 140) || 'Sin etapa definida',
    progress,
    summary: text(source.summary, 600),
    headline: text(source.headline, 240),
    done: list(source.done, 8, (item) => text(item, 220)),
    next: list(source.next, 6, (item) => {
      const title = text(item?.title, 140);
      if (!title) return null;
      const priority = ['crítica', 'alta', 'media', 'baja'].includes(item?.priority)
        ? item.priority
        : 'media';
      return { title, detail: text(item?.detail, 400), priority, effort: text(item?.effort, 60) };
    }),
    risks: list(source.risks, 6, (item) => text(item, 240)),
    metrics: list(source.metrics, 6, (item) => {
      const label = text(item?.label, 40);
      const value = text(item?.value, 40);
      return label && value ? { label, value } : null;
    }),
    sources: list(source.sources, 20, (item) => text(item, 200)).filter((item) => existing.has(item)),
    documentation: {
      state: docs.length === 0 ? 'no-existe' : state,
      summary: text(docInfo.summary, 600),
      canonical,
      plan: list(docInfo.plan, 8, (item) => text(item, 240)),
      proposed
    }
  };
}

function remapMessages(project, docs) {
  const current = {
    status: project.status,
    stage: project.stage,
    progress: project.progress,
    summary: project.summary,
    headline: project.headline,
    done: project.done,
    next: project.next,
    risks: project.risks,
    metrics: project.metrics,
    sources: project.sources
  };
  const bundle = docs.length
    ? docs
        .map((doc) => `### ${doc.relative} (${doc.size} bytes)\n${doc.text}`)
        .join('\n\n')
    : '(La carpeta no contiene archivos .md, .txt o .rst.)';

  return [
    {
      role: 'system',
      content:
        'Eres un analista técnico que mantiene tableros de proyectos. Lees la documentación de una carpeta y devuelves el estado real del proyecto. ' +
        'No inventes hechos, métricas, archivos ni fechas: si algo no está en los documentos, no lo afirmes. ' +
        'Escribe en español neutro y devuelve únicamente JSON válido, sin markdown ni comentarios.'
    },
    {
      role: 'user',
      content:
        `Proyecto: ${project.name}\nCarpeta: ${project.folder}\n\n` +
        `Entrada actual del tablero (puede estar desactualizada):\n${JSON.stringify(current, null, 2)}\n\n` +
        `Documentación encontrada:\n${bundle}\n\n` +
        'Devuelve un objeto JSON con este esquema exacto:\n' +
        '{\n' +
        '  "status": "activo|operativo|pausado|por-iniciar",\n' +
        '  "stage": "etapa breve",\n' +
        '  "progress": 0,\n' +
        '  "summary": "2 o 3 frases sobre qué es y en qué punto está",\n' +
        '  "headline": "una frase con lo más importante ahora",\n' +
        '  "done": ["logros verificables"],\n' +
        '  "next": [{"title": "paso", "detail": "cómo hacerlo", "priority": "crítica|alta|media|baja", "effort": "estimación"}],\n' +
        '  "risks": ["riesgos documentados"],\n' +
        '  "metrics": [{"label": "nombre", "value": "valor"}],\n' +
        '  "sources": ["rutas relativas que aparecen arriba"],\n' +
        '  "documentation": {\n' +
        '    "state": "completa|parcial|no-existe",\n' +
        '    "summary": "cómo está organizada la documentación y qué falta",\n' +
        '    "canonical": [{"path": "README.md", "role": "para qué sirve", "status": "ok|desactualizado|falta"}],\n' +
        '    "plan": ["cómo debería quedar organizada la documentación"],\n' +
        '    "proposed": [{"path": "docs/ESTADO.md", "purpose": "qué contendría"}]\n' +
        '  }\n' +
        '}\n\n' +
        'Reglas: progress entre 0 y 100; done máximo 8; next máximo 5 y ordenado por prioridad; risks máximo 6; metrics máximo 5; ' +
        'sources solo rutas que existan en la lista de arriba; plan entre 3 y 6 pasos; proposed entre 0 y 4 archivos .md que falten. ' +
        'Si no hay documentación, state debe ser "no-existe" y proposed debe incluir README.md y docs/ESTADO.md.'
    }
  ];
}

function parseAiJson(value) {
  let clean = String(value || '').trim();
  clean = clean.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start >= 0 && end > start) clean = clean.slice(start, end + 1);
  return JSON.parse(clean);
}

async function aiRemapProject(projectId) {
  const { data } = buildSnapshot();
  const project = data.projects.find((item) => item.id === projectId);
  if (!project) return { ok: false, error: 'Proyecto no encontrado.' };
  if (!project.folderExists) return { ok: false, error: 'La carpeta del proyecto no existe.' };

  try {
    const folder = resolveProjectFolder(project.folder);
    const docs = readDocBundle(folder);
    const response = await aiRequest(remapMessages(project, docs), { maxTokens: 3000 });
    const parsed = parseAiJson(response.text);
    const result = sanitizeAiResult(parsed, docs);
    return {
      ok: true,
      projectId,
      result,
      docs: docs.map((doc) => ({ relative: doc.relative, size: doc.size, modified: doc.modified })),
      provider: response.provider,
      model: response.model,
      usage: response.usage,
      generatedAt: new Date().toISOString()
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function backupDataFile() {
  try {
    if (!fs.existsSync(DATA_FILE)) return null;
    const target = `${DATA_FILE}.bak`;
    fs.copyFileSync(DATA_FILE, target);
    return target;
  } catch {
    return null;
  }
}

const PROJECT_ACCENTS = ['#f5b43c', '#a78bfa', '#31d6a0', '#5ba8ff', '#ff7a9e', '#ffb15c', '#4bd39a', '#7cc7ff'];

function slugifyProjectId(name, projects) {
  const base =
    String(name || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'proyecto';
  const used = new Set((projects || []).map((project) => project.id));
  let id = base;
  let counter = 2;
  while (used.has(id)) id = `${base}-${counter++}`;
  return id;
}

function folderDraft(folder) {
  const name = path.basename(folder);
  return {
    name,
    shortName: name,
    folder,
    status: 'por-iniciar',
    stage: 'Nuevo · sin analizar',
    progress: 0,
    summary: '',
    headline: '',
    done: [],
    next: [],
    risks: [],
    metrics: [],
    sources: []
  };
}

async function aiPreviewProject(folderInput) {
  const folder = resolveProjectFolder(folderInput);
  if (!folder) return { ok: false, error: 'Indica la carpeta del proyecto.' };
  let stat;
  try {
    stat = fs.statSync(folder);
  } catch {
    return { ok: false, error: 'Esa carpeta no existe en este equipo.' };
  }
  if (!stat.isDirectory()) return { ok: false, error: 'La ruta debe ser una carpeta.' };

  const docs = readDocBundle(folder);
  const draft = folderDraft(folder);
  try {
    const response = await aiRequest(remapMessages(draft, docs), { maxTokens: 3000 });
    const result = sanitizeAiResult(parseAiJson(response.text), docs);
    return {
      ok: true,
      folder,
      suggestedName: draft.name,
      result,
      docs: docs.map((doc) => ({ relative: doc.relative, size: doc.size, modified: doc.modified })),
      provider: response.provider,
      model: response.model
    };
  } catch (error) {
    return { ok: false, error: error.message, folder, suggestedName: draft.name };
  }
}

function addProject(payload = {}) {
  const folder = resolveProjectFolder(payload.folder);
  if (!folder) return { ok: false, error: 'Indica la carpeta del proyecto.' };

  let stat;
  try {
    stat = fs.statSync(folder);
  } catch {
    return { ok: false, error: 'Esa carpeta no existe en este equipo.' };
  }
  if (!stat.isDirectory()) return { ok: false, error: 'La ruta debe ser una carpeta.' };

  const raw = readJson(DATA_FILE, { meta: {}, projects: [], attention: [], decisions: [] });
  const projects = Array.isArray(raw.projects) ? raw.projects : [];
  if (projects.some((project) => sameFolder(resolveProjectFolder(project.folder), folder))) {
    return { ok: false, error: 'Esa carpeta ya está en el panel.' };
  }

  const name = text(payload.name, 80) || path.basename(folder);
  const docs = discoverDocs(folder);
  const usedAccents = new Set(projects.map((project) => project.accent));
  const accent =
    PROJECT_ACCENTS.find((color) => !usedAccents.has(color)) ||
    PROJECT_ACCENTS[projects.length % PROJECT_ACCENTS.length];

  let safe = null;
  if (payload.result && typeof payload.result === 'object') {
    safe = sanitizeAiResult(payload.result, docs);
  }

  const entry = {
    id: slugifyProjectId(name, projects),
    name,
    shortName: name,
    folder,
    status: safe?.status || 'por-iniciar',
    stage: safe?.stage || 'Nuevo · sin analizar',
    progress: safe?.progress ?? 0,
    accent,
    summary: safe?.summary || '',
    headline: safe?.headline || '',
    done: safe?.done || [],
    next: safe?.next || [],
    risks: safe?.risks || [],
    metrics: safe?.metrics || [],
    sources: safe?.sources?.length ? safe.sources : docs.slice(0, 12).map((doc) => doc.relative)
  };

  if (safe) {
    entry.ai = {
      updatedAt: new Date().toISOString(),
      provider: text(payload.provider, 40),
      model: text(payload.model, 80),
      documentation: safe.documentation
    };
  }

  const backup = backupDataFile();
  raw.projects = [...projects, entry];
  raw.attention = Array.isArray(raw.attention) ? raw.attention : [];
  raw.decisions = Array.isArray(raw.decisions) ? raw.decisions : [];
  writeJson(DATA_FILE, raw);
  docDiscoveryCache.clear();
  broadcastState();
  return { ok: true, projectId: entry.id, backup, snapshot: buildSnapshot() };
}

function aiApplyResult(projectId, result, meta = {}) {
  const raw = readJson(DATA_FILE, { meta: {}, projects: [], attention: [], decisions: [] });
  const index = (raw.projects || []).findIndex((item) => item.id === projectId);
  if (index < 0) return { ok: false, error: 'Proyecto no encontrado.' };

  const project = raw.projects[index];
  let docs = [];
  try {
    docs = discoverDocs(resolveProjectFolder(project.folder));
  } catch {
    docs = [];
  }
  const safe = sanitizeAiResult(result, docs);
  if (!safe.summary) return { ok: false, error: 'La respuesta no incluye un resumen utilizable.' };

  const backup = backupDataFile();
  const merged = {
    ...project,
    status: safe.status,
    stage: safe.stage,
    progress: safe.progress,
    summary: safe.summary,
    headline: safe.headline,
    done: safe.done.length ? safe.done : project.done,
    next: safe.next.length ? safe.next : project.next,
    risks: safe.risks.length ? safe.risks : project.risks,
    metrics: safe.metrics.length ? safe.metrics : project.metrics,
    sources: safe.sources.length ? safe.sources : project.sources,
    ai: {
      updatedAt: new Date().toISOString(),
      provider: text(meta.provider, 40),
      model: text(meta.model, 80),
      documentation: safe.documentation
    }
  };

  raw.projects[index] = merged;
  writeJson(DATA_FILE, raw);
  broadcastState();
  return { ok: true, projectId, backup, snapshot: buildSnapshot() };
}

function docsMessages(project, docs, documentation) {
  const bundle = docs.length
    ? docs.map((doc) => `### ${doc.relative}\n${doc.text.slice(0, 8000)}`).join('\n\n')
    : '(Sin documentación previa.)';
  const info = documentation && typeof documentation === 'object' ? documentation : {};

  return [
    {
      role: 'system',
      content:
        'Eres un documentalista técnico. Escribes documentación breve, útil y verificable para un repositorio de software. ' +
        'No inventes datos, métricas ni decisiones que no aparezcan en el material proporcionado; cuando falte información, ' +
        'deja una sección "Pendiente de confirmar" en lugar de suponer. Devuelve únicamente JSON válido, sin markdown alrededor.'
    },
    {
      role: 'user',
      content:
        `Proyecto: ${project.name}\nCarpeta: ${project.folder}\n\n` +
        `Documentación existente:\n${bundle}\n\n` +
        `Mapa de documentación propuesto:\n${JSON.stringify(info, null, 2)}\n\n` +
        'Genera únicamente los archivos que falten para que el proyecto tenga documentación clara. ' +
        'No propongas rutas que ya existan en la lista anterior. Usa como máximo 4 archivos .md. ' +
        'Estructura recomendada: README.md como entrada; docs/ESTADO.md con el estado actual; ' +
        'docs/DECISIONES.md para decisiones abiertas; docs/BITACORA.md para el historial. ' +
        'Cada archivo debe ser autónomo, en español, con encabezados y sin relleno. ' +
        'Devuelve: {"files":[{"path":"README.md","content":"# ..."}]}'
    }
  ];
}

function aiDocsPreview(projectId, documentation) {
  const { data } = buildSnapshot();
  const project = data.projects.find((item) => item.id === projectId);
  if (!project) return { ok: false, error: 'Proyecto no encontrado.' };
  if (!project.folderExists) return { ok: false, error: 'La carpeta del proyecto no existe.' };

  return aiRequest(docsMessages(project, readDocBundle(resolveProjectFolder(project.folder)), documentation), {
    maxTokens: 4000
  })
    .then((response) => {
      const parsed = parseAiJson(response.text);
      const files = list(parsed.files, 4, (file) => {
        const docPath = safeDocPath(file?.path);
        const content = String(file?.content || '').slice(0, 40000);
        if (!docPath || !content.trim()) return null;
        return { path: docPath, content };
      });
      if (!files.length) {
        return { ok: false, error: 'La IA no propuso documentos nuevos.' };
      }
      return { ok: true, files, provider: response.provider, model: response.model };
    })
    .catch((error) => ({ ok: false, error: error.message }));
}

function aiDocsWrite(projectId, files) {
  const raw = readJson(DATA_FILE, { meta: {}, projects: [], attention: [], decisions: [] });
  const project = (raw.projects || []).find((item) => item.id === projectId);
  if (!project) return { ok: false, error: 'Proyecto no encontrado.' };
  const folder = resolveProjectFolder(project.folder);
  if (!folder || !fs.existsSync(folder)) return { ok: false, error: 'La carpeta del proyecto no existe.' };

  const base = path.resolve(folder);
  const created = [];
  const skipped = [];
  for (const file of Array.isArray(files) ? files.slice(0, 4) : []) {
    const rel = safeDocPath(file?.path);
    if (!rel) {
      skipped.push({ path: String(file?.path || ''), reason: 'ruta no permitida' });
      continue;
    }
    const abs = path.resolve(base, rel);
    if (!abs.startsWith(base + path.sep)) {
      skipped.push({ path: rel, reason: 'ruta fuera del proyecto' });
      continue;
    }
    if (fs.existsSync(abs)) {
      skipped.push({ path: rel, reason: 'ya existe' });
      continue;
    }
    const content = String(file?.content || '').trim();
    if (!content) {
      skipped.push({ path: rel, reason: 'vacío' });
      continue;
    }
    try {
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, `${content}\n`, 'utf8');
      created.push(rel);
    } catch (error) {
      skipped.push({ path: rel, reason: error.message });
    }
  }

  if (created.length) {
    const current = raw.projects.find((item) => item.id === projectId);
    current.sources = [...new Set([...(current.sources || []), ...created])];
    const info = current.ai?.documentation;
    if (info) {
      info.state = info.state === 'no-existe' ? 'parcial' : info.state;
      info.canonical = Array.isArray(info.canonical) ? info.canonical : [];
      for (const rel of created) {
        if (!info.canonical.some((item) => item.path === rel)) {
          info.canonical.push({ path: rel, role: 'Documento creado desde Pulso', status: 'ok' });
        }
      }
      info.proposed = (info.proposed || []).filter((item) => !created.includes(item.path));
    }
    current.ai = {
      ...(current.ai || {}),
      createdFiles: [...new Set([...(current.ai?.createdFiles || []), ...created])],
      docsUpdatedAt: new Date().toISOString()
    };
    writeJson(DATA_FILE, raw);
    broadcastState();
  }

  return { ok: created.length > 0, created, skipped, snapshot: buildSnapshot() };
}

function stripQuotes(value) {
  return String(value || '').replace(/^"|"$/g, '');
}

function findInPath(names) {
  const dirs = String(process.env.PATH || '')
    .split(';')
    .map(stripQuotes)
    .filter(Boolean);
  for (const name of names) {
    for (const dir of dirs) {
      const candidate = path.join(dir, name);
      try {
        if (fs.existsSync(candidate)) return candidate;
      } catch {
        // Ignore malformed PATH entries.
      }
    }
  }
  return null;
}

function findHarnessLauncher() {
  const fromPath = findInPath(['dsh.cmd', 'dsh.exe']);
  if (fromPath) return fromPath;

  const bases = [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : null,
    process.env.PROGRAMFILES || null,
    process.env['PROGRAMFILES(X86)'] || null
  ].filter(Boolean);

  for (const base of bases) {
    let names = [];
    try {
      names = fs
        .readdirSync(base, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && /^deepseek harness/i.test(entry.name))
        .map((entry) => entry.name);
    } catch {
      continue;
    }
    for (const name of names) {
      const candidate = path.join(base, name, 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function resolveAgents() {
  const ai = readAiConfigSecret();
  return AGENT_DEFS.map((def) => {
    let command = null;
    let available = false;
    let hint = def.hint;

    if (def.kind === 'ai-terminal') {
      available = Boolean(ai.key);
      command = available ? AI_TERMINAL_SCRIPT : null;
      hint = available ? `${ai.providerLabel} · ${ai.model}` : 'Falta la clave en Ajustes';
    } else if (def.kind === 'harness') {
      command = findHarnessLauncher();
      available = Boolean(command);
      hint = available ? def.hint : 'Harness no instalado';
    } else {
      command =
        (def.candidates || []).find((candidate) => candidate && fs.existsSync(candidate)) ||
        (def.commandNames.length ? findInPath(def.commandNames) : null);
      available = Boolean(command);
    }

    return {
      id: def.id,
      label: def.label,
      hint,
      command,
      kind: def.kind || 'command',
      executable: command ? path.basename(command) : null,
      available
    };
  });
}

function agentsForClient() {
  return resolveAgents().map(({ command, ...agent }) => agent);
}

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

// Si Pulso se abrió desde una sesión de Claude Code hereda CLAUDE_CODE_* y
// CLAUDECODE; los agentes lanzados lo tomarían como sesión hija y no guardarían transcript.
function cleanAgentEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^CLAUDE_CODE_|^CLAUDECODE$|^CLAUDE_(PID|EFFORT)$/i.test(key)) delete env[key];
  }
  return env;
}

function launchAgent(projectId, agentId) {
  const state = buildSnapshot();
  const project = state.data.projects.find((p) => p.id === projectId);
  if (!project) return { ok: false, error: 'Proyecto no encontrado.' };
  if (!project.folderExists) return { ok: false, error: 'La carpeta del proyecto no existe.' };

  const agent = resolveAgents().find((a) => a.id === agentId);
  if (!agent) return { ok: false, error: 'Agente no reconocido.' };
  if (!agent.available) {
    if (agent.kind === 'ai-terminal') {
      return {
        ok: false,
        error: 'Añade tu clave de API en Ajustes → Inteligencia artificial para abrir el chat en terminal.'
      };
    }
    return {
      ok: false,
      error: `${agent.label} no está instalado o no se encontró en PATH.`
    };
  }

  const env = cleanAgentEnv();
  let invocation;
  if (agent.kind === 'ai-terminal') {
    const ai = readAiConfigSecret();
    if (!ai.key) {
      return { ok: false, error: 'Falta la clave de API. Añádela en Ajustes.' };
    }
    env.ELECTRON_RUN_AS_NODE = '1';
    env.PULSO_AI_PROVIDER = ai.provider;
    env.PULSO_AI_MODEL = ai.model;
    env.PULSO_AI_BASEURL = ai.baseUrl;
    env.PULSO_AI_KEY = ai.key;
    env.PULSO_AI_PROJECT = project.shortName;
    env.PULSO_AI_FOLDER = project.folderPath || resolveProjectFolder(project.folder);
    invocation = `& ${psQuote(process.execPath)} ${psQuote(AI_TERMINAL_SCRIPT)}`;
  } else if (agent.kind === 'harness') {
    // Harness no expone un TUI en todas las instalaciones: `web` abre su
    // interfaz interactiva y `headless` resuelve una tarea puntual.
    invocation = `& ${psQuote(agent.command)} web`;
  } else {
    invocation = `& ${psQuote(agent.command)}`;
  }

  const projectFolder = project.folderPath || resolveProjectFolder(project.folder);
  const title = `Pulso · ${project.shortName} · ${agent.label}`;
  const script = [
    `$Host.UI.RawUI.WindowTitle = ${psQuote(title)}`,
    `Write-Host ${psQuote(`Pulso -> ${agent.label} en ${project.shortName}`)} -ForegroundColor DarkCyan`,
    `Set-Location -LiteralPath ${psQuote(projectFolder)}`,
    invocation
  ].join('; ');

  try {
    // `detached` en Windows crea el proceso sin consola (DETACHED_PROCESS), así que
    // la ventana nunca aparece. `start` fuerza una consola nueva y visible.
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const child = spawn(
      process.env.ComSpec || 'cmd.exe',
      ['/c', 'start', '""', 'powershell.exe', '-NoExit', '-EncodedCommand', encoded],
      {
        cwd: projectFolder,
        env,
        stdio: 'ignore',
        windowsHide: true,
        windowsVerbatimArguments: true
      }
    );
    child.on('error', (err) => logEvent(`launchAgent error: ${err.message}`));
    child.unref();
    return {
      ok: true,
      agent: agent.label,
      project: project.shortName,
      executable: agent.executable,
      pid: child.pid
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function saveState(state) {
  writeJson(STATE_FILE(), state);
  broadcastState();
}

function broadcastState() {
  const payload = buildSnapshot();
  for (const win of [mainWindow, widgetWindow]) {
    if (win && !win.isDestroyed()) {
      win.webContents.send('state:changed', payload);
    }
  }
}

function formatDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function scanProject(project) {
  const folderPath = resolveProjectFolder(project.folder);
  const folderExists = Boolean(folderPath) && fs.existsSync(folderPath);
  let sources = (project.sources || []).map((rel) => {
    const abs = path.join(folderPath, rel);
    let exists = false;
    let modified = null;
    let size = 0;
    try {
      const stat = fs.statSync(abs);
      exists = stat.isFile();
      modified = stat.mtime.toISOString();
      size = stat.size;
    } catch {
      // Missing documents are shown as such, not treated as an error.
    }
    return { relative: rel, absolute: abs, exists, modified, size };
  });

  // Además de las fuentes declaradas, el refresco descubre documentos nuevos
  // en la carpeta. Así «Actualizar» sirve aunque nadie mantenga la lista.
  let discovered = 0;
  if (folderExists) {
    try {
      const known = new Set(
        sources.map((source) => source.relative.replaceAll('\\', '/').toLowerCase())
      );
      for (const doc of discoverDocsCached(folderPath, 24)) {
        const rel = doc.relative.replaceAll('\\', '/');
        if (known.has(rel.toLowerCase())) continue;
        known.add(rel.toLowerCase());
        sources.push({
          relative: rel,
          absolute: doc.absolute,
          exists: true,
          modified: doc.modified,
          size: doc.size,
          discovered: true
        });
        discovered += 1;
      }
    } catch {
      // Una carpeta ilegible se muestra como tal, sin romper el panel.
    }
  }

  let lastActivity = null;
  const dates = sources
    .map((s) => formatDate(s.modified))
    .filter(Boolean)
    .sort();
  if (dates.length) lastActivity = dates[dates.length - 1];

  if (!lastActivity && folderExists) {
    try {
      lastActivity = fs.statSync(folderPath).mtime.toISOString();
    } catch {
      lastActivity = null;
    }
  }

  return {
    ...project,
    folder: project.folder,
    folderPath,
    folderExists,
    lastActivity,
    discovered,
    sources: sources.sort((a, b) => String(b.modified).localeCompare(String(a.modified))),
    sourceCount: sources.filter((s) => s.exists).length
  };
}

function buildSnapshot() {
  const raw = readJson(DATA_FILE, { meta: {}, projects: [], attention: [], decisions: [] });
  const data = {
    meta: raw.meta || {},
    projects: (raw.projects || []).map(scanProject),
    attention: raw.attention || [],
    decisions: raw.decisions || []
  };
  return {
    data,
    state: getState(),
    agents: agentsForClient(),
    ai: publicAiConfig(),
    demo: DEMO_MODE,
    paths: DEMO_MODE
      ? {
          root: 'C:\\Users\\usuario\\Proyectos\\Pulso',
          state: 'C:\\Users\\usuario\\AppData\\Roaming\\pulso-dashboard\\pulso-state.json',
          data: 'C:\\Users\\usuario\\Proyectos\\Pulso\\data\\projects.json'
        }
      : {
          root: ROOT,
          state: STATE_FILE(),
          data: DATA_FILE
        },
    now: new Date().toISOString()
  };
}

function refreshStats(snapshot) {
  const projects = snapshot.data.projects;
  return {
    projects: projects.length,
    documents: projects.reduce((total, project) => total + project.sourceCount, 0),
    missingFolders: projects.filter((project) => !project.folderExists).map((project) => project.shortName),
    missingDocs: projects.filter((project) => project.folderExists && project.sourceCount === 0).map((project) => project.shortName),
    at: new Date().toISOString()
  };
}

function logEvent(message) {
  try {
    fs.appendFileSync(
      path.join(app.getPath('userData'), 'pulso.log'),
      `${new Date().toISOString()} ${message}\n`
    );
  } catch {
    // Logging must never break the app.
  }
}

function widgetHandle(win) {
  const buffer = win.getNativeWindowHandle();
  if (buffer.length >= 8) return buffer.readBigUInt64LE(0).toString();
  return buffer.readUInt32LE(0).toString();
}

function runDesktopPin(action) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32' || !widgetWindow || widgetWindow.isDestroyed()) {
      resolve({ ok: false, error: 'Solo disponible en Windows.' });
      return;
    }

    const hwnd = widgetHandle(widgetWindow);
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(ROOT, 'scripts', 'desktop-pin.ps1'),
        '-Hwnd',
        hwnd,
        '-Action',
        action
      ],
      { windowsHide: true, timeout: 15000 },
      (error, stdout, stderr) => {
        if (error) {
          resolve({ ok: false, error: error.message || stderr || 'Error al fijar el widget.' });
          return;
        }
        try {
          const result = JSON.parse(String(stdout).trim().split(/\r?\n/).filter(Boolean).pop());
          resolve(result);
        } catch {
          resolve({ ok: false, error: String(stdout || stderr || 'Respuesta vacía.').trim() });
        }
      }
    );
  });
}

function saveWidgetBounds() {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  const state = getState();
  if (state.settings.widgetDesktop) return;
  state.settings.widgetBounds = widgetWindow.getBounds();
  writeJson(STATE_FILE(), state);
}

async function applyWidgetModeNow() {
  if (!widgetWindow || widgetWindow.isDestroyed()) return;
  const state = getState();
  const { settings } = state;

  if (settings.widgetDesktop && process.platform === 'win32') {
    widgetWindow.setAlwaysOnTop(false);
    const result = await runDesktopPin('pin');
    desktopPinState = Boolean(result.ok);
    logEvent(`pin: ${JSON.stringify(result)} bounds=${JSON.stringify(widgetWindow.getBounds())}`);
    if (!result.ok) {
      console.warn('[widget] No se pudo anclar al escritorio:', result.error);
      widgetWindow.setAlwaysOnTop(true, 'floating');
    }
    return;
  }

  if (desktopPinState) {
    await runDesktopPin('unpin');
  }
  desktopPinState = false;
  widgetWindow.setAlwaysOnTop(true, 'floating');
  const saved = settings.widgetBounds;
  if (onAnyDisplay(saved)) {
    widgetWindow.setBounds(saved);
  }
}

function applyWidgetMode() {
  widgetModeQueue = widgetModeQueue
    .then(() => applyWidgetModeNow())
    .catch((error) => console.warn('[widget] Error cambiando el modo:', error));
  return widgetModeQueue;
}

function defaultWidgetPosition() {
  const display = screen.getPrimaryDisplay();
  const { x, y, width } = display.workArea;
  return { x: x + width - 384, y: y + 72 };
}

function onAnyDisplay(bounds) {
  if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return false;
  return screen.getAllDisplays().some(({ workArea: area }) => {
    const overlapX = Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const overlapY = Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
    return overlapX > 80 && overlapY > 80;
  });
}

function createWidget() {
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    widgetWindow.showInactive();
    applyWidgetMode();
    return widgetWindow;
  }

  const state = getState();
  const saved = state.settings.widgetBounds;
  const pos = onAnyDisplay(saved) ? saved : defaultWidgetPosition();

  widgetWindow = new BrowserWindow({
    width: 352,
    height: 548,
    x: pos.x,
    y: pos.y,
    minWidth: 320,
    minHeight: 460,
    maxWidth: 420,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    alwaysOnTop: !state.settings.widgetDesktop,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  widgetWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  widgetWindow.loadFile(path.join(ROOT, 'src', 'widget.html'));

  widgetWindow.once('ready-to-show', async () => {
    widgetWindow.showInactive();
    logEvent(`widget ready bounds=${JSON.stringify(widgetWindow.getBounds())}`);
    await applyWidgetMode();
    if (refreshTrayMenu) refreshTrayMenu();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('widget:visibility', true);
    }
  });

  widgetWindow.on('moved', () => {
    clearTimeout(widgetSaveTimer);
    widgetSaveTimer = setTimeout(saveWidgetBounds, 350);
  });

  widgetWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      saveWidgetBounds();
      widgetWindow.hide();
      if (refreshTrayMenu) refreshTrayMenu();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('widget:visibility', false);
      }
    }
  });

  widgetWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  widgetWindow.webContents.on('will-navigate', (event) => event.preventDefault());

  return widgetWindow;
}

function createMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    backgroundColor: '#0a0c10',
    title: 'Pulso — Panel de proyectos',
    icon: APP_ICON,
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: !SCREENSHOT_MODE
    }
  });

  mainWindow.loadFile(path.join(ROOT, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (!quitting && widgetWindow && !widgetWindow.isDestroyed() && widgetWindow.isVisible()) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());

  return mainWindow;
}

function createTray() {
  const iconPath = path.join(ROOT, 'assets', 'icon.png');
  if (!fs.existsSync(iconPath)) return;

  const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('Pulso — panel de proyectos y pendientes');

  const rebuildMenu = () => {
    const visible = widgetWindow && !widgetWindow.isDestroyed() && widgetWindow.isVisible();
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: 'Abrir panel',
          click: () => createMainWindow()
        },
        {
          label: visible ? 'Ocultar widget' : 'Mostrar widget',
          click: () => {
            if (visible) {
              widgetWindow.hide();
              if (refreshTrayMenu) refreshTrayMenu();
            } else {
              createWidget();
              if (refreshTrayMenu) refreshTrayMenu();
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Abrir carpeta de la app',
          click: () => shell.openPath(ROOT)
        },
        {
          label: 'Salir',
          click: () => {
            quitting = true;
            app.quit();
          }
        }
      ])
    );
  };

  refreshTrayMenu = rebuildMenu;
  rebuildMenu();
  tray.on('double-click', () => createMainWindow());
}

function registerIpc() {
  ipcMain.handle('state:get', () => buildSnapshot());

  ipcMain.handle('data:reload', () => {
    docDiscoveryCache.clear();
    const snapshot = buildSnapshot();
    const payload = { ...snapshot, refresh: refreshStats(snapshot) };
    for (const win of [mainWindow, widgetWindow]) {
      if (win && !win.isDestroyed()) win.webContents.send('state:changed', payload);
    }
    return payload;
  });

  ipcMain.handle('task:add', (_event, payload = {}) => {
    const state = getState();
    const title = String(payload.title || '').trim();
    if (!title) return buildSnapshot();
    state.tasks.unshift({
      id: crypto.randomUUID(),
      title: title.slice(0, 180),
      projectId: payload.projectId || null,
      priority: ['alta', 'media', 'baja'].includes(payload.priority) ? payload.priority : 'media',
      done: false,
      createdAt: new Date().toISOString()
    });
    saveState(state);
    return buildSnapshot();
  });

  ipcMain.handle('task:toggle', (_event, id) => {
    const state = getState();
    const task = state.tasks.find((t) => t.id === id);
    if (task) task.done = !task.done;
    saveState(state);
    return buildSnapshot();
  });

  ipcMain.handle('task:delete', (_event, id) => {
    const state = getState();
    state.tasks = state.tasks.filter((t) => t.id !== id);
    saveState(state);
    return buildSnapshot();
  });

  ipcMain.handle('task:clearDone', () => {
    const state = getState();
    state.tasks = state.tasks.filter((t) => !t.done);
    saveState(state);
    return buildSnapshot();
  });

  ipcMain.handle('settings:set', (_event, patch = {}) => {
    const state = getState();
    state.settings = { ...state.settings, ...patch };
    writeJson(STATE_FILE(), state);

    if ('widgetDesktop' in patch || 'widgetPinned' in patch) applyWidgetMode();
    if ('launchAtLogin' in patch) {
      try {
        app.setLoginItemSettings({
          openAtLogin: Boolean(patch.launchAtLogin),
          path: process.execPath,
          args: [ROOT]
        });
      } catch {
        // Login items are best-effort; the setting remains saved.
      }
    }
    broadcastState();
    return buildSnapshot();
  });

  ipcMain.handle('widget:show', () => {
    createWidget();
    if (refreshTrayMenu) refreshTrayMenu();
    if (mainWindow) mainWindow.webContents.send('widget:visibility', true);
    return true;
  });

  ipcMain.handle('widget:hide', () => {
    if (widgetWindow && !widgetWindow.isDestroyed()) widgetWindow.hide();
    if (refreshTrayMenu) refreshTrayMenu();
    if (mainWindow) mainWindow.webContents.send('widget:visibility', false);
    return false;
  });

  ipcMain.handle('widget:visibility', () => {
    return Boolean(widgetWindow && !widgetWindow.isDestroyed() && widgetWindow.isVisible());
  });

  ipcMain.handle('main:show', () => {
    createMainWindow();
    mainWindow.show();
    mainWindow.focus();
    return true;
  });

  ipcMain.handle('agent:launch', (_event, { projectId, agentId }) => {
    return launchAgent(projectId, agentId);
  });

  ipcMain.handle('project:pickFolder', async () => {
    const options = {
      title: 'Elegir la carpeta del proyecto',
      buttonLabel: 'Usar esta carpeta',
      properties: ['openDirectory']
    };
    const result = mainWindow && !mainWindow.isDestroyed()
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    return { ok: true, path: result.filePaths[0] };
  });

  ipcMain.handle('ai:project:preview', (_event, folder) => aiPreviewProject(folder));

  ipcMain.handle('project:add', (_event, payload = {}) => addProject(payload));

  ipcMain.handle('ai:config:get', () => publicAiConfig());

  ipcMain.handle('ai:config:set', (_event, patch = {}) => {
    saveAiConfig(patch);
    broadcastState();
    return buildSnapshot();
  });

  ipcMain.handle('ai:test', () => testAiConnection());

  ipcMain.handle('ai:remap', (_event, projectId) => aiRemapProject(projectId));

  ipcMain.handle('ai:apply', (_event, { projectId, result, provider, model }) => {
    return aiApplyResult(projectId, result, { provider, model });
  });

  ipcMain.handle('ai:docs:preview', (_event, { projectId, documentation }) => {
    return aiDocsPreview(projectId, documentation);
  });

  ipcMain.handle('ai:docs:write', (_event, { projectId, files }) => {
    return aiDocsWrite(projectId, files);
  });

  ipcMain.handle('ai:openKeyPage', async (_event, providerId) => {
    const provider = AI_PROVIDERS[providerId] || AI_PROVIDERS[readAiConfigRaw().provider];
    if (!provider || !/^https:\/\//.test(provider.keysUrl)) {
      return { ok: false, error: 'Enlace no disponible.' };
    }
    await shell.openExternal(provider.keysUrl);
    return { ok: true };
  });

  ipcMain.handle('project:openFolder', async (_event, projectId) => {
    const { data } = buildSnapshot();
    const project = data.projects.find((p) => p.id === projectId);
    const folder = project?.folderPath || resolveProjectFolder(project?.folder);
    if (!folder || !fs.existsSync(folder)) return { ok: false, error: 'La carpeta no existe.' };
    const error = await shell.openPath(folder);
    return { ok: !error, error };
  });

  ipcMain.handle('project:openDoc', async (_event, { projectId, relative }) => {
    const { data } = buildSnapshot();
    const project = data.projects.find((p) => p.id === projectId);
    if (!project) return { ok: false, error: 'Proyecto no encontrado.' };
    const folder = project.folderPath || resolveProjectFolder(project.folder);
    const abs = path.resolve(folder, relative || '');
    const base = path.resolve(folder);
    if (!abs.startsWith(base + path.sep)) return { ok: false, error: 'Ruta fuera del proyecto.' };
    if (!fs.existsSync(abs)) return { ok: false, error: 'El documento no existe.' };
    const error = await shell.openPath(abs);
    return { ok: !error, error };
  });

  ipcMain.handle('app:openRoot', async () => {
    const error = await shell.openPath(ROOT);
    return { ok: !error, error };
  });

  ipcMain.handle('app:openStateFolder', async () => {
    const error = await shell.openPath(path.dirname(STATE_FILE()));
    return { ok: !error, error };
  });

  ipcMain.handle('app:quit', () => {
    quitting = true;
    app.quit();
    return true;
  });
}

async function runScreenshotMode() {
  const outDir = process.env.PULSO_SHOTS_DIR || path.join(ROOT, 'docs', 'screenshots');
  fs.mkdirSync(outDir, { recursive: true });
  if (mainWindow) {
    mainWindow.webContents.on('console-message', (event) => {
      console.log(`[renderer:${event.level}] ${event.message}`);
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 4500));

  const shots = [
    ['dashboard', null],
    ['radar', "document.querySelector('.project-grid').scrollIntoView({ block: 'start' })"],
    ['proyectos', "switchView('proyectos')"],
    ['atencion', "switchView('atencion')"],
    ['pendientes', "switchView('pendientes')"],
    ['fuentes', "switchView('fuentes')"],
    ['ajustes', "switchView('ajustes')"],
    ['detalle', "switchView('resumen'); openProject('atlas')"],
    ['detalle-docs', "document.getElementById('drawer-content').scrollTop = 620"],
    ['ia', "closeDrawer(); openAiModal('atlas')"],
    ['proyecto-nuevo', "closeAiModal(); closeDrawer(); switchView('proyectos'); openProjectModal()"],
    ['_scroll-agents', "closeProjectModal(); switchView('resumen'); document.querySelector('[data-agent-menu=\"atlas\"]').scrollIntoView({ block: 'center' })"],
    ['agente-menu', "openAgentMenu('atlas', document.querySelector('[data-agent-menu=\"atlas\"]'))"]
  ];

  if (mainWindow && !mainWindow.isDestroyed()) {
    await mainWindow.webContents.insertCSS(
      '*, *::before, *::after { transition-duration: 0.001s !important; animation-duration: 0.001s !important; animation-delay: 0s !important; }'
    );
    for (const [name, script] of shots) {
      if (script) {
        try {
          await mainWindow.webContents.executeJavaScript(script);
          await new Promise((resolve) => setTimeout(resolve, 500));
          await mainWindow.webContents.executeJavaScript(
            'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
          );
        } catch (error) {
          console.log(`[shots] ${name}: ${error.message}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
      if (name.startsWith('_')) continue;
      mainWindow.webContents.invalidate();
      await new Promise((resolve) => setTimeout(resolve, 150));
      const image = await mainWindow.webContents.capturePage();
      fs.writeFileSync(path.join(outDir, `${name}.png`), image.toPNG());
    }
  }
  if (widgetWindow && !widgetWindow.isDestroyed()) {
    const image = await widgetWindow.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, 'widget.png'), image.toPNG());
  }

  if (process.env.PULSO_GIF_ASSETS === '1' && mainWindow && !mainWindow.isDestroyed()) {
    const saveCropped = async (name, selector) => {
      const rect = await mainWindow.webContents.executeJavaScript(
        `(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; })()`
      );
      const image = await mainWindow.webContents.capturePage(rect);
      fs.writeFileSync(path.join(outDir, name), image.toPNG());
    };

    await mainWindow.webContents.executeJavaScript(
      "closeAiModal(); closeDrawer(); switchView('proyectos'); openProjectModal()"
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    await saveCropped('modal-proyecto.png', '#project-modal');

    await mainWindow.webContents.executeJavaScript('closeProjectModal(); openAiModal("atlas")');
    await new Promise((resolve) => setTimeout(resolve, 500));
    await saveCropped('modal-ia.png', '#ai-modal');
    await mainWindow.webContents.executeJavaScript('closeAiModal()');
  }

  if (process.env.PULSO_AGENT_SMOKE === '1' && mainWindow && !mainWindow.isDestroyed()) {
    const launched = await mainWindow.webContents.executeJavaScript(
      "window.pulso.launchAgent('atlas', 'opencode')"
    );
    console.log(`[smoke] agente: ${JSON.stringify(launched)}`);
    if (launched.ok && launched.pid) {
      await new Promise((resolve) => {
        execFile('taskkill', ['/PID', String(launched.pid), '/T', '/F'], () => resolve());
      });
      console.log('[smoke] agente cerrado.');
    }
  }

  if (process.env.PULSO_SMOKE === '1' && mainWindow && !mainWindow.isDestroyed()) {
    const added = await mainWindow.webContents.executeJavaScript(
      "window.pulso.addTask({ title: 'Prueba interna de Pulso', projectId: 'atlas', priority: 'alta' })"
    );
    console.log(`[smoke] tarea añadida: ${added.state.tasks.length}`);
    await mainWindow.webContents.executeJavaScript("closeDrawer(); switchView('pendientes')");
    await new Promise((resolve) => setTimeout(resolve, 500));
    const taskShot = await mainWindow.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, 'pendientes-tarea.png'), taskShot.toPNG());
    if (widgetWindow && !widgetWindow.isDestroyed()) {
      const widgetTaskShot = await widgetWindow.webContents.capturePage();
      fs.writeFileSync(path.join(outDir, 'widget-tarea.png'), widgetTaskShot.toPNG());
    }
    const taskId = added.state.tasks[0].id;
    const toggled = await mainWindow.webContents.executeJavaScript(
      `window.pulso.toggleTask(${JSON.stringify(taskId)})`
    );
    console.log(`[smoke] tarea marcada: ${toggled.state.tasks[0].done}`);
    const cleaned = await mainWindow.webContents.executeJavaScript(
      `window.pulso.deleteTask(${JSON.stringify(taskId)})`
    );
    console.log(`[smoke] tareas tras limpiar: ${cleaned.state.tasks.length}`);
  }

  if (process.env.PULSO_PROJECT_SMOKE === '1' && DEMO_MODE && mainWindow && !mainWindow.isDestroyed()) {
    const original = fs.readFileSync(DATA_FILE, 'utf8');
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pulso-project-'));
    fs.writeFileSync(path.join(temp, 'README.md'), '# Proyecto temporal\n\nDocumento de prueba.\n', 'utf8');
    const added = await mainWindow.webContents.executeJavaScript(
      `window.pulso.addProject({ folder: ${JSON.stringify(temp)}, name: 'Proyecto temporal' })`
    );
    const project = added.snapshot?.data?.projects?.find((item) => item.id === added.projectId);
    console.log(`[smoke] proyecto: ${JSON.stringify({ ok: added.ok, id: added.projectId, total: added.snapshot?.data?.projects?.length, docs: project?.sourceCount, folderExists: project?.folderExists })}`);
    const duplicate = await mainWindow.webContents.executeJavaScript(
      `window.pulso.addProject({ folder: ${JSON.stringify(temp)}, name: 'Duplicado' })`
    );
    console.log(`[smoke] duplicado: ${JSON.stringify({ ok: duplicate.ok, error: duplicate.error })}`);
    const reloaded = await mainWindow.webContents.executeJavaScript('window.pulso.reload()');
    console.log(`[smoke] refresco: ${JSON.stringify(reloaded.refresh)}`);
    fs.writeFileSync(DATA_FILE, original, 'utf8');
    fs.rmSync(temp, { recursive: true, force: true });
    broadcastState();
  }

  quitting = true;
  app.quit();
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createMainWindow();
    }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.pulso.dashboard');
    Menu.setApplicationMenu(null);
    ensureDataFile();
    registerIpc();

    if (DEMO_MODE && process.env.PULSO_FAKE_AI === '1') {
      // Solo para capturas: una clave de relleno que nunca sale del perfil temporal.
      writeJson(AI_CONFIG_FILE(), {
        provider: 'deepseek',
        model: 'deepseek-chat',
        baseUrl: 'https://api.deepseek.com',
        key: encryptSecret('demo')
      });
    }

    if (!WIDGET_ONLY) createMainWindow();

    const state = getState();
    if (WIDGET_ONLY || state.settings.showWidgetOnStart) createWidget();

    createTray();

    if (SCREENSHOT_MODE) {
      runScreenshotMode();
    }
  });

  app.on('activate', () => {
    if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
    else mainWindow.show();
  });

  app.on('before-quit', () => {
    quitting = true;
    saveWidgetBounds();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
