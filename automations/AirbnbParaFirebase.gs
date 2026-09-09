/**
 * AIRBNB → FIREBASE — importa reservas confirmadas automaticamente
 * =================================================================
 * Lê e-mails "Reserva confirmada" do Airbnb no seu Gmail e lança a
 * receita (e a comissão de 17,5%) direto no Firebase do Dashboard
 * Locações — exatamente como se você tivesse digitado à mão na aba
 * Mês a Mês.
 *
 * COMO INSTALAR
 * -------------
 * 1. Acesse https://script.google.com → "Novo projeto"
 * 2. Apague o conteúdo padrão e cole este arquivo inteiro
 * 3. Salve (ícone de disquete). Dê um nome ao projeto, ex.: "Airbnb → Dashboard"
 * 4. No menu de funções (topo, ao lado de "Executar"), escolha
 *    "configurarGatilho" e clique em "Executar"
 * 5. O Google vai pedir autorização — aceite (ele avisa "app não
 *    verificado" porque é um script seu; clique em Avançado > Acessar
 *    [nome do projeto] (não seguro) > Permitir)
 * 6. Pronto! A partir daí, a cada 15 minutos o script confere se
 *    chegou reserva nova e lança sozinho.
 *
 * Pra rodar uma vez manualmente e testar: escolha a função
 * "processarReservasAirbnb" no mesmo menu e clique em "Executar".
 */

// ── Configuração ──────────────────────────────────────────
const FIREBASE_URL = 'https://locacao-dashboard-default-rtdb.firebaseio.com';

// Mapa: ID do anúncio no Airbnb → imóvel no sistema
const IMOVEL_POR_ANUNCIO = {
  '1365160889800213675': 'smg', // TÉRREO PÉ NA AREIA COM 3 SUÍTES
  '1628330458348439056': 'pn',  // ILUSION | Refúgio no Coração de Ponta Negra
};

const TAXA_COMISSAO = 0.175; // 17,5% — mesma regra já usada no app

const LABEL_IMPORTADO = 'Locacoes/Importado';
const LABEL_REVISAR    = 'Locacoes/Revisar';

const MESES_LISTA = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
const MES_ABREV_PARA_IDX = {
  jan:0, fev:1, mar:2, abr:3, mai:4, jun:5,
  jul:6, ago:7, set:8, out:9, nov:10, dez:11,
};

// Envia um e-mail de resumo pra você a cada execução com novidades
// (deixe false pra desligar)
const ENVIAR_RESUMO_POR_EMAIL = true;

// ── Avisos de limpeza (WhatsApp) ──────────────────────────
// Número de WhatsApp de cada equipe (código do país + DDD + número,
// só dígitos). Todo dia às 18h, se tiver check-in ou checkout no dia
// seguinte, o app manda uma notificação push pro celular — ao tocar,
// abre o WhatsApp já com a mensagem pronta pra essa equipe.
const TELEFONE_LIMPEZA = {
  smg:  '5584994546064', // Carol
  pn:   '5584998440479', // Isis
  pipa: '5584994212815', // Jucele
};
const NOME_IMOVEL = { smg: 'SMG', pn: 'PN', pipa: 'Pipa' };

// Credenciais do Firebase Cloud Messaging (pra enviar a notificação
// push). Gere as duas em console.firebase.google.com, projeto
// "locacao-dashboard":
// 1. Configurações do projeto → Contas de serviço → "Gerar nova
//    chave privada" → baixa um .json → copie os campos "client_email"
//    e "private_key" de dentro dele pras duas constantes abaixo
//    (mantenha as quebras de linha \n do private_key exatamente como
//    estão no arquivo)
const FCM_PROJECT_ID              = 'locacao-dashboard';
const SERVICE_ACCOUNT_EMAIL       = 'COLE_AQUI_O_CLIENT_EMAIL_DO_JSON';
const SERVICE_ACCOUNT_PRIVATE_KEY = 'COLE_AQUI_O_PRIVATE_KEY_DO_JSON';

