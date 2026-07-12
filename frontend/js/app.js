// ============================================================
// AI Sales Agent — frontend logic
// Talks to the FastAPI backend running on the same origin
// (started with: uvicorn app.main:app  -> http://localhost:8000)
// ============================================================

const API_BASE = ""; // same-origin: FastAPI serves this frontend too

// ---------------- Nav toggle (unchanged) ----------------
const navToggle = document.querySelector('[data-nav-toggle]');
const navLinks = document.querySelector('[data-nav-links]');
const navActions = document.querySelector('[data-nav-actions]');

if (navToggle && navLinks && navActions) {
  navToggle.addEventListener('click', () => {
    const open = navToggle.getAttribute('aria-expanded') === 'true';
    navToggle.setAttribute('aria-expanded', String(!open));
    navLinks.classList.toggle('open', !open);
    navActions.classList.toggle('open', !open);
    document.body.classList.toggle('menu-open', !open);
  });

  [...navLinks.querySelectorAll('a'), ...navActions.querySelectorAll('a')].forEach((link) => {
    link.addEventListener('click', () => {
      navToggle.setAttribute('aria-expanded', 'false');
      navLinks.classList.remove('open');
      navActions.classList.remove('open');
      document.body.classList.remove('menu-open');
    });
  });
}

// ---------------- Auth helpers ----------------
function getToken() {
  return localStorage.getItem('solarAiToken');
}
function setSession(token, businessName) {
  localStorage.setItem('solarAiToken', token);
  localStorage.setItem('solarAiBusiness', businessName || '');
}
function clearSession() {
  localStorage.removeItem('solarAiToken');
  localStorage.removeItem('solarAiBusiness');
}
function isLoggedIn() {
  return !!getToken();
}

async function apiFetch(path, options = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    let detail = 'Something went wrong. Please try again.';
    try {
      const data = await res.json();
      detail = data.detail || detail;
    } catch (_) {}
    throw new Error(detail);
  }
  return res;
}

// ---------------- Auth forms (Signup / Login) ----------------
function setupForms() {
  const signupForm = document.querySelector('[data-signup-form]');
  if (signupForm) {
    signupForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const business = signupForm.querySelector('#business')?.value.trim();
      const email = signupForm.querySelector('#email')?.value.trim();
      const password = signupForm.querySelector('#password')?.value.trim();

      if (!business || !email || !password) {
        alert('Please fill in all fields.');
        return;
      }

      try {
        const res = await apiFetch('/api/auth/signup', {
          method: 'POST',
          body: JSON.stringify({ business_name: business, email, password }),
        });
        const data = await res.json();
        setSession(data.access_token, data.business_name);
        window.location.href = 'dashboard.html';
      } catch (err) {
        alert(err.message);
      }
    });
  }

  const loginForm = document.querySelector('[data-login-form]');
  if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = loginForm.querySelector('#email')?.value.trim();
      const password = loginForm.querySelector('#password')?.value.trim();
      if (!email || !password) return;

      try {
        const res = await apiFetch('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        setSession(data.access_token, data.business_name);
        window.location.href = 'dashboard.html';
      } catch (err) {
        alert(err.message);
      }
    });
  }
}

// ---------------- Dashboard (Leads pipeline) ----------------
function statusClass(status) {
  return String(status || '').toLowerCase().replace(/\s+/g, '-');
}

async function fetchLeads() {
  try {
    const res = await apiFetch('/api/leads');
    return await res.json();
  } catch (err) {
    console.error('Failed to load leads:', err.message);
    return [];
  }
}

async function renderDashboard() {
  const tableBody = document.querySelector('[data-lead-table]');
  const mobileList = document.querySelector('[data-lead-cards]');
  const total = document.querySelector('[data-total-leads]');
  const newCount = document.querySelector('[data-new-leads]');
  const hotCount = document.querySelector('[data-hot-leads]');
  const followUps = document.querySelector('[data-follow-ups]');
  const search = document.querySelector('[data-lead-search]');
  const select = document.querySelector('[data-status-filter]');

  if (!tableBody && !mobileList) return;

  const allLeads = await fetchLeads();

  const paint = () => {
    const q = (search?.value || '').trim().toLowerCase();
    const selected = select?.value || 'All';
    const leads = allLeads.filter((lead) => {
      const text = `${lead.customer_name} ${lead.city} ${lead.interest} ${lead.phone_number} ${lead.note}`.toLowerCase();
      const statusOk = selected === 'All' || lead.status === selected;
      return statusOk && (!q || text.includes(q));
    });

    if (tableBody) {
      tableBody.innerHTML = leads.map((lead) => `
        <tr>
          <td><div class="lead-name">${lead.customer_name}</div><span class="lead-sub">${lead.city}</span></td>
          <td>${lead.interest}</td>
          <td>${lead.phone_number}</td>
          <td>${lead.note}</td>
        </tr>
      `).join('');
    }

    if (mobileList) {
      mobileList.innerHTML = leads.map((lead) => `
        <article class="lead-card-mobile">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
            <div><div class="lead-name">${lead.customer_name}</div><span class="lead-sub">${lead.city}</span></div>
            <span class="status ${statusClass(lead.status || 'New')}">${lead.status || 'New'}</span>
          </div>
          <div class="row"><span>Interest</span><strong>${lead.interest}</strong></div>
          <div class="row"><span>Contact</span><strong>${lead.phone_number}</strong></div>
          <p style="margin:10px 0 0;color:var(--muted);">${lead.note}</p>
        </article>
      `).join('');
    }

    if (total) total.textContent = allLeads.length;
    if (newCount) newCount.textContent = allLeads.filter((l) => l.status === 'New').length;
    if (hotCount) hotCount.textContent = allLeads.filter((l) => l.status === 'Hot').length;
    if (followUps) followUps.textContent = Math.max(0, allLeads.filter((l) => l.status !== 'Closed').length);
  };

  search?.addEventListener('input', paint);
  select?.addEventListener('change', paint);
  paint();
}

