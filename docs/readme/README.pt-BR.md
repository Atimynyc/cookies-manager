| [English](../../README.md) | [简体中文](README.zh-CN.md) | [繁體中文](README.zh-TW.md) | [Español](README.es.md) | **Português (Brasil) ✓** | [Deutsch](README.de.md) | [Français](README.fr.md) | [日本語](README.ja.md) | [Română](README.ro.md) |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |

# ![](../../assets/icon-48.png) Cookie Controller

Gerencie cookies, Local Storage e Session Storage para o site de sua escolha, a partir de uma janela pop-up ou do painel lateral Chrome. Desenvolvido para desenvolvedores, testadores e usuários avançados que desejam inspecionar e alterar dados do site sem abrir o DevTools.

## Comece agora

1. Instale o [Cookie Controller](https://chromewebstore.google.com/detail/cookie-controller/hmfnocennjjcieebhojphobilohcdfda) da loja virtual Chrome.
2. Abra uma página HTTP/HTTPS e clique no ícone da extensão.
3. Aprovar o acesso ao site selecionado quando solicitado e, em seguida, escolher “Cookies”, “Local Storage” ou “Session Storage”.
4. Pesquise, edite, importe ou exporte dados. Abra o painel lateral para ampliar a área de trabalho ou ative a atualização automática da página após as alterações.

Para instalação local, clone este repositório, abra o `chrome://extensions`, ative o modo de desenvolvedor e use a opção “Carregar descompactado” para selecionar a pasta do repositório que contém o `manifest.json`. A extensão é executada diretamente a partir dos arquivos incluídos; não é necessária nenhuma etapa de compilação.

## Recursos

- Pesquise cookies por nome, valor, domínio ou caminho.
- O editor mantém os atributos de domínio, caminho, SameSite, Secure e HttpOnly de cada cookie quando você altera seu valor ou prazo de validade.
- Criar e excluir cookies, excluir itens selecionados e definir valores em lote.
- Visualizar, criar, editar e excluir as entradas Local Storage e Session Storage.
- Os cookies HTTP favoritos e as entradas de armazenamento na web aparecem no topo de cada lista de dados.
- Visualize as exportações e salve a visualização atual, os itens selecionados ou todos os dados do site como um pacote JSON com controle de versão, em um arquivo ou na área de transferência. Importe com visualização das diferenças, seleção por item, estratégias de conflito, progresso, resultados e reversão em lote.
- Importar e exportar cookies no formato “cookie-jar” Netscape/cURL, incluindo a convenção `#HttpOnly_` e os cookies de sessão.
- Salve localmente estados reutilizáveis do site com tags, regras de origem, estratégias padrão para conflitos e variáveis inseridas ao aplicar um estado. Renomeie, duplique, exporte, aplique ou exclua estados salvos.
- Importe cookies rapidamente usando os campos separados Name e Value, ou adicione uma entrada de armazenamento com `key=value`. Copie valores, pares `name=value` ou JSON estruturados.
- Utilize as ferramentas de codificação/decodificação de URL, formatação/compactação JSON e decodificação de carga útil JWT ao editar valores.
- Verifique as alterações recentes e as diferenças entre o antes e o depois, repita as operações que falharam e desfaça as alterações permitidas durante a sessão atual do navegador.
- Alterne o destino entre as guias HTTP/HTTPS na janela atual do navegador.

O formato Netscape/cURL lida apenas com cookies. Ele não preserva o atributo SameSite, as informações de partição Partitioned/CHIPS nem o identificador do armazenamento de cookies Chrome. Use os pacotes JSON para preservar esses atributos e o armazenamento da web.

## Idiomas e temas

A interface está disponível em inglês, chinês simplificado, chinês tradicional, espanhol, português do Brasil, alemão, francês, japonês e romeno. Todas as traduções vêm incluídas na extensão e funcionam offline.

Na primeira utilização, um idioma compatível é selecionado entre os idiomas do Chrome e salvo; os idiomas não compatíveis são substituídos pelo inglês. As configurações regionais romenas, como `ro-RO` e `ro-MD`, selecionam o romeno. É possível alterar o idioma a qualquer momento usando o botão de configurações; a mudança de idioma preserva os rascunhos do editor.

Use o botão do sol/lua para alternar entre os temas claro e escuro. O modo normal vem configurado por padrão com o tema claro, enquanto o modo de navegação anônima vem configurado por padrão com o tema escuro. Cada modo lembra sua configuração independentemente do sistema operacional, e as preferências são sincronizadas entre todas as janelas da extensão abertas no mesmo modo.

## Privacidade e controle de dados

Sem anúncios, análises, rastreamento de usuários nem necessidade de criar uma conta. Os dados do site são processados no seu dispositivo e não são enviados, vendidos nem compartilhados com o desenvolvedor ou com servidores de terceiros. Por padrão, o acesso é solicitado para cada site separadamente e pode ser revogado nas configurações da extensão no Chrome. As operações iniciadas por você podem ser concluídas após o fechamento da janela pop-up ou do painel lateral.

Você pode ativar **Permitir todos os sites** nas configurações ou na caixa de diálogo de acesso ao site para solicitar acesso a cookies, localStorage e sessionStorage em todos os sites HTTP/HTTPS que visitar. Depois que o Chrome aprovar essa permissão, novos sites não precisarão de confirmação individual. Desative a opção para voltar a autorizar cada site separadamente.

Preferências, confirmações de acesso a sites, identificadores de favoritos (sem valores dos itens), estados salvos e resumos do histórico permanecem no armazenamento local da extensão. Os estados salvos podem conter os valores de cookies e de armazenamento que você optar explicitamente por salvar. Os valores completos de antes e depois e os dados de recuperação de operações permanecem apenas durante a sessão atual do navegador; reiniciar o Chrome ou recarregar a extensão os apaga. Limpe os dados da extensão ou desinstale-a para remover os dados salvos localmente.

Os cookies e o armazenamento na web podem conter informações de login ou outros dados confidenciais. Proteja os dados copiados e exportados. A ferramenta JWT exibe a carga útil decodificada em Base64URL apenas para fins de inspeção. Ela não verifica assinaturas nem verifica se um token de autenticação é confiável ou válido. Leia a [política de privacidade](../../docs/privacy-policy.html) para obter mais detalhes.

## Desenvolvimento de software

Instale as dependências de desenvolvimento e execute as verificações a partir da raiz do repositório:

```sh
npm install
npm run lint
npm test
npm run test:locales
npm run test:acceptance -- --storage-only
```

O último comando testa a leitura e a alteração dos dados Local Storage e Session Storage de um site em Chromium. Consulte a [referência de desenvolvimento e lançamento (em inglês)](../../docs/development.md) para obter os comandos completos de teste do navegador, os locais de saída e detalhes sobre a confiabilidade da operação.

## Lançamento e documentação

Versão atual: **0.3.9**. Requer **Chrome 114 ou mais recente**.

- [Notas de lançamento da versão v0.3.9](../../docs/release-notes-v0.3.9.md)
- [Manutenção da localização](../../docs/localization.md)
- [Formato do pacote de dados do site com controle de versão](../../docs/site-data-package-v1.md)
- [Descrições da loja e imagens promocionais da loja virtual Chrome](../../store-assets/)
- [Relatar um problema](https://github.com/Atimynyc/cookies-manager/issues)
