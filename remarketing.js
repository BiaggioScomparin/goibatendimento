const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { detectGender } = require('./gender.js');

const QUEUE_PATH = path.join(__dirname, 'remarketing_queue.json');
const STATE_PATH = path.join(__dirname, 'remarketing_state.json');
const LOG_FILE = path.join(__dirname, 'watcher.log');

const REMARKETING_TEMPLATES = [
  // Modelo 1 — Retomada Respeitosa e Consulta de Interesse
  "{{saudacao}}, {{primeiro_nome}}. Como você está?\n\nAqui é o Venerável Mestre Biaggio Scomparin, da Loja Maçônica Lealdade e Justiça nº 001 - GOIB.\n\nEstou revisando nossa relação de interessados que preencheram o cadastro para ingresso na Ordem Maçônica em São Paulo. Gostaria de saber se você ainda mantém o interesse em conhecer nossos trabalhos e realizar uma conversa pessoal conosco no Templo?",

  // Modelo 2 — Abertura de Novo Ciclo de Entrevistas no Templo
  "Olá, {{primeiro_nome}}, {{saudacao}}! Tudo bem?\n\nSou o Venerável Biaggio Scomparin. Estamos iniciando um novo ciclo de entrevistas presenciais para homens livres e de bons costumes em nossa Loja Maçônica (na região da Zona Norte de SP).\n\nComo você havia manifestado intenção anteriormente, gostaria de verificar se tem disponibilidade e interesse em agendar um encontro fraterno nesta semana.",

  // Modelo 3 — Abordagem Direta e Fraterna
  "{{saudacao}}, {{primeiro_nome}}, tudo em paz por aí?\n\nAqui é o Venerável Biaggio Scomparin. Vi em meus registros que você buscou informações sobre a Maçonaria algum tempo atrás.\n\nGostaria de saber se seu propósito em ingressar na Sublime Instituição continua vivo, ou se ficou com alguma dúvida sobre o funcionamento da nossa Ordem que eu possa esclarecer?",

  // Modelo 4 — Contato Pessoal e Consulta Rápida
  "Olá, {{primeiro_nome}}! {{saudacao}}.\n\nPassando brevemente para conversar com você. Sou o Venerável Mestre Biaggio Scomparin, da Loja Lealdade e Justiça (GOIB).\n\nOrganizamos nosso quadro de visitantes para este próximo período. Você ainda reside em São Paulo e mantém o desejo de dar sequência ao seu processo de admissão na Maçonaria?",

  // Modelo 5 — Foco em Propósito e Filosofia
  "{{saudacao}}, {{primeiro_nome}}, como vão as coisas?\n\nAqui é o Venerável Biaggio Scomparin. A busca pelo aperfeiçoamento moral, filosófico e espiritual é o pilar que une os membros da Maçonaria.\n\nLembrei do seu contato e gostaria de saber se você gostaria de bater um papo para entender melhor como funciona a nossa Loja aqui na capital. Um abraço fraterno!",

  // Modelo 6 — Tom Informal e Próximo
  "Oi, {{primeiro_nome}}, {{saudacao}}! Tudo bem com você e sua família?\n\nAqui é o Venerável Biaggio Scomparin. Estava revendo algumas conversas e cadastros de irmãos e interessados que ficaram pendentes.\n\nSe ainda fizer sentido para você conhecer mais de perto a Maçonaria, me avise por aqui para alinharmos um horário presencial em nosso Templo.",

  // Modelo 7 — Mensagem Curta e Objetiva (Alta Taxa de Resposta)
  "{{saudacao}}, {{primeiro_nome}}! Aqui é o Venerável Biaggio Scomparin.\n\nVocê ainda tem interesse em ingressar na Maçonaria e agendar uma entrevista presencial em nossa Loja em São Paulo?",

  // Modelo 8 — Esclarecimento de Dúvidas sobre Ingresso
  "Olá, {{primeiro_nome}}, {{saudacao}}!\n\nSou o Venerável Mestre Biaggio Scomparin. Sei que muitas vezes o candidato tem dúvidas sobre os pré-requisitos, costumes e compromissos maçônicos antes de dar o primeiro passo.\n\nCaso queira tirar alguma dúvida ou entender os próximos passos para o ingresso na Loja Lealdade e Justiça, estou à disposição por aqui.",

  // Modelo 9 — Atualização Cadastral e Triagem
  "{{saudacao}}, {{primeiro_nome}}. Espero que esteja bem!\n\nAqui é o Venerável Biaggio Scomparin. Estamos atualizando as candidaturas recebidas para a Loja Maçônica Lealdade e Justiça (Vila Mazzei, SP).\n\nPara mantermos seu contato ativo em nossa lista de candidatos prioritários, por favor me confirme se ainda deseja ser convidado para a entrevista.",

  // Modelo 10 — Acolhedor e Convidativo
  "{{saudacao}}, {{primeiro_nome}}! Tudo certo?\n\nAqui é o Venerável Biaggio Scomparin. Gostaria de estender novamente a você a oportunidade de conhecer de perto a nossa tradição maçônica e os valores que praticamos em nossa Loja.\n\nSe tiver interesse em nos visitar e conversarmos pessoalmente, responda esta mensagem para combinarmos. Um abraço!"
];