// ── Ponto de entrada (roda no gatilho de tempo) ──────────
function processarReservasAirbnb() {
  garantirLabels_();
  const labelImportado = GmailApp.getUserLabelByName(LABEL_IMPORTADO);
  const labelRevisar    = GmailApp.getUserLabelByName(LABEL_REVISAR);

  const query = 'from:automated@airbnb.com subject:"Reserva confirmada" -label:"' + LABEL_IMPORTADO + '" -label:"' + LABEL_REVISAR + '"';
  const threads = GmailApp.search(query, 0, 50);

  const importados = [];
  const comErro = [];

  threads.forEach(thread => {
    const mensagens = thread.getMessages();
    const msg = mensagens[mensagens.length - 1];
    try {
      const reserva = parseEmailAirbnb_(msg);
      lancarReservaNoFirebase_(reserva);
      thread.addLabel(labelImportado);
      importados.push(reserva);
    } catch (erro) {
      thread.addLabel(labelRevisar);
      comErro.push({ assunto: msg.getSubject(), erro: String(erro) });
    }
  });

  if (ENVIAR_RESUMO_POR_EMAIL && (importados.length || comErro.length)) {
    enviarResumo_(importados, comErro);
  }
}

// ── Instala o gatilho de tempo (rodar 1x manualmente) ────
function configurarGatilho() {
  // Remove gatilhos antigos desta função pra não duplicar
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'processarReservasAirbnb') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('processarReservasAirbnb')
    .timeBased()
    .everyMinutes(15)
    .create();

  // Já roda uma vez agora, pra testar
  processarReservasAirbnb();
}

// ── Extrai os dados da reserva a partir do e-mail ────────
function parseEmailAirbnb_(msg) {
  const assunto = msg.getSubject();
  const corpo   = msg.getPlainBody();
  const dataEmail = msg.getDate();

  // Nome do hóspede — vem limpo do assunto:
  // "Reserva confirmada - Anderson Matos chega em 6 de set."
  const matchNome = assunto.match(/Reserva confirmada - (.+?) chega em/i);
  const hospede = matchNome ? matchNome[1].trim() : 'Hóspede Airbnb';

  // Imóvel — pelo ID do anúncio na URL (fixo, não muda com o nome)
  const matchAnuncio = corpo.match(/\/rooms\/(\d+)/);
  const idAnuncio = matchAnuncio ? matchAnuncio[1] : null;
  const imovel = idAnuncio && IMOVEL_POR_ANUNCIO[idAnuncio];
  if (!imovel) {
    throw new Error('Anúncio não reconhecido (ID ' + idAnuncio + '). Adicione-o em IMOVEL_POR_ANUNCIO.');
  }

  // Datas de check-in/checkout — pega só o trecho entre "Check-in
  // Checkout" e "HÓSPEDES" pra não confundir com outras datas do e-mail
  const trechoDatas = corpo.match(/Check-in\s+Checkout([\s\S]*?)H[ÓO]SPEDES/i);
  if (!trechoDatas) throw new Error('Não encontrei o bloco de Check-in/Checkout no e-mail.');
  const datasEncontradas = trechoDatas[1].match(/(\d{1,2})\s+de\s+([a-zçãéêô]{3})\.?/gi);
  if (!datasEncontradas || datasEncontradas.length < 1) throw new Error('Não consegui ler a data de check-in.');
  const checkin = datasEncontradas[0];

  const mCheckin = checkin.match(/(\d{1,2})\s+de\s+([a-zçãéêô]{3})/i);
  const dia = parseInt(mCheckin[1], 10);
  const mesAbrev = normalizarMesAbrev_(mCheckin[2]);
  const mesIdx = MES_ABREV_PARA_IDX[mesAbrev];
  if (mesIdx === undefined) throw new Error('Mês não reconhecido: ' + mCheckin[2]);

  // O check-in é sempre no futuro em relação ao envio do e-mail — se o
  // mês da reserva vier "antes" do mês do e-mail, é ano que vem.
  let ano = dataEmail.getFullYear();
  if (mesIdx < dataEmail.getMonth()) ano += 1;

  const dataFmt = ano + '-' + pad2_(mesIdx + 1) + '-' + pad2_(dia);
  const mes = mesAbrev + '/' + String(ano).slice(-2);

  // Noites da estadia — pega a segunda data do bloco (checkout) e calcula
  // a diferença de dias. Usado no calendário de Gestão pra pintar o
  // período todo ocupado, não só o dia de chegada.
  let noites = 1;
  const checkout = datasEncontradas[1];
  if (checkout) {
    const mCheckout = checkout.match(/(\d{1,2})\s+de\s+([a-zçãéêô]{3})/i);
    if (mCheckout) {
      const diaOut = parseInt(mCheckout[1], 10);
      const mesOutAbrev = normalizarMesAbrev_(mCheckout[2]);
      const mesOutIdx = MES_ABREV_PARA_IDX[mesOutAbrev];
      if (mesOutIdx !== undefined) {
        let anoOut = ano;
        if (mesOutIdx < mesIdx) anoOut += 1; // checkout cai no ano seguinte (virada de dez/jan)
        const dataCheckin  = new Date(ano, mesIdx, dia);
        const dataCheckout = new Date(anoOut, mesOutIdx, diaOut);
        const diff = Math.round((dataCheckout - dataCheckin) / 86400000);
        if (diff > 0) noites = diff;
      }
    }
  }

  // Horários de check-in/checkout — ficam na linha logo após as datas,
  // no mesmo bloco ("14:00 11:00"). Usa os padrões do Airbnb (14h/11h)
  // se não encontrar, já que quase toda reserva segue esse horário.
  const matchHorarios = trechoDatas[1].match(/(\d{1,2}:\d{2})\s+(\d{1,2}:\d{2})/);
  const horaCheckin  = matchHorarios ? matchHorarios[1] : '14:00';
  const horaCheckout = matchHorarios ? matchHorarios[2] : '11:00';

  // Valor que você recebe (já líquido da taxa do Airbnb)
  const matchValor = corpo.match(/VOC[ÊE]\s+RECEBE[\s\S]{0,12}?R\$\s*([\d.,]+)/i);
  if (!matchValor) throw new Error('Não encontrei "Você recebe" no e-mail.');
  const valor = parseFloat(matchValor[1].replace(/\./g, '').replace(',', '.'));
  if (!valor || valor <= 0) throw new Error('Valor de "Você recebe" inválido: ' + matchValor[1]);

  // Código de confirmação (só pra registrar no motivo/log, não é usado no calculo)
  const matchCodigo = corpo.match(/\/reservations\/details\/([A-Z0-9]+)/i);
  const codigo = matchCodigo ? matchCodigo[1] : '';

  return { imovel, hospede, dataFmt, mes, valor, noites, horaCheckin, horaCheckout, codigo, threadId: msg.getThread().getId() };
}

