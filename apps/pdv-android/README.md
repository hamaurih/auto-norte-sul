# Norte Sul PDV Android / Stone SmartPOS

Shell Android leve para o PDV do ERP Norte Sul. O mesmo APK pode rodar em Android comum e em terminais Stone SmartPOS.

## Arquitetura

- A `WebView` carrega o PDV oficial em `https://nortesulauto.com.br/admin/pdv?embedded=1`.
- `NorteSulPOS` é a bridge nativa entre o PDV web e os aplicativos de pagamento do dispositivo.
- Quando os apps Stone estão instalados, a bridge habilita pagamento, cancelamento e impressão por deeplink.
- Em Android comum, o PDV continua operacional; cartão/Pix podem ser registrados como pagamento externo com NSU/ID.
- O front-end mantém catálogo de contingência e outbox de vendas no IndexedDB. A venda é sincronizada depois com a mesma chave idempotente.

## Compatibilidade

- `minSdk 23` (Android 6.0), compatível com a exigência mínima publicada pela Stone.
- Java 17.
- APK enxuto: sem React Native, Flutter ou Compose e sem SDK de pagamento embarcado.
- Pagamento usa os apps Stone via deeplink, evitando dependência de token PackageCloud no primeiro estágio.

## Segurança

- HTTPS obrigatório e tráfego HTTP bloqueado.
- A navegação da WebView fica limitada aos hosts oficiais do Norte Sul e ao Supabase do projeto.
- Links externos abrem fora do app.
- A bridge não recebe credenciais do Supabase nem chave de serviço.
- Antes do go-live ainda é obrigatório executar revisão de WebView/CSP, teste de XSS e homologação física em SmartPOS.

## Build

Abra `apps/pdv-android` no Android Studio e gere `app-release.apk`.
Antes da distribuição, configure assinatura de release e valide nos modelos de SmartPOS realmente usados pela loja.

## Gates antes de produção

1. Débito aprovado e recusado.
2. Crédito 1x e parcelado.
3. Pix aprovado, cancelado pelo operador e timeout.
4. Retorno ao PDV com ATK/ITK/autorização persistidos.
5. Queda de internet depois do pagamento: outbox sincroniza sem duplicação.
6. Cancelamento pela ATK.
7. Impressão e falta de papel.
8. Reinício do app e reautenticação.
9. APK abaixo de 70 MB.
10. Teste nos modelos Stone usados pela operação.
11. Teste de XSS/bridge e navegação para origem não confiável.
12. Teste de venda da última unidade em concorrência e em contingência.
