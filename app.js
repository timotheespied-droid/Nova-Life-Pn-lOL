// ============================================================
// APP - Police Nationale Nova Life
// ============================================================
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let moi = null;        // { id, matricule, nom, prenom, grade: {nom, niveau} }
let infractionsCache = [];
let citoyenCourant = null; // citoyen affiché dans le panneau détail

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.style.display = 'none'), 3200);
}

function euros(n) {
  return new Intl.NumberFormat('fr-FR').format(n) + ' €';
}

// ---------------- AUTH ----------------

// Transforme un prénom + nom RP en un identifiant technique unique
// (Supabase a besoin d'un "email" en interne, mais l'utilisateur ne voit jamais ça).
function identifiantDepuisNom(prenom, nom) {
  const nettoyer = s => (s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // enlève les accents
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ''); // enlève espaces, tirets, apostrophes...
  return `${nettoyer(prenom)}.${nettoyer(nom)}@pn-novalife.local`;
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const prenom = $('#login-prenom').value.trim();
  const nom = $('#login-nom').value.trim();
  const password = $('#login-password').value;
  const errBox = $('#login-error');
  errBox.style.display = 'none';

  const email = identifiantDepuisNom(prenom, nom);
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    errBox.textContent = "Identifiants incorrects ou compte inconnu.";
    errBox.style.display = 'block';
    return;
  }
  await bootAfterLogin();
});

$('#logout-btn').addEventListener('click', async () => {
  await sb.auth.signOut();
  location.reload();
});

async function bootAfterLogin() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return showLogin();

  const { data: agent, error } = await sb
    .from('agents')
    .select('id, matricule, nom, prenom, actif, grade:grade_id (nom, niveau)')
    .eq('id', user.id)
    .single();

  if (error || !agent || !agent.actif) {
    $('#login-error').textContent = "Ce compte n'est pas (ou plus) un compte policier actif. Contacte la Direction.";
    $('#login-error').style.display = 'block';
    await sb.auth.signOut();
    return showLogin();
  }

  moi = agent;
  showApp();
}

function showLogin() {
  $('#login-screen').classList.remove('hidden');
  $('#app-shell').classList.remove('active');
}

function showApp() {
  $('#login-screen').classList.add('hidden');
  $('#app-shell').classList.add('active');

  $('#sidebar-name').textContent = `${moi.prenom} ${moi.nom}`;
  $('#sidebar-grade').textContent = `${moi.grade.nom} · ${moi.matricule}`;

  const niveau = moi.grade.niveau;
  if (niveau < NIVEAU_COMMANDEMENT) {
    $$('.locked-commandement').forEach(el => el.classList.add('locked'));
  }
  if (niveau < NIVEAU_DIRECTION) {
    $$('.locked-direction').forEach(el => el.classList.add('locked'));
  }

  loadInfractions();
  goToView('citoyens');
}

// ---------------- NAVIGATION ----------------

$$('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    if (item.classList.contains('locked')) {
      toast("Accès réservé à un grade supérieur.");
      return;
    }
    goToView(item.dataset.view);
  });
});

