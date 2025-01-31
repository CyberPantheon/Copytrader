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

// OAuth and Authentication
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
        log('No accounts found in OAuth parameters', 'warning');
    }
}

function authenticateMasters(accounts) {
    accounts.forEach(account => {
        sendRequest('authorize', { authorize: account.token }, response => {
            if (!response.error) {
                const master = {
                    ...response.authorize,
                    token: account.token,
                    loginid: account.loginid,
                    allow_copiers: response.authorize.allow_copiers === 1,
                    currency: account.currency,
                    account_type: response.authorize.account_type
                };

                if (!masterAccounts.some(a => a.loginid === master.loginid)) {
                    masterAccounts.push(master);
                    saveMasters();
                    updateMasterDisplay();
                    checkAccountConfiguration(master);
                }
            } else {
                log(`Authentication failed for ${account.loginid}: ${response.error.message}`, 'error');
            }
        });
    });
}

function checkAccountConfiguration(account) {
    if (account.account_type !== 'peer_to_peer') {
        log(`Account ${account.loginid} needs peer_to_peer type. Create new account via Deriv dashboard.`, 'error');
    }
    if (!account.allow_copiers) {
        log(`Account ${account.loginid} requires copiers enabled`, 'warning');
    }
}

function reauthenticateMasters() {
    masterAccounts.forEach(account => {
        sendRequest('authorize', { authorize: account.token }, response => {
            if (response.error) {
                log(`Reauthentication failed for ${account.loginid}`, 'error');
                masterAccounts = masterAccounts.filter(a => a.loginid !== account.loginid);
                saveMasters();
                updateMasterDisplay();
            } else {
                const updatedMaster = {
                    ...account,
                    allow_copiers: response.authorize.allow_copiers === 1,
                    currency: response.authorize.currency
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
        log(`Initializing settings for ${loginid}...`, 'info');
        settingsWS.send(JSON.stringify({
            authorize: account.token,
            req_id: Date.now()
        }));
    };

    settingsWS.onmessage = (event) => {
        const response = JSON.parse(event.data);
        if (response.authorize) {
            log(`Authorized ${loginid} for settings`, 'success');
            settingsWS.send(JSON.stringify({
                set_settings: 1,
                allow_copiers: 1,
                loginid: account.loginid,
                req_id: Date.now()
            }));
        } else if (response.set_settings) {
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
        } else if (response.error) {
            if (response.error.code === 'InvalidAccount') {
                log(`Account configuration error: Create new account via Deriv dashboard with 'Peer-to-peer exchange' purpose`, 'error');
            } else {
                log(`Settings error: ${response.error.message}`, 'error');
            }
            settingsWS.close();
        }
    };

    settingsWS.onerror = (error) => {
        log(`Settings connection error: ${error.message}`, 'error');
        settingsWS.close();
    };
}

// Client Management
window.addClient = function () {
    const tokenInput = document.getElementById('clientToken');
    const token = tokenInput.value.trim();

    if (!token) {
        log('Please enter a client token', 'warning');
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
            last_verified: Date.now()
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
    if (!selectedAccount) {
        log('Select a master account first', 'error');
        return false;
    }

    const master = masterAccounts.find(a => a.loginid === selectedAccount);
    if (!master) {
        log('Master account not found', 'error');
        return false;
    }

    if (client.is_virtual !== master.is_virtual) {
        log('Account types must match (real/virtual)', 'error');
        return false;
    }

    if (client.currency !== master.currency) {
        log(`Currency mismatch: Master (${master.currency}) vs Client (${client.currency})`, 'error');
        return false;
    }

    if (!client.scopes?.includes('trade') || !client.scopes?.includes('trading_information')) {
        log('Client missing required permissions', 'error');
        return false;
    }

    if (!master.allow_copiers) {
        log('Enable copiers on master account first', 'error');
        return false;
    }

    if (master.account_type !== 'peer_to_peer') {
        log('Master account must be peer_to_peer type', 'error');
        return false;
    }

    return true;
}

// Copy Trading Controls
window.startCopying = function () {
    if (!selectedAccount) {
        log('Select a master account first', 'error');
        return;
    }

    const master = masterAccounts.find(a => a.loginid === selectedAccount);
    if (!master?.allow_copiers) {
        log('Enable copiers on master first', 'error');
        return;
    }

    if (clients.length === 0) {
        log('Add client accounts first', 'warning');
        return;
    }

    clients.forEach(client => {
        sendRequest('authorize', { authorize: client.token }, response => {
            if (response.error) {
                log(`Client ${client.loginid} authorization failed: ${response.error.message}`, 'error');
                return;
            }

            sendRequest('copy_start', {
                copy_start: client.token
            }, response => {
                if (response.copy_start === 1) {
                    log(`Copying all trades for ${client.loginid}`, 'success');
                } else {
                    log(`Copy failed: ${response.error?.message || 'Unknown error'}`, 'error');
                }
            });
        });
    });
};

window.stopCopying = function () {
    if (clients.length === 0) {
        log('No clients to stop copying', 'warning');
        return;
    }

    clients.forEach(client => {
        sendRequest('copy_stop', {
            copy_stop: client.token
        }, response => {
            if (response.copy_stop === 1) {
                log(`Copying stopped for ${client.loginid}`, 'success');
            } else {
                log(`Stop failed: ${response.error?.message || 'Unknown error'}`, 'error');
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
                <small>${acc.allow_copiers ? '✅ Copiers Enabled' : '❌ Copiers Disabled'}</small>
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

window.toggleDropdown = function () {
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

window.logout = function () {
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
