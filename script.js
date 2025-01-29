const API_URL = 'wss://ws.binaryws.com/websockets/v3?app_id=66842'; // Use your full app ID
let ws;
let masterAccounts = [];
let clients = [];

// Initialize WebSocket connection
function initWebSocket() {
    ws = new WebSocket(API_URL);
    
    ws.onopen = () => {
        log('Connected to Deriv API');
        processOAuthParams();
    };

    ws.onmessage = (msg) => {
        const response = JSON.parse(msg.data);
        handleAPIResponse(response);
    };

    ws.onerror = (error) => {
        log(`WebSocket error: ${error.message}`);
    };

    ws.onclose = () => {
        log('WebSocket connection closed');
    };
}

function processOAuthParams() {
    const params = new URLSearchParams(window.location.search);
    const accounts = [];
    let index = 1;
    
    while (params.has(`acct${index}`)) {
        accounts.push({
            loginid: params.get(`acct${index}`),
            token: params.get(`token${index}`),
            currency: params.get(`cur${index}`)
        });
        index++;
    }

    // Clear URL parameters after processing
    window.history.replaceState({}, document.title, window.location.pathname);

    if (accounts.length > 0) {
        authenticateMaster(accounts);
    } else {
        log('No master accounts found in URL parameters');
    }
}
function authenticateMaster(accounts) {
    accounts.forEach(account => {
        sendRequest('authorize', { authorize: account.token }, (res) => {
            if (!res.error) {
                const masterAccount = {
                    ...res.authorize,
                    token: account.token,
                    loginid: account.loginid,
                    allowCopiers: false
                };
                
                // Update existing account or add new
                const existingIndex = masterAccounts.findIndex(a => a.loginid === account.loginid);
                if (existingIndex >= 0) {
                    masterAccounts[existingIndex] = masterAccount;
                } else {
                    masterAccounts.push(masterAccount);
                }
                
                updateAccountDetails(masterAccount);
                saveMasterAccounts();
                updateMasterDisplay();
            }
        });
    });
}
function updateAccountDetails(account) {
    sendRequest('get_settings', { 
        get_settings: 1,
        loginid: account.loginid
    }, (res) => {
        if (res.get_settings) {
            account.allowCopiers = res.get_settings.allow_copiers === 1;
            updateMasterDisplay();
        }
    });
}

function enableCopiers(loginid) {
    const account = masterAccounts.find(a => a.loginid === loginid);
    if (!account) return;

    sendRequest('set_settings', {
        set_settings: 1,
        loginid,
        allow_copiers: 1
    }, (res) => {
        account.allowCopiers = res.set_settings === 1;
        updateMasterDisplay();
        if (res.set_settings === 1) {
            log(`Allow copiers enabled for ${loginid}`);
        } else {
            log(`Failed to enable allow copiers for ${loginid}`);
        }
    });
}
function addClient() {
    const tokenInput = document.getElementById('clientToken');
    const token = tokenInput.value.trim();
    
    if (!token) {
        log('Please enter a client API token');
        return;
    }

    sendRequest('authorize', { authorize: token }, (res) => {
        if (res.error) {
            log(`Client authentication failed: ${res.error.message}`);
            return;
        }

        const client = {
            ...res.authorize,
            token: token
        };

        if (validateClient(client)) {
            clients.push(client);
            saveClients();
            updateClientDisplay();
            log(`Client ${client.loginid} added successfully`);
            tokenInput.value = '';
        }
    });
}

function validateClient(client) {
    if (masterAccounts.length === 0) {
        log('Error: No master account authenticated');
        return false;
    }
    
    const masterIsVirtual = masterAccounts[0].is_virtual;
    if (client.is_virtual !== masterIsVirtual) {
        log('Error: Client and master must be both real or both virtual');
        return false;
    }
    return true;
}

function startCopying() {
    if (clients.length === 0) {
        log('No clients added to start copying');
        return;
    }

    clients.forEach(client => {
        sendRequest('copy_start', {
            copy_start: client.token,
            assets: ['frxUSDJPY'],
            max_trade_stake: 100
        }, (res) => {
            if (res.copy_start === 1) {
                log(`Copying started for ${client.loginid}`);
            } else {
                log(`Failed to start copying for ${client.loginid}`);
            }
        });
    });
}

function stopCopying() {
    clients.forEach(client => {
        sendRequest('copy_stop', {
            copy_stop: client.token
        }, (res) => {
            if (res.copy_stop === 1) {
                log(`Copying stopped for ${client.loginid}`);
            } else {
                log(`Failed to stop copying for ${client.loginid}`);
            }
        });
    });
}

function sendRequest(type, data, callback) {
    const req = { ...data, req_id: Date.now() };
    ws.send(JSON.stringify(req));
    
    const listener = (msg) => {
        const response = JSON.parse(msg.data);
        if (response.req_id === req.req_id) {
            callback(response);
            ws.removeEventListener('message', listener);
        }
    };
    
    ws.addEventListener('message', listener);
}

function updateMasterDisplay() {
    const container = document.getElementById('masterAccounts');
    container.innerHTML = masterAccounts.map(acc => `
        <div class="account-item">
            <div class="account-header">
                <div>
                    <strong>${acc.loginid}</strong>
                    <div>${acc.fullname} - ${acc.currency} ${acc.balance}</div>
                </div>
                <button class="allow-copiers-btn ${acc.allowCopiers ? 'disabled' : ''}" 
                        onclick="enableCopiers('${acc.loginid}')"
                        ${acc.allowCopiers ? 'disabled' : ''}>
                    ${acc.allowCopiers ? 'Copiers Enabled' : 'Enable Copiers'}
                </button>
            </div>
            <div class="account-details">
                Type: ${acc.is_virtual ? 'Virtual' : 'Real'} | 
                Company: ${acc.landing_company_name}
            </div>
        </div>
    `).join('');
}

function updateClientDisplay() {
    const container = document.getElementById('clientList');
    container.innerHTML = clients.map(client => `
        <div class="client-item">
            <div>
                <strong>${client.loginid}</strong>
                <div>${client.fullname}</div>
                <div>Balance: ${client.currency} ${client.balance}</div>
                <div>Type: ${client.is_virtual ? 'Virtual' : 'Real'}</div>
            </div>
            <div>Token: ${client.token.slice(0, 6)}...${client.token.slice(-4)}</div>
        </div>
    `).join('');
}

function log(message) {
    const logContainer = document.getElementById('logContainer');
    const entry = document.createElement('div');
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
}

function saveClients() {
    localStorage.setItem('clients', JSON.stringify(clients));
}

function loadClients() {
    const stored = localStorage.getItem('clients');
    if (stored) {
        try {
            clients = JSON.parse(stored);
            updateClientDisplay();
        } catch (e) {
            log('Error loading client data');
        }
    }
}

function logout() {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
    }
    localStorage.removeItem('clients');
    window.location.href = 'index.html';
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    loadClients();
    initWebSocket();
});
