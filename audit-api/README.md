# Serveur de référence — audit des prestations de prélèvement

Serveur Node.js **sans dépendance** (Node ≥ 20) : API REST de synchronisation et d'interopérabilité
de la PWA d'audit, et serveur des fichiers de l'application (un seul point d'accès HTTPS).

```bash
ADMIN_PASSWORD='mot-de-passe-solide' node audit-api/server.mjs
# → http://0.0.0.0:8080/audit/   (API : /api/v1, documentation : /api/v1/openapi.json)
```

Sans `ADMIN_PASSWORD`, un mot de passe administrateur aléatoire est affiché au premier démarrage.

## Configuration (variables d'environnement)

| Variable | Rôle | Défaut |
|---|---|---|
| `PORT`, `HOST` | écoute | `8080`, `0.0.0.0` |
| `DATA_DIR` | données (`db.json`, `journal.ndjson`, `media/`, `server-secret.key`) | `audit-api/data` |
| `TLS_CERT`, `TLS_KEY` | HTTPS natif (sinon placer derrière un proxy HTTPS : nginx, Caddy…) | — |
| `STATIC_ROOT` | racine des fichiers servis | racine du dépôt |
| `CORS_ORIGINS` | origines autorisées si l'application est servie ailleurs (ex. GitHub Pages) | — |
| `TOKEN_TTL_HOURS` | durée de validité d'une session serveur | `168` |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | compte administrateur initial | `admin`, aléatoire |
| `SERVER_SECRET` | clé (64 hex) de chiffrement au repos des clés d'appareils | fichier généré |
| `ALERT_WEBHOOK_URL` | réception des alertes d'urgence (messagerie, astreinte…) | — |

**HTTPS est obligatoire en production** (l'application refuse un serveur non HTTPS hors poste local ;
la géolocalisation et la caméra l'exigent aussi).

## Fonctionnement

- **Authentification** : mots de passe hachés (scrypt), jetons aléatoires stockés hachés, sessions liées
  à l'appareil, blocage après 10 échecs en 15 minutes.
- **Appareils** : enregistrés à la première connexion (numéro attribué) ; la clé de chiffrement de
  l'appareil est déposée et chiffrée au repos (AES-256-GCM) pour permettre à un autre utilisateur
  autorisé d'ouvrir une session sur le même appareil sans perte de données non synchronisées.
  **Désactivation d'un appareil perdu** : ses sessions sont supprimées ; à sa prochaine connexion il
  reçoit `DEVICE_REVOKED` et efface toutes ses données locales.
- **Synchronisation** : `POST /sync/push` (contrôle optimiste par révision, réponse `conflict` avec la
  version serveur), `GET /sync/pull?since=<curseur>` (différentiel), `PUT/GET /media/:id` (contenu
  vérifié par SHA-256, immuable), `POST /sequences/reserve` (numéros d'audit).
- **Droits** : même matrice que l'application (`audit/js/domain/permissions.js`) ; un auditeur ne peut
  pas modifier un référentiel ; un audit verrouillé n'est modifiable que par le responsable qualité ou
  l'administrateur et ne peut jamais être déverrouillé ; le journal d'audit est en ajout seul.
- **Journal serveur** : `journal.ndjson` en ajout seul (connexions, écritures avec empreinte,
  révocations, réservations, sauvegardes).
- **Interopérabilité** : `GET /entities/:type`, `GET /entities/:type/:id`, `GET /export/deviations.csv`,
  `GET /export/audits.csv` — pour le logiciel qualité, un SIG, une GED, un ERP… (compte de profil
  « consultation » recommandé).

## Sauvegarde

Sauvegarder régulièrement le dossier `DATA_DIR` (y compris `server-secret.key`, sans lequel les clés
d'appareils déposées ne sont plus lisibles), ou télécharger `GET /api/v1/admin/backup` (administrateur).