function goToView(name) {
  $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === name));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${name}`));
  if (name === 'citoyens') refreshCitoyensList();
  if (name === 'interpellation') resetInterpellationForm();
  if (name === 'fiches-s') loadFichesS();
  if (name === 'admin') { loadAgents(); loadInfractionsAdmin(); }
}

// ---------------- INFRACTIONS (référentiel) ----------------

async function loadInfractions() {
  const { data, error } = await sb.from('infractions').select('*').order('categorie').order('id');
  if (error) return toast("Impossible de charger le référentiel des infractions.");
  infractionsCache = data;
}

// ---------------- CITOYENS ----------------

$('#citoyen-search').addEventListener('input', debounce(refreshCitoyensList, 250));

$('#new-citoyen-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    nom: $('#nc-nom').value.trim(),
    prenom: $('#nc-prenom').value.trim(),
    date_naissance: $('#nc-naissance').value || null,
    adresse: $('#nc-adresse').value.trim() || null,
    telephone: $('#nc-telephone').value.trim() || null,
    created_by: moi.id,
  };
  if (!payload.nom || !payload.prenom) return toast("Nom et prénom requis.");

  const { data, error } = await sb.from('citoyens').insert(payload).select().single();
  if (error) return toast("Erreur lors de la création de l'identité.");
  toast(`Identité créée : ${data.prenom} ${data.nom}`);
  $('#new-citoyen-form').reset();
  $('#new-citoyen-panel').style.display = 'none';
  refreshCitoyensList();
  openCitoyen(data.id);
});

$('#toggle-new-citoyen').addEventListener('click', () => {
  const panel = $('#new-citoyen-panel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
});

async function refreshCitoyensList() {
  const q = $('#citoyen-search').value.trim();
  let query = sb.from('citoyens').select('*').order('nom').limit(50);
  if (q) query = query.or(`nom.ilike.%${q}%,prenom.ilike.%${q}%`);
  const { data, error } = await query;
  const tbody = $('#citoyens-tbody');
  tbody.innerHTML = '';
  if (error) return toast("Erreur de chargement des citoyens.");
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Aucun résultat.</td></tr>`;
    return;
  }
  data.forEach(c => {
    const tr = document.createElement('tr');
    tr.className = 'row-click';
    tr.innerHTML = `
      <td>${c.prenom} ${c.nom}</td>
      <td>${c.date_naissance ?? '—'}</td>
      <td>${c.telephone ?? '—'}</td>
      <td>${c.fiche_s ? '<span class="badge badge-s">FICHÉ S</span>' : ''}</td>
    `;
    tr.addEventListener('click', () => openCitoyen(c.id));
    tbody.appendChild(tr);
  });
}

async function openCitoyen(id) {
  const { data: c, error } = await sb.from('citoyens').select('*').eq('id', id).single();
  if (error) return toast("Impossible de charger cette fiche.");
  citoyenCourant = c;

  const box = $('#citoyen-detail');
  box.style.display = 'block';
  box.innerHTML = `
    <h3>${c.prenom} ${c.nom} ${c.fiche_s ? '<span class="badge badge-s">FICHÉ S</span>' : ''}</h3>
    <p class="meta" style="color:var(--ink-soft);font-size:.85rem;margin-top:-6px;">
      Né(e) le ${c.date_naissance ?? '—'} · ${c.telephone ?? 'tél. inconnu'} · ${c.adresse ?? 'adresse inconnue'}
    </p>
    <div style="display:flex;gap:8px;margin:14px 0;">
      <button class="btn btn-outline" id="btn-nouvelle-interpellation-depuis-fiche">+ Interpellation</button>
      <button class="btn btn-outline locked-commandement" id="btn-toggle-fiche-s">${c.fiche_s ? 'Lever le fiché S' : 'Marquer fiché S'}</button>
    </div>
    <h4 style="margin-bottom:8px;">Casier judiciaire</h4>
    <div id="casier-list"><p class="empty-state">Chargement…</p></div>
  `;
  if (moi.grade.niveau < NIVEAU_COMMANDEMENT) {
    $('#btn-toggle-fiche-s').classList.add('locked');
  }

  $('#btn-nouvelle-interpellation-depuis-fiche').addEventListener('click', () => {
    goToView('interpellation');
    selectCitoyenForInterpellation(c);
  });
  $('#btn-toggle-fiche-s').addEventListener('click', () => toggleFicheS(c));

  loadCasier(c.id);
}

async function toggleFicheS(c) {
  if (moi.grade.niveau < NIVEAU_COMMANDEMENT) return toast("Réservé au Commandement et +.");
  let motif = null;
  if (!c.fiche_s) {
    motif = prompt("Motif du fiché S (visible uniquement des policiers) :") || 'Non précisé';
  }
  const { error } = await sb.from('citoyens')
    .update({ fiche_s: !c.fiche_s, fiche_s_motif: motif, updated_at: new Date().toISOString() })
    .eq('id', c.id);
  if (error) return toast("Erreur lors de la mise à jour.");
  toast(c.fiche_s ? "Fiché S levé." : "Fiché S enregistré.");
  openCitoyen(c.id);
  refreshCitoyensList();
}

