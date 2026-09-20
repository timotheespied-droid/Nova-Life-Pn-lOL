-- ============================================================
-- SCHEMA POLICE NATIONALE - NOVA LIFE
-- A exécuter dans Supabase > SQL Editor (une seule fois)
-- ============================================================

-- ---------- GRADES ----------
create table grades (
  id serial primary key,
  nom text not null unique,
  niveau int not null unique -- 1 = Gardien de la Paix ... 10 = Commissaire Général
);

insert into grades (nom, niveau) values
  ('Gardien de la Paix', 1),
  ('Brigadier', 2),
  ('Brigadier-Chef', 3),
  ('Major', 4),
  ('Capitaine', 5),
  ('Commandant', 6),
  ('Commandant Divisionnaire', 7),
  ('Commissaire', 8),
  ('Commissaire Divisionnaire', 9),
  ('Commissaire Général', 10);

-- Seuils de permissions utilisés partout dans le site :
--   niveau >= 8  -> Direction   (gère les comptes, les infractions, les stats)
--   niveau >= 5  -> Commandement (modifie/annule une interpellation, gère fiché S)
--   niveau <  5  -> Agent        (crée une interpellation, consulte les casiers)

-- ---------- AGENTS (comptes policiers) ----------
-- Un agent = un utilisateur Supabase Auth (auth.users) + ses infos RP
create table agents (
  id uuid primary key references auth.users(id) on delete cascade,
  matricule text not null unique,
  nom text not null,
  prenom text not null,
  grade_id int not null references grades(id),
  actif boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- CITOYENS (identités des joueurs) ----------
create table citoyens (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  prenom text not null,
  date_naissance date,
  adresse text,
  telephone text,
  fiche_s boolean not null default false,
  fiche_s_motif text,
  notes text,
  created_by uuid references agents(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on citoyens (lower(nom), lower(prenom));

-- ---------- INFRACTIONS (référentiel légal) ----------
create table infractions (
  id serial primary key,
  code text not null unique,       -- ex: 'ART4-EXCES50'
  titre text not null,
  categorie text not null,         -- 'comportement' | 'route'
  amende_min int not null,
  amende_max int not null,
  points int not null default 0,
  peine text,                      -- texte libre : sanctions complémentaires
  garde_a_vue boolean not null default false,
  suspension_permis boolean not null default false,
  confiscation boolean not null default false,
  prison_rp boolean not null default false
);

insert into infractions (code, titre, categorie, amende_min, amende_max, points, peine, garde_a_vue, suspension_permis, confiscation, prison_rp) values
-- TITRE I : comportement envers les forces de l'ordre
('T1-OUTRAGE-SIMPLE', 'Outrage simple', 'comportement', 500, 500, 0, 'Avertissement, garde à vue possible', true, false, false, false),
('T1-OUTRAGE-GESTE', 'Outrage avec gestes', 'comportement', 1000, 1000, 0, 'Garde à vue, interdiction de port d''arme possible', true, false, false, false),
('T1-REBELLION', 'Rébellion / résistance à interpellation', 'comportement', 1500, 3000, 0, 'Garde à vue, confiscation du véhicule possible', true, false, true, false),
('T1-MENACE-AGRESSION', 'Menace / agression envers un agent', 'comportement', 3000, 7500, 0, 'Poursuites judiciaires, prison RP possible', true, false, false, true),
('T1-FUITE-CONTROLE', 'Fuite lors d''un contrôle', 'comportement', 2000, 2000, 0, 'Retrait de permis temporaire, immobilisation du véhicule', false, true, false, false),
-- TITRE II : code de la route
('T2-VITESSE-20', 'Excès de vitesse < 20 km/h', 'route', 68, 68, 1, null, false, false, false, false),
('T2-VITESSE-20-49', 'Excès de vitesse 20 à 49 km/h', 'route', 135, 135, 3, 'Suspension possible', false, true, false, false),
('T2-VITESSE-50', 'Excès de vitesse >= 50 km/h', 'route', 300, 3750, 6, 'Suspension, prison RP possible', false, true, false, true),
('T2-FEU-STOP', 'Feu rouge ou stop non respecté', 'route', 135, 135, 4, null, false, false, false, false),
('T2-TELEPHONE', 'Téléphone tenu en main', 'route', 135, 135, 3, null, false, false, false, false),
('T2-CEINTURE', 'Non-port de la ceinture', 'route', 135, 135, 3, null, false, false, false, false),
('T2-STATIONNEMENT', 'Stationnement gênant ou interdit', 'route', 35, 135, 0, 'Immobilisation possible', false, false, false, false),
('T2-SENS-INTERDIT', 'Circulation en sens interdit', 'route', 135, 135, 4, null, false, false, false, false),
('T2-PRIORITE', 'Non-respect priorité piéton / véhicule prioritaire', 'route', 135, 135, 4, null, false, false, false, false),
('T2-DEPASSEMENT', 'Dépassement dangereux', 'route', 135, 135, 3, null, false, false, false, false),
('T2-SANS-PERMIS', 'Conduite sans permis ou permis invalide', 'route', 1500, 4500, 0, 'Immobilisation, poursuites', false, false, true, false),
('T2-ALCOOL', 'Conduite sous alcool (0,5 g/l et plus)', 'route', 1500, 4500, 6, 'Suspension, prison RP possible', false, true, false, true),
('T2-STUPEFIANTS', 'Conduite sous stupéfiants', 'route', 1500, 4500, 6, 'Suspension, prison RP possible', false, true, false, true),
('T2-REFUS-OBTEMPERER', 'Refus d''obtempérer / fuite', 'route', 2000, 7500, 0, 'Immobilisation, poursuites', false, false, true, false),
('T2-ASSURANCE-CG', 'Défaut d''assurance ou de carte grise', 'route', 135, 750, 0, 'Immobilisation possible', false, false, true, false);

-- ---------- INTERPELLATIONS (constitue le casier judiciaire) ----------
create table interpellations (
  id uuid primary key default gen_random_uuid(),
  citoyen_id uuid not null references citoyens(id) on delete cascade,
  agent_id uuid not null references agents(id),
  infraction_ids int[] not null,       -- infractions cochées (plusieurs possibles)
  montant_total int not null,          -- amende totale calculée (éditable par l'agent)
  peine_appliquee text,                -- récap texte des sanctions complémentaires
  garde_a_vue boolean not null default false,
  lieu text,
  notes text,
  statut text not null default 'enregistree', -- enregistree | annulee
  created_at timestamptz not null default now()
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table agents enable row level security;
alter table citoyens enable row level security;
alter table infractions enable row level security;
alter table interpellations enable row level security;
alter table grades enable row level security;

-- petite fonction utilitaire : niveau de grade de l'utilisateur connecté
create or replace function mon_niveau()
returns int
language sql
security definer
stable
as $$
  select g.niveau
  from agents a
  join grades g on g.id = a.grade_id
  where a.id = auth.uid() and a.actif = true
  limit 1
$$;

-- GRADES : lisible par tout policier connecté
create policy "grades: lecture policiers" on grades
  for select using (mon_niveau() is not null);

-- AGENTS : un policier actif voit tous les agents (annuaire) ;
--          seule la Direction (niveau >= 8) peut créer/modifier/désactiver
create policy "agents: lecture policiers" on agents
  for select using (mon_niveau() is not null);

create policy "agents: gestion direction" on agents
  for all using (mon_niveau() >= 8) with check (mon_niveau() >= 8);

-- CITOYENS : tout policier actif peut lire/créer ; modifier réservé Commandement+
create policy "citoyens: lecture policiers" on citoyens
  for select using (mon_niveau() is not null);

create policy "citoyens: creation policiers" on citoyens
  for insert with check (mon_niveau() is not null);

create policy "citoyens: modification commandement" on citoyens
  for update using (mon_niveau() >= 5) with check (mon_niveau() >= 5);

-- INFRACTIONS (référentiel légal) : lecture pour tous, édition Direction seule
create policy "infractions: lecture policiers" on infractions
  for select using (mon_niveau() is not null);

create policy "infractions: gestion direction" on infractions
  for all using (mon_niveau() >= 8) with check (mon_niveau() >= 8);

-- INTERPELLATIONS : lecture/création pour tout policier ; modif/annulation Commandement+
create policy "interpellations: lecture policiers" on interpellations
  for select using (mon_niveau() is not null);

create policy "interpellations: creation policiers" on interpellations
  for insert with check (mon_niveau() is not null);

create policy "interpellations: modification commandement" on interpellations
  for update using (mon_niveau() >= 5) with check (mon_niveau() >= 5);

-- ============================================================
-- FIN DU SCRIPT
-- Pense ensuite à créer ton premier compte "Commissaire Général"
-- (voir README.md, section "Créer le premier compte").
-- ============================================================
