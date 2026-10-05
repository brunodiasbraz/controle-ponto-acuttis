# Meu Ponto

Aplicação em Node.js, SQLite, HTML e Bootstrap para acompanhar batimentos, horas trabalhadas, saldo semanal/mensal e saída prevista na sexta ou no último dia útil do mês. Cada conta tem dados isolados.

## Rodar

Requer Node.js 22.9 ou superior. A sincronização do Acuttis usa uma extensão do Chrome instalada no computador de cada usuário; o servidor não inicia navegador.

```bash
npm install
npm start
```

Copie `.env.example` para `.env` para personalizar as variáveis. `npm start`, `npm run dev` e `npm run import` carregam esse arquivo automaticamente; variáveis já definidas no ambiente do processo têm precedência.

Por padrão, o servidor escuta em todas as interfaces na porta `3000`. Crie uma conta na tela inicial ou entre com uma já existente. O cadastro está aberto a quem acessar a página: qualquer pessoa com o endereço pode criar uma conta. Nomes têm de 3 a 32 caracteres e senhas precisam ter no mínimo 12 caracteres. As senhas são armazenadas como hash scrypt com salt individual, nunca em texto legível.

Em produção, publique atrás de um proxy HTTPS (por exemplo, Nginx ou Caddy) e defina `NODE_ENV=production` e `APP_ORIGIN=https://ponto.seudominio.com`; o primeiro ativa o atributo `Secure` do cookie e o segundo restringe requisições de alteração ao domínio público configurado. O cookie também é `HttpOnly` e `SameSite=Strict`, os tokens de sessão são aleatórios e só seu hash fica no SQLite, e a sessão expira após sete dias. O app adiciona cabeçalhos básicos de segurança. Não exponha o serviço pela internet em HTTP simples.

Variáveis: `PORT` (porta), `HOST` (interface; padrão `0.0.0.0`), `DB_PATH` (arquivo SQLite), `APP_ORIGIN` (origem pública HTTPS obrigatória em produção) e `COOKIE_SECURE=true` (para ativar cookie Secure fora de `NODE_ENV=production`).

O banco fica em `data/ponto.sqlite` e é ignorado pelo Git. Na primeira conta cadastrada após atualizar uma instalação existente, os dados do banco antigo são migrados para essa conta. Cadastre essa conta antes de divulgar o endereço aos demais usuários.

O SQLite mantém as contas em `users`, as sessões em `user_sessions` e a conclusão individual do primeiro acesso em `user_onboarding`. Marcações, jornada e plantões são sempre consultados com o identificador da conta autenticada.

O ícone de configurações abre as preferências de jornada e a aba **Aparência**, onde é possível escolher o tema padrão do sistema, claro ou escuro, e definir a cor primária. Essas escolhas são salvas no navegador atual.

## Sincronizar com o Acuttis

1. Carregue a pasta `extension/` no Chrome em `chrome://extensions` com o **Modo do desenvolvedor → Carregar sem compactação**.
2. Nas opções da extensão, informe a origem usada para abrir o Meu Ponto e conceda acesso a esse endereço. Depois recarregue as abas do painel e do Acuttis.
3. Abra o Acuttis no mesmo perfil do Chrome e faça login. No Meu Ponto, clique em **Sincronizar batimentos**. A extensão busca as páginas do mês atual e importa os registros para a conta conectada.

A sincronização é manual. A extensão só captura batimentos quando o usuário clica no botão do painel; não armazena senha, não executa sincronizações em segundo plano e não abre navegador no servidor. O processamento ocorre no perfil do Chrome do usuário e envia ao servidor somente `_id`, horário, fuso e origem das marcações. A extensão usa permissões de host do Acuttis e pede acesso apenas à origem do painel configurada pelo usuário.

## Plantões

Clique em **Provisionar plantão** e informe a data do plantão e a folga, que pode ocorrer antes ou depois dele. As duas datas devem ser diferentes, e a folga precisa cair de segunda a sexta. Se a folga cair na sexta, a jornada do plantão será de 8h; nos demais dias úteis, será de 9h. O dia de folga terá jornada prevista de 0h. É possível excluir o provisionamento pelo painel. A tabela mostra dias com batimentos, o dia atual em aberto e os plantões futuros provisionados.

O calendário retira automaticamente da jornada os feriados da lista informada para 2026 e repete as datas fixas nos demais anos; Paixão de Cristo e Corpus Christi são calculados pelo calendário da Páscoa. Corpus Christi está incluído conforme a regra da empresa. Um plantão provisionado em um feriado volta a contar com a carga horária do plantão. A folga prevista do plantão deve ser um dia útil que não seja feriado.

Use o ícone **Registrar folga compensatória** para marcar uma folga paga pelo banco de horas. O dia fica com jornada prevista de 0h, aparece na tabela e não gera saldo devedor. Não é necessário lançar batimentos nesse dia. Para remover o registro, abra o dia na tabela e clique em **Excluir folga**.

O arquivo JSON pode ser importado para a conta autenticada pelo botão **Importar JSON**. Pela linha de comando, defina o nome do usuário:

```bash
IMPORT_USERNAME=usuario npm run import -- caminho/para/batimentos.json
```

Importações são idempotentes pelo `_id` do Acuttis. As marcações locais são identificadas separadamente e não são enviadas ao Acuttis.

## Cálculos

- Jornada padrão: segunda a quinta 9h, sexta 8h, sábado e domingo 0h. Feriados nacionais e folgas compensatórias ficam fora da jornada; outras exceções podem ser ajustadas clicando no dia.
- Trabalho do dia: soma de pares de batimentos (entrada → saída). Um dia de jornada integral só é considerado fechado após quatro batimentos; assim, intervalos e marcações faltantes não geram previsões falsamente precisas.
- Saldo: horas trabalhadas menos jornada prevista. A tolerância diária é de 10 minutos por padrão, como nos exemplos da planilha: diferenças de até 10 minutos não entram no saldo. Esse valor pode ser ajustado nas preferências. Os cartões de saldo incluem apenas dias fechados.
- Sexta: a previsão usa o saldo desde o começo da semana ou desde o começo do mês, o que vier depois. A saída estimada é a hora necessária para zerar esse saldo, com o almoço previsto quando ainda não foi batido.
- Último dia útil do mês: a previsão usa o saldo do mês. Dias futuros são projetados pela jornada padrão e as sextas futuras compensam o saldo da respectiva semana.
- Saída de hoje: calcula o fim da jornada prevista e o limite diário de saída com hora extra. O limite adicional é de 1h de segunda a quinta e 2h na sexta.
- Se faltarem batimentos completos em dias anteriores ao fechamento, a previsão fica suspensa até corrigir os dados ou marcar o dia como folga.

As previsões são auxiliares. Para registro oficial, valem os horários e as regras aplicados pela empresa no Acuttis.

## Verificar

```bash
npm test
```

Os testes incluem o exemplo de 01–02/10/2026 da planilha: crédito de 11 minutos em 01/10 e saída prevista às **16:19** em 02/10.