async function loadCasier(citoyenId) {
  const { data, error } = await sb
    .from('interpellations')
    .select('*, agent:agent_id (nom, prenom, matricule)')
    .eq('citoyen_id', citoyenId)
    .order('created_at', { ascending: false });

  const box = $('#casier-list');
  if (error) { box.innerHTML = '<p class="empty-state">Erreur de chargement.</p>'; return; }
  if (!data.length) { box.innerHTML = '<p class="empty-state">Casier vierge.</p>'; return; }

  box.innerHTML = data.map(i => {
    const titres = i.infraction_ids
      .map(id => infractionsCache.find(f => f.id === id)?.titre)
      .filter(Boolean)
      .join(', ');
    const date = new Date(i.created_at).toLocaleDateString('fr-FR');
    return `
      <div style="border-bottom:1px solid var(--paper-dim);padding:10px 0;">
        <div style="display:flex;justify-content:space-between;">
          <strong style="font-size:.88rem;">${date} — ${euros(i.montant_total)}</strong>
          <span style="font-size:.78rem;color:var(--ink-soft);">${i.statut === 'annulee' ? 'ANNULÉE' : ''}</span>
        </div>
        <div style="font-size:.85rem;margin-top:2px;">${titres}</div>
        <div style="font-size:.78rem;color:var(--ink-soft);margin-top:2px;">
          Agent ${i.agent.prenom} ${i.agent.nom} (${i.agent.matricule})${i.lieu ? ' · ' + i.lieu : ''}${i.garde_a_vue ? ' · Garde à vue' : ''}
        </div>
      </div>
    `;
  }).join('');
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------------- NOUVELLE INTERPELLATION ----------------

let interpellationCitoyen = null;

function resetInterpellationForm() {
  $('#interp-citoyen-choisi').innerHTML = '';
  $('#interp-citoyen-search').value = '';
  $('#interp-citoyen-results').innerHTML = '';
  $('#interp-lieu').value = '';
  $('#interp-notes').value = '';
  renderInfractionChecklist();
  updateInterpellationTotal();
  interpellationCitoyen = citoyenCourant; // pré-remplit si on vient d'une fiche
  if (interpellationCitoyen) showChosenCitoyen();
}

$('#interp-citoyen-search').addEventListener('input', debounce(async () => {
  const q = $('#interp-citoyen-search').value.trim();
  const box = $('#interp-citoyen-results');
  if (!q) { box.innerHTML = ''; return; }
  const { data } = await sb.from('citoyens').select('*')
    .or(`nom.ilike.%${q}%,prenom.ilike.%${q}%`).limit(8);
  box.innerHTML = (data || []).map(c =>
    `<div class="nav-item" data-id="${c.id}" style="color:var(--ink);">${c.prenom} ${c.nom}</div>`
  ).join('') || '<div class="empty-state">Aucun résultat — utilise "Citoyens" pour créer l\'identité.</div>';
  $$('.nav-item', box).forEach(el => el.addEventListener('click', () => {
    selectCitoyenForInterpellation(data.find(c => c.id === el.dataset.id));
  }));
}, 250));

function selectCitoyenForInterpellation(c) {
  interpellationCitoyen = c;
  $('#interp-citoyen-results').innerHTML = '';
  $('#interp-citoyen-search').value = '';
  showChosenCitoyen();
}

function showChosenCitoyen() {
  const c = interpellationCitoyen;
  $('#interp-citoyen-choisi').innerHTML = c
    ? `<div class="badge badge-ok">${c.prenom} ${c.nom}</div>`
    : '';
}

function renderInfractionChecklist() {
  const box = $('#infraction-checklist');
  const cats = { comportement: 'Titre I — Attitudes envers les forces de l\'ordre', route: 'Titre II — Code de la route' };
  box.innerHTML = Object.entries(cats).map(([key, label]) => `
    <h4 style="margin:14px 0 6px;font-size:.85rem;color:var(--ink-soft);">${label}</h4>
    ${infractionsCache.filter(f => f.categorie === key).map(f => `
      <label class="infraction-row">
        <input type="checkbox" data-id="${f.id}" class="infraction-check">
        <span>
          <div class="titre">${f.titre}</div>
          <div class="meta">
            ${f.amende_min === f.amende_max ? euros(f.amende_min) : euros(f.amende_min) + ' – ' + euros(f.amende_max)}
            ${f.points ? ' · ' + f.points + ' pts' : ''}
            ${f.garde_a_vue ? ' · Garde à vue possible' : ''}
            ${f.peine ? ' · ' + f.peine : ''}
          </div>
        </span>
      </label>
    `).join('')}
  `).join('');
  $$('.infraction-check', box).forEach(cb => cb.addEventListener('change', updateInterpellationTotal));
}

function updateInterpellationTotal() {
  const checked = $$('.infraction-check:checked').map(cb => infractionsCache.find(f => f.id == cb.dataset.id));
  const total = checked.reduce((sum, f) => sum + f.amende_max, 0);
  const peines = checked.map(f => f.peine).filter(Boolean);
  const gav = checked.some(f => f.garde_a_vue);
  $('#interp-total').textContent = euros(total);
  $('#interp-peines').textContent = peines.length ? peines.join(' ; ') : 'Aucune sanction complémentaire.';
  $('#interp-gav').textContent = gav ? 'Oui' : 'Non';
}

$('#interpellation-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!interpellationCitoyen) return toast("Sélectionne d'abord un citoyen.");
  const checked = $$('.infraction-check:checked').map(cb => Number(cb.dataset.id));
  if (!checked.length) return toast("Sélectionne au moins une infraction.");

  const infs = checked.map(id => infractionsCache.find(f => f.id === id));
  const montant_total = infs.reduce((s, f) => s + f.amende_max, 0);
  const peine_appliquee = infs.map(f => f.peine).filter(Boolean).join(' ; ') || null;
  const garde_a_vue = infs.some(f => f.garde_a_vue);

  const { error } = await sb.from('interpellations').insert({
    citoyen_id: interpellationCitoyen.id,
    agent_id: moi.id,
    infraction_ids: checked,
    montant_total,
    peine_appliquee,
    garde_a_vue,
    lieu: $('#interp-lieu').value.trim() || null,
    notes: $('#interp-notes').value.trim() || null,
  });
  if (error) return toast("Erreur lors de l'enregistrement.");
  toast(`Interpellation enregistrée — ${euros(montant_total)}`);
  resetInterpellationForm();
});

