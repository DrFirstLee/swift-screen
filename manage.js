const API = (localStorage.getItem('swift_api_base') && localStorage.getItem('swift_api_base') !== 'undefined') 
            ? localStorage.getItem('swift_api_base') 
            : "https://swift-medical-api.naranja.my";
let lastVer = -1;
let cachedData = null;
let dragItem = null;
let dragSource = null;

// ── Auth ──
async function handleLogin() {
    const u = document.getElementById('username').value;
    const p = document.getElementById('password').value;
    try {
        const res = await fetch(`${API}/login`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:u,password:p}) });
        if (res.ok) { const d = await res.json(); localStorage.setItem('swift_token',d.token); localStorage.setItem('swift_api_base',API); checkAuth(); }
        else document.getElementById('loginError').innerText = "Login failed.";
    } catch(e) { document.getElementById('loginError').innerText = "Connection error."; }
}
function handleLogout() { localStorage.removeItem('swift_token'); localStorage.removeItem('swift_api_base'); checkAuth(); }
function checkAuth() {
    const t = localStorage.getItem('swift_token');
    document.getElementById('loginContainer').style.display = (t && t!=="undefined") ? 'none' : 'flex';
    document.getElementById('mainApp').style.display = (t && t!=="undefined") ? 'flex' : 'none';
    if (t && t!=="undefined") fetchData(true);
}

// ── Data ──
async function fetchData(force) {
    try {
        const r = await fetch(`${API}/screen-data`);
        if (!r.ok) {
            console.error("[Data] Fetch failed status:", r.status);
            return;
        }
        const d = await r.json();
        // console.log("[Data] Received from server:", d);
        
        if (d.version !== lastVer || force) {
            console.log(`[Data] Updating UI: v${lastVer} -> v${d.version} (force: ${force})`);
            lastVer = d.version;
            cachedData = d;
            renderAll(d);
        }
    } catch(e) {
        console.error("[Data] Fetch error:", e);
    }
}

function renderAll(d) {
    try {
        renderList('internalItems', d.internal_waitlist || [], 'internal_waitlist');
        renderList('reservationItems', d.waiting_reservation || [], 'waiting_reservation');
        renderList('walkinItems', d.waiting_walkin || [], 'waiting_walkin');
        renderList('screenItems', d.screen_list || [], 'screen_list');
        
        document.getElementById('cntInternal').textContent = (d.internal_waitlist||[]).length;
        document.getElementById('cntRes').textContent = (d.waiting_reservation||[]).length;
        document.getElementById('cntWalk').textContent = (d.waiting_walkin||[]).length;
        document.getElementById('cntScreen').textContent = (d.screen_list||[]).length;
        
        console.log("[Render] Doctors list:", d.doctors);
        renderDoctors(d.doctors || []);
        updateDoctorSelects(d.doctors || []);
        
        if (!document.getElementById('defaultMsg').value && d.default_message) {
            document.getElementById('defaultMsg').value = d.default_message;
        }
    } catch (err) {
        console.error("[Render] Error in renderAll:", err);
    }
}

function renderList(containerId, items, listName) {
    const el = document.getElementById(containerId);
    if (!items.length) { el.innerHTML = '<div style="color:#94a3b8;text-align:center;padding:20px;font-size:13px;">Empty</div>'; return; }
    el.innerHTML = '';
    items.forEach((item, i) => {
        const card = document.createElement('div');
        card.className = 'p-card';
        card.draggable = true;
        card.dataset.id = item.id;
        card.dataset.list = listName;
        const typeTag = item.type === 'reservation' ? '<span class="tag res">R</span>' : '<span class="tag walk">W</span>';
        card.innerHTML = `<div class="p-card-top"><span class="p-num">${i+1}</span><strong>${esc(item.firstName)} ${esc(item.lastName)}</strong>${typeTag}${item.doctor?'<span class="tag doc">'+esc(item.doctor)+'</span>':''}</div><div class="p-note">${esc(item.internalNote||'')}</div><div class="p-actions"><button onclick="openEdit('${item.id}')">✏️</button><button onclick="deletePatient('${item.id}')">✕</button></div>`;
        card.addEventListener('dragstart', onDragStart);
        card.addEventListener('dragend', onDragEnd);
        el.appendChild(card);
    });
}

function renderDoctors(docs) {
    const el = document.getElementById('doctorList');
    if (!docs.length) { el.innerHTML = '<span style="color:#94a3b8">No doctors</span>'; return; }
    el.innerHTML = docs.map(d => `<span class="doc-chip">${esc(d)} <button onclick="removeDoctor('${esc(d)}')">×</button></span>`).join('');
}

function updateDoctorSelects(docs) {
    document.querySelectorAll('.doctor-select').forEach(sel => {
        const val = sel.value;
        sel.innerHTML = '<option value="">No doctor</option>' + docs.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('');
        sel.value = val;
    });
}

// ── Drag & Drop ──
function onDragStart(e) {
    dragItem = e.target.closest('.p-card');
    dragSource = dragItem.dataset.list;
    dragItem.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragItem.dataset.id);
}
function onDragEnd(e) { if(dragItem) dragItem.classList.remove('dragging'); dragItem=null; dragSource=null; document.querySelectorAll('.drop-zone').forEach(z=>z.classList.remove('drag-over')); }

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.drop-zone').forEach(zone => {
        zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
        zone.addEventListener('drop', e => {
            e.preventDefault(); zone.classList.remove('drag-over');
            const targetList = zone.dataset.list;
            const patientId = e.dataTransfer.getData('text/plain');
            if (!patientId || !targetList) return;
            if (dragSource === targetList) return;
            openMoveModal(patientId, targetList);
        });
    });
    checkAuth();
    setInterval(() => { if(document.getElementById('mainApp').style.display!=='none') fetchData(); }, 3000);
});

