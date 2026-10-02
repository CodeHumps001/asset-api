import crypto from 'crypto';
export const randomToken = () => crypto.randomBytes(32).toString('hex');
export const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
