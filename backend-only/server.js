const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const app = express();
const server = http.createServer(app);

// ─── CORS pour Netlify ────────────────────────────────────────────────────────
const FRONTEND_URL = process.env.FRONTEND_URL || '*'; // ex: https://ton-site.netlify.app

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', FRONTEND_URL);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());

// ─── Clé API simple (optionnelle mais recommandée) ────────────────────────────
const API_KEY = process.env.API_KEY || null;

function auth(req, res, next) {
  if (!API_KEY) return next();
  const key = req.headers['x-api-key'] || req.query.key;
  if (key !== API_KEY) return res.status(401).json({ error: 'Non autorisé' });
  next();
}

// ─── Config bots ─────────────────────────────────────────────────────────────
// ⚠️ Modifie ce tableau avec tes vrais bots
const BOT_CONFIG = [
  { id: 'bot1', name: 'MusicBot',      file: './bots/music.js',      color: '#5865F2' },
  { id: 'bot2', name: 'ModerationBot', file: './bots/moderation.js', color: '#57F287' },
  { id: 'bot3', name: 'WelcomeBot',    file: './bots/welcome.js',    color: '#FEE75C' },
  { id: 'bot4', name: 'StatsBot',      file: './bots/stats.js',      color: '#EB459E' },
];

// ─── État en mémoire ──────────────────────────────────────────────────────────
const bots = {};
const logs = {};
const MAX_LOGS = 300;

BOT_CONFIG.forEach(cfg => {
  bots[cfg.id] = { ...cfg, process: null, status: 'stopped', pid: null, startedAt: null, restarts: 0 };
  logs[cfg.id] = [];
});

// ─── SSE clients ──────────────────────────────────────────────────────────────
const sseClients = new Set();

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => { try { res.write(msg); } catch (_) {} });
}

function addLog(botId, level, text) {
  const entry = { ts: new Date().toISOString(), level, text };
  logs[botId].push(entry);
  if (logs[botId].length > MAX_LOGS) logs[botId].shift();
  broadcast('log', { botId, ...entry });
}

// ─── Gestion processus ────────────────────────────────────────────────────────
function ensureBotFile(bot) {
  if (!fs.existsSync(bot.file)) {
    fs.mkdirSync(path.dirname(bot.file), { recursive: true });
    fs.writeFileSync(bot.file, demoBot(bot.name));
  }
}

function startBot(id) {
  const bot = bots[id];
  if (bot.process) return { ok: false, msg: 'Déjà en cours' };

  ensureBotFile(bot);

  const proc = spawn('node', [bot.file], {
    env: { ...process.env, BOT_ID: id, BOT_NAME: bot.name },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  bot.process = proc;
  bot.pid = proc.pid;
  bot.status = 'starting';
  bot.startedAt = new Date().toISOString();

  setTimeout(() => {
    if (bot.process && bot.status === 'starting') {
      bot.status = 'online';
      broadcast('status', { botId: id, status: 'online', pid: bot.pid, startedAt: bot.startedAt });
    }
  }, 1500);

  proc.stdout.on('data', d =>
    d.toString().trim().split('\n').forEach(l => l && addLog(id, 'info', l))
  );
  proc.stderr.on('data', d =>
    d.toString().trim().split('\n').forEach(l => {
      if (!l) return;
      addLog(id, 'error', l);
      bot.status = 'error';
      broadcast('status', { botId: id, status: 'error' });
    })
  );
  proc.on('close', code => {
    addLog(id, code === 0 ? 'info' : 'error', `Processus terminé (code ${code})`);
    bot.process = null; bot.pid = null; bot.status = 'stopped';
    broadcast('status', { botId: id, status: 'stopped', pid: null });
  });
  proc.on('error', err => {
    addLog(id, 'error', `Erreur spawn: ${err.message}`);
    bot.status = 'error';
    broadcast('status', { botId: id, status: 'error' });
  });

  addLog(id, 'system', `▶ Démarrage de ${bot.name} (PID: ${proc.pid})`);
  broadcast('status', { botId: id, status: 'starting', pid: proc.pid, startedAt: bot.startedAt });
  return { ok: true };
}

function stopBot(id) {
  const bot = bots[id];
  if (!bot.process) return { ok: false, msg: 'Bot déjà arrêté' };
  addLog(id, 'system', `■ Arrêt de ${bot.name}...`);
  bot.process.kill('SIGTERM');
  setTimeout(() => { try { if (bot.process) bot.process.kill('SIGKILL'); } catch(_) {} }, 5000);
  return { ok: true };
}

function restartBot(id) {
  bots[id].restarts++;
  addLog(id, 'system', `↺ Redémarrage de ${bots[id].name}...`);
  if (bots[id].process) {
    bots[id].process.kill('SIGTERM');
    setTimeout(() => startBot(id), 1500);
  } else {
    startBot(id);
  }
  return { ok: true };
}

// ─── Bot démo ─────────────────────────────────────────────────────────────────
function demoBot(name) {
  return `// Bot démo: ${name} — remplace par ton vrai fichier bot
const msgs = ['Connecté à Discord','En écoute des commandes...','Heartbeat envoyé','Cache mis à jour','Traitement d\\'un événement'];
let i = 0;
console.log('[${name}] Démarrage...');
setInterval(() => { console.log('[${name}] ' + msgs[i++ % msgs.length]); }, 2500);
`;
}

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/api/health', (_, res) => res.json({ ok: true, uptime: process.uptime() }));

app.get('/api/bots', auth, (_, res) =>
  res.json(Object.values(bots).map(b => ({
    id: b.id, name: b.name, file: b.file, color: b.color,
    status: b.status, pid: b.pid, startedAt: b.startedAt, restarts: b.restarts
  })))
);

app.get('/api/logs/:id', auth, (req, res) => {
  const l = logs[req.params.id];
  if (!l) return res.status(404).json({ error: 'Bot introuvable' });
  res.json(l);
});

app.post('/api/bots/:id/start',   auth, (req, res) => res.json(startBot(req.params.id)));
app.post('/api/bots/:id/stop',    auth, (req, res) => res.json(stopBot(req.params.id)));
app.post('/api/bots/:id/restart', auth, (req, res) => res.json(restartBot(req.params.id)));

app.post('/api/bots/all/start', auth, (_, res) => {
  BOT_CONFIG.forEach(b => startBot(b.id));
  res.json({ ok: true });
});
app.post('/api/bots/all/stop', auth, (_, res) => {
  BOT_CONFIG.forEach(b => stopBot(b.id));
  res.json({ ok: true });
});

// ─── SSE ──────────────────────────────────────────────────────────────────────
app.get('/api/events', auth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // important pour Render/Railway
  res.flushHeaders();
  sseClients.add(res);
  const ping = setInterval(() => { try { res.write(':ping\n\n'); } catch(_) {} }, 20000);
  req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
});

// ─── Démarrage ────────────────────────────────────────────────────────────────
process.on('SIGINT', () => {
  Object.values(bots).forEach(b => { try { b.process?.kill('SIGTERM'); } catch(_) {} });
  process.exit(0);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🤖 Bot Manager → http://0.0.0.0:${PORT}`);
  console.log(`   FRONTEND_URL : ${FRONTEND_URL}`);
  console.log(`   API_KEY      : ${API_KEY ? '✅ activée' : '⚠️  désactivée'}\n`);
});