// ── Move Modal ──
function openMoveModal(patientId, targetList) {
    const patient = findPatient(patientId);
    if (!patient) return;
    const modal = document.getElementById('moveModal');
    const listLabels = { internal_waitlist:'Internal Waitlist', waiting_reservation:'Waiting (Reservation)', waiting_walkin:'Waiting (Walk-in)', screen_list:'Screen List' };
    document.getElementById('moveInfo').innerHTML = `<strong>${esc(patient.firstName)} ${esc(patient.lastName)}</strong> → <strong>${listLabels[targetList]||targetList}</strong>`;
    
    // Show room/externalNote fields only when moving to screen_list
    const extraFields = document.getElementById('moveExtraFields');
    if (targetList === 'screen_list') {
        extraFields.style.display = 'block';
        document.getElementById('moveRoom').value = patient.room || '';
        document.getElementById('moveExtNote').value = patient.externalNote || '';
    } else {
        extraFields.style.display = 'none';
    }
    
    modal.style.display = 'flex';
    document.getElementById('confirmMoveBtn').onclick = async () => {
        const updates = {};
        if (targetList === 'screen_list') {
            updates.room = document.getElementById('moveRoom').value;
            updates.externalNote = document.getElementById('moveExtNote').value;
        }
        await fetch(`${API}/screen-move-patient`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ patient_id:patientId, target_list:targetList, updates }) });
        modal.style.display = 'none';
        fetchData(true);
        showToast('Patient moved');
    };
    document.getElementById('cancelMoveBtn').onclick = () => { modal.style.display = 'none'; };
}

function findPatient(id) {
    if (!cachedData) return null;
    for (const list of ['internal_waitlist','waiting_reservation','waiting_walkin','screen_list']) {
        const found = (cachedData[list]||[]).find(p => p.id === id);
        if (found) return found;
    }
    return null;
}

// ── Edit Modal ──
function openEdit(id) {
    const p = findPatient(id);
    if (!p) return;
    document.getElementById('editId').value = id;
    document.getElementById('editFirst').value = p.firstName;
    document.getElementById('editLast').value = p.lastName;
    document.getElementById('editIntNote').value = p.internalNote||'';
    document.getElementById('editExtNote').value = p.externalNote||'';
    document.getElementById('editType').value = p.type||'walkin';
    document.getElementById('editDoctor').value = p.doctor||'';
    document.getElementById('editRoom').value = p.room||'';
    document.getElementById('editModal').style.display = 'flex';
}
async function saveEdit() {
    const id = document.getElementById('editId').value;
    const data = { firstName:document.getElementById('editFirst').value, lastName:document.getElementById('editLast').value, internalNote:document.getElementById('editIntNote').value, externalNote:document.getElementById('editExtNote').value, type:document.getElementById('editType').value, doctor:document.getElementById('editDoctor').value, room:document.getElementById('editRoom').value };
    await fetch(`${API}/screen-update-patient/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
    document.getElementById('editModal').style.display = 'none';
    fetchData(true);
    showToast('Patient updated');
}

// ── Add Patient ──
async function addPatient() {
    const fn = document.getElementById('addFirst').value.trim();
    const ln = document.getElementById('addLast').value.trim();
    if (!fn || !ln) return alert('Name required');
    const data = { firstName:fn, lastName:ln, internalNote:document.getElementById('addIntNote').value.trim(), externalNote:'', type:document.getElementById('addType').value, doctor:document.getElementById('addDoctor').value, room:'' };
    await fetch(`${API}/screen-add-patient`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
    document.getElementById('addModal').style.display = 'none';
    document.getElementById('addFirst').value=''; document.getElementById('addLast').value=''; document.getElementById('addIntNote').value='';
    fetchData(true);
    showToast('Patient added');
}

// ── Delete ──
async function deletePatient(id) {
    if (!confirm('Delete this patient?')) return;
    await fetch(`${API}/screen-delete-patient/${id}`, { method:'DELETE' });
    fetchData(true);
    showToast('Patient deleted');
}

// ── Clear All ──
async function clearAll() {
    if (!confirm('Clear ALL lists?')) return;
    await fetch(`${API}/screen-clear`, { method:'DELETE' });
    fetchData(true);
    showToast('All cleared');
}

// ── Doctors ──
async function addDoctor() {
    const input = document.getElementById('newDoctorName');
    const name = input.value.trim();
    if (!name) return;
    
    console.log("[Doctor] Adding:", name);
    try {
        const resp = await fetch(`${API}/screen-doctors`, { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ name }) 
        });
        
        if (resp.ok) {
            console.log("[Doctor] Add success");
            input.value = '';
            await fetchData(true);
            showToast('Doctor added');
        } else {
            const err = await resp.json();
            console.error("[Doctor] Add failed:", err);
            alert("Failed to add doctor: " + (err.message || "Unknown error"));
        }
    } catch (e) {
        console.error("[Doctor] Connection error:", e);
        alert("Connection error while adding doctor.");
    }
}
async function removeDoctor(name) {
    await fetch(`${API}/screen-doctors/${encodeURIComponent(name)}`, { method:'DELETE' });
    fetchData(true);
}

// ── Config ──
async function saveConfig() {
    const msg = document.getElementById('defaultMsg').value.trim();
    if (!msg) return;
    await fetch(`${API}/screen-config`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({default_message:msg}) });
    showToast('Config saved');
}

// ── Util ──
function esc(t) { const d=document.createElement('div'); d.textContent=t; return d.innerHTML; }
function showToast(msg) { const t=document.getElementById('toast'); document.getElementById('toastMsg').textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2500); }
