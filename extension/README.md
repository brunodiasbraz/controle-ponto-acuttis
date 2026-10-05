# Extensão Meu Ponto para Chrome

## Instalar para testar

1. Copie esta pasta para cada computador que usará a sincronização.
2. No Chrome, abra `chrome://extensions` e ative **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione esta pasta.
4. A página de opções abre na instalação. Informe a origem exata do Meu Ponto, como `https://ponto.suaempresa.com` ou `http://10.100.7.6:3000`, e autorize o acesso solicitado.
5. Recarregue as abas do Meu Ponto e do Acuttis. Mantenha ambos abertos no mesmo perfil do Chrome.
6. Entre no Acuttis com a mesma pessoa/conta selecionada no Meu Ponto e clique em **Sincronizar batimentos**.

Se alterar a pasta ou receber uma atualização, abra `chrome://extensions`, clique em **Recarregar** na extensão e recarregue as duas abas.

## Privacidade e permissões

A extensão tem acesso às páginas do Acuttis e ao endereço do Meu Ponto que o usuário autorizar. Ela observa a resposta dos batimentos somente depois de um pedido de sincronização, importa o mês atual e transmite ao Meu Ponto apenas identificador, horário, fuso e origem. Não lê nem salva a senha e não envia dados em segundo plano.

Esta pasta é uma instalação local para teste e distribuição interna. Para distribuição gerenciada a vários usuários, publique a extensão na Chrome Web Store privada ou use as políticas de extensões da empresa.
