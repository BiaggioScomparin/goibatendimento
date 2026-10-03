const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { execSync } = require('child_process');
const { Pool } = require('pg');
const { google } = require('googleapis');
const { createCalendarEvent, addAttendeeToCalendarEvent, getCalendarClient } = require('./calendar.js');
const {
  getRemarketingData,
  toggleRemarketing,
  updateRemarketingConfig,
  syncRemarketingQueue
} = require('./remarketing.js');

const pool = new Pool({
  connectionString: 'postgres://now7:5kR8qpzA5BtV9S2w@127.0.0.1:5432/now7'
});

const app = express();
const PORT = 4050;

app.use(cors());
app.use(express.json());

const CONFIG_PATH = path.join(__dirname, 'config.json');
const QUEUE_PATH = path.join(__dirname, 'queue.json');
const SCHEDULED_PATH = path.join(__dirname, 'scheduled_leads.json');
const PROCESSED_PATH = path.join(__dirname, 'processed_leads.json');
const APPOINTMENTS_PATH = path.join(__dirname, 'appointments.json');
const CREDENTIALS_PATH = path.join(__dirname, 'google_credentials.json');
const LOG_FILE = path.join(__dirname, 'watcher.log');
const AUDIO_DIR = path.join(__dirname, 'audios');
const PUBLIC_DIR = path.join(__dirname, 'public');

const upload = multer({ dest: '/tmp/uploads/' });

// Serve static frontend app
app.use(express.static(PUBLIC_DIR));
app.use('/funnel', express.static(PUBLIC_DIR));
app.use('/funnel-app', express.static(PUBLIC_DIR));

const router = express.Router();

const REDIRECT_URI = 'https://app.7now.xyz/funnel-api/auth/google/callback';

function loadAppointments() {
  try {
    if (fs.existsSync(APPOINTMENTS_PATH)) {
      return JSON.parse(fs.readFileSync(APPOINTMENTS_PATH, 'utf-8'));
    }
  } catch (e) {}
  return [];
}

function saveAppointments(appts) {
  try {
    fs.writeFileSync(APPOINTMENTS_PATH, JSON.stringify(appts, null, 2), 'utf-8');
  } catch (e) {}
}

async function setKanbanTag(ticketId, tagId) {
  try {
    await pool.query(
      `DELETE FROM "TicketTags" WHERE "ticketId" = $1 AND "tagId" IN (SELECT id FROM "Tags" WHERE kanban = 1)`,
      [ticketId]
    );
    await pool.query(
      `INSERT INTO "TicketTags" ("ticketId", "tagId", "createdAt", "updatedAt") VALUES ($1, $2, NOW(), NOW())`,
      [ticketId, tagId]
    );
  } catch (err) {
    console.error(`[ERRO KANBAN API] ${err.message}`);
  }
}

// ---------------------------------------------------------
// ROTAS DE AUTENTICAÇÃO NATIVA GOOGLE OAUTH 2.0 (1 CLIQUE)
// ---------------------------------------------------------
router.get(['/auth/google', '/api/auth/google'], (req, res) => {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    const clientId = config.calendar?.clientId;
    const clientSecret = config.calendar?.clientSecret;

    if (!clientId || !clientSecret) {
      return res.status(400).send(`
        <!DOCTYPE html>
        <html lang="pt-BR">
        <head><meta charset="UTF-8"><title>Configuração Pendente</title><script src="https://cdn.tailwindcss.com"></script></head>
        <body class="bg-slate-950 text-slate-100 flex items-center justify-center min-h-screen p-4 font-sans">
          <div class="bg-slate-900 border border-slate-800 p-8 rounded-2xl max-w-md text-center space-y-4 shadow-2xl">
            <div class="w-12 h-12 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center mx-auto text-2xl font-bold">!</div>
            <h2 class="text-xl font-bold text-white">Client ID Não Informado</h2>
            <p class="text-xs text-slate-400 leading-relaxed">
              Para logar nativamente com 1 clique, insira o <b>Client ID</b> e o <b>Client Secret</b> do Google na aba "Google Agenda & Entrevistas" do painel.
            </p>
            <a href="/lead-funnel" class="inline-block px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition">
              Voltar ao Painel
            </a>
          </div>
        </body>
        </html>
      `);
    }

    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      REDIRECT_URI
    );

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/userinfo.email'
      ]
    });

    res.redirect(authUrl);
  } catch (err) {
    res.status(500).send(`Erro ao iniciar autenticação: ${err.message}`);
  }
});

