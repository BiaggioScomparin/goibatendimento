const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { Pool } = require('pg');
const { detectGender } = require('./gender.js');
const { createCalendarEvent, addAttendeeToCalendarEvent, getCalendarClient } = require('./calendar.js');
const {
  syncRemarketingQueue,
  processRemarketingDispatch,
  markRemarketingReplied
} = require('./remarketing.js');

const pool = new Pool({
  connectionString: 'postgres://now7:5kR8qpzA5BtV9S2w@127.0.0.1:5432/now7'
});

const CONFIG_PATH = path.join(__dirname, 'config.json');
const PROCESSED_PATH = path.join(__dirname, 'processed_leads.json');
const QUEUE_PATH = path.join(__dirname, 'queue.json');
const STATE_PATH = path.join(__dirname, 'queue_state.json');
const SCHEDULED_PATH = path.join(__dirname, 'scheduled_leads.json');
const APPOINTMENTS_PATH = path.join(__dirname, 'appointments.json');
const COMMANDS_PATH = path.join(__dirname, 'processed_commands.json');
const LOG_FILE = path.join(__dirname, 'watcher.log');

const AUDIO_DIR = path.join(__dirname, 'audios');
const AUDIO_1 = path.join(AUDIO_DIR, 'audio1.ogg');
const AUDIO_2 = path.join(AUDIO_DIR, 'audio2.ogg');
const AUDIO_3 = path.join(AUDIO_DIR, 'audio3.ogg');

// IDs das colunas do Kanban
const TAG_NOVO_LEAD = 1;
const TAG_AUDIO_ENVIADO = 2;
const TAG_EM_CONVERSA = 3;
const TAG_QUALIFICADO = 4;
const TAG_CONVERTIDO = 5;
const TAG_FEMININO = 6;
const TAG_SINDICANCIA = 7;
const TAG_REAGENDAR = 8;

function log(msg) {
  const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const line = `[${now}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf-8');
  } catch (e) {}
}

function getFormattedDateTime() {
  return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function getGreeting() {
  const now = new Date();
  const hourStr = now.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false });
  const hour = parseInt(hourStr, 10);

  if (hour >= 5 && hour < 12) {
    return 'Bom dia';
  } else if (hour >= 12 && hour < 18) {
    return 'Boa tarde';
  } else {
    return 'Boa noite';
  }
}

function isWithinWorkingHours(startHour = 8, endHour = 21) {
  const now = new Date();
  const hourStr = now.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false });
  const hour = parseInt(hourStr, 10);
  return hour >= startHour && hour < endHour;
}

function renderTemplate(template, data) {
  return template
    .replace(/\{\{?\s*sauda[çc][ãa]o\s*\}\}?/gi, data.saudacao)
    .replace(/\{\{?\s*primeiro[_ ]nome\s*\}\}?/gi, data.firstName || data.fullName)
    .replace(/\{\{?\s*nome\s*\}\}?/gi, data.fullName)
    .replace(/\{\{?\s*telefone\s*\}\}?/gi, data.phone);
}

function getRandomTemplate(config) {
  if (Array.isArray(config.messageVariations) && config.messageVariations.length > 0) {
    const idx = Math.floor(Math.random() * config.messageVariations.length);
    const letters = ['A', 'B', 'C', 'D', 'E'];
    const letter = letters[idx] || `${idx + 1}`;
    return { template: config.messageVariations[idx], variation: letter };
  }
  return { template: config.messageTemplate, variation: 'Padrão' };
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    log(`[ERRO] Falha ao carregar config.json: ${err.message}`);
    return null;
  }
}

function loadProcessed() {
  try {
    if (fs.existsSync(PROCESSED_PATH)) {
      const raw = fs.readFileSync(PROCESSED_PATH, 'utf-8');
      return new Set(JSON.parse(raw));
    }
  } catch (err) {
    log(`[AVISO] Erro ao carregar processed_leads.json: ${err.message}`);
  }
  return null;
}

function saveProcessed(set) {
  try {
    fs.writeFileSync(PROCESSED_PATH, JSON.stringify(Array.from(set), null, 2), 'utf-8');
  } catch (err) {
    log(`[ERRO] Falha ao salvar processed_leads.json: ${err.message}`);
  }
}

function loadQueue() {
  try {
    if (fs.existsSync(QUEUE_PATH)) {
      const raw = fs.readFileSync(QUEUE_PATH, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    log(`[AVISO] Erro ao carregar queue.json: ${err.message}`);
  }
  return [];
}

function saveQueue(queue) {
  try {
    fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2), 'utf-8');
  } catch (err) {
    log(`[ERRO] Falha ao salvar queue.json: ${err.message}`);
  }
}

function loadScheduled() {
  try {
    if (fs.existsSync(SCHEDULED_PATH)) {
      const raw = fs.readFileSync(SCHEDULED_PATH, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    log(`[AVISO] Erro ao carregar scheduled_leads.json: ${err.message}`);
  }
  return [];
}

function saveScheduled(scheduled) {
  try {
    fs.writeFileSync(SCHEDULED_PATH, JSON.stringify(scheduled, null, 2), 'utf-8');
  } catch (err) {
    log(`[ERRO] Falha ao salvar scheduled_leads.json: ${err.message}`);
  }
}

function loadAppointments() {
  try {
    if (fs.existsSync(APPOINTMENTS_PATH)) {
      const raw = fs.readFileSync(APPOINTMENTS_PATH, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {
    log(`[AVISO] Erro ao carregar appointments.json: ${err.message}`);
  }
  return [];
}

function saveAppointments(appts) {
  try {
    fs.writeFileSync(APPOINTMENTS_PATH, JSON.stringify(appts, null, 2), 'utf-8');
  } catch (err) {
    log(`[ERRO] Falha ao salvar appointments.json: ${err.message}`);
  }
}

function loadProcessedCommands() {
  try {
    if (fs.existsSync(COMMANDS_PATH)) {
      const raw = fs.readFileSync(COMMANDS_PATH, 'utf-8');
      return new Set(JSON.parse(raw));
    }
  } catch (err) {}
  return new Set();
}

function saveProcessedCommands(set) {
  try {
    fs.writeFileSync(COMMANDS_PATH, JSON.stringify(Array.from(set), null, 2), 'utf-8');
  } catch (err) {}
}

function loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      const raw = fs.readFileSync(STATE_PATH, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (err) {}
  return { lastQueueSendTime: 0, wasOutside: false };
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {}
}

function sanitizePhone(raw) {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, '');
  if (!digits) return null;

  if (digits.length === 10 || digits.length === 11) {
    digits = '55' + digits;
  }

  if (digits.length < 10 || digits.length > 15) {
    return null;
  }

  return digits;
}

function getFirstName(fullName) {
  if (!fullName) return '';
  const clean = fullName.replace(/\(teste\)/gi, '').trim();
  const parts = clean.split(/\s+/);
  if (parts.length === 0) return '';
  const first = parts[0];
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------
// PARSERS E AUXILIARES DE AGENDAMENTO
// ---------------------------------------------------------
function parseAgendarCommand(body) {
  const match = body.match(/#agendar\s+(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)(?:\s+(?:[àa]s\s+)?)(\d{1,2}(?:[:h]\d{2})?)/i);
  if (!match) return null;

  const rawDate = match[1];
  let rawTime = match[2].replace('h', ':');
  if (!rawTime.includes(':')) {
    rawTime = `${rawTime}:00`;
  }
  const timeParts = rawTime.split(':');
  const hour = parseInt(timeParts[0], 10);
  const minute = parseInt(timeParts[1], 10);

  const dateParts = rawDate.split('/');
  const day = parseInt(dateParts[0], 10);
  const month = parseInt(dateParts[1], 10);
  let year = new Date().getFullYear();
  if (dateParts[2]) {
    const y = parseInt(dateParts[2], 10);
    year = y < 100 ? 2000 + y : y;
  }

  const pad = (n) => String(n).padStart(2, '0');
  const dateFormatted = `${pad(day)}/${pad(month)}/${year}`;
  const timeFormatted = `${pad(hour)}:${pad(minute)}`;
  const startDateTime = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00-03:00`;
  
  let endHour = hour + 1;
  if (endHour >= 24) endHour = 0;
  const endDateTime = `${year}-${pad(month)}-${pad(day)}T${pad(endHour)}:${pad(minute)}:00-03:00`;

  const remaining = body.replace(match[0], '').trim();

  return {
    dateStr: dateFormatted,
    timeStr: timeFormatted,
    day,
    month,
    year,
    hour,
    minute,
    startDateTime,
    endDateTime,
    notes: remaining
  };
}