// ── Lança a receita + comissão automática de 17,5% ───────
function lancarReservaNoFirebase_(reserva) {
  const agora = new Date().toISOString();

  const lancamento = {
    imovel:        reserva.imovel,
    mes:           reserva.mes,
    data:          reserva.dataFmt,
    motivo:        'Airbnb',
    hospede:       reserva.hospede,
    categoria:     'receita',
    tipo:          'entrada',
    valor:         reserva.valor,
    noites:        reserva.noites,
    hora_checkin:  reserva.horaCheckin,
    hora_checkout: reserva.horaCheckout,
    criado_em:     agora,
  };
  pushFirebase_('/lancamentos', lancamento);

  const comissao = {
    imovel:    reserva.imovel,
    mes:       reserva.mes,
    data:      reserva.dataFmt,
    motivo:    'Comissão (17,5%)',
    categoria: 'comissao',
    tipo:      'saida',
    valor:     Math.round(reserva.valor * TAXA_COMISSAO * 100) / 100,
    criado_em: agora,
  };
  pushFirebase_('/lancamentos', comissao);
}

function pushFirebase_(caminho, dados) {
  const resp = UrlFetchApp.fetch(FIREBASE_URL + caminho + '.json', {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(dados),
    muteHttpExceptions: true,
  });
  const codigo = resp.getResponseCode();
  if (codigo < 200 || codigo >= 300) {
    throw new Error('Firebase recusou a escrita (HTTP ' + codigo + '): ' + resp.getContentText());
  }
}

// ── Utilitários ───────────────────────────────────────────
function normalizarMesAbrev_(txt) {
  const t = txt.toLowerCase()
    .replace('ç', 'c').replace('ã', 'a').replace('é', 'e').replace('ê', 'e').replace('ô', 'o')
    .substring(0, 3);
  return MESES_LISTA.includes(t) ? t : t;
}
function pad2_(n) { return String(n).padStart(2, '0'); }

function garantirLabels_() {
  [LABEL_IMPORTADO, LABEL_REVISAR].forEach(nome => {
    if (!GmailApp.getUserLabelByName(nome)) GmailApp.createLabel(nome);
  });
}

