/* État de la session ouverte sur l'appareil (en mémoire uniquement, jamais persisté en clair). */
export const session = {
  dek: null,          // CryptoKey AES-GCM de chiffrement des données
  dekRaw: null,       // octets de la clé (pour l'envelopper pour un nouvel utilisateur)
  user: null,         // {id, username, name, role}
  device: null,       // {id, name, number}
  mode: null,         // 'standalone' | 'server'
  serverUrl: '',
  token: null,        // jeton d'accès au serveur (mémoire)
  tokenExpiresAt: null,
  unlockedAt: null,
  lastActivity: Date.now(),
  get unlocked() { return !!this.dek && !!this.user; }
};

export function clearSession() {
  if (session.dekRaw) session.dekRaw.fill(0);
  Object.assign(session, { dek: null, dekRaw: null, user: null, token: null, tokenExpiresAt: null, unlockedAt: null });
}

export function appVersion() {
  return (globalThis.self && self.AUDIT_VERSION) || 'dev';
}
