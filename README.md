# ICT Asset Management: Backend

Express + TypeScript + Prisma + PostgreSQL REST API.

## Run

```
docker compose up -d                 # PostgreSQL (or use your own DATABASE_URL)
cp .env.example .env                 # then edit secrets
npm install
npx prisma migrate dev --name init
npm run seed
npm run dev                          # http://localhost:5000/api
```

## Seeded accounts (DEVELOPMENT ONLY, change before any real deployment)

| Role        | Email             | Password       |
| ----------- | ----------------- | -------------- |
| Admin       | admin@ict.local   | Admin@12345    |
| ICT Manager | manager@ict.local | ChangeMe@12345 |
| ICT Staff   | staff@ict.local   | ChangeMe@12345 |
| Viewer      | viewer@ict.local  | ChangeMe@12345 |

## Email (Brevo)

1. In Brevo, verify a sender address or domain (Senders, Domains & Dedicated IPs).
2. Create an API key under SMTP & API > API Keys.
3. Set `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` (the verified address), and optionally `BREVO_SENDER_NAME` in `.env`.
4. Restart the backend, add a member, and check the invitation arrives.

Without `BREVO_API_KEY`, emails and activation links are printed to the console in development. Production email sends require the API key. Failed sends mark the invitation as Failed and can be resent from the Members page.

## Notes

- `APP_URL` must match the frontend origin (CORS and email links).
- Extra endpoints beyond the PRD: `GET /api/auth/invitation?token=`, `POST /api/auth/activate`, `GET /api/audit-logs/actions`, `POST /api/departments|locations|staff`.
