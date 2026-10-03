const nodemailer = require('nodemailer');
const { setting } = require('./config');

// Envoi d'e-mails transactionnels (mot de passe oublié). Configuré via SMTP_* dans config.env.

let _transport = null;

function getTransport() {
  if (_transport) return _transport;
  _transport = nodemailer.createTransport({
    host: setting('SMTP_HOST', 'smtp.gmail.com'),
    port: Number(setting('SMTP_PORT', 587)),
    secure: Number(setting('SMTP_PORT', 587)) === 465,
    auth: {
      user: setting('SMTP_USER', ''),
      pass: setting('SMTP_PASS', ''),
    },
  });
  return _transport;
}

const FROM = () => setting('SMTP_FROM', setting('SMTP_USER', 'noreply@example.com'));

/**
 * Envoie un e-mail. { to, subject, text, html }
 * Retourne true si envoyé, false si la config SMTP est absente ou si une erreur survient.
 */
async function sendMail({ to, subject, text, html }) {
  const user = setting('SMTP_USER', '');
  if (!user) {
    console.warn('[mailer] SMTP_USER not configured — email not sent');
    return false;
  }
  try {
    await getTransport().sendMail({ from: FROM(), to, subject, text, html });
    return true;
  } catch (error) {
    console.error('[mailer] Failed to send email:', error.message);
    return false;
  }
}

module.exports = { sendMail };
