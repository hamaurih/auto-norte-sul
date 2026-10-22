# Sentry — monitoramento com privacidade

A instrumentação do **frontend** fica desligada por padrão, até a configuração de `VITE_SENTRY_DSN` na hospedagem. Configure um projeto Sentry separado por aplicação.

- `VITE_SENTRY_DSN`: DSN público do projeto Sentry (não é token de API).
- `VITE_SENTRY_APP`: identificador não pessoal da aplicação.
- Nunca adicionar `SENTRY_AUTH_TOKEN` ao frontend.
- O envio de PII, session replay, breadcrumbs e rastreamento de requisições está desativado.
- Dados de clientes, endereço, CPF, receita e transações financeiras não devem ser anexados a eventos.
- Validar o recebimento de um erro sintético apenas em ambiente de **homologação** e revisar o payload coletado no painel do Sentry antes de liberar produção.

A integração de navegador **não** cobre erros exclusivamente no backend (Supabase Edge Functions, webhooks, jobs). Instrumentação de servidor requer configuração independente e políticas próprias de sanitização.
