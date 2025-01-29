const API_URL = 'wss://ws.binaryws.com/websockets/v3?app_id=66842';
let ws;
let masterAccounts = [];
let clients = JSON.parse(localStorage.getItem('clients') || '[]');

// Core initialization flow
function initWebSocket() {
    try {
        if (ws) ws.close();
        
        ws = new WebSocket(API_URL);
        
        ws.onopen = () => {
            log('WebSocket connection established');
            processOAuthParams();
        };

        ws.onmessage = (msg) => {
            try {
                const response = JSON.parse(msg.data);
                log('Raw API response:', response);
                handleAPIResponse(response);
            } catch (error) {
                log('Message handling error:', error);
            }
        };

        ws.onerror = (error) => log('WebSocket error:', error);
        ws.onclose = () => {
            log('Connection closed - attempting reconnect in 5s');
            setTimeout(initWebSocket, 5000);
        };
    } catch (error) {
        log('WebSocket initialization failed:', error);
    }
}

// Define the missing log function
function log(...args) {
    const logContainer = document.getElementById('logContainer');
    if (logContainer) {
        const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
        logContainer.innerHTML += `<div>${message}</div>`;
        logContainer.scrollTop = logContainer.scrollHeight;
    }
    console.log(...args);
}

// Define the missing sendRequest function
function sendRequest(command, params, callback) {
    const request = JSON.stringify({ ...params, request: command });
    ws.send(request);

    ws.onmessage = (msg) => {
        const response = JSON.parse(msg.data);
        callback(response);
    };
}

// OAuth parameter handling
function processOAuthParams() {
    try {
        log('Processing OAuth parameters');
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

        window.history.replaceState({}, document.title, window.location.pathname);

        if (accounts.length > 0) {
            log(`Found ${accounts.length} master accounts`);
            authenticateMaster(accounts);
        } else {
            log('No OAuth parameters found');
            loadPersistedData();
        }
    } catch (error) {
        log('OAuth processing failed:', error);
    }
}

// Authentication core
function authenticateMaster(accounts) {
    try {
        log('Authenticating master accounts');
        masterAccounts = [];
        
        accounts.forEach(account => {
            sendRequest('authorize', { authorize: account.token }, (res) => {
                if (res.error) {
                    log(`Authentication failed for ${account.loginid}:`, res.error.message);
                    return;
                }
                
                log(`Successfully authenticated ${account.loginid}`);
                const masterAccount = {
                    ...res.authorize,
                    token: account.token,
                    loginid: account.loginid,
                    allowCopiers: false
                };
                
                masterAccounts.push(masterAccount);
                updateAccountDetails(masterAccount);
                updateMasterDisplay();
                saveMasterAccounts();
            });
        });
    } catch (error) {
        log('Master authentication failed:', error);
    }
}

// Account management
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
        log(account.allowCopiers 
            ? `✅ Copiers enabled for ${loginid}`
            : `❌ Failed to enable copiers for ${loginid}`);
    });
}

// UI updates
function updateMasterDisplay() {
    try {
        const container = document.getElementById('masterAccounts');
        if (!container) return;

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
    } catch (error) {
        log('Master display update failed:', error);
    }
}

// Client management
function addClient() {
    try {
        const tokenInput = document.getElementById('clientToken');
        const token = tokenInput.value.trim();
        
        if (!token) {
            log('⚠️ Please enter a client token');
            return;
        }

        if (clients.some(c => c.token === token)) {
            log('⚠️ Client already exists');
            return;
        }

        sendRequest('authorize', { authorize: token }, (res) => {
            if (res.error) {
                log(`❌ Client auth failed: ${res.error.message}`);
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
                log(`✅ Client ${client.loginid} added`);
                tokenInput.value = '';
            }
        });
    } catch (error) {
        log('Client add failed:', error);
    }
}

// Validation
function validateClient(client) {
    try {
        if (masterAccounts.length === 0) {
            log('❌ No master account selected');
            return false;
        }
        
        const master = masterAccounts.find(a => a.allowCopiers);
        if (!master) {
            log('❌ Enable copiers on a master account first');
            return false;
        }

        if (client.is_virtual !== master.is_virtual) {
            log(`❌ Client must be ${master.is_virtual ? 'virtual' : 'real'} like master`);
            return false;
        }
        
        return true;
    } catch (error) {
        log('Validation failed:', error);
        return false;
    }
}

// System operations
function startCopying() {
    if (clients.length === 0) {
        log('⚠️ Add clients first');
        return;
    }

    const master = masterAccounts.find(a => a.allowCopiers);
    if (!master) {
        log('⚠️ Select a master account with copiers enabled');
        return;
    }

    clients.forEach(client => {
        sendRequest('copy_start', {
            copy_start: client.token,
            assets: ['frxUSDJPY'],
            max_trade_stake: 100
        }, (res) => {
            log(res.copy_start === 1 
                ? `✅ Copying started for ${client.loginid}`
                : `❌ Copy failed for ${client.loginid}: ${res.error?.message}`);
        });
    });
}

function stopCopying() {
    if (clients.length === 0) {
        log('⚠️ Add clients first');
        return;
    }

    clients.forEach(client => {
        sendRequest('copy_stop', {
            copy_stop: client.token
        }, (res) => {
            log(res.copy_stop === 1 
                ? `✅ Copying stopped for ${client.loginid}`
                : `❌ Copy stop failed for ${client.loginid}: ${res.error?.message}`);
        });
    });
}

// Persistence
function saveMasterAccounts() {
    localStorage.setItem('masterAccounts', JSON.stringify(masterAccounts));
}

function saveClients() {
    localStorage.setItem('clients', JSON.stringify(clients));
}

function loadPersistedData() {
    try {
        const masters = localStorage.getItem('masterAccounts');
        if (masters) {
            masterAccounts = JSON.parse(masters);
            updateMasterDisplay();
        }
    } catch (error) {
        log('Master load failed:', error);
    }
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    initWebSocket();
    document.getElementById('clientToken')?.addEventListener('keypress', e => {
        if (e.key === 'Enter') addClient();
    });
    log('System initialized');
});

function logout() {
    // Clear all stored data and reload the page
    localStorage.clear();
    window.location.href = 'index.html';
}
