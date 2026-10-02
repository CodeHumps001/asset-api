const layout = (title: string, body: string) => `
<div style="background:#f1f5f9;padding:32px 16px;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#0f172a">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0">
    <div style="background:#1d4ed8;padding:20px 28px;color:#ffffff;font-weight:600;font-size:15px">ICT Asset Management</div>
    <div style="padding:28px">
      <h1 style="margin:0 0 16px;font-size:20px">${title}</h1>${body}
    </div>
  </div>
</div>`;

const button = (href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${href}" style="background:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">${label}</a></p>`;

export function invitationEmail(p: { name: string; role: string; department: string; link: string; hours: number }) {
  const subject = 'You have been invited to the ICT Asset Management System';
  const html = layout(
    `Hello ${p.name},`,
    `<p>You have been added to the ICT Asset Management System.</p>
     <p><strong>Role:</strong> ${p.role}<br/><strong>Department:</strong> ${p.department}</p>
     <p>Please click the button below to activate your account and create your password:</p>
     ${button(p.link, 'Activate account')}
     <p style="font-size:13px;color:#475569">This invitation link will expire after ${p.hours} hours. If the button does not work, copy this link into your browser:<br/>${p.link}</p>
     <p style="font-size:13px;color:#475569">If you did not expect this invitation, please contact the system administrator.</p>`,
  );
  const text = `Hello ${p.name},\n\nYou have been added to the ICT Asset Management System.\nRole: ${p.role}\nDepartment: ${p.department}\n\nPlease open the link below to activate your account and create your password:\n${p.link}\n\nThis invitation link will expire after ${p.hours} hours.\nIf you did not expect this invitation, please contact the system administrator.`;
  return { subject, html, text };
}

export function resetEmail(p: { name: string; link: string; minutes: number }) {
  const subject = 'Reset your ICT Asset Management password';
  const html = layout(
    `Hello ${p.name},`,
    `<p>We received a request to reset your password.</p>${button(p.link, 'Choose a new password')}
     <p style="font-size:13px;color:#475569">This link expires in ${p.minutes} minutes. If you did not request this, you can ignore this email.</p>`,
  );
  const text = `Hello ${p.name},\n\nReset your password using this link (valid for ${p.minutes} minutes):\n${p.link}\n\nIf you did not request this, ignore this email.`;
  return { subject, html, text };
}
