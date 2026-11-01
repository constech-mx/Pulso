#!/usr/bin/env node
/**
 * Chat de terminal para Pulso.
 *
 * Se ejecuta con ELECTRON_RUN_AS_NODE=1 y recibe la configuración por
 * variables de entorno. La clave nunca se imprime ni se escribe en disco.
 */

const readline = require('readline');
const path = require('path');

const PROVIDER = (process.env.PULSO_AI_PROVIDER || 'deepseek').toLowerCase();
const MODEL = process.env.PULSO_AI_MODEL || 'deepseek-chat';
const BASE_URL = (process.env.PULSO_AI_BASEURL || 'https://api.deepseek.com').replace(/\/+$/, '');
const API_KEY = process.env.PULSO_AI_KEY || '';
const PROJECT = process.env.PULSO_AI_PROJECT || path.basename(process.cwd());
const FOLDER = process.env.PULSO_AI_FOLDER || process.cwd();

const LABELS = { deepseek: 'DeepSeek', openai: 'OpenAI', anthropic: 'Claude' };
const LABEL = LABELS[PROVIDER] || PROVIDER;

const color = (code) => (text) => `\x1b[${code}m${text}\x1b[0m`;
const dim = color('2');
const bold = color('1');
const lime = color('38;5;154');
const cyan = color('36');
const red = color('31');
const yellow = color('33');

const history = [
  {
    role: 'system',
    content:
      `Eres un asistente técnico que trabaja dentro de la carpeta "${FOLDER}" del proyecto "${PROJECT}". ` +
      'Responde en español, con respuestas breves y concretas. Cuando propongas cambios, indica el archivo y el motivo. ' +
      'No inventes rutas ni resultados de comandos que no hayas visto.'
  }
];

if (!API_KEY) {
  console.error(red('No hay una clave de API configurada. Añádela en Pulso → Ajustes → Inteligencia artificial.'));
  process.exit(1);
}

function banner() {
  const line = '─'.repeat(64);
  console.log('');
  console.log(lime(line));
  console.log(`${lime(bold('PULSO'))} ${dim('·')} ${bold(PROJECT)}`);
  console.log(`${dim('Proveedor')} ${LABEL} ${dim('·')} ${dim('Modelo')} ${MODEL}`);
  console.log(`${dim('Carpeta')} ${FOLDER}`);
  console.log(lime(line));
  console.log(dim('Escribe tu pregunta. Comandos: /ayuda, /limpiar, /modelo, /salir'));
  console.log('');
}

function usage() {
  console.log('');
  console.log(`${bold('Comandos')}`);
  console.log(`  ${cyan('/ayuda')}            muestra esta ayuda`);
  console.log(`  ${cyan('/limpiar')}          olvida la conversación anterior`);
  console.log(`  ${cyan('/modelo <nombre>')}  cambia el modelo de esta sesión`);
  console.log(`  ${cyan('/contexto')}         muestra proveedor, modelo y carpeta`);
  console.log(`  ${cyan('/salir')}            cierra el chat`);
  console.log('');
}

function errorMessage(data, status) {
  const message =
    data?.error?.message ||
    data?.message ||
    (typeof data?.error === 'string' ? data.error : '') ||
    '';
  return message ? `${status}: ${message}` : `HTTP ${status}`;
}

async function send(messages) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120000);
  try {
    if (PROVIDER === 'anthropic') {
      const system = messages
        .filter((item) => item.role === 'system')
        .map((item) => item.content)
        .join('\n\n');
      const rest = messages.filter((item) => item.role !== 'system');
      const response = await fetch(`${BASE_URL}/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({ model: MODEL, max_tokens: 1600, system, messages: rest }),
        signal: controller.signal
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorMessage(data, response.status));
      return (data.content || [])
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
        .trim();
    }

    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.4,
        max_tokens: 1600
      }),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(errorMessage(data, response.status));
    return String(data.choices?.[0]?.message?.content || '').trim();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('La respuesta tardó más de 2 minutos.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function trimHistory() {
  const system = history[0];
  const rest = history.slice(1);
  if (rest.length <= 24) return;
  history.length = 0;
  history.push(system, ...rest.slice(-24));
}

async function handle(line) {
  const input = line.trim();
  if (!input) return;

  if (input === '/salir' || input === '/exit' || input === '/quit') {
    console.log(dim('Hasta luego.'));
    process.exit(0);
  }
  if (input === '/ayuda' || input === '/help') {
    usage();
    return;
  }
  if (input === '/limpiar' || input === '/clear') {
    history.length = 1;
    console.log(dim('Conversación reiniciada.'));
    return;
  }
  if (input === '/contexto') {
    console.log(dim(`${LABEL} · ${MODEL} · ${FOLDER}`));
    return;
  }
  if (input.startsWith('/modelo')) {
    const next = input.split(/\s+/).slice(1).join(' ').trim();
    if (!next) {
      console.log(dim(`Modelo actual: ${MODEL}`));
      return;
    }
    process.env.PULSO_AI_MODEL = next;
    console.log(dim(`Modelo cambiado a ${next} para esta sesión.`));
    return;
  }

  history.push({ role: 'user', content: input });
  trimHistory();

  process.stdout.write(dim('  pensando…'));
  try {
    const answer = await send(history);
    process.stdout.write('\r\x1b[2K');
    if (!answer) {
      console.log(yellow('La respuesta llegó vacía. Intenta de nuevo.'));
      return;
    }
    history.push({ role: 'assistant', content: answer });
    console.log(`${lime('●')} ${answer.replace(/\n/g, '\n  ')}`);
    console.log('');
  } catch (error) {
    process.stdout.write('\r\x1b[2K');
    console.log(red(`Error: ${error.message}`));
    console.log('');
    history.pop();
  }
}

function main() {
  banner();
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: Boolean(process.stdin.isTTY)
  });

  const prompt = () => {
    rl.question(`${lime('›')} `, async (line) => {
      await handle(line);
      prompt();
    });
  };

  rl.on('SIGINT', () => {
    console.log('');
    process.exit(0);
  });

  prompt();
}

main();