function getDayOfWeekName(year, month, day) {
  const dt = new Date(year, month - 1, day);
  const days = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  return days[dt.getDay()] || '';
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
    log(`[ERRO KANBAN] Falha ao vincular tag #${tagId} ao ticket #${ticketId}: ${err.message}`);
  }
}

async function linkTicketToLeadTag(phone, email) {
  try {
    const res = await pool.query(
      `SELECT t.id, t."contactId" FROM "Tickets" t
       JOIN "Contacts" c ON c.id = t."contactId"
       WHERE c.number = $1 AND t."companyId" = 1
       ORDER BY t.id DESC LIMIT 1`,
      [phone]
    );

    if (res.rows.length > 0) {
      const ticketId = res.rows[0].id;
      const contactId = res.rows[0].contactId;
      await setKanbanTag(ticketId, TAG_NOVO_LEAD);
      log(`[KANBAN] Ticket #${ticketId} posicionado na coluna "1. Novo Lead"!`);

      if (email && email.includes('@')) {
        await pool.query(
          `UPDATE "Contacts" SET email = $1, "updatedAt" = NOW() WHERE id = $2 AND (email IS NULL OR email = '')`,
          [email.toLowerCase(), contactId]
        ).catch(() => {});
      }
      return ticketId;
    }
  } catch (err) {
    log(`[ERRO KANBAN] Falha ao buscar ticket para telefone ${phone}: ${err.message}`);
  }
  return null;
}

