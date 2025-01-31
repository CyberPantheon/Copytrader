const API_URL = 'wss://ws.binaryws.com/websockets/v3?app_id=66842';
let ws;
let masterAccounts = JSON.parse(localStorage.getItem('masterAccounts')) || [];
let clients = JSON.parse(localStorage.getItem('clients')) || [];
let selectedAccount = null;

// Initialize WebSocket connection
function initWebSocket() {
    ws = new WebSocket(API_URL);
    
    ws.onopen = () => {
        log('🔌 Connected to Deriv API', 'success');
        if (masterAccounts.length > 0) {
            reauthenticateMasters();
        } else {
            processOAuthParams();
        }
    };

    ws.onmessage = (event) => handleMessage(event);
    ws.onerror = (error) => handleError(error);
    ws.onclose = () => handleClose();
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
    } else if (response.copy_start || response.copy_stop) {
        handleCopyResponse(response);
    } else if (response.copytrading_list) {
        handleCopierList(response);
    }
}

// Handle WebSocket errors
function handleError(error) {
    log(`❌ WebSocket Error: ${error.message || 'Unknown error'}`, 'error');
}

// Handle WebSocket connection close
function handleClose() {
    log('⚠️ WebSocket connection closed. Reconnecting...', 'warning');
    setTimeout(initWebSocket, 5000); // Reconnect after 5 seconds
}

// Process OAuth parameters from URL
function processOAuthParams() {
    const params = new URLSearchParams(window.location.search);
    const accounts = [];
    
    let index = 1;
    while (params.has(`acct${index}`)) {
        const account = {
            loginid: params.get(`acct${index}`),
            token: params.get(`token${index}`),
            currency: params.get(`cur${index}`),
            balance: 'Loading...',
            allowCopiers: false
        };
        accounts.push(account);
        authorizeAccount(account);
        index++;
    }
    
    masterAccounts = accounts;
    localStorage.setItem('masterAccounts', JSON.stringify(masterAccounts));
    setupAccountsDropdown();
}

// Authorize an account
function authorizeAccount(account) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            authorize: account.token
        }));
    } else {
        log('⚠️ WebSocket not ready for authorization', 'error');
    }
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
    clients = response.copytrading_list.copiers || [];
    localStorage.setItem('clients', JSON.stringify(clients));
    updateClientList();
}

// Update the client list UI
function updateClientList() {
    const clientList = document.getElementById('clientList');
    clientList.innerHTML = clients.map(client => `
        <div class="client-item">
            <div>${client.name || 'Anonymous'} (${client.loginid})</div>
            <div>${client.balance} ${client.currency}</div>
        </div>
    `).join('');
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initWebSocket();
});

// Logging system
function log(message, type = 'info') {
    const logContainer = document.getElementById('logContainer');
    const logEntry = document.createElement('div');
    
    logEntry.className = `log-${type}`;
    logEntry.innerHTML = `[${new Date().toLocaleTimeString()}] ${message}`;
    
    logContainer.appendChild(logEntry);
    logContainer.scrollTop = logContainer.scrollHeight;
}
