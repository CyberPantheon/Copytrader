const API_URL = 'wss://ws.binaryws.com/websockets/v3?app_id=66842';
let ws;
let isMasterPage = window.location.pathname.includes('home.html');
let accounts = JSON.parse(localStorage.getItem('accounts')) || [];
let masterInfo = JSON.parse(localStorage.getItem('masterInfo')) || null;
let selectedAccount = null;

// WebSocket Management
function initWebSocket() {
    ws = new WebSocket(API_URL);

    ws.onopen = () => {
        log('Connected to Deriv API', 'success');
        if(isMasterPage) authenticateMasters();
        else authenticateClients();
    };

    ws.onmessage = handleMessage;
    ws.onerror = handleError;
    ws.onclose = handleClose;
}

function handleMessage(event) {
    const response = JSON.parse(event.data);
    
    if(response.error) {
        log(`Error: ${response.error.message}`, 'error');
    } else if(response.authorize) {
        handleAuthorization(response);
    } else if(response.set_settings) {
        handleSettingsResponse(response);
    } else if(response.copytrading_list) {
        handleClientList(response);
    } else if(response.copy_start || response.copy_stop) {
        handleCopyResponse(response);
    }
}

// Authentication Handlers
function authenticateMasters() {
    accounts.forEach(account => {
        sendRequest('authorize', { authorize: account.token }, response => {
            if(!response.error) updateAccount(response.authorize);
        });
    });
}

function authenticateClients() {
    accounts.forEach(account => {
        sendRequest('authorize', { authorize: account.token }, response => {
            if(!response.error) updateAccount(response.authorize);
        });
    });
    if(masterInfo) verifyMasterConnection();
}

// Master Functions
function toggleCopiers(loginid, enable) {
    sendRequest('set_settings', {
        set_settings: 1,
        loginid: loginid,
        allow_copiers: enable ? 1 : 0
    }, response => {
        if(response.set_settings === 1) {
            log(`${enable ? 'Enabled' : 'Disabled'} copiers for ${loginid}`, 'success');
            refreshClients();
        }
    });
}

// Client Functions
window.authenticateMaster = function() {
    const token = document.getElementById('masterToken').value.trim();
    if(!token) return;

    sendRequest('authorize', { authorize: token }, response => {
        if(response.error) {
            log(`Master authentication failed: ${response.error.message}`, 'error');
            return;
        }
        
        masterInfo = {
            loginid: response.authorize.loginid,
            currency: response.authorize.currency,
            token: token
        };
        
        localStorage.setItem('masterInfo', JSON.stringify(masterInfo));
        updateMasterDisplay();
        log('Master account verified ✔️', 'success');
    });
}

window.toggleCopy = function(loginid, isCopying) {
    const account = accounts.find(a => a.loginid === loginid);
    if(!account || !masterInfo) return;

    if(isCopying) {
        stopCopying(loginid);
    } else {
        if(account.currency !== masterInfo.currency) {
            log('Currency mismatch with master account', 'error');
            return;
        }
        startCopying(loginid);
    }
}

function startCopying(loginid) {
    sendRequest('copy_start', {
        copy_start: masterInfo.token,
        params: {
            trade_types: ["CALL", "PUT"],
            loginid: loginid
        }
    }, response => {
        if(response.copy_start) {
            updateCopyStatus(loginid, true);
            log(`Copying started for ${loginid}`, 'success');
        }
    });
}

function stopCopying(loginid) {
    sendRequest('copy_stop', {
        copy_stop: masterInfo.token,
        loginid: loginid
    }, response => {
        if(response.copy_stop) {
            updateCopyStatus(loginid, false);
            log(`Copying stopped for ${loginid}`, 'success');
        }
    });
}

// UI Updates
function updateMasterDisplay() {
    if(!isMasterPage) {
        const masterInfoDiv = document.getElementById('masterInfo');
        if(masterInfo) {
            masterInfoDiv.innerHTML = `
                <div class="client-item">
                    <div>Master Account: ${masterInfo.loginid}</div>
                    <div>Currency: ${masterInfo.currency}</div>
                </div>
            `;
        }
        return;
    }

    // Master page updates
    const dropdown = document.getElementById('dropdownContent');
    dropdown.innerHTML = accounts.map(acc => `
        <div class="account-item">
            <div>
                <strong>${acc.loginid}</strong>
                <div>${acc.currency} ${acc.balance}</div>
            </div>
            <button class="${acc.allow_copiers ? 'disable-btn' : 'enable-btn'}" 
                    onclick="toggleCopiers('${acc.loginid}', ${!acc.allow_copiers})">
                ${acc.allow_copiers ? 'Disallow' : 'Allow'} Copiers
            </button>
        </div>
    `).join('');
}

function updateClientDisplay() {
    const accountList = document.getElementById('accountList');
    accountList.innerHTML = accounts.map(acc => `
        <div class="client-item">
            <div>
                <strong>${acc.loginid}</strong>
                <div>${acc.currency} ${acc.balance}</div>
            </div>
            <button class="${acc.is_copying ? 'disable-btn' : 'enable-btn'}" 
                    onclick="toggleCopy('${acc.loginid}', ${acc.is_copying})">
                ${acc.is_copying ? 'Stop Copying' : 'Start Copying'}
            </button>
        </div>
    `).join('');
}

// Logout Handler
window.logout = async function() {
    if(!isMasterPage && masterInfo) {
        const stopPromises = accounts.map(acc => 
            new Promise(resolve => {
                if(acc.is_copying) {
                    stopCopying(acc.loginid);
                    setTimeout(resolve, 500);
                } else {
                    resolve();
                }
            })
        );
        await Promise.all(stopPromises);
    }
    
    localStorage.clear();
    window.location.href = '/index.html';
}

// Utilities
function sendRequest(type, data, callback) {
    const req_id = Date.now();
    const request = { ...data, req_id };
    
    ws.send(JSON.stringify(request));
    
    const listener = (event) => {
        const response = JSON.parse(event.data);
        if(response.req_id === req_id) {
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

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    initWebSocket();
    if(isMasterPage) {
        updateMasterDisplay();
        refreshClients();
    } else {
        updateMasterDisplay();
        updateClientDisplay();
    }
});
