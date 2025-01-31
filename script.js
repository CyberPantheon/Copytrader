const API_URL = 'wss://ws.binaryws.com/websockets/v3?app_id=66842';
let ws;
let masterAccounts = JSON.parse(localStorage.getItem('masterAccounts')) || [];
let clients = JSON.parse(localStorage.getItem('clients')) || [];
let selectedAccount = null;
let reconnectTimeout = null;

// WebSocket Management
function initWebSocket() {
    try {
        ws = new WebSocket(API_URL);
        
        ws.onopen = () => {
            log('🔗 Connected to Deriv API', 'success');
            clearTimeout(reconnectTimeout);
            if (masterAccounts.length > 0) {
                reauthenticateMasters();
            } else {
                processOAuthParams();
            }
            startHeartbeat();
        };

        ws.onmessage = (e) => {
            try {
                const response = JSON.parse(e.data);
                handleMessage(response);
            } catch (error) {
                log(`❌ Message parse error: ${error.message}`, 'error');
            }
        };

        ws.onerror = (error) => {
            log(`⚠️ WebSocket error: ${error.message || 'Unknown error'}`, 'error');
        };

        ws.onclose = (e) => {
            log(`🔌 Connection closed (${e.code}: ${e.reason || 'No reason'})`, 'warning');
            if (!e.wasClean) {
                reconnectTimeout = setTimeout(initWebSocket, 5000);
            }
        };
    } catch (error) {
        log(`❌ WebSocket initialization failed: ${error.message}`, 'error');
    }
}

// Heartbeat system
function startHeartbeat() {
    setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ ping: 1 }));
        }
    }, 30000);
}

// OAuth Parameters Processing
function processOAuthParams() {
    const params = new URLSearchParams(window.location.search);
    let index = 1;
    
    while (params.has(`acct${index}`)) {
        masterAccounts.push({
            loginid: params.get(`acct${index}`),
            token: params.get(`token${index}`),
            currency: params.get(`cur${index}`),
            balance: 0,
            allowCopiers: false
        });
        index++;
    }
    
    if (masterAccounts.length === 0) {
        log('⚠️ No valid accounts found in URL parameters', 'error');
        return;
    }

    localStorage.setItem('masterAccounts', JSON.stringify(masterAccounts));
    setupAccountsDropdown();
    authenticateAccount(masterAccounts[0].token);
}

// Account Reauthentication
function reauthenticateMasters() {
    masterAccounts.forEach(account => {
        ws.send(JSON.stringify({
            authorize: account.token,
            req_id: Date.now()
        }));
    });
}

// Message Handler
function handleMessage(response) {
    log(`📥 Received: ${JSON.stringify(response)}`, 'info');
    
    if (response.error) {
        handleAPIError(response.error);
        return;
    }

    if (response.authorize) {
        handleAuthorization(response);
    } else if (response.set_settings) {
        handleSettingsResponse(response);
    } else if (response.copytrading_list) {
        handleCopierList(response);
    } else if (response.pong) {
        log('🏓 Heartbeat received', 'info');
    }
}

// API Error Handling
function handleAPIError(error) {
    const errorMessages = {
        'InvalidAppID': 'Invalid application ID',
        'RateLimit': 'Too many requests - wait 60 seconds',
        'InvalidToken': 'Session expired - please relogin',
        'ConnectionLimit': 'Too many simultaneous connections'
    };
    
    const message = errorMessages[error.code] || error.message;
    log(`❌ API Error: ${message} (code: ${error.code})`, 'error');
    
    if (error.code === 'InvalidToken') {
        localStorage.removeItem('masterAccounts');
        window.location.href = 'index.html';
    }
}

// Account Authorization
function authenticateAccount(token) {
    if (ws.readyState !== WebSocket.OPEN) {
        log('⚠️ WebSocket not ready for authentication', 'error');
        return;
    }

    ws.send(JSON.stringify({
        authorize: token,
        req_id: Date.now()
    }));
}

// UI Functions
function setupAccountsDropdown() {
    const dropdown = document.getElementById('dropdownContent');
    dropdown.innerHTML = masterAccounts.map(acc => `
        <div class="account-item">
            <div>
                <strong>${acc.loginid}</strong><br>
                ${acc.currency.toUpperCase()} - ${acc.balance}
            </div>
            <button class="${acc.allowCopiers ? 'disable-btn' : 'enable-btn'}" 
                    onclick="toggleCopyPermissions('${acc.loginid}', this)">
                ${acc.allowCopiers ? '🚫 Disallow' : '✅ Allow Copy'}
            </button>
        </div>
    `).join('');
}

function toggleCopyPermissions(loginid, button) {
    const account = masterAccounts.find(acc => acc.loginid === loginid);
    const newState = !account.allowCopiers;

    ws.send(JSON.stringify({
        set_settings: 1,
        allow_copiers: newState ? 1 : 0,
        loginid: loginid,
        req_id: Date.now()
    }));

    button.classList.toggle('enable-btn');
    button.classList.toggle('disable-btn');
    button.textContent = newState ? '🚫 Disallow' : '✅ Allow Copy';
}

function refreshClients() {
    ws.send(JSON.stringify({ 
        copytrading_list: 1,
        req_id: Date.now()
    }));
}

function logout() {
    // Disable all copiers
    masterAccounts.forEach(acc => {
        if(acc.allowCopiers) {
            ws.send(JSON.stringify({
                set_settings: 1,
                allow_copiers: 0,
                loginid: acc.loginid,
                req_id: Date.now()
            }));
        }
    });

    // Cleanup
    localStorage.clear();
    ws.close();
    window.location.href = 'index.html';
}

// Response Handlers
function handleAuthorization(response) {
    const account = masterAccounts.find(acc => acc.token === response.echo_req.authorize);
    if (account) {
        account.balance = response.authorize.balance;
        account.allowCopiers = response.authorize.scopes.includes('admin');
        localStorage.setItem('masterAccounts', JSON.stringify(masterAccounts));
        setupAccountsDropdown();
        log(`🔓 Authorized: ${account.loginid} - Balance: ${account.balance} ${account.currency}`, 'success');
    }
}

function handleSettingsResponse(response) {
    const account = masterAccounts.find(acc => acc.loginid === response.echo_req.loginid);
    if (account) {
        account.allowCopiers = response.echo_req.allow_copiers === 1;
        localStorage.setItem('masterAccounts', JSON.stringify(masterAccounts));
        log(`⚙️ Settings updated for ${account.loginid}: Copiers ${account.allowCopiers ? 'allowed' : 'disallowed'}`, 
            account.allowCopiers ? 'success' : 'error');
        setupAccountsDropdown();
    }
}

function handleCopierList(response) {
    clients = response.copytrading_list?.copiers || [];
    localStorage.setItem('clients', JSON.stringify(clients));
    
    const clientList = document.getElementById('clientList');
    clientList.innerHTML = clients.map(client => `
        <div class="client-item">
            <div>${client.name || 'Anonymous'} (${client.loginid})</div>
            <div>${client.balance} ${client.currency}</div>
        </div>
    `).join('');
}

// Logging System
function log(message, type = 'info') {
    const logContainer = document.getElementById('logContainer');
    const logEntry = document.createElement('div');
    
    logEntry.className = `log-${type}`;
    logEntry.innerHTML = `[${new Date().toLocaleTimeString()}] ${message}`;
    
    logContainer.appendChild(logEntry);
    logContainer.scrollTop = logContainer.scrollHeight;
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    initWebSocket();
    window.addEventListener('beforeunload', () => {
        if (ws) ws.close();
    });
});
