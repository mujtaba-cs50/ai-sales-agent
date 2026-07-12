// ==========================================
// DUMMY DATA FOR DASHBOARD
// ==========================================
const dummyLeads = [
    { name: "Zubair Ahmed", phone: "0300-1234567", email: "zubair@gmail.com", product: "10kW Hybrid System", status: "Hot", note: "wants to install next week, talking about installment plan" },
    { name: "Kamran Khan", phone: "0321-7654321", email: "kamran@yahoo.com", product: "5kW On-Grid System", status: "Warm", note: "Asked about net metering process and solar plates brand" },
    { name: "Ayesha Siddiqua", phone: "0333-9876543", email: "ayesha@outlook.com", product: "7kW Inverter System", status: "New", note: "Left contact details via voice assistant, requested a call back" },
    { name: "Muhammad Bilal", phone: "0345-5554433", email: "bilal@gmail.com", product: "15kW Industrial Solar", status: "Hot", note: "High intent client, requested site survey quotation as soon as possible" }
];

// ==========================================
// ON PAGE LOAD LOGIC
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    initNavbarToggle();
    
    // Check which page we are currently on
    if (document.querySelector("[data-signup-form]")) {
        initDummySignup();
    }
    if (document.querySelector("[data-login-form]")) {
        initDummyLogin();
    }
    if (document.querySelector("[data-lead-table]")) {
        renderDummyDashboard();
    }
});

// Navbar toggle for mobile view
function initNavbarToggle() {
    const toggleBtn = document.querySelector(".nav-toggle");
    const navLinks = document.querySelector(".nav-links");
    if (toggleBtn && navLinks) {
        toggleBtn.addEventListener("click", () => {
            const expanded = toggleBtn.getAttribute("aria-expanded") === "true";
            toggleBtn.setAttribute("aria-expanded", !expanded);
            navLinks.classList.toggle("nav-active");
        });
    }
}

// ==========================================
// SIGNUP PAGE DUMMY LOGIC
// ==========================================
function initDummySignup() {
    const signupForm = document.querySelector("[data-signup-form]");
    signupForm.addEventListener("submit", (e) => {
        e.preventDefault(); // Stop page from crashing or talking to backend
        
        // Show success alert
        alert("Account Created Successfully! Welcome to Dashboard.");
        
        // Redirect directly to the dashboard
        window.location.href = "dashboard.html";
    });
}

// ==========================================
// LOGIN PAGE DUMMY LOGIC
// ==========================================
function initDummyLogin() {
    const loginForm = document.querySelector("[data-login-form]");
    loginForm.addEventListener("submit", (e) => {
        e.preventDefault(); // Stop page from crashing or talking to backend
        
        // Redirect directly to the dashboard
        window.location.href = "dashboard.html";
    });
}

// ==========================================
// DASHBOARD DUMMY RENDER LOGIC
// ==========================================
function renderDummyDashboard() {
    const tableBody = document.querySelector("[data-lead-table]");
    const cardsContainer = document.querySelector("[data-lead-cards]");
    
    // Update KPI counter blocks on dashboard
    if (document.querySelector("[data-total-leads]")) {
        document.querySelector("[data-total-leads]").innerText = dummyLeads.length;
        document.querySelector("[data-new-leads]").innerText = "1";
        document.querySelector("[data-hot-leads]").innerText = "2";
        document.querySelector("[data-follow-ups]").innerText = "1";
    }

    if (!tableBody) return;

    tableBody.innerHTML = "";
    if (cardsContainer) cardsContainer.innerHTML = "";

    // Loop through dummy data and insert rows into the HTML table
    dummyLeads.forEach(lead => {
        // 1. Table row for desktop view
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

        // 2. Card view for mobile responsiveness
        if (cardsContainer) {
            const card = document.createElement("div");
            card.className = "dashboard-card";
            card.style.marginBottom = "15px";
            card.style.padding = "15px";
            card.innerHTML = `
                <div style="display:flex; justify-content:between; align-items:center; margin-bottom:10px;">
                    <strong>${lead.name}</strong>
                    <span class="badge ${lead.status.toLowerCase()}">${lead.status}</span>
                </div>
                <div style="font-size:0.9rem; margin-bottom:5px;"><b>Product:</b> ${lead.product}</div>
                <div style="font-size:0.9rem; margin-bottom:5px;"><b>Phone:</b> ${lead.phone}</div>
                <div style="font-size:0.9rem; color:var(--muted);"><b>Note:</b> ${lead.note}</div>
            `;
            cardsContainer.appendChild(card);
        }
    });

    // Dummy Logout action
    const logoutBtn = document.querySelector("[data-logout]");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", (e) => {
            e.preventDefault();
            alert("Logged out successfully!");
            window.location.href = "index.html";
        });
    }
}