// ==========================================================================
// GLOBALS & DUMMY STORAGE
// ==========================================================================
let dummyLeads = [
    { name: "Zubair Ahmed", phone: "0300-1234567", email: "zubair@gmail.com", product: "10kW Hybrid System", status: "Hot", note: "Wants to install next week, talking about installment plan." },
    { name: "Kamran Khan", phone: "0321-7654321", email: "kamran@yahoo.com", product: "5kW On-Grid System", status: "Warm", note: "Asked about net metering process and solar plates brand." },
    { name: "Ayesha Siddiqua", phone: "0333-9876543", email: "ayesha@outlook.com", product: "7kW Inverter System", status: "New", note: "Left contact details via voice assistant, requested a call back." }
];

const aiResponses = [
    "That sounds like a great requirement! Our solar panel solutions offer up to 25 years of warranty. May I know your name and contact number to arrange a final quota for you?",
    "For this scale, net metering will help you send excess electricity back to the grid and reduce your bill to zero. Can you share your phone number so our technical advisor can contact you?",
    "Perfect! We offer flexible installment plans for 5kW, 10kW, and 15kW packages. Please share your email address or phone number so I can register a slot for you?",
    "I have noted down your interest. Please share your full name and phone number so our team can execute a structural survey of your site."
];

// ==========================================================================
// INITIALIZATION ON LOAD
// ==========================================================================
document.addEventListener("DOMContentLoaded", () => {
    initNavbarToggle();
    
    if (document.querySelector("[data-signup-form]")) initDummySignup();
    if (document.querySelector("[data-login-form]")) initDummyLogin();
    if (document.querySelector("[data-lead-table]")) renderDummyDashboard();
    if (document.querySelector("[data-chat-window]")) initDummyAssistant();
    if (document.querySelector("[data-product-card]")) initProductFilters();
});

// ==========================================================================
// 1. HAMBURGER MENU FIX
// ==========================================================================
function initNavbarToggle() {
    const toggleBtn = document.querySelector('[data-nav-toggle]');
    const navLinks = document.querySelector('[data-nav-links]');
    const navActions = document.querySelector('[data-nav-actions]');

    if (toggleBtn && navLinks) {
        toggleBtn.addEventListener("click", () => {
            const isOpen = toggleBtn.getAttribute("aria-expanded") === "true";
            toggleBtn.setAttribute("aria-expanded", String(!isOpen));
            
            navLinks.classList.toggle("open", !isOpen);
            if (navActions) navActions.classList.toggle("open", !isOpen);
            document.body.classList.toggle("menu-open", !isOpen);
        });
    }
}

// ==========================================================================
// 2. DUMMY AUTH LOGIC
// ==========================================================================
function initDummySignup() {
    document.querySelector("[data-signup-form]").addEventListener("submit", (e) => {
        e.preventDefault();
        alert("Account Created Successfully! Redirecting to dashboard...");
        window.location.href = "dashboard.html";
    });
}

function initDummyLogin() {
    document.querySelector("[data-login-form]").addEventListener("submit", (e) => {
        e.preventDefault();
        window.location.href = "dashboard.html";
    });
}

