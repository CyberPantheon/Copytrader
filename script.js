const API_URL = 'wss://ws.binaryws.com/websockets/v3?app_id=66842';
let ws;
let masterAccounts = JSON.parse(localStorage.getItem('masterAccounts')) || [];
let clients = JSON.parse(localStorage.getItem('clients')) || [];
let selectedAccount = null;

// WebSocket Management
function initWebSocket() {
    ws = new WebSocket(API_URL);
    
    ws.onopen = () => {
        log('Connected to Deriv API');
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
    log(`Received: ${JSON.stringify(response)}`);
    
    if (response.authorize) {
        handleAuthorization(response);
    }
    else if (response.set_settings) {
        handleSettingsResponse(response);
    }
    else if (response.copy_start || response.copy_stop) {
        handleCopyResponse(response);
    }
}

function handleError(error) {
    log(`WebSocket Error: ${error.message}`);
}

function handleClose() {
    log('WebSocket connection closed');
    setTimeout(initWebSocket, 5000); // Reconnect after 5 seconds
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

    if (accounts.length > 0) {
        authenticateMasters(accounts);
    } else {
        log('No master accounts found');
    }
}

function authenticateMasters(accounts) {
    accounts.forEach(account => {
        sendRequest('authorize', { authorize: account.token }, response => {
            if (!response.error) {
                const master = {
                    ...response.authorize,
                    token: account.token,
                    loginid: account.loginid
                };
                
                if (!masterAccounts.some(a => a.loginid === master.loginid)) {
                    masterAccounts.push(master);
                    saveMasters();
                    updateMasterDisplay();
                    log(`Authenticated: ${master.loginid}`);
                }
            }
        });
    });
}

function reauthenticateMasters() {
    masterAccounts.forEach(account => {
        sendRequest('authorize', { authorize: account.token }, response => {
            if (response.error) {
                log(`Reauthentication failed for ${account.loginid}`);
                masterAccounts = masterAccounts.filter(a => a.loginid !== account.loginid);
                saveMasters();
                updateMasterDisplay();
            }
        });
    });
}

function enableCopiers(loginid) {
    const account = masterAccounts.find(a => a.loginid === loginid);
    if (!account) return;

    sendRequest('set_settings', {
        set_settings: 1,
        loginid,
        allow_copiers: 1
    }, response => {
        if (response.set_settings === 1) {
            log(`Allow copiers enabled for ${loginid}`);
            selectedAccount = loginid;
        } else {
            log(`Failed to enable copiers for ${loginid}`);
        }
    });
}

// Client Management
window.addClient = function() {
    const tokenInput = document.getElementById('clientToken');
    const token = tokenInput.value.trim();
    
    if (!token) {
        log('Please enter a client token');
        return;
    }

    sendRequest('authorize', { authorize: token }, response => {
        if (response.error) {
            log(`Client error: ${response.error.message}`);
            return;
        }

        const client = {
            ...response.authorize,
            token: token
        };

        if (validateClient(client)) {
            clients.push(client);
            saveClients();
            updateClientDisplay();
            log(`Client added: ${client.loginid}`);
            tokenInput.value = '';
        }
    });
}

function validateClient(client) {
    if (!selectedAccount) {
        log('Please select a master account first');
        return false;
    }
    
    const master = masterAccounts.find(a => a.loginid === selectedAccount);
    if (client.is_virtual !== master.is_virtual) {
        log('Client must match master account type');
        return false;
    }
    return true;
}

// Copy Trading Controls
window.startCopying = function() {
    if (!selectedAccount) {
        log('Please select a master account first');
        return;
    }

    clients.forEach(client => {
        sendRequest('copy_start', {
            copy_start: client.token,
            assets: ['frxUSDJPY'],
            max_trade_stake: 100
        }, response => {
            if (response.copy_start === 1) {
                log(`Copying started for ${client.loginid}`);
            } else {
                log(`Failed to start copying for ${client.loginid}`);
            }
        });
    });
}

window.stopCopying = function() {
    clients.forEach(client => {
        sendRequest('copy_stop', {
            copy_stop: client.token
        }, response => {
            if (response.copy_stop === 1) {
                log(`Copying stopped for ${client.loginid}`);
            } else {
                log(`Failed to stop copying for ${client.loginid}`);
            }
        });
    });
}

// UI Functions
function updateMasterDisplay() {
    const dropdownContent = document.getElementById('dropdownContent');
    dropdownContent.innerHTML = masterAccounts.map(acc => `
        <div class="account-item">
            <div>
                <strong>${acc.loginid}</strong>
                <div>${acc.fullname} - ${acc.currency} ${acc.balance}</div>
            </div>
            <button class="btn btn-primary" onclick="enableCopiers('${acc.loginid}')">
                ${selectedAccount === acc.loginid ? '✔ Enabled' : 'Enable Copiers'}
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
            </div>
            <div>${client.token.slice(0, 6)}...${client.token.slice(-4)}</div>
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

function log(message) {
    const logContainer = document.getElementById('logContainer');
    const entry = document.createElement('div');
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
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
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.accounts-dropdown')) {
            document.getElementById('dropdownContent').style.display = 'none';
        }
    });
});