async function createFemaleLeadCard(fullName, phone, lead) {
  try {
    const contactRes = await pool.query(
      `INSERT INTO "Contacts" (name, number, "profilePicUrl", "isGroup", "companyId", "createdAt", "updatedAt")
       VALUES ($1, $2, '', false, 1, NOW(), NOW())
       ON CONFLICT ("number", "companyId") DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [fullName, phone]
    );
    const contactId = contactRes.rows[0].id;

    const lastMsg = `Lead Feminino (Anúncio: ${lead.campaign_name || 'Campanha'}) - Sem Disparo`;
    const ticketRes = await pool.query(
      `INSERT INTO "Tickets" (status, "lastMessage", "contactId", "whatsappId", "companyId", uuid, "isBot", channel, "createdAt", "updatedAt")
       VALUES ('pending', $1, $2, 1, 1, gen_random_uuid(), false, 'whatsapp', NOW(), NOW())
       RETURNING id`,
      [lastMsg, contactId]
    );
    const ticketId = ticketRes.rows[0].id;

    await setKanbanTag(ticketId, TAG_FEMININO);
    log(`[KANBAN] Lead Feminino "${fullName}" adicionado diretamente à coluna "6. Leads Femininos (Sem Disparo)" (Ticket #${ticketId})!`);
  } catch (err) {
    log(`[ERRO KANBAN FEMININO] ${err.message}`);
  }
}

async function sendWhatsApp(apiUrl, apiToken, number, text) {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      number: number,
      body: text
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  return await response.json();
}

async function sendWhatsAppAudio(apiUrl, apiToken, number, audioPath) {
  if (!fs.existsSync(audioPath)) {
    throw new Error(`Arquivo de áudio não encontrado: ${audioPath}`);
  }

  const formData = new FormData();
  formData.append('number', number);
  formData.append('body', '');

  const fileBytes = fs.readFileSync(audioPath);
  const ext = path.extname(audioPath).toLowerCase();
  const mimeType = ext === '.ogg' ? 'audio/ogg' : 'audio/mpeg';
  const fileName = path.basename(audioPath);

  const blob = new Blob([fileBytes], { type: mimeType });
  formData.append('medias', blob, fileName);

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiToken}`
    },
    body: formData
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`HTTP ${res.status}: ${errorText}`);
  }

  return await res.json();
}

function getAdminNotifyNumbers(config) {
  const numbers = [];
  if (config && config.adminNotifyNumbers && Array.isArray(config.adminNotifyNumbers)) {
    for (const n of config.adminNotifyNumbers) {
      const clean = String(n).replace(/\D/g, '');
      if (clean && !numbers.includes(clean)) numbers.push(clean);
    }
  }
  if (config && config.adminNotifyNumber) {
    const raw = String(config.adminNotifyNumber);
    for (const part of raw.split(/[,;\s]+/)) {
      const clean = part.replace(/\D/g, '');
      if (clean && !numbers.includes(clean)) {
        numbers.push(clean);
      }
    }
  }
  // Garante que ambos os administradores autorizados recebam todos os alertas
  const defaultRecipients = ['5511984736679', '5511982599289'];
  for (const def of defaultRecipients) {
    if (!numbers.includes(def)) {
      numbers.push(def);
    }
  }
  return numbers;
}

async function notifyAdmins(config, message) {
  const recipients = getAdminNotifyNumbers(config);
  for (const num of recipients) {
    try {
      await sendWhatsApp(config.apiUrl, config.apiToken, num, message);
      log(`[NOTIFICAÇÃO ADMIN] Alerta entregue com sucesso para +${num}`);
    } catch (e) {
      log(`[ERRO NOTIFICAÇÃO ADMIN] Falha ao enviar para +${num}: ${e.message}`);
    }
    await sleep(1000);
  }
}

// ---------------------------------------------------------
// MONITOR DE COMANDOS DO ADMINISTRADOR (#agendar)
// ---------------------------------------------------------
let isCheckingCommands = false;

async function checkAdminCommands(config) {
  if (isCheckingCommands) return;
  isCheckingCommands = true;

  try {
    const query = `
      SELECT 
        m.id, 
        m."ticketId", 
        m.body, 
        m."createdAt", 
        t."contactId", 
        c.name AS "contactName", 
        c.number AS "contactPhone", 
        c.email AS "contactEmail"
      FROM "Messages" m
      JOIN "Tickets" t ON t.id = m."ticketId"
      JOIN "Contacts" c ON c.id = t."contactId"
      WHERE m."fromMe" = true 
        AND m.body ILIKE '%#agendar%'
        AND m."createdAt" > NOW() - INTERVAL '3 days'
      ORDER BY m.id DESC LIMIT 15;
    `;

    const res = await pool.query(query);
    if (res.rows.length === 0) return;

    const processed = loadProcessedCommands();
    const appointments = loadAppointments();
    let hasUpdates = false;

    for (const row of res.rows) {
      if (processed.has(row.id)) continue;

      const parsed = parseAgendarCommand(row.body);
      if (!parsed) {
        processed.add(row.id);
        saveProcessedCommands(processed);
        continue;
      }

      processed.add(row.id);
      saveProcessedCommands(processed);

      log(`[COMANDO #AGENDAR DETECTADO] Ticket #${row.ticketId} para ${row.contactName} (${row.contactPhone}): ${parsed.dateStr} às ${parsed.timeStr}`);

      const location = (config.calendar && config.calendar.location) || 'Rua Paru, 175 - Vila Mazzei, São Paulo - SP, 02310-200';
      const copyEmail = (config.calendar && config.calendar.copyEmail) || 'srzambrini@gmail.com';

      const existingIdx = appointments.findIndex(a => a.ticketId === row.ticketId && a.status !== 'concluido' && a.status !== 'cancelado');

      // 1. Identifica e-mail do candidato (do banco, do comando #agendar ou agendamento prévio)
      let candEmail = (row.contactEmail || '').trim().toLowerCase();

      // Procura e-mail digitado no corpo do comando
      const emailInBody = row.body.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
      if (emailInBody) {
        candEmail = emailInBody[1].toLowerCase();
      }

      // Se ainda não tem, verifica histórico de agendamentos
      if (!candEmail && existingIdx >= 0 && appointments[existingIdx].candidateEmail) {
        candEmail = appointments[existingIdx].candidateEmail.trim().toLowerCase();
      }

      // Se achou candEmail e não estava salvo no contato, salva no PostgreSQL
      if (candEmail && (!row.contactEmail || row.contactEmail === '')) {
        try {
          await pool.query(
            `UPDATE "Contacts" SET email = $1, "updatedAt" = NOW() WHERE id = $2`,
            [candEmail, row.contactId]
          );
          log(`[BANCO DE DADOS] E-mail "${candEmail}" vinculado ao contato #${row.contactId} (${row.contactName}).`);
        } catch (e) {}
      }

      // Cria evento no Google Calendar (convidando o candidato caso tenhamos o e-mail)
      const calRes = await createCalendarEvent({
        candidateName: row.contactName,
        candidatePhone: row.contactPhone,
        candidateEmail: candEmail || '',
        startDateTime: parsed.startDateTime,
        endDateTime: parsed.endDateTime,
        location: location,
        copyEmail: copyEmail,
        notes: parsed.notes
      });

      const aptId = `apt_${row.ticketId}_${parsed.year}${String(parsed.month).padStart(2,'0')}${String(parsed.day).padStart(2,'0')}`;
      
      const aptData = {
        id: aptId,
        ticketId: row.ticketId,
        contactId: row.contactId,
        candidateName: row.contactName,
        candidateFirstName: getFirstName(row.contactName),
        candidatePhone: row.contactPhone,
        candidateEmail: candEmail || '',
        dateStr: parsed.dateStr,
        timeStr: parsed.timeStr,
        day: parsed.day,
        month: parsed.month,
        year: parsed.year,
        startDateTime: parsed.startDateTime,
        endDateTime: parsed.endDateTime,
        location: location,
        googleEventId: calRes.eventId || null,
        googleEventLink: calRes.htmlLink || null,
        status: 'agendado',
        morningSent: false,
        morningSentAt: null,
        preInterviewSent: false,
        preInterviewSentAt: null,
        notes: parsed.notes || '',
        createdAt: getFormattedDateTime(),
        updatedAt: getFormattedDateTime()
      };

      if (existingIdx >= 0) {
        appointments[existingIdx] = { ...appointments[existingIdx], ...aptData };
      } else {
        appointments.push(aptData);
      }
      hasUpdates = true;

      // 1. Move Ticket no Kanban para a Coluna 4: "4. Qualificado / Entrevista"
      await setKanbanTag(row.ticketId, TAG_QUALIFICADO);
      log(`[KANBAN ATUALIZADO] Ticket #${row.ticketId} ("${row.contactName}") movido para "4. Qualificado / Entrevista"!`);

      // 2. Dispara mensagem de confirmação para o Candidato
      const dayName = getDayOfWeekName(parsed.year, parsed.month, parsed.day);
      const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent(location)}`;

      let emailPrompt = '';
      if (candEmail && candEmail.includes('@')) {
        emailPrompt = `\n📧 *Convite no Google Agenda:*\nEnviamos o convite oficial da entrevista para o seu e-mail: *${candEmail}*.\n`;
      } else {
        emailPrompt = `\n📧 *Convite no seu Google Agenda:*\nPara receber o convite oficial diretamente no calendário do seu celular e no seu e-mail, *por favor responda nos enviando o seu e-mail abaixo:*\n`;
      }

      const clientMsg =
        `🏛️ *Agendamento Confirmado!*\n\n` +
        `Olá *${aptData.candidateFirstName}*, sua entrevista presencial com o *Venerável Mestre Biaggio Scomparin* foi agendada com sucesso!\n\n` +
        `📅 *Data:* ${parsed.dateStr} (${dayName})\n` +
        `⏰ *Horário:* ${parsed.timeStr}\n` +
        `📍 *Local:* ${location}\n` +
        `🗺️ *Como chegar:* ${mapsUrl}\n` +
        emailPrompt +
        `\n📌 *Orientações importantes:*\n` +
        `• Solicitamos chegar com 10 a 15 minutos de antecedência.\n` +
        `• Traje esporte fino ou passeio.\n` +
        `• No dia da entrevista enviaremos uma breve mensagem para confirmação de presença.\n\n` +
        `Estamos ansiosos para recebê-lo em nossa Loja!`;

      try {
        await sendWhatsApp(config.apiUrl, config.apiToken, row.contactPhone, clientMsg);
        log(`[AGENDAMENTO WHATSAPP] Confirmação enviada para ${row.contactName} (+${row.contactPhone})!`);
      } catch (e) {
        log(`[ERRO WHATSAPP AGENDAMENTO] Falha ao enviar para candidato: ${e.message}`);
      }

      // 3. Notifica os Administradores no WhatsApp
      const calStatus = calRes.success ? `✅ Google Agenda Conectado (${calRes.htmlLink})` : `⚠️ Salvo localmente (Google Calendar: ${calRes.reason || calRes.error || 'Aguardando credencial'})`;
      const candEmailDisplay = candEmail ? `📧 *E-mail Candidato:* ${candEmail} (Convidado)` : `📧 *E-mail Candidato:* ⏳ Aguardando candidato enviar via WhatsApp`;

      const adminMsg =
        `📅 *Nova Entrevista Agendada!*\n\n` +
        `👤 *Candidato:* ${row.contactName}\n` +
        `📱 *WhatsApp:* +${row.contactPhone}\n` +
        `${candEmailDisplay}\n` +
        `📅 *Data/Hora:* ${parsed.dateStr} às ${parsed.timeStr} (${dayName})\n` +
        `📍 *Local:* ${location}\n` +
        `📨 *Cópia fixa:* ${copyEmail}\n` +
        `🌐 *Google Agenda:* ${calStatus}\n` +
        `📋 *Kanban:* Coluna 4 (Qualificado / Entrevista)`;

      await notifyAdmins(config, adminMsg);

      await sleep(2000);
    }

    if (hasUpdates) {
      saveAppointments(appointments);
    }
  } catch (err) {
    log(`[ERRO CHECK COMMANDS] ${err.message}`);
  } finally {
    isCheckingCommands = false;
  }
}

// ---------------------------------------------------------
// SINCRONIZADOR DE CONVIDADOS PENDENTES NO GOOGLE AGENDA
// ---------------------------------------------------------
let isSyncingGuests = false;
async function syncMissingCalendarAttendees(config) {
  if (isSyncingGuests) return;
  isSyncingGuests = true;

  try {
    const appointments = loadAppointments();
    let hasUpdates = false;

    for (const apt of appointments) {
      if ((!apt.candidateEmail || !apt.candidateEmail.includes('@')) && apt.googleEventId && apt.contactId) {
        const res = await pool.query(`SELECT email FROM "Contacts" WHERE id = $1`, [apt.contactId]);
        if (res.rows.length > 0 && res.rows[0].email && res.rows[0].email.includes('@')) {
          const foundEmail = res.rows[0].email.trim().toLowerCase();
          log(`[AUTO-SYNC CONVIDADO] Adicionando e-mail ${foundEmail} do contato #${apt.contactId} ao evento ${apt.googleEventId}...`);
          const patchRes = await addAttendeeToCalendarEvent({
            eventId: apt.googleEventId,
            candidateEmail: foundEmail
          });
          if (patchRes.success) {
            apt.candidateEmail = foundEmail;
            apt.updatedAt = getFormattedDateTime();
            hasUpdates = true;
            log(`[AUTO-SYNC CONVIDADO SUCESSO] ${foundEmail} convidado no Google Agenda para o evento ${apt.googleEventId}!`);
          }
        }
      }
    }

    if (hasUpdates) {
      saveAppointments(appointments);
    }
  } catch (e) {
    log(`[ERRO SYNC CONVIDADOS] ${e.message}`);
  } finally {
    isSyncingGuests = false;
  }
}

