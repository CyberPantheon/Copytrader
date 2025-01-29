document.addEventListener("DOMContentLoaded", () => {
const API_URL = 'wss://ws.binaryws.com/websockets/v3?app_id=66842'; // Use your full app ID
let ws;
let masterAccounts = [];
let clients = [];
let currentMasterToken = '';

// Initialize WebSocket connection
function initWebSocket() {
    ws = new WebSocket(API_URL);
    
    ws.onopen = () => {
        log('Connected to Deriv API');
        const params = new URLSearchParams(localStorage.getItem('deriv_oauth_params'));
        handleOAuthParams(params);
    };

    ws.onmessage = (msg) => {
        const response = JSON.parse(msg.data);
        handleAPIResponse(response);
    };

    ws.onerror = (error) => {
        log(`WebSocket error: ${error.message}`);
    };
}

function handleOAuthParams(params) {
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

    if (accounts.length > 0) {
        currentMasterToken = accounts[0].token;
        authenticateMaster(accounts);
    }
}

function authenticateMaster(accounts) {
    accounts.forEach(account => {
        sendRequest('authorize', { authorize: account.token }, (res) => {
            if (!res.error) {
                const masterAccount = {
                    ...res.authorize,
                    token: account.token,
                    loginid: account.loginid
                };
                masterAccounts.push(masterAccount);
                enableCopiers(masterAccount.loginid);
                updateMasterDisplay();
                log(`Authenticated master account: ${masterAccount.loginid}`);
                log(`User: ${masterAccount.fullname} | Balance: ${masterAccount.balance} ${masterAccount.currency}`);
            }
        });
    });
}

function enableCopiers(loginid) {
    sendRequest('set_settings', {
        set_settings: 1,
        loginid,
        allow_copiers: 1
    }, (res) => {
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
    
    if (!token) return;

    sendRequest('authorize', { authorize: token }, (res) => {
        if (res.error) {
            log(`Client authentication failed: ${res.error.message}`);
            return;
        }

        const client = {
            ...res.authorize,
            token
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
    const masterIsVirtual = masterAccounts[0].is_virtual;
    if (client.is_virtual !== masterIsVirtual) {
        log('Error: Client and master must be both real or both virtual');
        return false;
    }
    return true;
}

function startCopying() {
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
        <div class="account-card">
            <h4>${acc.loginid}</h4>
            <p>Name: ${acc.fullname}</p>
            <p>Balance: ${acc.currency} ${acc.balance}</p>
            <p>Landing Company: ${acc.landing_company_name}</p>
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
    if (stored) clients = JSON.parse(stored);
}

function logout() {
    localStorage.removeItem('deriv_oauth_params');
    localStorage.removeItem('clients');
    window.location.href = 'index.html';
}

// // Initialization
// document.addEventListener('DOMContentLoaded', () => {
//     if (!localStorage.getItem('deriv_oauth_params')) {
//         window.location.href = 'index.html';
//         return;
//     }
    loadClients();
    initWebSocket();
});
}
