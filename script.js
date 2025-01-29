const REDIRECT_URL = "dashboard.html";
const masterAccount = JSON.parse(localStorage.getItem("masterAccount"));
const clientAccounts = JSON.parse(localStorage.getItem("clients")) || [];

if (!masterAccount && window.location.pathname.includes("dashboard.html")) {
    window.location.href = "index.html";
}

function logMessage(message) {
    const logsDiv = document.getElementById("logs");
    if (!logsDiv) return;
    const logEntry = document.createElement("p");
    logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logsDiv.appendChild(logEntry);
    logsDiv.scrollTop = logsDiv.scrollHeight;
}

async function authorizeUser(token) {
    const response = await fetch("wss://ws.deriv.com/websockets/v3", {
        method: "POST",
        body: JSON.stringify({ authorize: token })
    });

    const data = await response.json();
    if (data.authorize) {
        localStorage.setItem("masterAccount", JSON.stringify({
            name: data.authorize.fullname,
            loginid: data.authorize.loginid,
            balance: data.authorize.balance,
            token
        }));
        window.location.href = REDIRECT_URL;
    } else {
        logMessage("Authorization failed.");
    }
}

function extractTokens() {
    const params = new URLSearchParams(window.location.search);
    let foundToken = null;

    params.forEach((value, key) => {
        if (key.startsWith("token")) {
            foundToken = value;
        }
    });

    if (foundToken) {
        authorizeUser(foundToken);
    }
}

if (!masterAccount) {
    extractTokens();
} else {
    document.getElementById("masterName").textContent = masterAccount.name;
    document.getElementById("masterID").textContent = masterAccount.loginid;
    document.getElementById("masterBalance").textContent = masterAccount.balance;
}

document.getElementById("logoutBtn").addEventListener("click", () => {
    localStorage.clear();
    window.location.href = "index.html";
});

document.getElementById("enableCopying").addEventListener("click", async () => {
    const response = await fetch("wss://ws.deriv.com/websockets/v3", {
        method: "POST",
        body: JSON.stringify({ set_settings: 1, allow_copiers: 1, loginid: masterAccount.loginid })
    });

    const data = await response.json();
    logMessage(data.set_settings === 1 ? "Copy Trading Enabled" : "Failed to Enable Copy Trading");
});

document.getElementById("startCopy").addEventListener("click", async () => {
    for (let client of clientAccounts) {
        const response = await fetch("wss://ws.deriv.com/websockets/v3", {
            method: "POST",
            body: JSON.stringify({ copy_start: masterAccount.token, loginid: client.loginid })
        });
        logMessage("Started Copying for " + client.loginid);
    }
});

document.getElementById("stopCopy").addEventListener("click", async () => {
    for (let client of clientAccounts) {
        const response = await fetch("wss://ws.deriv.com/websockets/v3", {
            method: "POST",
            body: JSON.stringify({ copy_stop: masterAccount.token, loginid: client.loginid })
        });
        logMessage("Stopped Copying for " + client.loginid);
    }
});