// ---------------- FICHÉS S ----------------

async function loadFichesS() {
  const { data, error } = await sb.from('citoyens').select('*').eq('fiche_s', true).order('nom');
  const box = $('#fiches-s-list');
  if (error) return (box.innerHTML = '<p class="empty-state">Erreur de chargement.</p>');
  if (!data.length) return (box.innerHTML = '<p class="empty-state">Aucun fiché S actuellement.</p>');
  box.innerHTML = data.map(c => `
    <div class="card" style="cursor:pointer;" data-id="${c.id}">
      <strong>${c.prenom} ${c.nom}</strong>
      <div style="font-size:.85rem;color:var(--ink-soft);margin-top:4px;">${c.fiche_s_motif ?? 'Motif non précisé'}</div>
    </div>
  `).join('');
  $$('.card', box).forEach(el => el.addEventListener('click', () => {
    goToView('citoyens');
    openCitoyen(el.dataset.id);
  }));
}

// ---------------- ADMIN : agents ----------------

async function loadAgents() {
  if (moi.grade.niveau < NIVEAU_DIRECTION) return;
  const { data: grades } = await sb.from('grades').select('*').order('niveau');
  const sel = $('#new-agent-grade');
  sel.innerHTML = grades.map(g => `<option value="${g.id}">${g.nom}</option>`).join('');

  const { data, error } = await sb.from('agents').select('*, grade:grade_id (nom, niveau)').order('nom');
  const tbody = $('#agents-tbody');
  if (error) { tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Erreur.</td></tr>'; return; }
  tbody.innerHTML = data.map(a => `
    <tr>
      <td>${a.prenom} ${a.nom}</td>
      <td class="mono">${a.matricule}</td>
      <td>
        <select data-agent="${a.id}" class="agent-grade-select">
          ${grades.map(g => `<option value="${g.id}" ${g.id === a.grade_id ? 'selected' : ''}>${g.nom}</option>`).join('')}
        </select>
      </td>
      <td>${a.actif ? '<span class="badge badge-ok">Actif</span>' : '<span class="badge badge-s">Inactif</span>'}</td>
      <td><button class="btn btn-outline agent-toggle-actif" data-agent="${a.id}" data-actif="${a.actif}">${a.actif ? 'Désactiver' : 'Réactiver'}</button></td>
    </tr>
  `).join('');

  $$('.agent-grade-select', tbody).forEach(sel => sel.addEventListener('change', async () => {
    const { error } = await sb.from('agents').update({ grade_id: Number(sel.value) }).eq('id', sel.dataset.agent);
    toast(error ? "Erreur." : "Grade mis à jour.");
  }));
  $$('.agent-toggle-actif', tbody).forEach(btn => btn.addEventListener('click', async () => {
    const actif = btn.dataset.actif === 'true';
    const { error } = await sb.from('agents').update({ actif: !actif }).eq('id', btn.dataset.agent);
    if (error) return toast("Erreur.");
    loadAgents();
  }));
}

function updateNewAgentEmailPreview() {
  const prenom = $('#new-agent-prenom').value.trim();
  const nom = $('#new-agent-nom').value.trim();
  const preview = $('#new-agent-email-preview');
  if (!preview) return;
  preview.textContent = (prenom && nom)
    ? `Crée d'abord ce compte dans Supabase (Authentication → Add user) avec l'email : ${identifiantDepuisNom(prenom, nom)}`
    : '';
}
$('#new-agent-nom')?.addEventListener('input', updateNewAgentEmailPreview);
$('#new-agent-prenom')?.addEventListener('input', updateNewAgentEmailPreview);

$('#new-agent-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    id: $('#new-agent-uid').value.trim(),
    matricule: $('#new-agent-matricule').value.trim(),
    nom: $('#new-agent-nom').value.trim(),
    prenom: $('#new-agent-prenom').value.trim(),
    grade_id: Number($('#new-agent-grade').value),
  };
  if (!payload.id || !payload.matricule || !payload.nom || !payload.prenom) {
    return toast("Tous les champs sont requis (dont l'UID Supabase, voir README).");
  }
  const { error } = await sb.from('agents').insert(payload);
  if (error) return toast("Erreur : vérifie que l'UID existe bien dans Authentication.");
  toast("Agent ajouté.");
  $('#new-agent-form').reset();
  loadAgents();
});

