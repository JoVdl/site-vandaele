-- ============================================================
-- CURAGE VANDAELE – Schéma Supabase
-- À exécuter dans : Supabase > SQL Editor > New Query
-- ============================================================

CREATE TABLE IF NOT EXISTS demandes (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ,

  -- Coordonnées client
  prenom        TEXT NOT NULL,
  nom           TEXT NOT NULL,
  email         TEXT NOT NULL,
  telephone     TEXT,
  profil        TEXT,         -- particulier | association | collectivite | agriculteur | autre
  delai         TEXT,         -- urgent | 3mois | 6mois | 1an | indefini

  -- Localisation chantier
  adresse       TEXT,
  surface_ha    NUMERIC,
  perimetre_ml  NUMERIC,
  acces         TEXT,         -- facile | moyen | difficile

  -- Travaux
  travaux       TEXT[],       -- ex: {hydrocurage, curage, faucardage}
  estimation_min NUMERIC,
  estimation_max NUMERIC,
  estimation_text TEXT,       -- ex: "12 000 € – 24 000 €"
  details       JSONB,        -- paramètres détaillés par type de travaux
  infos_sup     TEXT,         -- champ libre du formulaire

  -- Champs admin (gérés depuis l'interface admin)
  statut        TEXT DEFAULT 'nouveau', -- nouveau | contacte | devis_envoye | chantier_gagne | sans_suite
  note_admin    TEXT
);

-- ── ROW LEVEL SECURITY ──────────────────────────────────────
ALTER TABLE demandes ENABLE ROW LEVEL SECURITY;

-- Tout le monde peut insérer (soumissions du formulaire public)
CREATE POLICY "public_insert" ON demandes
  FOR INSERT TO anon
  WITH CHECK (true);

-- Seuls les utilisateurs authentifiés (admin) peuvent lire
CREATE POLICY "auth_select" ON demandes
  FOR SELECT TO authenticated
  USING (true);

-- Seuls les utilisateurs authentifiés (admin) peuvent modifier
CREATE POLICY "auth_update" ON demandes
  FOR UPDATE TO authenticated
  USING (true);

-- ── APRÈS AVOIR EXÉCUTÉ CE SQL ──────────────────────────────
-- 1. Allez dans Authentication > Users > "Add User"
--    Créez un compte avec votre email + mot de passe admin
--
-- 2. Allez dans Settings > API
--    Copiez l'URL du projet et la clé "anon public"
--    Collez-les dans js/admin.js ET js/estimation.js
--    (constantes SUPABASE_URL et SUPABASE_ANON_KEY)
