const API_URL = 'wss://ws.binaryws.com/websockets/v3?app_id=66842';
let ws;
let masterAccounts = [];
let selectedAccount = null;

// Initialize WebSocket connection
function initWebSocket() {
    ws = new WebSocket(API_URL);

    ws.onopen = () => {
        log('🔌 Connected to Deriv API', 'success');
        processOAuthParams(); // Process OAuth tokens after connection
    };

    ws.onmessage = (event) => handleMessage(event);
    ws.onerror = (error) => log(`❌ WebSocket Error: ${error.message}`, 'error');
    ws.onclose = () => {
        log('⚠️ WebSocket connection closed. Reconnecting...', 'warning');
        setTimeout(initWebSocket, 5000); // Reconnect after 5 seconds
    };
}

// Handle incoming WebSocket messages
function handleMessage(event) {
    const response = JSON.parse(event.data);
    log(`📥 Received: ${JSON.stringify(response)}`, 'info');

    if (response.error) {
        log(`❌ Error: ${response.error.message}`, 'error');
    } else if (response.authorize) {
        handleAuthorization(response);
    } else if (response.set_settings) {
        handleSettingsResponse(response);
    } else if (response.copytrading_list) {
        handleCopierList(response);
    }
}

// Process OAuth parameters from URL
function processOAuthParams() {
    const params = new URLSearchParams(window.location.search);
    const accounts = [];

    let index = 1;
    while (params.has(`acct${index}`)) {
        accounts.push({
            loginid: params.get(`acct${index}`),
            token: params.get(`token${index}`),
            currency: params.get(`cur${index}`),
            balance: 'Loading...',
            allowCopiers: false
        });
        index++;
    }

    if (accounts.length > 0) {
        masterAccounts = accounts;
        authenticateMasters(accounts);
    } else {
        log('⚠️ No valid accounts found in URL', 'error');
    }
}

// Authenticate master accounts
function authenticateMasters(accounts) {
    accounts.forEach(account => {
        ws.send(JSON.stringify({
            authorize: account.token
        }));
    });
}

// Handle authorization response
function handleAuthorization(response) {
    const account = masterAccounts.find(acc => acc.token === response.echo_req.authorize);
    if (account) {
        account.balance = response.authorize.balance;
        account.allowCopiers = response.authorize.scopes.includes('admin');
        log(`🔓 Authorized: ${account.loginid} - Balance: ${account.balance} ${account.currency}`, 'success');
        setupAccountsDropdown();
    }
}

// Handle settings response
function handleSettingsResponse(response) {
    const account = masterAccounts.find(acc => acc.loginid === response.echo_req.loginid);
    if (account) {
        account.allowCopiers = response.echo_req.allow_copiers === 1;
        log(`⚙️ Settings updated for ${account.loginid}: Copiers ${account.allowCopiers ? 'allowed' : 'disallowed'}`, 
            account.allowCopiers ? 'success' : 'error');
        setupAccountsDropdown();
    }
}

// Handle copier list response
function handleCopierList(response) {
    const clientList = document.getElementById('clientList');
    clientList.innerHTML = response.copytrading_list.copiers.map(copier => `
        <div class="client-item">
            <div>${copier.name || 'Anonymous'} (${copier.loginid})</div>
            <div>${copier.balance} ${copier.currency}</div>
        </div>
    `).join('');
}

// Toggle copy permissions for an account
function toggleCopyPermissions(loginid, button) {
    const account = masterAccounts.find(acc => acc.loginid === loginid);
    if (!account) return;

    const newState = !account.allowCopiers;
    ws.send(JSON.stringify({
        set_settings: 1,
        allow_copiers: newState ? 1 : 0,
        loginid: loginid
    }));

    button.textContent = newState ? '🚫 Disallow' : '✅ Allow Copy';
    button.classList.toggle('enable-btn');
    button.classList.toggle('disable-btn');
}

// Refresh copier list
function refreshClients() {
    ws.send(JSON.stringify({ copytrading_list: 1 }));
}

// Logout and cleanup
function logout() {
    // Disable copiers for all accounts before logout
    masterAccounts.forEach(account => {
        if (account.allowCopiers) {
            ws.send(JSON.stringify({
                set_settings: 1,
                allow_copiers: 0,
                loginid: account.loginid
            }));
        }
    });

    // Redirect to index.html after 1 second
    setTimeout(() => {
        window.location.href = 'index.html';
    }, 1000);
}

// Setup accounts dropdown
function setupAccountsDropdown() {
    const dropdown = document.getElementById('dropdownContent');
    dropdown.innerHTML = masterAccounts.map(account => `
        <div class="account-item">
            <div>
                <strong>${account.loginid}</strong><br>
                ${account.currency.toUpperCase()} - ${account.balance}
            </div>
            <button class="${account.allowCopiers ? 'disable-btn' : 'enable-btn'}" 
                    onclick="toggleCopyPermissions('${account.loginid}', this)">
                ${account.allowCopiers ? '🚫 Disallow' : '✅ Allow Copy'}
            </button>
        </div>
    `).join('');
}

// Logging system
function log(message, type = 'info') {
    const logContainer = document.getElementById('logContainer');
    const logEntry = document.createElement('div');
    logEntry.className = `log-${type}`;
    logEntry.innerHTML = `[${new Date().toLocaleTimeString()}] ${message}`;
    logContainer.appendChild(logEntry);
    logContainer.scrollTop = logContainer.scrollHeight;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initWebSocket();
});
