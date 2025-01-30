const API_URL = 'wss://ws.binaryws.com/websockets/v3?app_id=66842';
let ws;
let masterAccounts = JSON.parse(localStorage.getItem('masterAccounts')) || [];
let clients = JSON.parse(localStorage.getItem('clients')) || [];
let selectedAccount = null;

// WebSocket Management
function initWebSocket() {
    ws = new WebSocket(API_URL);
    
    ws.onopen = () => {
        log('Connected to Deriv API', 'success');
        if (masterAccounts.length > 0) {
            reauthenticateMasters();
        } else {
            processOAuthParams();
        }
    };

    ws.onmessage = handleMessage;
    ws.onerror = handleError;
    ws.onclose = handleClose;
}

function handleMessage(event) {
    const response = JSON.parse(event.data);
    
    if (response.error) {
        log(`Error: ${response.error.message}`, 'error');
    } else if (response.authorize) {
        handleAuthorization(response);
    } else if (response.set_settings) {
        handleSettingsResponse(response);
    } else if (response.copy_start || response.copy_stop) {
        handleCopyResponse(response);
    }
}

function handleError(error) {
    log(`WebSocket Error: ${error.message}`, 'error');
}

function handleClose() {
    log('WebSocket connection closed', 'warning');
    setTimeout(initWebSocket, 5000);
}

// Master Account Management
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
    authenticateMasters(accounts);
}

function authenticateMasters(accounts) {
    accounts.forEach(account => {
        sendRequest('authorize', { authorize: account.token }, response => {
            if (!response.error) {
                const master = {
                    ...response.authorize,
                    token: account.token,
                    loginid: account.loginid,
                    allow_copiers: false,
                    account_type: 'peer_to_peer'
                };
                
                if (!masterAccounts.some(a => a.loginid === master.loginid)) {
                    masterAccounts.push(master);
                    saveMasters();
                    updateMasterDisplay();
                    log(`Authenticated: ${master.loginid}`, 'success');
                }
            }
        });
    });
}

function reauthenticateMasters() {
    masterAccounts.forEach(account => {
        sendRequest('authorize', { authorize: account.token }, response => {
            if (response.error) {
                log(`Reauth failed for ${account.loginid}`, 'error');
                masterAccounts = masterAccounts.filter(a => a.loginid !== account.loginid);
                saveMasters();
                updateMasterDisplay();
            } else {
                const updatedMaster = {
                    ...account,
                    allow_copiers: response.authorize?.allow_copiers === 1,
                    balance: response.authorize.balance
                };
                masterAccounts = masterAccounts.map(a => 
                    a.loginid === updatedMaster.loginid ? updatedMaster : a
                );
                saveMasters();
                updateMasterDisplay();
            }
        });
    });
}

function enableCopiers(loginid) {
    const account = masterAccounts.find(a => a.loginid === loginid);
    if (!account) return;

    const settingsWS = new WebSocket(API_URL);
    
    settingsWS.onopen = () => {
        log(`Configuring ${loginid}...`, 'info');
        settingsWS.send(JSON.stringify({ 
            authorize: account.token,
            req_id: Date.now()
        }));
    };

    settingsWS.onmessage = (event) => {
        const response = JSON.parse(event.data);
        if (response.authorize) {
            settingsWS.send(JSON.stringify({
                set_settings: 1,
                allow_copiers: 1,
                loginid: account.loginid,
                account_opening_reason: "Peer-to-peer exchange",
                trading_hub: 1,
                req_id: Date.now()
            }));
        }
        else if (response.set_settings) {
            if (response.set_settings === 1) {
                log(`Copiers enabled for ${loginid}`, 'success');
                const updatedMaster = {
                    ...account,
                    allow_copiers: true
                };
                masterAccounts = masterAccounts.map(a => 
                    a.loginid === loginid ? updatedMaster : a
                );
                saveMasters();
                updateMasterDisplay();
                selectedAccount = loginid;
            }
            settingsWS.close();
        }
    };
}

// Client Management
window.addClient = function() {
    const tokenInput = document.getElementById('clientToken');
    const token = tokenInput.value.trim();
    
    if (!token) {
        log('Enter client token', 'warning');
        return;
    }

    sendRequest('authorize', { authorize: token }, response => {
        if (response.error) {
            log(`Client error: ${response.error.message}`, 'error');
            return;
        }

        const client = {
            ...response.authorize,
            token: token,
            account_type: 'peer_to_peer'
        };

        if (validateClient(client)) {
            clients = clients.filter(c => c.loginid !== client.loginid);
            clients.push(client);
            saveClients();
            updateClientDisplay();
            log(`Client added: ${client.loginid}`, 'success');
            tokenInput.value = '';
        }
    });
}