// ==========================================================================
// 3. VOICE & TEXT ASSISTANT FUNCTIONALITY (FIXED MIC SELECTION)
// ==========================================================================
function initDummyAssistant() {
    const chatWindow = document.querySelector("[data-chat-window]");
    const chatInput = document.querySelector("[data-chat-input]");
    const sendBtn = document.querySelector("[data-chat-send]");
    const statusDot = document.querySelector("[data-assistant-status]");
    const promptChips = document.querySelectorAll("[data-prompt]");
    
    // Fixed mic button selection matching your HTML elements layout
    const micBtn = document.querySelector(".orb-area button") || document.querySelector(".orb") || document.querySelector(".orb-area");

    function appendMessage(text, sender) {
        const msg = document.createElement("div");
        msg.className = `message ${sender}`;
        msg.innerText = text;
        chatWindow.appendChild(msg);
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }

    function processAiReply(userText) {
        if (statusDot) statusDot.innerText = "Typing...";
        
        setTimeout(() => {
            let reply = aiResponses[Math.floor(Math.random() * aiResponses.length)];
            appendMessage(reply, "agent");
            if (statusDot) statusDot.innerText = "Online";

            // If user enters number details, auto-inject row directly into real-time local array
            const phoneMatch = userText.match(/\d{5,15}/);
            if (phoneMatch) {
                const newLead = {
                    name: "Voice Capture Client",
                    phone: phoneMatch[0],
                    email: "captured@ai-agent.live",
                    product: "Solar Package Quote",
                    status: "Hot",
                    note: `Simulated query capture: "${userText}"`
                };
                dummyLeads.unshift(newLead);
                // Dynamically update dashboard view state data array
                localStorage.setItem("savedLeads", JSON.stringify(dummyLeads));
            }
        }, 1200);
    }

    function handleSend() {
        const text = chatInput.value.trim();
        if (!text) return;
        appendMessage(text, "user");
        chatInput.value = "";
        processAiReply(text);
    }

    if (sendBtn && chatInput) {
        sendBtn.addEventListener("click", handleSend);
        chatInput.addEventListener("keypress", (e) => { if (e.key === "Enter") handleSend(); });
    }

    promptChips.forEach(chip => {
        chip.addEventListener("click", () => {
            appendMessage(chip.innerText, "user");
            processAiReply(chip.innerText);
        });
    });

    // Microphone interaction sequence simulator mapping
    if (micBtn) {
        micBtn.addEventListener("click", () => {
            const innerOrb = document.querySelector(".orb") || micBtn;
            innerOrb.style.transform = "scale(1.15)";
            innerOrb.style.boxShadow = "0 0 25px var(--primary)";
            
            if (statusDot) statusDot.innerText = "Listening...";
            
            setTimeout(() => {
                innerOrb.style.transform = "none";
                innerOrb.style.boxShadow = "none";
                
                const voicePhrases = [
                    "I want a quote for 10kW solar system my number is 03001234567",
                    "What is the total package price with battery backup?",
                    "My name is Ahmed, arrange a call back for industrial net metering"
                ];
                const simulatedVoice = voicePhrases[Math.floor(Math.random() * voicePhrases.length)];
                appendMessage(simulatedVoice, "user");
                if (statusDot) statusDot.innerText = "Online";
                processAiReply(simulatedVoice);
            }, 2000);
        });
    }
}

// ==========================================================================
// 4. DUMMY DASHBOARD DATA GENERATOR
// ==========================================================================
function renderDummyDashboard() {
    const tableBody = document.querySelector("[data-lead-table]");
    
    // Sync leads if any updates happened in current window state session
    const storedLeads = localStorage.getItem("savedLeads");
    if (storedLeads) {
        dummyLeads = JSON.parse(storedLeads);
    }

    if (document.querySelector("[data-total-leads]")) {
        document.querySelector("[data-total-leads]").innerText = dummyLeads.length;
        document.querySelector("[data-new-leads]").innerText = dummyLeads.filter(l => l.status === "New").length || 1;
        document.querySelector("[data-hot-leads]").innerText = dummyLeads.filter(l => l.status === "Hot").length || 2;
    }

    if (!tableBody) return;
    tableBody.innerHTML = "";

    dummyLeads.forEach(lead => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>
                <div style="font-weight:bold; color:var(--text);">${lead.name}</div>
                <div style="font-size:0.85rem; color:var(--muted);">${lead.email}</div>
            </td>
            <td>
                <span class="badge ${lead.status.toLowerCase()}">${lead.status}</span>
                <div style="font-size:0.9rem; margin-top:4px;">${lead.product}</div>
            </td>
            <td style="font-family:monospace; color:var(--primary);">${lead.phone}</td>
            <td style="max-width:300px; font-size:0.9rem; color:var(--text);">${lead.note}</td>
        `;
        tableBody.appendChild(row);
    });

    const logoutBtn = document.querySelector("[data-logout]");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            window.location.href = "index.html";
        });
    }
}

// ==========================================================================
// 5. PRODUCT PAGE FILTERS LOGIC
// ==========================================================================
function initProductFilters() {
    const filterButtons = document.querySelectorAll(".filter-btn");
    const cards = document.querySelectorAll("[data-product-card]");

    filterButtons.forEach(btn => {
        btn.addEventListener("click", () => {
            filterButtons.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            const filterValue = btn.innerText.trim();

            cards.forEach(card => {
                const category = card.getAttribute("data-product-card");
                if (filterValue === "All Packages" || category === filterValue || (filterValue === "Residential" && category === "Residential")) {
                    card.style.display = "flex";
                } else {
                    card.style.display = "none";
                }
            });
        });
    });
}