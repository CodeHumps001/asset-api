import "dotenv/config";

function need(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required environment variable ${key}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT || 5000),
  isProd: process.env.NODE_ENV === "production",
  appUrl: process.env.APP_URL || "http://localhost:3000",
  jwtSecret: need("JWT_SECRET"),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "15m",
  refreshDays: parseInt(process.env.REFRESH_TOKEN_EXPIRES_IN || "7", 10) || 7,
  invitationHours: Number(process.env.INVITATION_EXPIRY_HOURS || 48),
  resetMinutes: 60,
  reminderDays: Number(process.env.MAINTENANCE_REMINDER_DAYS || 7),
  brevo: {
    apiKey: process.env.BREVO_API_KEY || "",
    senderEmail: process.env.BREVO_SENDER_EMAIL || "",
    senderName: process.env.BREVO_SENDER_NAME || "ICT Asset Management",
  },
};
