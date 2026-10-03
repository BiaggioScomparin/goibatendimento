const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const CREDENTIALS_PATH = path.join(__dirname, 'google_credentials.json');
const CONFIG_PATH = path.join(__dirname, 'config.json');

function getCalendarClient() {
  try {
    if (!fs.existsSync(CREDENTIALS_PATH)) {
      return null;
    }

    const key = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));

    // Suporta Service Account
    if (key.type === 'service_account') {
      const jwtClient = new google.auth.JWT(
        key.client_email,
        null,
        key.private_key,
        ['https://www.googleapis.com/auth/calendar']
      );
      return google.calendar({ version: 'v3', auth: jwtClient });
    }

    // Suporta OAuth2
    if (key.type === 'oauth2' || (key.client_id && key.client_secret && key.refresh_token)) {
      const oauth2Client = new google.auth.OAuth2(
        key.client_id,
        key.client_secret,
        'https://app.7now.xyz/funnel-api/auth/google/callback'
      );
      oauth2Client.setCredentials({ refresh_token: key.refresh_token });
      return google.calendar({ version: 'v3', auth: oauth2Client });
    }
  } catch (err) {
    console.error(`[CALENDAR AUTH ERROR] ${err.message}`);
  }
  return null;
}

async function createCalendarEvent(params) {
  const {
    candidateName,
    candidatePhone,
    candidateEmail,
    startDateTime,
    endDateTime,
    location,
    copyEmail,
    notes
  } = params;

  const calendar = getCalendarClient();
  if (!calendar) {
    console.log(`[GOOGLE CALENDAR] Credenciais do Google Calendar ainda não configuradas. Agendamento registrado localmente.`);
    return { success: false, reason: 'credentials_missing' };
  }

  const attendees = [];
  if (copyEmail && copyEmail.includes('@')) {
    attendees.push({ email: copyEmail });
  }
  if (candidateEmail && candidateEmail.includes('@')) {
    attendees.push({ email: candidateEmail });
  }

  const event = {
    summary: `Entrevista Maçonaria — ${candidateName}`,
    location: location || 'Rua Paru, 175 - Vila Mazzei, São Paulo - SP, 02310-200',
    description: `👤 Candidato: ${candidateName}\n📱 WhatsApp: +${candidatePhone}\n📍 Local: Templo da Loja Maçônica Lealdade e Justiça nº 001 - GOIB\n🏛️ Venerável Mestre Biaggio Scomparin\n\n${notes || ''}`,
    start: {
      dateTime: startDateTime,
      timeZone: 'America/Sao_Paulo'
    },
    end: {
      dateTime: endDateTime,
      timeZone: 'America/Sao_Paulo'
    },
    attendees: attendees,
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 24 * 60 },
        { method: 'popup', minutes: 60 }
      ]
    }
  };

  try {
    const res = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: event,
      sendUpdates: 'all' // Dispara email de convite para os convidados
    });
    console.log(`[GOOGLE CALENDAR SUCESSO] Evento criado em "primary": ${res.data.htmlLink}`);
    return {
      success: true,
      eventId: res.data.id,
      htmlLink: res.data.htmlLink
    };
  } catch (err) {
    console.error(`[GOOGLE CALENDAR ERRO] Falha ao criar evento: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function addAttendeeToCalendarEvent(params) {
  const { eventId, candidateEmail } = params;
  if (!eventId || !candidateEmail || !candidateEmail.includes('@')) {
    return { success: false, reason: 'invalid_params' };
  }

  const calendar = getCalendarClient();
  if (!calendar) return { success: false, reason: 'no_calendar' };

  try {
    const event = await calendar.events.get({
      calendarId: 'primary',
      eventId: eventId
    });

    const attendees = event.data.attendees || [];
    if (!attendees.some(a => a.email && a.email.toLowerCase() === candidateEmail.toLowerCase())) {
      attendees.push({ email: candidateEmail });
    }

    const res = await calendar.events.patch({
      calendarId: 'primary',
      eventId: eventId,
      requestBody: { attendees },
      sendUpdates: 'all' // Google envia o convite formal por e-mail para o candidato
    });

    console.log(`[GOOGLE CALENDAR] Convidado ${candidateEmail} adicionado com sucesso ao evento ${eventId}!`);
    return { success: true, htmlLink: res.data.htmlLink };
  } catch (err) {
    console.error(`[GOOGLE CALENDAR ERRO] Falha ao adicionar convidado ${candidateEmail}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

module.exports = {
  createCalendarEvent,
  addAttendeeToCalendarEvent,
  getCalendarClient
};
