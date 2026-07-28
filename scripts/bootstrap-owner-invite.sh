#!/usr/bin/env bash
# Fase 1E.1 — cria o convite de uso único do PRIMEIRO proprietário.
#
# Uso (execute na sua máquina, apontando para o Supabase de DESENVOLVIMENTO):
#   DEV_DATABASE_URL="postgresql://..." \
#   OWNER_EMAIL="hamaurih@gmail.com" \
#   ORG_SLUG="norte-sul" \
#   APP_URL="http://localhost:8080" \
#   ./scripts/bootstrap-owner-invite.sh
#
# Regras de segurança:
# - Nenhuma senha é criada e nenhuma credencial fica no repositório.
# - O token é gerado localmente, gravado apenas como hash SHA-256 no banco
#   (private.create_owner_invitation) e impresso UMA única vez no terminal.
# - O convite só vale para o e-mail informado E exige que a pessoa já esteja
#   autenticada no Supabase Auth; o e-mail sozinho não concede nada.
# - Não use `bash -x`, não redirecione a saída para arquivos e não cole o link
#   em issues, chats públicos ou logs.

set -euo pipefail

: "${DEV_DATABASE_URL:?defina DEV_DATABASE_URL com a connection string do projeto DEV}"
OWNER_EMAIL="${OWNER_EMAIL:?defina OWNER_EMAIL}"
ORG_SLUG="${ORG_SLUG:-norte-sul}"
APP_URL="${APP_URL:-http://localhost:8080}"

TOKEN="$(openssl rand -hex 32)"

INVITE_ID="$(
  PGPASSWORD="" psql "$DEV_DATABASE_URL" -X -q -A -t \
    -v ON_ERROR_STOP=1 \
    -v slug="$ORG_SLUG" -v email="$OWNER_EMAIL" -v token="$TOKEN" \
    -c "select private.create_owner_invitation(:'slug', :'email', :'token');"
)"

printf '\nConvite owner criado (id: %s) para %s na organização %s.\n' \
  "$INVITE_ID" "$OWNER_EMAIL" "$ORG_SLUG"
printf 'Validade: 7 dias. Uso único.\n\n'
printf 'Link de ativação (mostrado apenas agora, não salve em log):\n  %s/ativacao?token=%s\n\n' \
  "$APP_URL" "$TOKEN"
printf 'Fluxo esperado: a pessoa cria a conta/faz login normalmente pelo Supabase Auth\n'
printf 'com esse mesmo e-mail e depois abre o link acima para consumir o convite.\n\n'

unset TOKEN