router.get(['/auth/google/callback', '/api/auth/google/callback'], async (req, res) => {
  try {
    const code = req.query.code;
    if (!code) {
      return res.status(400).send('Código de autorização não recebido do Google.');
    }

    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    const clientId = config.calendar?.clientId;
    const clientSecret = config.calendar?.clientSecret;

    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      REDIRECT_URI
    );

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Obtém o e-mail da conta conectada
    let userEmail = config.calendar?.copyEmail || 'srzambrini@gmail.com';
    try {
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const userInfo = await oauth2.userinfo.get();
      if (userInfo.data && userInfo.data.email) {
        userEmail = userInfo.data.email;
      }
    } catch (e) {}

    const credData = {
      type: 'oauth2',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      expiry_date: tokens.expiry_date,
      client_email: userEmail
    };

    fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(credData, null, 2), 'utf-8');

    // Mantém o copyEmail como srzambrini@gmail.com para ir sempre em cópia!
    if (!config.calendar) config.calendar = {};
    if (!config.calendar.copyEmail) config.calendar.copyEmail = 'srzambrini@gmail.com';
    config.calendar.connectedAccount = userEmail;
    config.calendar.calendarId = 'primary';
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');

    res.send(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <title>Google Calendar Conectado</title>
        <script src="https://cdn.tailwindcss.com"></script>
      </head>
      <body class="bg-slate-950 text-slate-100 flex items-center justify-center min-h-screen p-4 font-sans">
        <div class="bg-slate-900 border border-slate-800 p-8 rounded-2xl max-w-md text-center space-y-4 shadow-2xl">
          <div class="w-12 h-12 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center mx-auto text-2xl font-bold">✓</div>
          <h2 class="text-xl font-bold text-white">Google Calendar Conectado!</h2>
          <p class="text-xs text-emerald-400 font-mono">Conta vinculada: ${userEmail}</p>
          <p class="text-xs text-slate-400">Sua agenda pessoal foi conectada com sucesso. Retornando ao painel...</p>
        </div>
        <script>
          if (window.opener) {
            try {
              window.opener.location.reload();
            } catch(e) {}
            setTimeout(() => { window.close(); }, 1500);
          } else {
            setTimeout(() => { window.location.href = '/lead-funnel?connected=true'; }, 1500);
          }
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    res.status(500).send(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head><meta charset="UTF-8"><title>Erro de Conexão</title><script src="https://cdn.tailwindcss.com"></script></head>
      <body class="bg-slate-950 text-slate-100 flex items-center justify-center min-h-screen p-4 font-sans">
        <div class="bg-slate-900 border border-slate-800 p-8 rounded-2xl max-w-md text-center space-y-4 shadow-2xl">
          <div class="w-12 h-12 rounded-full bg-rose-500/20 text-rose-400 flex items-center justify-center mx-auto text-2xl font-bold">✕</div>
          <h2 class="text-xl font-bold text-white">Falha na Conexão Google</h2>
          <p class="text-xs text-rose-400 font-mono leading-relaxed">${err.message}</p>
          <a href="/lead-funnel" class="inline-block px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition">
            Voltar ao Painel
          </a>
        </div>
      </body>
      </html>
    `);
  }
});

router.post(['/auth/google/disconnect', '/api/auth/google/disconnect'], (req, res) => {
  try {
    if (fs.existsSync(CREDENTIALS_PATH)) {
      fs.unlinkSync(CREDENTIALS_PATH);
    }
    res.json({ success: true, message: 'Conta do Google desconectada com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /status
router.get(['/status', '/api/status'], (req, res) => {
  res.json({ status: 'online', uptime: process.uptime(), time: new Date().toISOString() });
});

// GET /config
router.get(['/config', '/api/config'], (req, res) => {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /config
router.post(['/config', '/api/config'], (req, res) => {
  try {
    const newConfig = req.body;
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2), 'utf-8');
    res.json({ success: true, config: newConfig });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /stats
router.get(['/stats', '/api/stats'], async (req, res) => {
  try {
    const tagQuery = `
      SELECT tg.id, tg.name, COUNT(tt."ticketId")::int as count
      FROM "Tags" tg
      LEFT JOIN "TicketTags" tt ON tt."tagId" = tg.id
      LEFT JOIN "Tickets" t ON t.id = tt."ticketId" AND t.status != 'closed'
      WHERE tg.kanban = 1
      GROUP BY tg.id, tg.name
      ORDER BY tg.id ASC;
    `;
    const tagRes = await pool.query(tagQuery);

    let queue = [];
    try {
      if (fs.existsSync(QUEUE_PATH)) queue = JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf-8'));
    } catch (e) {}

    let scheduled = [];
    try {
      if (fs.existsSync(SCHEDULED_PATH)) scheduled = JSON.parse(fs.readFileSync(SCHEDULED_PATH, 'utf-8'));
    } catch (e) {}

    let processedCount = 0;
    try {
      if (fs.existsSync(PROCESSED_PATH)) processedCount = JSON.parse(fs.readFileSync(PROCESSED_PATH, 'utf-8')).length;
    } catch (e) {}

    const appointments = loadAppointments();
    const nowSp = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const todayAppointments = appointments.filter(a => a.dateStr === nowSp);

    res.json({
      kanban: tagRes.rows,
      queueCount: queue.length,
      scheduledCount: scheduled.length,
      processedCount,
      appointmentCount: appointments.length,
      todayAppointmentsCount: todayAppointments.length,
      queue,
      scheduled,
      appointments
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /appointments
router.get(['/appointments', '/api/appointments'], (req, res) => {
  try {
    const appointments = loadAppointments();
    res.json(appointments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /appointments/:id/status
router.post(['/appointments/:id/status', '/api/appointments/:id/status'], async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const appointments = loadAppointments();
    const idx = appointments.findIndex(a => a.id === id);

    if (idx === -1) {
      return res.status(404).json({ error: 'Agendamento não encontrado' });
    }

    appointments[idx].status = status;
    appointments[idx].updatedAt = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    if (appointments[idx].ticketId) {
      if (status === 'reagendar') {
        await setKanbanTag(appointments[idx].ticketId, 8);
      } else if (status === 'agendado' || status === 'confirmado') {
        await setKanbanTag(appointments[idx].ticketId, 4);
      } else if (status === 'concluido') {
        await setKanbanTag(appointments[idx].ticketId, 5);
      }
    }

    saveAppointments(appointments);
    res.json({ success: true, appointment: appointments[idx] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /appointments/:id/email
router.post(['/appointments/:id/email', '/api/appointments/:id/email'], async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ error: 'E-mail inválido' });
    }
    const cleanEmail = email.trim().toLowerCase();
    const appointments = loadAppointments();
    const idx = appointments.findIndex(a => a.id === id);

    if (idx === -1) {
      return res.status(404).json({ error: 'Agendamento não encontrado' });
    }

    appointments[idx].candidateEmail = cleanEmail;
    appointments[idx].updatedAt = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    if (appointments[idx].contactId) {
      await pool.query(
        `UPDATE "Contacts" SET email = $1, "updatedAt" = NOW() WHERE id = $2`,
        [cleanEmail, appointments[idx].contactId]
      ).catch(() => {});
    }

    let googlePatch = null;
    if (appointments[idx].googleEventId) {
      googlePatch = await addAttendeeToCalendarEvent({
        eventId: appointments[idx].googleEventId,
        candidateEmail: cleanEmail
      });
    }

    saveAppointments(appointments);
    res.json({ success: true, appointment: appointments[idx], googlePatch });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /calendar/credentials
router.get(['/calendar/credentials', '/api/calendar/credentials'], (req, res) => {
  try {
    if (!fs.existsSync(CREDENTIALS_PATH)) {
      return res.json({ configured: false });
    }
    const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf-8');
    const key = JSON.parse(raw);
    res.json({
      configured: true,
      type: key.type || (key.client_id ? 'oauth2' : 'unknown'),
      isOAuth: key.type === 'oauth2' || Boolean(key.refresh_token),
      clientEmail: key.client_email || key.client_id || 'Conectado'
    });
  } catch (err) {
    res.status(500).json({ configured: false, error: err.message });
  }
});

// POST /calendar/credentials
router.post(['/calendar/credentials', '/api/calendar/credentials'], upload.single('file'), (req, res) => {
  try {
    let credentialsContent = null;
    if (req.file) {
      credentialsContent = fs.readFileSync(req.file.path, 'utf-8');
      fs.unlinkSync(req.file.path);
    } else if (req.body && req.body.credentials) {
      credentialsContent = typeof req.body.credentials === 'string'
        ? req.body.credentials
        : JSON.stringify(req.body.credentials);
    }

    if (!credentialsContent) {
      return res.status(400).json({ error: 'Nenhum arquivo ou JSON fornecido.' });
    }

    const parsed = JSON.parse(credentialsContent);
    fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(parsed, null, 2), 'utf-8');

    res.json({
      success: true,
      message: 'Credenciais salvas com sucesso!',
      type: parsed.type || (parsed.client_id ? 'oauth2' : 'custom'),
      clientEmail: parsed.client_email || parsed.client_id
    });
  } catch (err) {
    res.status(400).json({ error: `JSON inválido: ${err.message}` });
  }
});

// POST /calendar/test
router.post(['/calendar/test', '/api/calendar/test'], async (req, res) => {
  try {
    const calendar = getCalendarClient();
    if (!calendar) {
      return res.json({
        success: false,
        message: 'Nenhuma conta do Google conectada no momento.'
      });
    }

    const calInfo = await calendar.calendars.get({ calendarId: 'primary' });
    res.json({
      success: true,
      message: `Conexão bem sucedida com o Google Calendar!`,
      summary: calInfo.data.summary,
      timeZone: calInfo.data.timeZone
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: `Erro ao conectar com Google Calendar: ${err.message}`
    });
  }
});

// GET /audios/:id
router.get(['/audios/:id', '/api/audios/:id'], (req, res) => {
  const id = req.params.id;
  const audioPath = path.join(AUDIO_DIR, `audio${id}.ogg`);

  if (!fs.existsSync(audioPath)) {
    return res.status(404).json({ error: 'Audio não encontrado' });
  }

  const stat = fs.statSync(audioPath);
  res.writeHead(200, {
    'Content-Type': 'audio/ogg',
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes'
  });

  fs.createReadStream(audioPath).pipe(res);
});

// POST /audios/:id
router.post(['/audios/:id', '/api/audios/:id'], upload.single('audio'), (req, res) => {
  const id = req.params.id;
  if (!['1', '2', '3'].includes(id)) {
    return res.status(400).json({ error: 'ID inválido (use 1, 2 ou 3)' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum arquivo enviado' });
  }

  const tempPath = req.file.path;
  const destPath = path.join(AUDIO_DIR, `audio${id}.ogg`);

  try {
    execSync(`ffmpeg -y -i "${tempPath}" -c:a libopus -b:a 32k -vbr on -application voip "${destPath}"`);
    fs.unlinkSync(tempPath);
    res.json({ success: true, message: `Áudio ${id} atualizado com sucesso!` });
  } catch (err) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    res.status(500).json({ error: `Erro na conversão: ${err.message}` });
  }
});

// GET /logs
router.get(['/logs', '/api/logs'], (req, res) => {
  try {
    if (!fs.existsSync(LOG_FILE)) {
      return res.json({ logs: [] });
    }
    const lines = fs.readFileSync(LOG_FILE, 'utf-8').trim().split('\n');
    res.json({ logs: lines.slice(-100) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /remarketing
router.get(['/remarketing', '/api/remarketing', '/funnel-api/remarketing'], (req, res) => {
  try {
    const data = getRemarketingData();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /remarketing/toggle
router.post(['/remarketing/toggle', '/api/remarketing/toggle', '/funnel-api/remarketing/toggle'], (req, res) => {
  try {
    const { enabled } = req.body;
    const state = toggleRemarketing(enabled);
    res.json({ success: true, state });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /remarketing/config
router.post(['/remarketing/config', '/api/remarketing/config', '/funnel-api/remarketing/config'], (req, res) => {
  try {
    const state = updateRemarketingConfig(req.body);
    res.json({ success: true, state });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /remarketing/sync
router.post(['/remarketing/sync', '/api/remarketing/sync', '/funnel-api/remarketing/sync'], async (req, res) => {
  try {
    const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    const result = await syncRemarketingQueue(cfg.sheetUrl, cfg.adminNotifyNumber);
    res.json({ success: true, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use(router);

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[Funnel API] Servidor rodando na porta ${PORT}`);
});

module.exports = app;
