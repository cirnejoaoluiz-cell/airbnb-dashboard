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

  // Valor que você recebe (já líquido da taxa do Airbnb)
  const matchValor = corpo.match(/VOC[ÊE]\s+RECEBE[\s\S]{0,12}?R\$\s*([\d.,]+)/i);
  if (!matchValor) throw new Error('Não encontrei "Você recebe" no e-mail.');
  const valor = parseFloat(matchValor[1].replace(/\./g, '').replace(',', '.'));
  if (!valor || valor <= 0) throw new Error('Valor de "Você recebe" inválido: ' + matchValor[1]);

  // Código de confirmação (só pra registrar no motivo/log, não é usado no calculo)
  const matchCodigo = corpo.match(/\/reservations\/details\/([A-Z0-9]+)/i);
  const codigo = matchCodigo ? matchCodigo[1] : '';

  return { imovel, hospede, dataFmt, mes, valor, noites, codigo, threadId: msg.getThread().getId() };
}

// ── Lança a receita + comissão automática de 17,5% ───────
function lancarReservaNoFirebase_(reserva) {
  const agora = new Date().toISOString();

  const lancamento = {
    imovel:    reserva.imovel,
    mes:       reserva.mes,
    data:      reserva.dataFmt,
    motivo:    'Airbnb',
    categoria: 'receita',
    tipo:      'entrada',
    valor:     reserva.valor,
    noites:    reserva.noites,
    criado_em: agora,
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