function enviarResumo_(importados, comErro) {
  const destinatario = Session.getActiveUser().getEmail();
  let corpo = '';
  if (importados.length) {
    corpo += 'Reservas importadas automaticamente:\n\n';
    importados.forEach(r => {
      corpo += '• ' + r.imovel.toUpperCase() + ' — ' + r.hospede + ' — ' + r.dataFmt + ' (' + r.noites + (r.noites === 1 ? ' noite' : ' noites') + ') — R$ ' + r.valor.toFixed(2).replace('.', ',') + '\n';
    });
  }
  if (comErro.length) {
    corpo += '\n⚠️ Precisam de revisão manual (rótulo "Locacoes/Revisar" no Gmail):\n\n';
    comErro.forEach(e => { corpo += '• ' + e.assunto + ' — ' + e.erro + '\n'; });
  }
  MailApp.sendEmail(destinatario, 'Dashboard Locações — importação automática do Airbnb', corpo);
}

// ── Diagnóstico: lista tudo que está lançado, pra achar duplicatas ──
// Só lê o Firebase, não altera nada. Rode esta função (mesmo menu de
// "Executar" das outras) e depois abra "Execuções" (ícone de relógio)
// > clique na execução > veja o log. Toda receita cuja data é igual à
// da linha anterior do mesmo imóvel vem marcada com ⚠️ — geralmente é
// duplicata (uma lançada manualmente e outra importada do Airbnb).
function diagnosticoReservas() {
  const resp = UrlFetchApp.fetch(FIREBASE_URL + '/lancamentos.json');
  const dados = JSON.parse(resp.getContentText()) || {};

  ['smg', 'pn'].forEach(imovel => {
    const linhas = Object.entries(dados)
      .filter(([, l]) => l.imovel === imovel && (l.categoria === 'receita' || l.categoria === 'comissao'))
      .map(([id, l]) => Object.assign({ id: id }, l))
      .sort((a, b) => (a.data || '').localeCompare(b.data || '') || (a.categoria || '').localeCompare(b.categoria || ''));

    Logger.log('═══════════ ' + imovel.toUpperCase() + ' (' + linhas.length + ' lançamentos) ═══════════');
    let dataAnterior = null;
    linhas.forEach(l => {
      const duplicataProvavel = (l.categoria === 'receita' && l.data === dataAnterior);
      Logger.log(
        (l.categoria === 'receita' ? 'RECEITA ' : 'comissão') +
        ' | ' + l.data + ' | noites:' + (l.noites || 1) +
        ' | R$' + l.valor + ' | "' + l.motivo + '"' +
        ' | criado:' + (l.criado_em || '').slice(0, 16) +
        ' | id:' + l.id +
        (duplicataProvavel ? '  ⚠️ MESMA DATA DA RECEITA ANTERIOR — provável duplicata' : '')
      );
      if (l.categoria === 'receita') dataAnterior = l.data;
    });
  });
}

// ── Instala o gatilho diário dos avisos de limpeza (rodar 1x) ────
function configurarGatilhoLimpeza() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'enviarAvisosLimpeza') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('enviarAvisosLimpeza')
    .timeBased()
    .atHour(18)
    .everyDays(1)
    .create();

  // Já roda uma vez agora, pra testar
  enviarAvisosLimpeza();
}