// ---------------------------------------------------------
// MONITOR DE FOLLOW-UPS DE ENTREVISTA (MANHÃ E 45 MIN ANTES)
// ---------------------------------------------------------
let isCheckingFollowups = false;

async function checkAppointmentFollowups(config) {
  if (isCheckingFollowups) return;
  isCheckingFollowups = true;

  try {
    const appointments = loadAppointments();
    if (appointments.length === 0) return;

    const now = new Date();
    const spDateStr = now.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const spTimeStr = now.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false });
    const [curH, curM] = spTimeStr.split(':').map(n => parseInt(n, 10));
    const currentTotalMinutes = curH * 60 + curM;

    const morningH = (config.calendar && config.calendar.morningHour) !== undefined ? config.calendar.morningHour : 8;
    const morningM = (config.calendar && config.calendar.morningMinute) !== undefined ? config.calendar.morningMinute : 30;
    const morningThreshold = morningH * 60 + morningM;
    const preMinutes = (config.calendar && config.calendar.preInterviewMinutes) !== undefined ? config.calendar.preInterviewMinutes : 45;
    const location = (config.calendar && config.calendar.location) || 'Rua Paru, 175 - Vila Mazzei, São Paulo - SP, 02310-200';
    const mapsUrl = `https://maps.google.com/?q=${encodeURIComponent(location)}`;

    let hasUpdates = false;

    for (const apt of appointments) {
      if (apt.dateStr !== spDateStr) continue;
      if (apt.status === 'cancelado' || apt.status === 'reagendar') continue;

      const [aptH, aptM] = apt.timeStr.split(':').map(n => parseInt(n, 10));
      const aptTotalMinutes = aptH * 60 + aptM;

      // 1. FOLLOW-UP MATINAL (Confirmação de Presença)
      if (!apt.morningSent && currentTotalMinutes >= morningThreshold && currentTotalMinutes < aptTotalMinutes) {
        log(`[FOLLOW-UP MATINAL] Disparando confirmação para ${apt.candidateName} (${apt.candidatePhone})...`);

        const morningMsg =
          `🏛️ *Confirmação de Presença — Loja Maçônica Lealdade e Justiça*\n\n` +
          `Olá *${apt.candidateFirstName}*, bom dia! Tudo bem?\n\n` +
          `Lembramos que sua entrevista para a Maçonaria está agendada para *hoje*, às *${apt.timeStr}*, em nosso Templo:\n` +
          `📍 *${location}*\n\n` +
          `Você confirma sua presença no horário marcado?\n\n` +
          `1️⃣ *1* - Sim, estarei presente!\n` +
          `2️⃣ *2* - Não poderei comparecer / Desejo reagendar\n\n` +
          `_Por favor, responda com *1* para confirmar ou *2* para reagendar._`;

        try {
          await sendWhatsApp(config.apiUrl, config.apiToken, apt.candidatePhone, morningMsg);
          apt.morningSent = true;
          apt.morningSentAt = getFormattedDateTime();
          apt.updatedAt = getFormattedDateTime();
          hasUpdates = true;
          log(`[FOLLOW-UP MATINAL SUCESSO] Enviado para ${apt.candidateName}!`);
        } catch (e) {
          log(`[FOLLOW-UP MATINAL ERRO] Falha ao enviar para ${apt.candidatePhone}: ${e.message}`);
        }

        await sleep(2000);
      }

      // 2. LEMBRETE PRÉ-ENTREVISTA (45 min antes)
      if (!apt.preInterviewSent && (apt.status === 'agendado' || apt.status === 'confirmado')) {
        const diffMinutes = aptTotalMinutes - currentTotalMinutes;
        if (diffMinutes <= preMinutes && diffMinutes >= -10) {
          log(`[LEMBRETE PRÉ-ENTREVISTA] Disparando aviso de 45 min para ${apt.candidateName} (${apt.candidatePhone})...`);

          const preMsg =
            `Olá *${apt.candidateFirstName}*!\n\n` +
            `O *Venerável Mestre Biaggio Scomparin* já está no Templo da Loja Maçônica Lealdade e Justiça aguardando você para a sua entrevista às *${apt.timeStr}*.\n\n` +
            `📍 *Endereço:* ${location}\n` +
            `🗺️ *Google Maps:* ${mapsUrl}\n\n` +
            `Desejamos uma ótima vinda até o Templo. Qualquer imprevisto no trânsito, avise-nos por aqui!`;

          try {
            await sendWhatsApp(config.apiUrl, config.apiToken, apt.candidatePhone, preMsg);
            apt.preInterviewSent = true;
            apt.preInterviewSentAt = getFormattedDateTime();
            apt.updatedAt = getFormattedDateTime();
            hasUpdates = true;
            log(`[LEMBRETE PRÉ-ENTREVISTA SUCESSO] Enviado para ${apt.candidateName}!`);
          } catch (e) {
            log(`[LEMBRETE PRÉ-ENTREVISTA ERRO] Falha ao enviar para ${apt.candidatePhone}: ${e.message}`);
          }

          await sleep(2000);
        }
      }

      // 3. CASO NÃO CONFIRME ATÉ O HORÁRIO: Move para Coluna 8
      if (apt.morningSent && apt.status === 'agendado' && currentTotalMinutes >= aptTotalMinutes) {
        log(`[AUTO REAGENDAR] Candidato ${apt.candidateName} não respondeu confirmação até o horário da entrevista (${apt.timeStr}).`);
        apt.status = 'reagendar';
        apt.updatedAt = getFormattedDateTime();
        hasUpdates = true;

        await setKanbanTag(apt.ticketId, TAG_REAGENDAR);
        log(`[KANBAN ATUALIZADO] Ticket #${apt.ticketId} movido para "8. Reagendar Entrevista" por falta de confirmação!`);

        const alertMsg =
          `⚠️ *Entrevista Não Confirmada / Candidato Ausente*\n\n` +
          `O candidato abaixo não confirmou presença até o horário da entrevista:\n\n` +
          `👤 *Nome:* ${apt.candidateName}\n` +
          `📱 *WhatsApp:* +${apt.candidatePhone}\n` +
          `📅 *Data/Hora:* ${apt.dateStr} às ${apt.timeStr}\n` +
          `📋 *Kanban:* Movido automaticamente para a coluna *"8. Reagendar Entrevista"*`;

        await notifyAdmins(config, alertMsg);
      }
    }

    if (hasUpdates) {
      saveAppointments(appointments);
    }
  } catch (err) {
    log(`[ERRO CHECK FOLLOWUPS] ${err.message}`);
  } finally {
    isCheckingFollowups = false;
  }
}

