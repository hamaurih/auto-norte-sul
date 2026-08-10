const MAP: Array<[RegExp, string]> = [
  [/invalid login credentials/i, "E-mail ou senha incorretos."],
  [/email not confirmed/i, "Confirme seu e-mail antes de entrar."],
  [/user already registered/i, "Este e-mail já possui uma conta. Tente entrar."],
  [/password should be at least (\d+)/i, "A senha deve ter no mínimo 8 caracteres."],
  [/new password should be different/i, "A nova senha deve ser diferente da anterior."],
  [/for security purposes|rate limit|too many requests/i, "Muitas tentativas. Aguarde alguns instantes e tente novamente."],
  [/token has expired|invalid or has expired|expired/i, "O link expirou. Solicite uma nova recuperação de senha."],
  [/auth session missing|session_not_found/i, "Sessão de recuperação inválida. Solicite um novo link."],
  [/unable to validate email|invalid email/i, "Informe um e-mail válido."],
  [/network|failed to fetch/i, "Falha de conexão. Verifique sua internet e tente novamente."],
];

export function authErrorMessage(err: unknown, fallback = "Não foi possível concluir a operação."): string {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  for (const [re, msg] of MAP) if (re.test(raw)) return msg;
  return fallback;
}

