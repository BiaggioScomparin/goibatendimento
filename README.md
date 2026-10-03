# 🏛️ GOIB Atendimento — Automação de Funil de Leads, Whaticket & Google Calendar

Sistema integrado de atendimento e qualificação de candidatos para a **Augusta e Respeitável Loja Simbólica Lealdade e Justiça nº 001 — GOIB** (São Paulo/SP).

Desenvolvido para operar em conjunto com a plataforma **Whaticket / Baileys**, orquestrando todo o ciclo de vida do candidato desde a captura do lead no Google Sheets até a entrevista presencial no Templo.

---

## 🚀 Principais Funcionalidades

### 1. ⏱️ Sala de Espera Humanizada (Anti-Robô)
- Aguarda um intervalo aleatório e natural de **4 a 8 minutos** antes de enviar a primeira mensagem após o preenchimento do formulário.
- Evita a sensação de robô imediato e reduz riscos de denúncia no WhatsApp.
- Rotação de 3 variações de mensagens iniciais com saudação dinâmica (*Bom dia / Boa tarde / Boa noite*).

### 2. 🎙️ Sequência Automatizada de 3 Áudios (Gravados ao Vivo / PTT)
- Quando o candidato responde à primeira mensagem, o robô move o ticket para a coluna **"2. Respondeu - Áudios Enviados"** e despacha 3 notas de voz sequenciais gravadas pelo Venerável Mestre Biaggio Scomparin.
- Os áudios são enviados no formato nativo `audio/ogg; codecs=opus` com a tag PTT (*Push-to-Talk*), aparecendo com o microfone verde oficial do WhatsApp.
- Quando o candidato responde aos áudios, o card é movido automaticamente para **"3. Em Conversa"** e ambos os administradores são notificados.

### 3. 📅 Agendamento Inteligente com Google Calendar (`#agendar`)
- No próprio chat do candidato dentro do Whaticket, o administrador digita:
  ```text
  #agendar 05/10/2026 14:00
  ```
- O robô:
  1. Cria o evento oficial no **Google Agenda**.
  2. Adiciona o e-mail do candidato como convidado oficial.
  3. Envia convite em cópia fixa para `srzambrini@gmail.com`.
  4. Move o lead para a coluna **"4. Qualificado / Entrevista"**.
  5. Envia confirmação com endereço completo (*Rua Paru, 175 - Vila Mazzei*) para o candidato e notifica os administradores.

### 4. ⏰ Follow-ups de Confirmação de Entrevista
- **Véspera (D-1 às 18:00):** Mensagem de confirmação com opções rápidas (1 para confirmar, 2 para reagendar).
- **Dia da Entrevista (D-0, 2 horas antes):** Lembrete com endereço.
- **Tratamento de Resposta:**
  - Se confirma: marca status como confirmado e alerta admins.
  - Se cancela/pede reagendamento: move o ticket para **"8. Reagendar Entrevista"** e alerta admins.
  - Se não confirma até o horário: move automaticamente para reagendamento.

### 5. 🛡️ Filtro de Gênero IBGE (100% Masculino)
- Utiliza a base do Censo do IBGE (`gender.js`) para identificar nomes femininos.
- Leads femininos são automaticamente direcionados para a coluna **"6. Leads Femininos (Sem Disparo)"** sem envio de WhatsApp, com alerta administrativo imediato.

### 6. 📢 Motor de Remarketing Anti-Ban da Base Histórica
- Parser automático da base de ~1.300 contatos masculinos antigos.
- Rotação de **10 modelos de mensagem** fraternos aprovados.
- **Blindagem Anti-Ban:**
  - Janela de horário comercial seguro: **09:30 às 20:30**.
  - Intervalo dinâmico entre envios: **9 a 18 minutos**.
  - Pausa humana de descanso: **40 minutos a cada 8 disparos**.
  - Limite diário parametrizável (padrão: 50 envios/dia).
- **Conexão Nativa com o Funil de Áudios:** Quando um contato de remarketing responde, ele entra no fluxo dos 3 áudios exatamente como um novo lead.

### 7. 📲 Notificações Multi-Administrador
Todas as notificações críticas do sistema são despachadas simultaneamente para ambos os números de administração cadastrados:
- `+55 11 98473-6679`
- `+55 11 98259-9289`

### 8. 📊 Painel Web do Funil de Leads
- Dashboard web responsivo disponível em `/lead-funnel`.
- Acompanhamento em tempo real dos status do Kanban, métricas do remarketing, botão de Iniciar/Pausar envios e histórico de disparos recentes.

---

## 📁 Estrutura do Repositório

```text
├── watcher.js            # Serviço central de monitoramento, áudios, follow-ups e comandos
├── remarketing.js        # Motor de remarketing anti-ban com 10 modelos de mensagem
├── calendar.js           # Módulo de integração direta com a API Google Calendar
├── gender.js             # Módulo de classificação de gênero baseado no IBGE
├── api.js                # Servidor Express com rotas REST para o painel web
├── public/
│   └── index.html        # Frontend SPA do Painel do Funil de Leads
├── config.example.json   # Modelo do arquivo de configuração (sem credenciais)
├── test_admin_notify.js  # Script de validação de entrega para administradores
└── README.md             # Esta documentação
```

---

## ⚙️ Instalação e Execução no Servidor

### Pré-requisitos
- Node.js 18+ instalado
- PostgreSQL rodando com a base do Whaticket
- PM2 para gerenciamento de processos

### Configuração
1. Copie o arquivo de modelo:
   ```bash
   cp config.example.json config.json
   ```
2. Edite `config.json` com suas credenciais:
   - `sheetUrl`: URL pública do Google Sheets (formato CSV)
   - `apiUrl`: Endpoint do Whaticket (`http://127.0.0.1:4000/api/messages/send`)
   - `apiToken`: Token de autorização Bearer da API Whaticket
   - `adminNotifyNumbers`: Lista dos telefones dos administradores

### Execução com PM2
```bash
# Iniciar o serviço monitor
pm2 start watcher.js --name "lead-watcher"

# Salvar lista do PM2 para inicialização automática no boot
pm2 save
```

---

## 🏛️ Sobre a Ordem
Sistema desenvolvido com rigor, discrição e zelo fraterno para a **Augusta e Respeitável Loja Simbólica Lealdade e Justiça nº 001** (Grande Oriente Independente do Brasil — GOIB).