// ---------------- ADMIN : infractions ----------------

async function loadInfractionsAdmin() {
  if (moi.grade.niveau < NIVEAU_DIRECTION) return;
  const tbody = $('#infractions-tbody');
  tbody.innerHTML = infractionsCache.map(f => `
    <tr>
      <td style="max-width:220px;">${f.titre}</td>
      <td><input type="number" class="inf-edit" data-id="${f.id}" data-field="amende_min" value="${f.amende_min}" style="width:80px;"></td>
      <td><input type="number" class="inf-edit" data-id="${f.id}" data-field="amende_max" value="${f.amende_max}" style="width:80px;"></td>
      <td><input type="number" class="inf-edit" data-id="${f.id}" data-field="points" value="${f.points}" style="width:60px;"></td>
    </tr>
  `).join('');
  $$('.inf-edit', tbody).forEach(inp => inp.addEventListener('change', async () => {
    const { error } = await sb.from('infractions')
      .update({ [inp.dataset.field]: Number(inp.value) })
      .eq('id', inp.dataset.id);
    if (error) return toast("Erreur (droits insuffisants ?).");
    toast("Infraction mise à jour.");
    loadInfractions();
  }));
}

// ---------------- BOOT ----------------

(async function init() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) await bootAfterLogin();
  else showLogin();
})();