// ---------------------------------------------------------
// MONITOR DE RESPOSTAS DOS LEADS PARA DISPARO DOS 3 ÁUDIOS E FOLLOW-UPS
// ---------------------------------------------------------
let isCheckingReplies = false;
const processedCol4Replies = new Set();

async function checkReplies(config) {
  if (isCheckingReplies) return;
  isCheckingReplies = true;

  try {
    // 1. CHECAGEM: Leads na Coluna 1 ("1. Novo Lead") que responderam à primeira mensagem
    const col1Query = `
      SELECT t.id AS "ticketId", c.number AS "phone", c.name AS "fullName"
      FROM "Tickets" t
      JOIN "Contacts" c ON c.id = t."contactId"
      JOIN "TicketTags" tt ON tt."ticketId" = t.id AND tt."tagId" = $1
      WHERE t."companyId" = 1 AND t.status != 'closed'
    `;
    const col1Tickets = (await pool.query(col1Query, [TAG_NOVO_LEAD])).rows;

    for (const ticket of col1Tickets) {
      const msgRes = await pool.query(
        `SELECT "fromMe", "createdAt", body FROM "Messages"
         WHERE "ticketId" = $1
         ORDER BY id DESC LIMIT 2`,
        [ticket.ticketId]
      );

      if (msgRes.rows.length === 0) continue;

      const latestMsg = msgRes.rows[0];

      if (!latestMsg.fromMe) {
        log(`[GATILHO DETECTADO] Lead "${ticket.fullName}" (${ticket.phone}) respondeu à 1ª mensagem! Iniciando envio dos 3 áudios.`);

        await setKanbanTag(ticket.ticketId, TAG_AUDIO_ENVIADO);

        await sleep(5000);

        try {
          log(`[ÁUDIO 1] Enviando para ${ticket.fullName}...`);
          await sendWhatsAppAudio(config.apiUrl, config.apiToken, ticket.phone, AUDIO_1);
          log(`[ÁUDIO 1 SUCESSO] Enviado para ${ticket.fullName}!`);
        } catch (e) {
          log(`[ÁUDIO 1 ERRO] ${e.message}`);
        }

        await sleep(7000);

        try {
          log(`[ÁUDIO 2] Enviando para ${ticket.fullName}...`);
          await sendWhatsAppAudio(config.apiUrl, config.apiToken, ticket.phone, AUDIO_2);
          log(`[ÁUDIO 2 SUCESSO] Enviado para ${ticket.fullName}!`);
        } catch (e) {
          log(`[ÁUDIO 2 ERRO] ${e.message}`);
        }

        await sleep(7000);

        try {
          log(`[ÁUDIO 3] Enviando para ${ticket.fullName}...`);
          await sendWhatsAppAudio(config.apiUrl, config.apiToken, ticket.phone, AUDIO_3);
          log(`[ÁUDIO 3 SUCESSO] Enviado para ${ticket.fullName}!`);
        } catch (e) {
          log(`[ÁUDIO 3 ERRO] ${e.message}`);
        }

        log(`[KANBAN ATUALIZADO] Lead "${ticket.fullName}" movido para "2. Respondeu - Áudios Enviados"!`);
        markRemarketingReplied(ticket.phone);
        await sleep(2000);
      }
    }

    // 2. CHECAGEM: Leads na Coluna 2 ("2. Respondeu - Áudios Enviados") que responderam aos áudios
    const col2Query = `
      SELECT t.id AS "ticketId", c.number AS "phone", c.name AS "fullName"
      FROM "Tickets" t
      JOIN "Contacts" c ON c.id = t."contactId"
      JOIN "TicketTags" tt ON tt."ticketId" = t.id AND tt."tagId" = $1
      WHERE t."companyId" = 1 AND t.status != 'closed'
    `;
    const col2Tickets = (await pool.query(col2Query, [TAG_AUDIO_ENVIADO])).rows;

    for (const ticket of col2Tickets) {
      const msgRes = await pool.query(
        `SELECT "fromMe", "createdAt", body FROM "Messages"
         WHERE "ticketId" = $1
         ORDER BY id DESC LIMIT 1`,
        [ticket.ticketId]
      );

      if (msgRes.rows.length === 0) continue;

      const latestMsg = msgRes.rows[0];

      if (!latestMsg.fromMe) {
        log(`[RESPOSTA AOS ÁUDIOS] Lead "${ticket.fullName}" respondeu aos 3 áudios!`);

        await setKanbanTag(ticket.ticketId, TAG_EM_CONVERSA);
        log(`[KANBAN ATUALIZADO] Lead "${ticket.fullName}" movido para "3. Em Conversa"!`);

        const alert =
          `🔔 *Novo Candidato em Conversa!*\n\n` +
          `O lead abaixo respondeu aos seus 3 áudios e está aguardando você:\n\n` +
          `👤 *Nome:* ${ticket.fullName}\n` +
          `📱 *WhatsApp:* +${ticket.phone}\n` +
          `💬 *Resposta do Candidato:* "${latestMsg.body || 'Mensagem de áudio/mídia'}"\n` +
          `📋 *Kanban:* Movido para a coluna "3. Em Conversa"`;

        await notifyAdmins(config, alert);

        await sleep(2000);
      }
    }

    // 3. CHECAGEM: Candidatos na Coluna 4 ("4. Qualificado / Entrevista") que responderam aos Follow-ups ou enviaram e-mail
    const col4Query = `
      SELECT t.id AS "ticketId", t."contactId", c.number AS "phone", c.name AS "fullName", c.email AS "contactEmail"
      FROM "Tickets" t
      JOIN "Contacts" c ON c.id = t."contactId"
      JOIN "TicketTags" tt ON tt."ticketId" = t.id AND tt."tagId" = $1
      WHERE t."companyId" = 1 AND t.status != 'closed'
    `;
    const col4Tickets = (await pool.query(col4Query, [TAG_QUALIFICADO])).rows;

    for (const ticket of col4Tickets) {
      const msgRes = await pool.query(
        `SELECT id, "fromMe", "createdAt", body FROM "Messages"
         WHERE "ticketId" = $1
         ORDER BY id DESC LIMIT 1`,
        [ticket.ticketId]
      );

      if (msgRes.rows.length === 0) continue;
      const latestMsg = msgRes.rows[0];

      if (!latestMsg.fromMe) {
        if (processedCol4Replies.has(latestMsg.id)) continue;
        processedCol4Replies.add(latestMsg.id);

        const appointments = loadAppointments();
        const aptIdx = appointments.findIndex(a => a.ticketId === ticket.ticketId && a.status !== 'cancelado');
        const apt = aptIdx >= 0 ? appointments[aptIdx] : null;

        const bodyRaw = (latestMsg.body || '').trim();
        const body = bodyRaw.toLowerCase();
        const firstName = getFirstName(ticket.fullName);

        // A) DETECÇÃO DE E-MAIL DO CANDIDATO
        const emailRegex = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i;
        const emailMatch = bodyRaw.match(emailRegex);

        if (emailMatch) {
          const detectedEmail = emailMatch[1].toLowerCase();
          log(`[EMAIL DETECTADO NO CHAT] Candidato "${ticket.fullName}" informou: ${detectedEmail}`);

          // 1. Atualiza no PostgreSQL Contacts
          try {
            await pool.query(
              `UPDATE "Contacts" SET email = $1, "updatedAt" = NOW() WHERE id = $2`,
              [detectedEmail, ticket.contactId]
            );
          } catch (errDb) {
            log(`[ERRO BD EMAIL] Falha ao salvar email em Contacts: ${errDb.message}`);
          }

          // 2. Atualiza no agendamento appointments.json
          let eventPatched = false;
          if (apt) {
            apt.candidateEmail = detectedEmail;
            apt.updatedAt = getFormattedDateTime();

            // 3. Se tiver googleEventId, adiciona como convidado oficial com sendUpdates: 'all'
            if (apt.googleEventId) {
              const patchRes = await addAttendeeToCalendarEvent({
                eventId: apt.googleEventId,
                candidateEmail: detectedEmail
              });
              if (patchRes.success) {
                eventPatched = true;
                log(`[GOOGLE CALENDAR SUCESSO] Candidato ${detectedEmail} convidado para o evento ${apt.googleEventId}!`);
              }
            }
            saveAppointments(appointments);
          }

          // 4. Confirmação carinhosa no WhatsApp para o candidato
          const emailConfirmReply =
            `Perfeito, *${firstName}*! ✉️\n\n` +
            `Seu e-mail (*${detectedEmail}*) foi registrado e enviamos o convite oficial da sua entrevista pelo Google Agenda!\n\n` +
            `Você receberá a notificação em seu e-mail e na agenda do seu celular. Nos vemos no Templo! 🏛️`;

          try {
            await sendWhatsApp(config.apiUrl, config.apiToken, ticket.phone, emailConfirmReply);
            log(`[RESPOSTA EMAIL CONFIRMADO] Enviada para ${ticket.fullName}!`);
          } catch (e) {
            log(`[ERRO RESPOSTA EMAIL] ${e.message}`);
          }

          // 5. Notifica os Administradores no WhatsApp
          const adminAlert =
            `📧 *E-mail do Candidato Capturado!*\n\n` +
            `👤 *Candidato:* ${ticket.fullName}\n` +
            `📱 *WhatsApp:* +${ticket.phone}\n` +
            `✉️ *E-mail:* ${detectedEmail}\n` +
            `📅 *Data da Entrevista:* ${apt ? `${apt.dateStr} às ${apt.timeStr}` : 'Agendada'}\n` +
            `🌐 *Google Agenda:* ${eventPatched ? '✅ Convidado adicionado e convite despachado!' : (apt && apt.googleEventId ? '⚠️ Falha ao adicionar no Google' : 'ℹ️ Agendado localmente')}`;

          await notifyAdmins(config, adminAlert);

          const remainingWithoutEmail = bodyRaw.replace(emailMatch[0], '').trim();
          if (remainingWithoutEmail.length < 2) {
            await sleep(2000);
            continue;
          }
        }

        const isCancellation = /\b(2|n[aã]o|reagendar|remarcar|imprevisto|n[aã]o\s+posso|n[aã]o\s+vou|n[aã]o\s+consigo|imposs[ií]vel|outro\s+dia|outra\s+data|cancelar)\b/i.test(body);
        const isConfirmation = /\b(1|sim|confirmo|confirmado|confirmada|vou|estarei|chegando|certeza|a\s+caminho)\b/i.test(body);

        if (isCancellation) {
          log(`[CANCELAMENTO / REAGENDAR] Candidato "${ticket.fullName}" informou que não poderá comparecer!`);

          await setKanbanTag(ticket.ticketId, TAG_REAGENDAR);
          log(`[KANBAN ATUALIZADO] Ticket #${ticket.ticketId} movido para "8. Reagendar Entrevista"!`);

          if (apt) {
            apt.status = 'reagendar';
            apt.lastCandidateResponse = latestMsg.body;
            apt.updatedAt = getFormattedDateTime();
            saveAppointments(appointments);
          }

          const cancelReply =
            `Compreendido, *${firstName}*! Sem problemas.\n\n` +
            `Já registramos seu pedido de reagendamento. Em breve o *Venerável Mestre Biaggio Scomparin* entrará em contato para alinharmos uma nova data e horário para a sua entrevista.\n\n` +
            `Um abraço fraterno!`;

          try {
            await sendWhatsApp(config.apiUrl, config.apiToken, ticket.phone, cancelReply);
            log(`[RESPOSTA REAGENDAMENTO] Enviada para ${ticket.fullName}!`);
          } catch (e) {
            log(`[ERRO RESPOSTA REAGENDAMENTO] ${e.message}`);
          }

          const adminCancelAlert =
            `⚠️ *Atenção: Candidato Solicitou Reagendamento!*\n\n` +
            `👤 *Nome:* ${ticket.fullName}\n` +
            `📱 *WhatsApp:* +${ticket.phone}\n` +
            (apt ? `📅 *Data Original:* ${apt.dateStr} às ${apt.timeStr}\n` : '') +
            `💬 *Resposta do Candidato:* "${latestMsg.body}"\n` +
            `📋 *Kanban:* Movido automaticamente para a coluna *"8. Reagendar Entrevista"*`;

          await notifyAdmins(config, adminCancelAlert);

        } else if (isConfirmation) {
          log(`[CONFIRMAÇÃO PRESENÇA] Candidato "${ticket.fullName}" confirmou presença na entrevista!`);

          if (apt) {
            apt.status = 'confirmado';
            apt.lastCandidateResponse = latestMsg.body;
            apt.updatedAt = getFormattedDateTime();
            saveAppointments(appointments);
          }

          const confirmReply =
            `Excelente, *${firstName}*! Sua presença está confirmada com sucesso.\n\n` +
            `Nos vemos no Templo da Loja Lealdade e Justiça (Rua Paru, 175 - Vila Mazzei). Até breve!`;

          try {
            await sendWhatsApp(config.apiUrl, config.apiToken, ticket.phone, confirmReply);
            log(`[RESPOSTA CONFIRMAÇÃO] Enviada para ${ticket.fullName}!`);
          } catch (e) {
            log(`[ERRO RESPOSTA CONFIRMAÇÃO] ${e.message}`);
          }

          const adminConfirmAlert =
            `✅ *Presença Confirmada pelo Candidato!*\n\n` +
            `👤 *Nome:* ${ticket.fullName}\n` +
            `📱 *WhatsApp:* +${ticket.phone}\n` +
            (apt ? `📅 *Data da Entrevista:* ${apt.dateStr} às ${apt.timeStr}\n` : '') +
            `💬 *Resposta do Candidato:* "${latestMsg.body}"\n` +
            `📋 *Status:* Presença confirmada no Google Calendar / Agenda!`;

          await notifyAdmins(config, adminConfirmAlert);
        }

        await sleep(2000);
      }
    }

  } catch (err) {
    log(`[ERRO RESPOSTAS] ${err.message}`);
  } finally {
    isCheckingReplies = false;
  }
}

