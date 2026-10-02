# Meu Ponto

Monolito local em Node.js, SQLite, HTML e Bootstrap para acompanhar batimentos, horas trabalhadas, saldo semanal/mensal e saída prevista na sexta ou no último dia útil do mês.

## Rodar

Requer Node.js 22 ou superior e Google Chrome instalado. Nesta máquina, o Chrome está em `/usr/bin/google-chrome`.

```bash
npm install
npm start
```

Abra <http://127.0.0.1:3000>. O banco fica em `data/ponto.sqlite` e o perfil isolado do Chrome em `data/chrome-profile`. Ambos são ignorados pelo Git. Para mudar a porta ou o caminho do navegador, use `PORT` e `CHROME_PATH`.

O ícone de configurações abre as preferências de jornada e a aba **Aparência**, onde é possível escolher o tema padrão do sistema, claro ou escuro, e definir a cor primária. Essas escolhas são salvas no navegador atual.

## Sincronizar com o Acuttis

1. Clique em **Conectar Acuttis** e depois em **Abrir login**. O aplicativo abre um perfil próprio do Chrome.
2. Faça login na página oficial do Acuttis. Quando o comprovante de ponto aparecer, o aplicativo o abre e sincroniza os batimentos automaticamente. Se o site exigir MFA ou CAPTCHA, conclua essa etapa no Chrome.
3. O aplicativo busca páginas de 20 batimentos até o início do mês atual e repete a busca a cada cinco minutos enquanto o servidor estiver aberto.

O login em iframe não disponibiliza a sessão ao backend local, por causa da separação de origem dos navegadores. Por isso, o aplicativo usa uma janela do Chrome controlada pelo próprio monolito. Nenhuma senha ou CPF é salva no SQLite; o perfil do Chrome guarda a sessão conforme o próprio navegador. A integração usa o endpoint observado na plataforma; se a interface ou o formato da API mudar, ajuste `src/acuttis.js`.

## Plantões

Clique em **Provisionar plantão** e informe a data do plantão e a folga, que pode ocorrer antes ou depois dele. As duas datas devem ser diferentes, e a folga precisa cair de segunda a sexta. Se a folga cair na sexta, a jornada do plantão será de 8h; nos demais dias úteis, será de 9h. O dia de folga terá jornada prevista de 0h. É possível excluir o provisionamento pelo painel. A tabela mostra dias com batimentos, o dia atual em aberto e os plantões futuros provisionados.

O arquivo JSON do exemplo também pode ser importado pelo botão **Importar JSON** ou por:

```bash
npm run import -- caminho/para/batimentos.json
```

Importações são idempotentes pelo `_id` do Acuttis. As marcações locais são identificadas separadamente e não são enviadas ao Acuttis.

## Cálculos

- Jornada padrão: segunda a quinta 9h, sexta 8h, sábado e domingo 0h. Ajuste feriados, folgas e outras exceções clicando no dia.
- Trabalho do dia: soma de pares de batimentos (entrada → saída). Um dia de jornada integral só é considerado fechado após quatro batimentos; assim, intervalos e marcações faltantes não geram previsões falsamente precisas.
- Saldo: horas trabalhadas menos jornada prevista. A tolerância diária é de 10 minutos por padrão, como nos exemplos da planilha: diferenças de até 10 minutos não entram no saldo. Esse valor pode ser ajustado nas preferências. Os cartões de saldo incluem apenas dias fechados.
- Sexta: a previsão usa o saldo desde o começo da semana ou desde o começo do mês, o que vier depois. A saída estimada é a hora necessária para zerar esse saldo, com o almoço previsto quando ainda não foi batido.
- Último dia útil do mês: a previsão usa o saldo do mês. Dias futuros são projetados pela jornada padrão e as sextas futuras compensam o saldo da respectiva semana.
- Se faltarem batimentos completos em dias anteriores ao fechamento, a previsão fica suspensa até corrigir os dados ou marcar o dia como folga.

As previsões são auxiliares. Para registro oficial, valem os horários e as regras aplicados pela empresa no Acuttis.

## Verificar

```bash
npm test
```

Os testes incluem o exemplo de 01–02/10/2026 da planilha: crédito de 11 minutos em 01/10 e saída prevista às **16:19** em 02/10.
