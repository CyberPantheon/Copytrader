// Constants
const APP_ID = 66842;
const REDIRECT_URL = "https://cyberpantheon.github.io/Copytrader/";

// Elements
const loginBtn = document.getElementById("loginBtn");
const logoutBtn = document.getElementById("logoutBtn");
const masterAccountDiv = document.getElementById("masterAccount");
const clientsSection = document.getElementById("clientsSection");
const copyControls = document.getElementById("copyControls");
const logsDiv = document.getElementById("logs");

const masterNameEl = document.getElementById("masterName");
const masterIDEl = document.getElementById("masterID");
const masterBalanceEl = document.getElementById("masterBalance");
const enableCopyingBtn = document.getElementById("enableCopying");

const clientTokenInput = document.getElementById("clientToken");
const addClientBtn = document.getElementById("addClient");
const authenticateClientsBtn = document.getElementById("authenticateClients");
const clientList = document.getElementById("clientList");

const startCopyBtn = document.getElementById("startCopy");
const stopCopyBtn = document.getElementById("stopCopy");

// Variables
let masterAccount = null;
let clientAccounts = JSON.parse(localStorage.getItem("clients")) || [];

// Utility Function: Append to Logs
function logMessage(message) {
    const logEntry = document.createElement("p");
    logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logsDiv.appendChild(logEntry);
    logsDiv.scrollTop = logsDiv.scrollHeight;
}

// Step 1: OAuth Login
loginBtn.addEventListener("click", () => {
    const oauthUrl = `https://oauth.deriv.com/oauth2/authorize?app_id=${APP_ID}`;
    window.location.href = oauthUrl;
});

// Step 2: Extract Token from URL
function extractTokens() {
    const params = new URLSearchParams(window.location.search);
    let userAccounts = [];

    params.forEach((value, key) => {
        if (key.startsWith("acct")) {
            const index = key.replace("acct", "");
            userAccounts.push({
                account: value,
                token: params.get(`token${index}`),
                currency: params.get(`cur${index}`)
            });
        }
    });

    if (userAccounts.length > 0) {
        authorizeUser(userAccounts);
    }
}

// Step 3: Authorize User
async function authorizeUser(accounts) {
    masterAccount = accounts[0]; // First account as Master
    const response = await fetch("wss://ws.deriv.com/websockets/v3", {
        method: "POST",
        body: JSON.stringify({ authorize: masterAccount.token })
    });

    const data = await response.json();

    if (data.authorize) {
        masterNameEl.textContent = data.authorize.fullname;
        masterIDEl.textContent = data.authorize.loginid;
        masterBalanceEl.textContent = data.authorize.balance;
        masterAccountDiv.style.display = "block";
        clientsSection.style.display = "block";
        copyControls.style.display = "block";
        loginBtn.style.display = "none";
        logoutBtn.style.display = "inline-block";

        logMessage("Master account authenticated.");
    } else {
        logMessage("Error authenticating master.");
    }
}

// Step 4: Enable Copy Trading
enableCopyingBtn.addEventListener("click", async () => {
    const response = await fetch("wss://ws.deriv.com/websockets/v3", {
        method: "POST",
        body: JSON.stringify({
            set_settings: 1,
            allow_copiers: 1,
            loginid: masterAccount.account
        })
    });

    const data = await response.json();
    if (data.set_settings === 1) {
        logMessage("Copy Trading Enabled for Master.");
    } else {
        logMessage("Failed to enable Copy Trading.");
    }
});

// Step 5: Add Clients
addClientBtn.addEventListener("click", () => {
    const token = clientTokenInput.value.trim();
    if (token) {
        clientAccounts.push({ token });
        localStorage.setItem("clients", JSON.stringify(clientAccounts));
        updateClientList();
        logMessage("Client added.");
    }
});

// Step 6: Authenticate Clients
authenticateClientsBtn.addEventListener("click", async () => {
    for (let client of clientAccounts) {
        const response = await fetch("wss://ws.deriv.com/websockets/v3", {
            method: "POST",
            body: JSON.stringify({ authorize: client.token })
        });

        const data = await response.json();

        if (data.authorize) {
            client.loginid = data.authorize.loginid;
            client.balance = data.authorize.balance;
            updateClientList();
            logMessage(`Client ${client.loginid} authenticated.`);
        } else {
            logMessage("Client authentication failed.");
        }
    }
});

// Step 7: Update Client List
function updateClientList() {
    clientList.innerHTML = "";
    clientAccounts.forEach(client => {
        const li = document.createElement("li");
        li.textContent = `Client ${client.loginid || "Unknown"} - Balance: ${client.balance || "N/A"}`;
        clientList.appendChild(li);
    });
}

// Step 8: Start Copying Trades
startCopyBtn.addEventListener("click", async () => {
    for (let client of clientAccounts) {
        const response = await fetch("wss://ws.deriv.com/websockets/v3", {
            method: "POST",
            body: JSON.stringify({
                copy_start: masterAccount.token,
                loginid: client.loginid
            })
        });

        const data = await response.json();
        if (data.copy_start === 1) {
            logMessage(`Copy Trading started for ${client.loginid}`);
        } else {
            logMessage("Failed to start copy trading.");
        }
    }
});

// Step 9: Stop Copying Trades
stopCopyBtn.addEventListener("click", async () => {
    for (let client of clientAccounts) {
        const response = await fetch("wss://ws.deriv.com/websockets/v3", {
            method: "POST",
            body: JSON.stringify({
                copy_stop: masterAccount.token,
                loginid: client.loginid
            })
        });

        const data = await response.json();
        if (data.copy_stop === 1) {
            logMessage(`Copy Trading stopped for ${client.loginid}`);
        } else {
            logMessage("Failed to stop copy trading.");
        }
    }
});

// Step 10: Logout
logoutBtn.addEventListener("click", () => {
    masterAccount = null;
    clientAccounts = [];
    localStorage.removeItem("clients");
    window.location.href = REDIRECT_URL;
    logMessage("Logged out.");
});

// Extract tokens on page load
extractTokens();
updateClientList();