// ---------------- Voice Assistant ----------------
function getSessionId() {
  let id = sessionStorage.getItem('solarAiSessionId');
  if (!id) {
    id = 'sess-' + Math.random().toString(36).slice(2) + Date.now();
    sessionStorage.setItem('solarAiSessionId', id);
  }
  return id;
}

async function sendChatMessage(text) {
  const res = await apiFetch('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ session_id: getSessionId(), message: text }),
  });
  return res.json(); // { reply, stage, lead_captured }
}

async function playSpeech(text) {
  try {
    const res = await fetch(`${API_BASE}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return; // TTS optional - fail silently (e.g. no internet for gTTS)
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.play().catch(() => {});
  } catch (_) {
    // Non-fatal: text reply is already shown, audio is a bonus.
  }
}

function setupAssistant() {
  const micButton = document.querySelector('[data-mic-button]');
  const status = document.querySelector('[data-assistant-status]');
  const title = document.querySelector('[data-console-title]');
  const copy = document.querySelector('[data-console-copy]');
  const windowEl = document.querySelector('[data-chat-window]');
  const input = document.querySelector('[data-chat-input]');
  const send = document.querySelector('[data-chat-send]');
  const chips = document.querySelectorAll('[data-prompt]');

  if (!micButton || !windowEl) return;

  const addMessage = (text, type = 'agent') => {
    const msg = document.createElement('div');
    msg.className = `message ${type}`;
    msg.textContent = text;
    windowEl.appendChild(msg);
    windowEl.scrollTop = windowEl.scrollHeight;
  };

  const handleCustomerText = async (text) => {
    if (!text || !text.trim()) return;
    addMessage(text, 'customer');
    if (status) status.textContent = 'Thinking';
    try {
      const data = await sendChatMessage(text);
      addMessage(data.reply, 'agent');
      playSpeech(data.reply);
      if (data.lead_captured && copy) {
        copy.textContent = 'Lead captured! It now appears on the admin dashboard.';
      }
    } catch (err) {
      addMessage('Sorry, I could not reach the AI backend. Please make sure the FastAPI server is running.', 'agent');
    } finally {
      if (status) status.textContent = 'Online';
    }
  };

  // ----- Text input fallback (works everywhere, incl. Firefox) -----
  const sendMessage = (text) => {
    const value = (text || input?.value || '').trim();
    if (!value) return;
    if (input) input.value = '';
    handleCustomerText(value);
  };
  send?.addEventListener('click', () => sendMessage());
  input?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') sendMessage();
  });
  chips.forEach((chip) => chip.addEventListener('click', () => sendMessage(chip.textContent)));

  // ----- Real voice input via the Web Speech API -----
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let listening = false;

  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      handleCustomerText(transcript);
    };
    recognition.onerror = () => {
      listening = false;
      micButton.classList.remove('listening');
      if (status) status.textContent = 'Online';
      if (title) title.textContent = 'Tap the microphone to start';
    };
    recognition.onend = () => {
      listening = false;
      micButton.classList.remove('listening');
      if (status) status.textContent = 'Online';
      if (title) title.textContent = 'Tap the microphone to start';
    };
  }

  micButton.addEventListener('click', () => {
    if (!recognition) {
      if (copy) copy.textContent = 'Voice recognition is not supported in this browser. Please type your message below, or use Chrome/Edge.';
      return;
    }

    listening = !listening;
    micButton.classList.toggle('listening', listening);
    if (status) status.textContent = listening ? 'Listening' : 'Online';
    if (title) title.textContent = listening ? 'Listening to the customer' : 'Tap the microphone to start';
    if (copy) copy.textContent = listening ? 'Speak now — I am listening.' : 'The assistant can answer solar product questions.';

    if (listening) {
      recognition.start();
    } else {
      recognition.stop();
    }
  });

  // Greet on first load of a brand-new session
  if (!sessionStorage.getItem('solarAiGreeted')) {
    sessionStorage.setItem('solarAiGreeted', '1');
  }
}

// ---------------- Products filter (unchanged) ----------------
function setupProducts() {
  const select = document.querySelector('[data-product-filter]');
  const cards = document.querySelectorAll('[data-product-card]');
  if (!select || !cards.length) return;
  select.addEventListener('change', () => {
    const value = select.value;
    cards.forEach((card) => {
      card.style.display = value === 'All' || card.dataset.productCard === value ? '' : 'none';
    });
  });
}

// ---------------- Dashboard protection + logout ----------------
function checkAuthAndSetupLogout() {
  const isDashboardPage = window.location.pathname.includes('dashboard.html');

  if (isDashboardPage && !isLoggedIn()) {
    window.location.href = 'login.html';
    return;
  }

  const logoutBtn = document.querySelector('[data-logout]');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      clearSession();
      window.location.href = 'login.html';
    });
  }
}

// ---------------- Boot ----------------
document.addEventListener('DOMContentLoaded', () => {
  checkAuthAndSetupLogout();
  renderDashboard();
  setupAssistant();
  setupForms();
  setupProducts();
});
