import nodemailer from 'nodemailer';

export async function sendResetCode(to, code) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !SMTP_FROM)
    throw Object.assign(new Error('O envio de email ainda não está configurado. Defina SMTP_HOST, SMTP_USER, SMTP_PASS e SMTP_FROM no ambiente.'), { status: 503 });
  const transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT || 587),
    secure: Number(SMTP_PORT || 587) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  await transport.sendMail({
    from: SMTP_FROM,
    to,
    subject: 'Código para recuperar sua senha do Meu Ponto',
    text: `Seu código para redefinir a senha é ${code}. Ele expira em 15 minutos. Se você não solicitou a recuperação, ignore este email.`,
  });
}