function log(msg) {
  const now = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const line = `[${now}] [REMARKETING] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + '\n', 'utf-8');
  } catch (e) {}
}

function sanitizePhone(raw) {
  if (!raw) return null;
  let clean = raw.replace(/\D/g, '');
  if (clean.length === 10 || clean.length === 11) clean = '55' + clean;
  if (clean.length === 12 || clean.length === 13) return clean;
  return null;
}

function getFirstName(fullName) {
  if (!fullName) return 'Candidato';
  return fullName.trim().split(/\s+/)[0];
}

function getGreeting() {
  const now = new Date();
  const hourStr = now.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false });
  const hour = parseInt(hourStr, 10);
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

function getTodaySpDate() {
  return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

function loadState() {
  const defaultState = {
    enabled: false,
    dailyLimit: 50,
    todaySent: 0,
    totalSent: 0,
    repliedCount: 0,
    minIntervalMinutes: 9,
    maxIntervalMinutes: 18,
    batchPauseEvery: 8,
    batchPauseDurationMinutes: 40,
    batchCount: 0,
    startHour: 9,
    startMinute: 30,
    endHour: 20,
    endMinute: 30,
    lastSentDate: getTodaySpDate(),
    lastSentTimestamp: 0,
    nextAllowedSendTime: 0
  };

  try {
    if (fs.existsSync(STATE_PATH)) {
      const data = JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
      return { ...defaultState, ...data };
    }
  } catch (err) {
    log(`[ERRO] Falha ao carregar remarketing_state.json: ${err.message}`);
  }
  return defaultState;
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
  } catch (err) {
    log(`[ERRO] Falha ao salvar remarketing_state.json: ${err.message}`);
  }
}

function loadQueue() {
  try {
    if (fs.existsSync(QUEUE_PATH)) {
      return JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf-8'));
    }
  } catch (err) {
    log(`[ERRO] Falha ao carregar remarketing_queue.json: ${err.message}`);
  }
  return [];
}

function saveQueue(queue) {
  try {
    fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2), 'utf-8');
  } catch (err) {
    log(`[ERRO] Falha ao salvar remarketing_queue.json: ${err.message}`);
  }
}

function isWithinActiveHours(state) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour12: false });
  const [h, m] = timeStr.split(':').map(n => parseInt(n, 10));
  const curMinutes = h * 60 + m;

  const startMinutes = (state.startHour || 9) * 60 + (state.startMinute || 30);
  const endMinutes = (state.endHour || 20) * 60 + (state.endMinute || 30);

  return curMinutes >= startMinutes && curMinutes <= endMinutes;
}

function isAdminPhone(phone, adminPhones) {
  const defaultAdmins = ['5511984736679', '5511982599289'];
  if (defaultAdmins.includes(phone)) return true;
  if (!adminPhones) return false;
  if (Array.isArray(adminPhones)) {
    return adminPhones.some(a => String(a).replace(/\D/g, '') === phone);
  }
  return String(adminPhones).includes(phone);
}

// Sincroniza e monta a fila de contatos a partir da planilha (100% livre de mulheres)
async function syncRemarketingQueue(sheetUrl, adminPhones) {
  try {
    log(`[SINCRONIZAÇÃO] Baixando planilha e processando base para remarketing...`);
    const res = await fetch(sheetUrl, { headers: { 'User-Agent': 'LeadWatcher/1.0' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const csvText = await res.text();
    const records = parse(csvText, { columns: true, skip_empty_lines: true, trim: true });

    let existingQueue = loadQueue();
    const existingPhones = new Set(existingQueue.map(item => item.phone));

    let addedCount = 0;
    let femaleFiltered = 0;
    let duplicateOrInvalid = 0;

    for (const row of records) {
      const rawPhone = row['número_do_whatsapp'] || row['whatsapp'] || row['telefone'] || row['phone'];
      const phone = sanitizePhone(rawPhone);
      if (!phone || isAdminPhone(phone, adminPhones)) {
        duplicateOrInvalid++;
        continue;
      }

      if (existingPhones.has(phone)) {
        continue;
      }

      const fullName = (row['nome'] || row['full_name'] || row['name'] || 'Candidato').trim();
      const firstName = getFirstName(fullName);
      const email = (row['email'] || row['e-mail'] || row['Email'] || '').trim().toLowerCase();

      // 100% RIGOROSO: Filtra mulheres
      const genderInfo = await detectGender(firstName);
      if (genderInfo.gender === 'F') {
        femaleFiltered++;
        continue;
      }

      existingPhones.add(phone);
      existingQueue.push({
        id: row.id || `lead_${phone}`,
        fullName,
        firstName,
        phone,
        email: email.includes('@') ? email : '',
        status: 'pending', // 'pending' | 'sent' | 'replied' | 'failed'
        templateIndex: null,
        sentAt: null,
        repliedAt: null,
        addedAt: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
      });
      addedCount++;
    }

    saveQueue(existingQueue);
    log(`[SINCRONIZAÇÃO CONCLUÍDA] Total na fila: ${existingQueue.length} homens | Novos adicionados: ${addedCount} | Mulheres descartadas: ${femaleFiltered}`);
    return {
      total: existingQueue.length,
      added: addedCount,
      femaleFiltered
    };
  } catch (err) {
    log(`[ERRO SINCRONIZAÇÃO] ${err.message}`);
    return { error: err.message };
  }
}

// Loop principal de disparo humanizado com blindagem anti-ban
let isDispatching = false;
async function processRemarketingDispatch(config, sendWhatsApp, linkTicketToLeadTag) {
  if (isDispatching) return;
  isDispatching = true;

  try {
    const state = loadState();
    if (!state.enabled) return;

    // Checa se o dia virou no fuso horário de SP para resetar o contador diário
    const todaySp = getTodaySpDate();
    if (state.lastSentDate !== todaySp) {
      state.todaySent = 0;
      state.lastSentDate = todaySp;
      state.batchCount = 0;
      saveState(state);
      log(`[NOVO DIA] Contador diário de remarketing reiniciado para 0/${state.dailyLimit}.`);
    }

    // 1. Checa limite diário
    if (state.todaySent >= state.dailyLimit) {
      return;
    }

    // 2. Checa janela de horário comercial seguro (09:30 às 20:30)
    if (!isWithinActiveHours(state)) {
      return;
    }

    // 3. Checa intervalo mínimo obrigatório (anti-ban jitter)
    const now = Date.now();
    if (now < (state.nextAllowedSendTime || 0)) {
      return;
    }

    // 4. Carrega fila e localiza próximo lead pendente
    const queue = loadQueue();
    const nextIdx = queue.findIndex(item => item.status === 'pending');
    if (nextIdx === -1) {
      return; // Todos enviados!
    }

    const lead = queue[nextIdx];

    // 5. Seleciona 1 dos 10 modelos aprovados de forma aleatória e balanceada
    const templateIdx = Math.floor(Math.random() * REMARKETING_TEMPLATES.length);
    const templateRaw = REMARKETING_TEMPLATES[templateIdx];
    const saudacao = getGreeting();

    const message = templateRaw
      .replace(/\{\{\s*saudacao\s*\}\}/gi, saudacao)
      .replace(/\{\{\s*primeiro_nome\s*\}\}/gi, lead.firstName)
      .replace(/\{\{\s*nome\s*\}\}/gi, lead.fullName);

    log(`[DISPARO REMARKETING] Enviando Modelo ${templateIdx + 1} para: ${lead.fullName} (${lead.phone}) | Hoje: ${state.todaySent + 1}/${state.dailyLimit}...`);

    try {
      await sendWhatsApp(config.apiUrl, config.apiToken, lead.phone, message);

      lead.status = 'sent';
      lead.templateIndex = templateIdx + 1;
      lead.sentAt = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      saveQueue(queue);

      state.todaySent++;
      state.totalSent++;
      state.lastSentTimestamp = Date.now();
      state.batchCount++;

      // Cria/Posiciona Ticket no Kanban na Coluna 1 ("1. Novo Lead")
      // IMPORTANTE: Ao responder, o Whaticket dispara os 3 áudios automaticamente seguindo o fluxo nativo!
      await new Promise(r => setTimeout(r, 1500));
      await linkTicketToLeadTag(lead.phone, lead.email);

      // 6. Cálculo do próximo intervalo dinâmico (Anti-Ban Jitter + Pausa de Café)
      let waitMinutes = 0;
      if (state.batchCount >= (state.batchPauseEvery || 8)) {
        // Pausa humana natural de descanso (35 a 55 minutos)
        waitMinutes = Math.floor(Math.random() * 20) + 35;
        state.batchCount = 0;
        log(`[PAUSA HUMANA ANTI-BAN] Lote de 8 mensagens concluído! Pausa de ${waitMinutes} minutos ativada.`);
      } else {
        // Intervalo dinâmico entre mensagens (9 a 18 minutos)
        const minM = state.minIntervalMinutes || 9;
        const maxM = state.maxIntervalMinutes || 18;
        waitMinutes = Math.floor(Math.random() * (maxM - minM + 1)) + minM;
        log(`[ANTI-BAN JITTER] Mensagem entregue com sucesso! Próximo envio programado para daqui a ${waitMinutes} min.`);
      }

      state.nextAllowedSendTime = Date.now() + waitMinutes * 60 * 1000;
      saveState(state);

    } catch (err) {
      log(`[FALHA DISPARO] Erro ao enviar para ${lead.fullName} (${lead.phone}): ${err.message}`);
      lead.status = 'failed';
      lead.error = err.message;
      saveQueue(queue);

      // Em caso de falha, espera 5 minutos antes de tentar o próximo
      state.nextAllowedSendTime = Date.now() + 5 * 60 * 1000;
      saveState(state);
    }

  } catch (err) {
    log(`[ERRO CICLO REMARKETING] ${err.message}`);
  } finally {
    isDispatching = false;
  }
}

// Marca um contato como "replied" quando ele responde e recebe os áudios
function markRemarketingReplied(phone) {
  try {
    const queue = loadQueue();
    const item = queue.find(q => q.phone === phone);
    if (item && item.status !== 'replied') {
      item.status = 'replied';
      item.repliedAt = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
      saveQueue(queue);

      const state = loadState();
      state.repliedCount = (state.repliedCount || 0) + 1;
      saveState(state);
      log(`[REMARKETING ENGAJADO] Contato ${item.fullName} (${phone}) respondeu à mensagem de remarketing e recebeu os 3 áudios!`);
    }
  } catch (e) {}
}

function getRemarketingData() {
  const state = loadState();
  const queue = loadQueue();

  const total = queue.length;
  const sent = queue.filter(q => q.status === 'sent' || q.status === 'replied').length;
  const pending = queue.filter(q => q.status === 'pending').length;
  const replied = queue.filter(q => q.status === 'replied').length;
  const failed = queue.filter(q => q.status === 'failed').length;

  let nextSendInMinutes = null;
  if (state.nextAllowedSendTime && state.nextAllowedSendTime > Date.now()) {
    nextSendInMinutes = Math.ceil((state.nextAllowedSendTime - Date.now()) / 60000);
  }

  const recentSent = queue
    .filter(q => q.status === 'sent' || q.status === 'replied')
    .slice(-15)
    .reverse();

  return {
    state: {
      ...state,
      nextSendInMinutes,
      isWithinHours: isWithinActiveHours(state)
    },
    counts: {
      total,
      sent,
      pending,
      replied,
      failed
    },
    templates: REMARKETING_TEMPLATES,
    recentSent
  };
}

function toggleRemarketing(enabled) {
  const state = loadState();
  state.enabled = Boolean(enabled);
  if (state.enabled && (!state.nextAllowedSendTime || state.nextAllowedSendTime < Date.now())) {
    state.nextAllowedSendTime = Date.now() + 10000; // Começa em 10 segundos
  }
  saveState(state);
  log(`[REMARKETING STATUS] Sistema ${state.enabled ? 'ATIVADO' : 'PAUSADO'} pelo painel.`);
  return state;
}

function updateRemarketingConfig(newCfg) {
  const state = loadState();
  if (newCfg.dailyLimit !== undefined) state.dailyLimit = parseInt(newCfg.dailyLimit, 10);
  if (newCfg.minIntervalMinutes !== undefined) state.minIntervalMinutes = parseInt(newCfg.minIntervalMinutes, 10);
  if (newCfg.maxIntervalMinutes !== undefined) state.maxIntervalMinutes = parseInt(newCfg.maxIntervalMinutes, 10);
  if (newCfg.startHour !== undefined) state.startHour = parseInt(newCfg.startHour, 10);
  if (newCfg.startMinute !== undefined) state.startMinute = parseInt(newCfg.startMinute, 10);
  if (newCfg.endHour !== undefined) state.endHour = parseInt(newCfg.endHour, 10);
  if (newCfg.endMinute !== undefined) state.endMinute = parseInt(newCfg.endMinute, 10);
  saveState(state);
  log(`[CONFIGURAÇÃO ATUALIZADA] Limite diário: ${state.dailyLimit} | Intervalos: ${state.minIntervalMinutes}-${state.maxIntervalMinutes}m`);
  return state;
}

module.exports = {
  syncRemarketingQueue,
  processRemarketingDispatch,
  markRemarketingReplied,
  getRemarketingData,
  toggleRemarketing,
  updateRemarketingConfig,
  REMARKETING_TEMPLATES
};
