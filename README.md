# Police Nationale — Nova Life

Portail interne pour la Police Nationale d'un serveur Nova Life : gestion des identités des joueurs, interpellations avec calcul automatique de l'amende et des sanctions à partir de votre législation RP, casier judiciaire, fichés S, et gestion des comptes/grades des policiers.

⚠️ Ceci est un outil de **roleplay**. Toutes les données (identités, casiers, fichés S) concernent des personnages de jeu, pas des personnes réelles.

## Comment ça marche

- Le site (`index.html` + `css/` + `js/`) est **statique** : tu peux l'héberger gratuitement sur **GitHub Pages**.
- Les données (citoyens, casiers, agents…) sont stockées sur **Supabase** (base Postgres + authentification), gratuit pour ce volume d'usage.
- La sécurité est assurée côté Supabase par des règles **RLS** (Row Level Security) : même si le site est public, personne ne peut lire ou écrire les données sans être connecté avec un compte policier actif. La clé "anon" dans `config.js` est publique par design chez Supabase — ce n'est pas un secret, la protection vient des règles RLS, pas de la clé.

## 1. Créer le projet Supabase

1. Va sur [supabase.com](https://supabase.com), crée un compte puis un nouveau projet.
2. Une fois le projet prêt, va dans **SQL Editor** → colle le contenu de `sql/schema.sql` → **Run**. Cela crée toutes les tables, insère les grades et les infractions de votre législation, et active la sécurité (RLS).
3. Va dans **Project Settings → API** : récupère l'**URL du projet** et la clé **anon public**.
4. Ouvre `js/config.js` et remplace `SUPABASE_URL` et `SUPABASE_ANON_KEY` par ces valeurs.

### Désactiver la confirmation par e-mail (recommandé pour un serveur RP)

Dans **Authentication → Providers → Email**, désactive "Confirm email" pour pouvoir créer des comptes policiers directement avec un mot de passe, sans boîte mail à vérifier.

## 2. Créer le premier compte (Commissaire Général)

Les comptes de connexion (email + mot de passe) et les fiches "agent" (matricule, nom, grade) sont deux choses séparées côté Supabase — il faut les relier une fois à la main pour le tout premier compte :

Le site permet aux policiers de se connecter avec leur **prénom + nom RP** plutôt qu'un e-mail. En coulisses, Supabase a quand même besoin d'un e-mail technique : le site le génère automatiquement selon le format `prenom.nom@pn-novalife.local` (accents et espaces retirés, tout en minuscules). C'est cet e-mail-là qu'il faut utiliser quand tu crées le compte dans Supabase — l'agent, lui, ne tape que son prénom et son nom sur le site.

1. **Authentication → Users → Add user** : crée un utilisateur avec l'e-mail au format `prenom.nom@pn-novalife.local` (ex : pour "Jean Dupont" → `jean.dupont@pn-novalife.local`) et un mot de passe. Copie son **UID**.
2. **SQL Editor**, exécute (en remplaçant les valeurs) :

```sql
insert into agents (id, matricule, nom, prenom, grade_id)
values (
  'COLLE-ICI-L-UID-COPIÉ',
  '0001',
  'Dupont',
  'Jean',
  (select id from grades where nom = 'Commissaire Général')
);
```

3. Connecte-toi sur le site avec cet e-mail/mot de passe : tu as maintenant accès à l'onglet **Administration**.

Pour tous les policiers suivants, plus besoin de SQL Editor : un Commissaire (+) crée le compte dans **Authentication → Add user** avec l'e-mail au format `prenom.nom@pn-novalife.local` (le formulaire "Ajouter l'agent" dans l'onglet **Administration** du site affiche cet e-mail à générer dès que tu tapes le prénom/nom), puis ajoute l'agent depuis ce même formulaire en collant son UID.

## 3. Déployer sur GitHub

1. Crée un dépôt GitHub **privé** (Settings → visibilité "Private") si tu veux que même le code source (pas les données) reste confidentiel — même si en pratique, les données restant protégées par Supabase, un dépôt public est aussi possible.
2. Pousse tous les fichiers de ce dossier dans le dépôt.
3. Dans **Settings → Pages**, active GitHub Pages sur la branche `main`, dossier racine.
4. Ton site sera accessible à une URL du type `https://ton-pseudo.github.io/nom-du-depot/`.

> Astuce : si tu veux vraiment que le site ne soit pas indexé/trouvable, tu peux aussi l'héberger sur **Netlify** ou **Vercel** en "non listé", ou simplement ne partager le lien qu'en interne police.

## 4. Utilisation au quotidien

- **Citoyens** : rechercher une identité, en créer une nouvelle si le joueur n'existe pas encore, consulter le casier judiciaire complet d'une personne.
- **Nouvelle interpellation** : choisir le citoyen, cocher les infractions constatées (regroupées par titre de la législation) → l'amende totale, les points et les sanctions complémentaires (garde à vue, suspension, confiscation…) se calculent automatiquement. Le montant par défaut est le **maximum** de la fourchette légale ; tu peux ajuster manuellement le référentiel dans Administration si besoin.
- **Fichés S** : réservé au Commandement (Capitaine et +) — liste et gestion des individus signalés.
- **Administration** (Commissaire et +) : gérer les grades/statuts des agents, ajuster les montants du référentiel d'infractions si la législation évolue.

## 5. Grades gérés (du plus haut au plus bas)

Commissaire Général · Commissaire Divisionnaire · Commissaire · Commandant Divisionnaire · Commandant · Capitaine · Major · Brigadier-Chef · Brigadier · Gardien de la Paix

Les seuils de permissions sont définis dans `sql/schema.sql` (fonction `mon_niveau()`) et dans `js/config.js` (`NIVEAU_DIRECTION`, `NIVEAU_COMMANDEMENT`) — modifiables si votre hiérarchie interne évolue.

## Limites actuelles / pistes d'évolution

- Pas encore de photo de profil pour les citoyens (facile à ajouter via Supabase Storage).
- Pas de journal d'audit détaillé (qui a modifié quoi) — actuellement seul l'agent créateur d'une fiche citoyen est tracé.
- Le montant de l'amende appliqué est actuellement le maximum de la fourchette légale automatiquement ; si vous préférez un champ éditable infraction par infraction, dites-le et le formulaire peut être ajusté.
