const API_URL = 'wss://ws.binaryws.com/websockets/v3?app_id=66842';
let ws;
let accounts = [];
let selectedAccount = null;
let masterToken = localStorage.getItem('masterToken') || null;
let masterDetails = JSON.parse(localStorage.getItem('masterDetails')) || null;
let activeCopiers = new Set();

// WebSocket Management
function initWebSocket() {
    ws = new WebSocket(API_URL);

    ws.onopen = () => {
        log('Connected to Deriv API', 'success');
        processOAuthParams();
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
    } else if (response.copytrading_list) {
        handleClientList(response);
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
    const newAccounts = [];

    let index = 1;
    while (params.has(`acct${index}`)) {
        newAccounts.push({
            loginid: params.get(`acct${index}`),
            token: params.get(`token${index}`),
            currency: params.get(`cur${index}`)
        });
        index++;
    }

    window.history.replaceState({}, document.title, window.location.pathname);

    if (newAccounts.length > 0) {
        authenticateAccounts(newAccounts);
    } else {
        log('No accounts found in OAuth parameters', 'warning');
        loadStoredAccounts();
    }
}

function authenticateAccounts(newAccounts) {
    newAccounts.forEach(account => {
        sendRequest('authorize', {
            authorize: account.token,
            req_id: Date.now()
        }, response => {
            if (!response.error) {
                const authData = {
                    ...response.authorize,
                    token: account.token,
                    loginid: account.loginid,
                    allow_copiers: false
                };

                if (!accounts.some(a => a.loginid === authData.loginid)) {
                    accounts.push(authData);
                    localStorage.setItem('accounts', JSON.stringify(accounts));
                    updateAccountDisplay();
                    log(`Authenticated: ${authData.loginid}`, 'success');

                    if (isMasterPage()) {
                        checkCopierStatus(authData.loginid);
                    }
                }
            } else {
                log(`Authentication failed for ${account.loginid}: ${response.error.message}`, 'error');
            }
        });
    });
}

function loadStoredAccounts() {
    const storedAccounts = JSON.parse(localStorage.getItem('accounts')) || [];
    if (storedAccounts.length > 0) {
        accounts = storedAccounts;
        updateAccountDisplay();

        if (isMasterPage()) {
            refreshClients();
        } else if (masterDetails) {
            showMasterDetails();
        }
    }
}

// Master Page Functions
function checkCopierStatus(loginid) {
    sendRequest('get_settings', {
        get_settings: 1,
        loginid: loginid
    }, response => {
        if (!response.error) {
            const allowCopiers = response.get_settings.allow_copiers === 1;
            accounts = accounts.map(acc =>
                acc.loginid === loginid ? { ...acc, allow_copiers: allowCopiers } : acc
            );
            localStorage.setItem('accounts', JSON.stringify(accounts));
            updateAccountDisplay();
        }
    });
}

function toggleCopiers(loginid, enable) {
    const account = accounts.find(a => a.loginid === loginid);
    if (!account) return;

    sendRequest('set_settings', {
        set_settings: 1,
        loginid: loginid,
        allow_copiers: enable ? 1 : 0
    }, response => {
        if (response.set_settings === 1) {
            log(`${enable ? 'Enabled' : 'Disabled'} copiers for ${loginid}`, 'success');
            checkCopierStatus(loginid);
            if (!enable) refreshClients();
        }
    });
}

function refreshClients() {
    if (!selectedAccount) return;

    sendRequest('copytrading_list', {
        copytrading_list: 1,
        loginid: selectedAccount
    }, response => {
        if (response.copytrading_list) {
            handleClientList(response);
        }
    });
}

function handleClientList(response) {
    const clients = response.copytrading_list.copiers || [];
    const clientList = document.getElementById('clientList');

    clientList.innerHTML = clients.map(client => `
        <div class="client-item">
            <div>
                <strong>${client.loginid}</strong>
                <div>${client.name} - ${client.currency} ${client.balance}</div>
            </div>
            <div class="copy-status">
                ${client.copy_trades ? '✅ Active' : '❌ Inactive'}
            </div>
        </div>
    `).join('');
}

// Client Page Functions
function authenticateMaster(auto = false) {
    const tokenInput = document.getElementById('masterToken');
    const token = auto ? masterToken : tokenInput.value.trim();

    if (!token) {
        log('Please enter a master token', 'warning');
        return;
    }

    sendRequest('authorize', { authorize: token }, response => {
        if (response.error) {
            log(`Master authentication failed: ${response.error.message}`, 'error');
            return;
        }

        masterDetails = response.authorize;
        masterToken = token;
        localStorage.setItem('masterToken', token);
        localStorage.setItem('masterDetails', JSON.stringify(masterDetails));

        if (!auto) tokenInput.value = '';
        showMasterDetails();
        log(`Master authenticated: ${masterDetails.loginid}`, 'success');
    });
}

function showMasterDetails() {
    const masterInfo = document.getElementById('masterInfo');
    if (!masterDetails) return;

    masterInfo.innerHTML = `
        <h3>Master Account Details</h3>
        <div>Login ID: ${masterDetails.loginid}</div>
        <div>Name: ${masterDetails.fullname}</div>
        <div>Currency: ${masterDetails.currency}</div>
        <div>Balance: ${masterDetails.balance}</div>
    `;
}

function toggleCopy(loginid, start) {
    if (!masterToken) {
        log('Authenticate master first', 'error');
        return;
    }

    const clientAccount = accounts.find(a => a.loginid === loginid);
    if (!clientAccount) return;

    if (clientAccount.currency !== masterDetails.currency) {
        log('Currency mismatch with master account', 'error');
        return;
    }

    const action = start ? 'copy_start' : 'copy_stop';
    sendRequest(action, {
        [action]: masterToken
    }, response => {
        if (response[action] === 1) {
            log(`${start ? 'Started' : 'Stopped'} copying for ${loginid}`, 'success');
            if (start) activeCopiers.add(loginid);
            else activeCopiers.delete(loginid);
            updateAccountDisplay();
        }
    });
}

// Common UI Functions
function updateAccountDisplay() {
    const dropdown = document.getElementById('dropdownContent');
    if (!dropdown) return;

    dropdown.innerHTML = accounts.map(acc => `
        <div class="account-item">
            <div>
                <strong>${acc.loginid}</strong>
                <div>${acc.fullname} - ${acc.currency} ${acc.balance}</div>
            </div>
            ${isMasterPage() ? `
                <button class="${acc.allow_copiers ? 'disable-btn' : 'enable-btn'}" 
                        onclick="toggleCopiers('${acc.loginid}', ${!acc.allow_copiers})">
                    ${acc.allow_copiers ? 'Disallow' : 'Allow'} Copiers
                </button>
            ` : `
                <button class="${activeCopiers.has(acc.loginid) ? 'disable-btn' : 'enable-btn'}"
                        onclick="toggleCopy('${acc.loginid}', ${!activeCopiers.has(acc.loginid)})">
                    ${activeCopiers.has(acc.loginid) ? 'Stop Copy' : 'Start Copy'}
                </button>
            `}
        </div>
    `).join('');
}

function toggleDropdown() {
    const dropdown = document.getElementById('dropdownContent');
    if (dropdown) {
        dropdown.style.display = dropdown.style.display === 'block' ? 'none' : 'block';
    }
}

// Logout Handler
async function logout() {
    // Stop all active copying for clients
    if (!isMasterPage()) {
        const stopPromises = [...activeCopiers].map(loginid =>
            new Promise(resolve => {
                sendRequest('copy_stop', {
                    copy_stop: masterToken
                }, response => {
                    if (response.copy_stop === 1) {
                        log(`Stopped copying for ${loginid}`, 'success');
                    }
                    resolve();
                });
            })
        );
        await Promise.all(stopPromises);
    }

    // Clear sensitive data
    localStorage.removeItem('masterToken');
    localStorage.removeItem('masterDetails');
    activeCopiers.clear();

    // Redirect to login
    window.location.href = 'index.html';
}

// WebSocket Utilities
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

function isMasterPage() {
    return window.location.pathname.endsWith('home.html');
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

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    initWebSocket();
});
