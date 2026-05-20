# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Site vitrine statique pour **ETS Vandaele Marcel & Fils** (`curagevandaele.fr`), entreprise familiale spécialisée dans le curage d'étangs, faucardage, défenses de berges et travaux aquatiques depuis 1953. Basée à Tortefontaine (62140, Hauts-de-France).

- Tél : 06 32 44 11 17
- Email : vandaelemarcel@orange.fr

## Stack technique

Aucun framework, aucun système de build. Fichiers statiques purs :

- **HTML/CSS/JS vanilla** — pas de `package.json`, pas de compilation requise
- **Police** : Inter (corps) + Sora (titres), chargées depuis Google Fonts
- **Leaflet + Leaflet.draw** — carte IGN interactive dans `estimation.html` uniquement
- **Web3Forms** — soumission des formulaires de contact et d'estimation
- **API Base Adresse Nationale** (`api-adresse.data.gouv.fr`) — autocomplete d'adresse dans l'outil d'estimation
- **IGN Géoplateforme** (`data.geopf.fr/wmts`) — tuiles cartographiques (ortho + plan)

## Architecture

Il n'existe **aucun système de templates** : la nav et le footer sont dupliqués dans chaque fichier HTML. Toute modification de navigation doit être répercutée dans les 6 fichiers `.html`.

### Pages

| Fichier | Rôle |
|---|---|
| `index.html` | Accueil : hero, aperçu services, formulaire contact, animation drague au scroll, cookie banner |
| `services.html` | Détail de chaque prestation |
| `chantiers.html` | Portfolio filtrable par catégorie (`data-cat` + `.filter-btn`) |
| `conseils.html` | Articles SEO / guide entretien étang |
| `estimation.html` | Outil d'estimation en 3 étapes + carte Leaflet |
| `mentions-legales.html` | Mentions légales RGPD |

### JS

- `js/main.js` — partagé par toutes les pages : navbar scroll, menu mobile, lien actif, formulaire contact, filtre chantiers, cookie banner RGPD, animation drague verticale (scroll-driven), scroll animations (IntersectionObserver)
- `js/estimation.js` — outil d'estimation uniquement : calculs de prix (`TARIFS`), stepper 3 panneaux, sliders, carte Leaflet avec dessin polygone/polyligne, autocomplete adresse BAN, soumission Web3Forms

### CSS

Un seul fichier `css/style.css`. Les variables CSS définissent la palette brand :

```css
--blue-400: #56B57A  /* vert principal (attention : nommage "blue" mais couleur verte) */
--blue-800: #133d22  /* vert foncé nav/footer */
```
Les noms de variables `--blue-*` sont historiques — ils correspondent à la palette verte Vandaele.

## Déploiement & preview

Pas de serveur de dev ni de build. Pour prévisualiser :

```bash
# avec Python
python3 -m http.server 8080

# avec Node (si disponible)
npx serve .
```

Ouvrir `http://localhost:8080` dans le navigateur.

## Services externes & clés

- **Contact form** (`index.html`) : utilise Web3Forms avec la clé `VOTRE_CLE_WEB3FORMS` en placeholder — à remplacer par une vraie clé si on retouche le formulaire contact.
- **Estimation form** (`js/estimation.js` ligne 539) : clé Web3Forms `d6047275-07ab-4b26-8be7-3b39b661f43b` déjà configurée et fonctionnelle.

## Médias

- Images : `assets/img/` (JPG)
- Logo : `assets/logo.svg`
- Vidéos : `assets/video/` (MP4 H.264, noms attendus dans `LIRE-MOI.txt`)
- OG image : `assets/og-image.jpg` (1200×630)

## SEO

Chaque page contient : balises meta complètes, Open Graph, Twitter Card, et données structurées Schema.org (JSON-LD). `sitemap.xml` et `robots.txt` sont à la racine. Ne pas modifier les balises `<link rel="canonical">` sans mettre à jour le sitemap.