// ── Ponto de entrada dos avisos de limpeza (roda no gatilho) ─────
// Pra cada imóvel com telefone cadastrado, confere se amanhã tem
// check-in e/ou checkout e manda uma notificação push (uma por
// imóvel) pros celulares inscritos em /push_tokens. Tocar na
// notificação abre o WhatsApp da equipe com a mensagem pronta.
function enviarAvisosLimpeza() {
  const amanha = new Date();
  amanha.setDate(amanha.getDate() + 1);
  const amanhaFmt = amanha.getFullYear() + '-' + pad2_(amanha.getMonth() + 1) + '-' + pad2_(amanha.getDate());

  const resp = UrlFetchApp.fetch(FIREBASE_URL + '/lancamentos.json');
  const lancamentos = JSON.parse(resp.getContentText()) || {};

  let accessToken = null; // só busca o token OAuth2 se realmente precisar mandar algo

  Object.keys(TELEFONE_LIMPEZA).forEach(imovel => {
    const numero = TELEFONE_LIMPEZA[imovel];
    if (!numero) return;

    const checkins = [];
    const checkouts = [];

    Object.values(lancamentos).forEach(l => {
      if (l.categoria !== 'receita' || l.imovel !== imovel || !l.data) return;
      if (l.data === amanhaFmt) checkins.push(l);
      const noites = parseInt(l.noites, 10) || 1;
      if (somarDias_(l.data, noites) === amanhaFmt) checkouts.push(l);
    });

    if (!checkins.length && !checkouts.length) return; // nada amanhã nesse imóvel

    let corpo = '';
    checkouts.forEach(l => {
      corpo += '🔴 Check-out às ' + (l.hora_checkout || '11:00') + (l.hospede ? ' — ' + l.hospede : '') + '\n';
    });
    checkins.forEach(l => {
      corpo += '🟢 Check-in às ' + (l.hora_checkin || '14:00') + (l.hospede ? ' — ' + l.hospede : '') + '\n';
    });
    corpo = corpo.trim();

    const mensagemWhats = 'Oi! Amanhã (' + formatarDataBR_(amanhaFmt) + ') na ' + NOME_IMOVEL[imovel] + ':\n\n' + corpo;
    const link = 'https://wa.me/' + numero + '?text=' + encodeURIComponent(mensagemWhats);
    const titulo = 'Limpeza ' + NOME_IMOVEL[imovel] + ' — amanhã';

    if (!accessToken) accessToken = obterTokenAcessoFCM_();
    enviarNotificacaoParaTodos_(accessToken, titulo, corpo, link);
  });
}

function enviarNotificacaoParaTodos_(accessToken, titulo, corpo, link) {
  const resp = UrlFetchApp.fetch(FIREBASE_URL + '/push_tokens.json');
  const tokens = JSON.parse(resp.getContentText()) || {};
  Object.keys(tokens).forEach(id => {
    const fcmToken = tokens[id] && tokens[id].token;
    if (!fcmToken) return;
    try {
      enviarPush_(accessToken, fcmToken, titulo, corpo, link);
    } catch (erro) {
      Logger.log('Falha ao enviar push (token ' + id + '): ' + erro);
    }
  });
}

function enviarPush_(accessToken, fcmToken, titulo, corpo, link) {
  const payload = {
    message: {
      token: fcmToken,
      data: { title: titulo, body: corpo, url: link },
      webpush: { headers: { Urgency: 'high' } },
    },
  };
  const resp = UrlFetchApp.fetch(
    'https://fcm.googleapis.com/v1/projects/' + FCM_PROJECT_ID + '/messages:send',
    {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + accessToken },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    }
  );
  const codigo = resp.getResponseCode();
  if (codigo < 200 || codigo >= 300) {
    throw new Error('FCM recusou o envio (HTTP ' + codigo + '): ' + resp.getContentText());
  }
}

// Autentica como a conta de serviço (JWT assinado com RS256) e troca
// por um token de acesso OAuth2 válido pra chamar a API do FCM.
function obterTokenAcessoFCM_() {
  const agora = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: agora + 3600,
    iat: agora,
  };

  const base64url_ = obj => Utilities.base64EncodeWebSafe(JSON.stringify(obj)).replace(/=+$/, '');
  const semAssinar = base64url_(header) + '.' + base64url_(claim);
  const assinatura = Utilities.computeRsaSha256Signature(semAssinar, SERVICE_ACCOUNT_PRIVATE_KEY);
  const jwt = semAssinar + '.' + Utilities.base64EncodeWebSafe(assinatura).replace(/=+$/, '');

  const resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    },
    muteHttpExceptions: true,
  });
  const codigo = resp.getResponseCode();
  if (codigo < 200 || codigo >= 300) {
    throw new Error('Falha ao autenticar com a conta de serviço (HTTP ' + codigo + '): ' + resp.getContentText());
  }
  return JSON.parse(resp.getContentText()).access_token;
}

function somarDias_(dataStr, dias) {
  const [a, m, d] = dataStr.split('-').map(Number);
  const data = new Date(a, m - 1, d);
  data.setDate(data.getDate() + dias);
  return data.getFullYear() + '-' + pad2_(data.getMonth() + 1) + '-' + pad2_(data.getDate());
}
function formatarDataBR_(dataStr) {
  const [a, m, d] = dataStr.split('-');
  return d + '/' + m + '/' + a;
}