// ---------------------------------------------------------
// PROCESSAMENTO DA SALA DE ESPERA HUMANIZADA (4 A 8 MINUTOS)
// ---------------------------------------------------------
let isProcessingScheduled = false;

async function processScheduledLeads(config) {
  if (isProcessingScheduled) return;
  isProcessingScheduled = true;

  try {
    let scheduled = loadScheduled();
    if (scheduled.length === 0) return;

    const now = Date.now();
    const readyIndices = [];

    for (let i = 0; i < scheduled.length; i++) {
      if (now >= scheduled[i].sendAt) {
        readyIndices.push(i);
      }
    }

    if (readyIndices.length === 0) return;

    const startH = (config.workingHours && config.workingHours.startHour) || 8;
    const endH = (config.workingHours && config.workingHours.endHour) || 21;
    const inHours = isWithinWorkingHours(startH, endH);

    for (const idx of readyIndices.reverse()) {
      const item = scheduled.splice(idx, 1)[0];
      saveScheduled(scheduled);

      if (!inHours) {
        const queue = loadQueue();
        queue.push({
          id: item.id,
          fullName: item.fullName,
          firstName: item.firstName,
          phone: item.phone,
          addedAt: getFormattedDateTime()
        });
        saveQueue(queue);
        log(`[SALA DE ESPERA -> FILA NOTURNA] Horário encerrou enquanto "${item.fullName}" aguardava. Movido para fila matinal das 08:00.`);
        continue;
      }

      const { template, variation } = getRandomTemplate(config);
      const saudacao = getGreeting();
      const msg = renderTemplate(template, {
        saudacao,
        fullName: item.fullName,
        firstName: item.firstName,
        phone: item.phone
      });

      log(`[DISPARO HUMANIZADO] Enviando para: ${item.fullName} (${item.phone}) após espera de ${item.delayMinutes} min | Variação [${variation}] | Saudação: "${saudacao}"...`);

      try {
        await sendWhatsApp(config.apiUrl, config.apiToken, item.phone, msg);
        log(`[DISPARO HUMANIZADO SUCESSO] Mensagem entregue com sucesso para ${item.fullName} (${item.phone})!`);
        await sleep(1500);
        await linkTicketToLeadTag(item.phone, item.email);
      } catch (err) {
        log(`[DISPARO HUMANIZADO FALHA] Erro ao enviar para ${item.fullName} (${item.phone}): ${err.message}`);
      }

      await sleep(2000);
    }
  } catch (err) {
    log(`[ERRO SALA DE ESPERA] ${err.message}`);
  } finally {
    isProcessingScheduled = false;
  }
}

