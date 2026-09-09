# Automações

Scripts que rodam fora do site (não fazem parte do que é publicado no
GitHub Pages), usados para alimentar o Firebase automaticamente.

## AirbnbParaFirebase.gs

Google Apps Script que lê os e-mails de **"Reserva confirmada"** do
Airbnb no Gmail (`cirnejoaoluiz@gmail.com`) e lança automaticamente:

- Uma receita (`categoria: "receita"`) com o valor de **"Você recebe"**
  (já líquido da taxa do Airbnb), na data de check-in, com o número de
  **noites** da estadia (calculado a partir do check-in/checkout do
  e-mail) — usado pelo calendário da aba Gestão pra pintar o período
  todo ocupado, não só o dia de chegada
- A comissão de 17,5% correspondente (mesma regra que o app já aplica
  quando você lança uma receita manualmente)

O imóvel (SMG ou PN) é identificado pelo **ID do anúncio do Airbnb**
(fixo na URL, não muda se o título do anúncio for editado):

| Imóvel | Anúncio | ID |
|---|---|---|
| SMG | TÉRREO PÉ NA AREIA COM 3 SUÍTES | `1365160889800213675` |
| PN | ILUSION \| Refúgio no Coração de Ponta Negra | `1628330458348439056` |

Pipa não tem anúncio no Airbnb — continua sendo lançada manualmente
na aba Comissões, como já é hoje.

### Instalação

Veja o cabeçalho do próprio arquivo `AirbnbParaFirebase.gs` — o
passo a passo completo está comentado lá (colar em
[script.google.com](https://script.google.com), autorizar o acesso
ao Gmail, e rodar a função `configurarGatilho` uma vez).

### Como funciona a prova de duplicidade

Cada e-mail processado com sucesso recebe o rótulo do Gmail
`Locacoes/Importado`, e a busca do script sempre ignora e-mails que já
tenham esse rótulo — então rodar o script várias vezes não lança a
mesma reserva duas vezes.

Se algum e-mail não puder ser interpretado (formato mudou, anúncio
novo não cadastrado, etc.), ele recebe o rótulo `Locacoes/Revisar` no
Gmail, pra você lançar manualmente, e você recebe um e-mail avisando.

⚠️ **Atenção na primeira execução**: como a busca considera qualquer
e-mail de "Reserva confirmada" que ainda não tenha o rótulo
`Locacoes/Importado`, a primeira vez que o script roda ele processa
até 50 e-mails de uma vez — incluindo reservas antigas que você já
possa ter lançado manualmente antes. Isso gera lançamentos duplicados.
Antes de rodar `configurarGatilho` pela primeira vez, vale a pena
lançar manualmente só reservas bem recentes (ou nenhuma), deixando o
script cuidar do resto.

### Conferindo duplicatas

A função `diagnosticoReservas` (só leitura, não altera nada) lista
todos os lançamentos de receita/comissão de SMG e PN, ordenados por
data, marcando com ⚠️ qualquer receita cuja data é igual à da anterior
— sinal forte de duplicata (já que cada imóvel só recebe uma reserva
por vez). Rode pelo mesmo menu de "Executar" e veja o resultado em
"Execuções" (ícone de relógio) no menu lateral.
