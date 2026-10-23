import { createHmac, randomBytes } from 'crypto';

export function checkAuthConfig() {
  // Yahan fallback secret add kar diya hai taaki bina environment variables ke bhi error na aaye
  const secret = process.env.AUTH_SECRET || process.env.JWT_SECRET || "fallback-secret-key-for-ai-sales-agent-2026";
  return secret;
}

export function hashPassword(password: string): string {
  const salt = 'ai-sales-agent-salt';
  return createHmac('sha256', salt).update(password).digest('hex');
}

export function verifyPassword(password: string, hash: string): boolean {
  return hashPassword(password) === hash;
}

export function generateToken(userId: string): string {
  const secret = checkAuthConfig();
  const payload = Buffer.from(JSON.stringify({ userId, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 })).toString('base64');
  const signature = createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${signature}`;
}

export function verifyToken(token: string): string | null {
  try {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;
    const secret = checkAuthConfig();
    const expectedSignature = createHmac('sha256', secret).update(payload).digest('hex');
    if (signature !== expectedSignature) return null;
    const data = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    if (data.exp && Date.now() > data.exp) return null;
    return data.userId;
  } catch {
    return null;
  }
}