// ---------------------------------------------------------
// PROCESSAMENTO DA FILA NOTURNA (08:00 C/ 25 MIN INTERVALO)
// ---------------------------------------------------------
async function processQueue(config) {
  const queue = loadQueue();
  if (queue.length === 0) return;

  const state = loadState();
  const now = Date.now();
  const intervalMs = (config.queueIntervalMinutes || 25) * 60 * 1000;

  const timeSinceLast = now - (state.lastQueueSendTime || 0);

  if (state.lastQueueSendTime !== 0 && timeSinceLast < intervalMs) {
    return;
  }

  const item = queue.shift();
  saveQueue(queue);

  const { template, variation } = getRandomTemplate(config);
  const saudacao = getGreeting();
  const msg = renderTemplate(template, {
    saudacao,
    fullName: item.fullName,
    firstName: item.firstName,
    phone: item.phone
  });

  log(`[FILA] Enviando mensagem da fila para: ${item.fullName} (${item.phone}) | Variação [${variation}] | Saudação: "${saudacao}"...`);

  try {
    await sendWhatsApp(config.apiUrl, config.apiToken, item.phone, msg);
    log(`[FILA SUCESSO] Mensagem enviada para ${item.fullName}! Restam ${queue.length} leads na fila.`);
    state.lastQueueSendTime = Date.now();
    saveState(state);

    await sleep(1500);
    await linkTicketToLeadTag(item.phone, item.email);
  } catch (err) {
    log(`[FILA FALHA] Erro ao enviar lead da fila (${item.fullName}): ${err.message}`);
    state.lastQueueSendTime = Date.now();
    saveState(state);
  }
}

