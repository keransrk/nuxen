# NUXEN — Ticketmaster France Bot

Bot automatisé pour Ticketmaster France. Gère la génération de cookies, la file d'attente Queue-it et la création de paniers en parallèle.

---

## Installation

1. Placez `NUXEN.exe` dans un dossier dédié (ex: `C:\NUXEN\`)
2. Lancez `NUXEN.exe` une première fois → le dossier `config/` est créé automatiquement
3. Remplissez les deux fichiers de configuration
4. Relancez `NUXEN.exe`

---

## Configuration

### `config/config.csv`

```
key,value
capsolver_api_key,CAP-VOTRE_CLE_ICI
discord_webhook_url,https://discord.com/api/webhooks/ID/TOKEN
discord_user_id_to_ping,123456789012345678
qty_min,1
qty_max,2
poll_status_max_minutes,30
request_delay_ms,3000
```

| Paramètre | Description |
|---|---|
| `capsolver_api_key` | Votre clé API Capsolver (commence par `CAP-`) |
| `discord_webhook_url` | URL du webhook Discord pour les notifications |
| `discord_user_id_to_ping` | Votre ID Discord (optionnel, pour être mentionné) |
| `qty_min` | Quantité minimum de places à prendre (défaut: 1) |
| `qty_max` | Quantité maximum de places à prendre (défaut: 2) |
| `poll_status_max_minutes` | Durée max de polling Queue-it en minutes (défaut: 30) |
| `request_delay_ms` | Délai entre requêtes en ms pour éviter la détection (défaut: 3000) |

### `config/proxies.csv`

Un proxy par ligne. Les lignes commençant par `#` sont des commentaires.

```
http://user:pass@proxy-eu.packetstream.vip:31112
http://user2:pass2@proxy-eu.packetstream.vip:31112
```

**Important**: Utilisez des proxies résidentiels français. Une session = un proxy. Autant de proxies = autant de sessions parallèles.

---

## Utilisation

1. Lancez `NUXEN.exe`
2. Collez l'URL de l'événement Ticketmaster quand demandé :
   ```
   https://www.ticketmaster.fr/fr/manifestation/gims-billet/idmanif/645637
   ```
3. Le bot démarre toutes les sessions en parallèle

---

## Contrôles (pendant l'exécution)

| Touche | Action |
|---|---|
| `Q` | Quitter proprement (arrête toutes les sessions) |
| `S` | Stopper les sessions (sans quitter) |
| `R` | Redémarrer toutes les sessions |
| `T` | Remonter en haut de la liste |
| `B` | Aller en bas de la liste |
| `F` | Mode focus (voir les logs d'une session) |
| `↑ ↓` | Naviguer (en mode focus) |
| `ESC` | Sortir du mode focus |

---

## Notification Discord

Quand un panier est créé, vous recevrez un message avec :
- Nom de l'artiste et date
- Catégorie et places assignées (rang, numéro de siège)
- Prix total
- Basket ID (pour le checkout)
- Cookie string complet (pour reprendre la session manuellement)

---

## Venues supportées

- **La Défense Arena** (idsite: 17592)
- **Stade de France** (idsite: 0)
- **Accord Arena**
- Tout autre événement Ticketmaster France (URL ou idmanif)

---

## Support Capsolver

NUXEN utilise Capsolver pour résoudre les reCAPTCHA :
- reCAPTCHA v3 (génération des cookies TM)
- reCAPTCHA v2 (challenges Queue-it)
- reCAPTCHA invisible (purchase/init)

Rechargez votre solde sur [capsolver.com](https://capsolver.com) si besoin.
