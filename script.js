const API_URL = 'wss://ws.binaryws.com/websockets/v3?app_id=66842';
let ws;
let masterAccounts = JSON.parse(localStorage.getItem('masterAccounts')) || [];
let clients = JSON.parse(localStorage.getItem('clients')) || [];
let selectedAccount = null;

function initWebSocket() {
    ws = new WebSocket(API_URL);
    
    ws.onopen = () => {
        log('Connected to Deriv API');
        if (masterAccounts.length === 0) {
            processOAuthParams();
        } else {
            masterAccounts.forEach(acc => updateAccountDetails(acc));
            updateMasterDisplay();
        }
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
        setTimeout(initWebSocket, 5000); // Reconnect after 5 seconds
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

    window.history.replaceState({}, document.title, window.location.pathname);

    if (accounts.length > 0) {
        authenticateMaster(accounts);
    } else if (masterAccounts.length === 0) {
        log('No master accounts found');
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

// Modified addClient function with better validation
function addClient() {
    const tokenInput = document.getElementById('clientToken');
    const token = tokenInput.value.trim();
    
    if (!token) {
        log('Please enter a client API token');
        return;
    }

    // Check if client already exists
    if (clients.some(c => c.token === token)) {
        log('Client already exists');
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

// Enhanced validation
function validateClient(client) {
    if (masterAccounts.length === 0) {
        log('Error: No master account selected');
        return false;
    }
    
    // Get selected master account type
    const master = masterAccounts.find(a => a.allowCopiers);
    if (!master) {
        log('Error: No master account with copiers enabled');
        return false;
    }

    if (client.is_virtual !== master.is_virtual) {
        log('Error: Client must match master account type');
        return false;
    }
    
    return true;
}

// Modified startCopying with better error handling
function startCopying() {
    if (clients.length === 0) {
        log('No clients added');
        return;
    }

    const master = masterAccounts.find(a => a.allowCopiers);
    if (!master) {
        log('No master account with copiers enabled');
        return;
    }

    clients.forEach(client => {
        sendRequest('copy_start', {
            copy_start: client.token,
            assets: ['frxUSDJPY'],
            max_trade_stake: 100,
            trade_types: ['CALL', 'PUT']
        }, (res) => {
            if (res.copy_start === 1) {
                log(`Copying started for ${client.loginid}`);
            } else {
                log(`Failed to start copying for ${client.loginid}: ${res.error?.message}`);
            }
        });
    });
}

// Persistence functions
function saveMasterAccounts() {
    localStorage.setItem('masterAccounts', JSON.stringify(masterAccounts));
}

function saveClients() {
    localStorage.setItem('clients', JSON.stringify(clients));
}

function loadPersistedData() {
    const storedMasters = localStorage.getItem('masterAccounts');
    if (storedMasters) {
        try {
            masterAccounts = JSON.parse(storedMasters);
        } catch (e) {
            log('Error loading master accounts');
        }
    }
    
    const storedClients = localStorage.getItem('clients');
    if (storedClients) {
        try {
            clients = JSON.parse(storedClients);
        } catch (e) {
            log('Error loading clients');
        }
    }
}

// Modified logout
function logout() {
    localStorage.clear();
    if (ws?.readyState === WebSocket.OPEN) ws.close();
    window.location.href = 'index.html';
}

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    loadPersistedData();
    initWebSocket();
    updateClientDisplay();
});