function validateClient(client) {
    const master = masterAccounts.find(a => a.loginid === selectedAccount);
    
    if (!master) {
        log('Select master account first', 'error');
        return false;
    }
    
    const validations = [
        {
            check: () => client.is_virtual !== master.is_virtual,
            message: 'Account types must match (real/virtual)'
        },
        {
            check: () => !client.scopes?.includes('trading_information'),
            message: 'Client missing trading_information scope'
        },
        {
            check: () => client.currency !== master.currency,
            message: 'Currency must match master account'
        },
        {
            check: () => !master.allow_copiers,
            message: 'Enable copiers on master first'
        }
    ];

    for (const validation of validations) {
        if (validation.check()) {
            log(validation.message, 'error');
            return false;
        }
    }
    return true;
}

// Copy Trading Controls
window.startCopying = function() {
    if (!selectedAccount) {
        log('Select master account first', 'error');
        return;
    }

    const master = masterAccounts.find(a => a.loginid === selectedAccount);
    
    clients.forEach(client => {
        sendRequest('copy_start', {
            copy_start: client.token,
            account_type: "peer_to_peer",
            trading_hub: 1
        }, response => {
            if (response.copy_start === 1) {
                log(`Copying all trades to ${client.loginid}`, 'success');
            } else {
                log(`Copy failed: ${response.error?.message || 'Unknown error'}`, 'error');
            }
        });
    });
};

window.stopCopying = function() {
    clients.forEach(client => {
        sendRequest('copy_stop', {
            copy_stop: client.token
        }, response => {
            if (response.copy_stop === 1) {
                log(`Stopped copying to ${client.loginid}`, 'success');
            }
        });
    });
}

// UI and Utilities (keep previous implementations)
// ... [Keep all UI and utility functions from previous version]
// Include updateMasterDisplay, updateClientDisplay, 
// log, saveMasters, saveClients, etc. as before
function updateMasterDisplay() {
    const dropdownContent = document.getElementById('dropdownContent');
    dropdownContent.innerHTML = masterAccounts.map(acc => `
        <div class="account-item">
            <div>
                <strong>${acc.loginid}</strong>
                <div>${acc.fullname} - ${acc.currency} ${acc.balance}</div>
                <small>${acc.allow_copiers ? 'Copiers Enabled' : 'Copiers Disabled'}</small>
            </div>
            <button class="btn btn-primary" onclick="enableCopiers('${acc.loginid}')">
                ${acc.allow_copiers ? '✔ Active' : 'Enable'}
            </button>
        </div>
    `).join('');
}

function updateClientDisplay() {
    const clientList = document.getElementById('clientList');
    clientList.innerHTML = clients.map(client => `
        <div class="client-item">
            <div>
                <strong>${client.loginid}</strong>
                <div>${client.fullname} - ${client.currency} ${client.balance}</div>
                <small>${client.scopes?.includes('trade') ? '✅ Trade Permissions' : '❌ No Trading'}</small>
            </div>
            <div class="token-display">
                ${client.token.slice(0, 6)}...${client.token.slice(-4)}
            </div>
        </div>
    `).join('');
}

window.toggleDropdown = function() {
    const dropdown = document.getElementById('dropdownContent');
    dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
}

// Utilities
function sendRequest(type, data, callback) {
    const req_id = Date.now();
    const request = { ...data, req_id };
    
    ws.send(JSON.stringify(request));
    
    const listener = (event) => {
        const response = JSON.parse(event.data);
        if (response.req_id === req_id) {
            callback(response);
            ws.removeEventListener('message', listener);
        }
    };
    
    ws.addEventListener('message', listener);
}

function log(message, type = 'info') {
    const logContainer = document.getElementById('logContainer');
    const entry = document.createElement('div');
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    entry.style.color = {
        error: '#ff4444',
        success: '#00ffa5',
        warning: '#ffdd57',
        info: '#ffffff'
    }[type];
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
}

function saveMasters() {
    localStorage.setItem('masterAccounts', JSON.stringify(masterAccounts));
}

function saveClients() {
    localStorage.setItem('clients', JSON.stringify(clients));
}

window.logout = function() {
    localStorage.clear();
    if (ws) ws.close();
    window.location.href = 'index.html';
}








// Initialization
document.addEventListener('DOMContentLoaded', () => {
    initWebSocket();
    updateMasterDisplay();
    updateClientDisplay();
    
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.accounts-dropdown')) {
            document.getElementById('dropdownContent').style.display = 'none';
        }
    });
});
