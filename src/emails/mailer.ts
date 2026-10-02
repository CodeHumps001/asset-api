import { config } from "../config";

/**
 * Send transactional email through Brevo's API. Credentials never leave the backend.
 */
export type MailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

async function sendWithBrevo(o: MailInput) {
  if (!config.brevo.senderEmail) {
    throw new Error(
      "BREVO_SENDER_EMAIL must be set to a verified sender address",
    );
  }

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": config.brevo.apiKey,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: {
        name: config.brevo.senderName,
        email: config.brevo.senderEmail,
      },
      to: [{ email: o.to }],
      subject: o.subject,
      htmlContent: o.html,
      textContent: o.text,
    }),
  });
  if (!res.ok)
    throw new Error(
      `Brevo API responded ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
}

export async function sendMail(o: MailInput) {
  if (config.brevo.apiKey) return sendWithBrevo(o);
  if (config.isProd) {
    throw new Error("BREVO_API_KEY must be set to send email in production");
  }
  console.log(
    `\n[mail:dev] No email provider configured, printing email instead\nTo: ${o.to}\nSubject: ${o.subject}\n${o.text}\n`,
  );
}