// ---------------------------------------------------------
// MONITORAMENTO DA PLANILHA DO GOOGLE SHEETS
// ---------------------------------------------------------
async function checkSheet() {
  const config = loadConfig();
  if (!config) return;

  const startH = (config.workingHours && config.workingHours.startHour) || 8;
  const endH = (config.workingHours && config.workingHours.endHour) || 21;
  const inHours = isWithinWorkingHours(startH, endH);

  const state = loadState();

  if (inHours && state.wasOutside) {
    log(`[HORÁRIO COMERCIAL INICIADO] 08:00 atingido! Iniciando processamento da fila de contatos acumulados.`);
    state.lastQueueSendTime = 0;
    state.wasOutside = false;
    saveState(state);
  } else if (!inHours && !state.wasOutside) {
    log(`[HORÁRIO COMERCIAL ENCERRADO] Fora do horário comercial (08h às 21h). Novos leads serão enfileirados.`);
    state.wasOutside = true;
    saveState(state);
  }

  if (inHours) {
    await processQueue(config);
  }

  try {
    const res = await fetch(config.sheetUrl, { headers: { 'User-Agent': 'LeadWatcher/1.0' } });
    if (!res.ok) {
      log(`[ERRO] Falha ao baixar planilha: HTTP ${res.status}`);
      return;
    }

    const csvText = await res.text();
    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    // Sincroniza retroativamente os e-mails da planilha com a tabela Contacts
    for (const r of records) {
      const p = sanitizePhone(r['número_do_whatsapp'] || r['whatsapp'] || r['telefone'] || r['phone']);
      const em = (r['email'] || r['e-mail'] || r['Email'] || '').trim().toLowerCase();
      if (p && em && em.includes('@')) {
        await pool.query(
          `UPDATE "Contacts" SET email = $1, "updatedAt" = NOW() 
           WHERE number = $2 AND (email IS NULL OR email = '')`,
          [em, p]
        ).catch(() => {});
      }
    }

    let processed = loadProcessed();

    if (processed === null) {
      processed = new Set();
      for (const row of records) {
        if (row.id) {
          processed.add(row.id.trim());
        }
      }
      saveProcessed(processed);
      log(`[INICIALIZAÇÃO] ${processed.size} leads existentes na planilha foram catalogados.`);
      log(`[INICIALIZAÇÃO] Monitorando apenas novos leads a partir de agora.`);
      return;
    }

    const newLeads = [];
    for (const row of records) {
      const id = row.id ? row.id.trim() : null;
      if (!id) continue;

      if (!processed.has(id)) {
        newLeads.push(row);
      }
    }

    if (newLeads.length > 0) {
      log(`[INFO] Detectado(s) ${newLeads.length} novo(s) lead(s) na planilha!`);
    }

    for (const lead of newLeads) {
      const id = lead.id.trim();
      const rawPhone = lead['número_do_whatsapp'] || lead['whatsapp'] || lead['telefone'] || lead['phone'];
      const fullName = (lead['nome'] || lead['full_name'] || lead['name'] || 'Candidato').trim();
      const rawEmail = (lead['email'] || lead['e-mail'] || lead['Email'] || '').trim().toLowerCase();
      const firstName = getFirstName(fullName);
      const phone = sanitizePhone(rawPhone);

      if (!phone) {
        log(`[AVISO] Lead "${fullName}" sem telefone válido (${rawPhone}). Ignorando.`);
        processed.add(id);
        saveProcessed(processed);
        continue;
      }

      // Detecção de Gênero
      if (config.filterFemale) {
        const genderInfo = await detectGender(firstName);
        if (genderInfo.gender === 'F') {
          log(`[FILTRO DE GÊNERO] Lead "${fullName}" identificado como FEMININO (${genderInfo.source}).`);

          await createFemaleLeadCard(fullName, phone, lead);

          const adminAlert =
            `⚠️ *Lead Feminino Cadastrado (Sem Disparo)*\n\n` +
            `Uma interessada preencheu o formulário de anúncio:\n\n` +
            `👤 *Nome:* ${fullName}\n` +
            `📱 *WhatsApp:* +${phone}\n` +
            `📋 *Campanha:* ${lead.campaign_name || 'N/A'}\n` +
            `📑 *Kanban:* Coluna "6. Leads Femininos (Sem Disparo)"\n` +
            `🕒 *Horário:* ${getFormattedDateTime()}`;

          await notifyAdmins(config, adminAlert);

          processed.add(id);
          saveProcessed(processed);
          continue;
        }
      }

      // Lead Masculino:
      if (!inHours) {
        const queue = loadQueue();
        queue.push({
          id,
          fullName,
          firstName,
          phone,
          email: rawEmail,
          addedAt: getFormattedDateTime()
        });
        saveQueue(queue);

        processed.add(id);
        saveProcessed(processed);

        log(`[FILA NOTURNA] Lead "${fullName}" (${phone}) recebido às ${getFormattedDateTime()} (fora do horário comercial).`);
        log(`[FILA NOTURNA] Guardado na fila com sucesso! Total acumulado: ${queue.length}. Disparos iniciarão às 08:00 com intervalo de 25 min.`);
      } else {
        const queue = loadQueue();

        if (queue.length > 0) {
          queue.push({
            id,
            fullName,
            firstName,
            phone,
            email: rawEmail,
            addedAt: getFormattedDateTime()
          });
          saveQueue(queue);
          processed.add(id);
          saveProcessed(processed);
          log(`[FILA ATIVA] Lead "${fullName}" adicionado ao final da fila existente (${queue.length} na fila).`);
        } else {
          const minMin = (config.humanDelay && config.humanDelay.minMinutes) || 4;
          const maxMin = (config.humanDelay && config.humanDelay.maxMinutes) || 8;
          const minSec = minMin * 60;
          const maxSec = maxMin * 60;
          const randomSeconds = Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec;
          const sendAt = Date.now() + randomSeconds * 1000;
          const delayMinutes = (randomSeconds / 60).toFixed(1);
          const sendTimeStr = new Date(sendAt).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' });

          const scheduled = loadScheduled();
          scheduled.push({
            id,
            fullName,
            firstName,
            phone,
            email: rawEmail,
            sendAt,
            delaySeconds: randomSeconds,
            delayMinutes,
            addedAt: getFormattedDateTime()
          });
          saveScheduled(scheduled);

          processed.add(id);
          saveProcessed(processed);

          log(`[SALA DE ESPERA HUMANIZADA] Novo lead "${fullName}" (${phone}) agendado para envio em ${delayMinutes} min (às ${sendTimeStr}). Simulação 100% natural ativada.`);
        }
      }
    }

  } catch (err) {
    log(`[ERRO NO CICLO] ${err.message}`);
  }
}

// ---------------------------------------------------------
// LOOP PRINCIPAL
// ---------------------------------------------------------
async function main() {
  log(`====================================================`);
  log(`  ROBÔ MONITOR DE LEADS COM KANBAN E 3 ÁUDIOS       `);
  log(`  MODO HUMANIZADO ATIVO (ESPERA DE 4 A 8 MINUTOS)   `);
  log(`  MÓDULO GOOGLE AGENDA (#agendar) E FOLLOW-UPS ON   `);
  log(`====================================================`);

  await checkSheet();

  const config = loadConfig() || { checkIntervalSeconds: 30 };
  await syncMissingCalendarAttendees(config);

  // Inicializa fila de remarketing masculino da base histórica
  if (config && config.sheetUrl) {
    await syncRemarketingQueue(config.sheetUrl, getAdminNotifyNumbers(config));
  }

  const intervalMs = (config.checkIntervalSeconds || 30) * 1000;

  // Checa planilha a cada 30 segundos
  setInterval(async () => {
    await checkSheet();
  }, intervalMs);

  // Monitora e despacha leads da Sala de Espera Humanizada a cada 10 segundos
  setInterval(async () => {
    const cfg = loadConfig();
    if (cfg) {
      await processScheduledLeads(cfg);
    }
  }, 10000);

  // Monitora respostas dos leads a cada 10 segundos para disparar áudios e follow-ups
  setInterval(async () => {
    const cfg = loadConfig();
    if (cfg) {
      await checkReplies(cfg);
    }
  }, 10000);

  // Monitora comandos do administrador (#agendar) a cada 5 segundos
  setInterval(async () => {
    const cfg = loadConfig();
    if (cfg) {
      await checkAdminCommands(cfg);
    }
  }, 5000);

  // Sincroniza convidados pendentes no Google Agenda a cada 30 segundos
  setInterval(async () => {
    const cfg = loadConfig();
    if (cfg) {
      await syncMissingCalendarAttendees(cfg);
    }
  }, 30000);

  // Monitora e despacha lote de remarketing a cada 30 segundos (respeitando limite diário e pausas)
  setInterval(async () => {
    const cfg = loadConfig();
    if (cfg) {
      await processRemarketingDispatch(cfg, sendWhatsApp, linkTicketToLeadTag);
    }
  }, 30000);

  // Monitora follow-ups matinais e lembretes 45 min antes a cada 30 segundos
  setInterval(async () => {
    const cfg = loadConfig();
    if (cfg) {
      await checkAppointmentFollowups(cfg);
    }
  }, 30000);
}

main();

// Inicia API do Funil de Leads
require('./api.js');
