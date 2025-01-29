const API_URL = 'wss://ws.binaryws.com/websockets/v3?app_id=66842';
let ws;
let masterAccounts = JSON.parse(localStorage.getItem('masterAccounts')) || [];
let clients = JSON.parse(localStorage.getItem('clients')) || [];
let selectedAccount = null;

function handleAPIResponse(response) {
    try {
        log(`Received: ${JSON.stringify(response)}`);
        if (response.authorize) handleAuthorization(response);
        else if (response.get_settings) handleGetSettings(response);
        else if (response.set_settings) handleSetSettings(response);
        else if (response.copy_start || response.copy_stop) handleCopyResponse(response);
        else if (response.error) log(`Error: ${response.error.message}`);
    } catch (error) {
        log(`Response handling error: ${error.message}`);
    }
}

function handleAuthorization(response) {
    const account = masterAccounts.find(acc => acc.loginid === response.authorize.loginid);
    if (account) {
        Object.assign(account, response.authorize);
        saveMasterAccounts();
        updateMasterDisplay();
    }
}

function initWebSocket() {
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    ws = new WebSocket(API_URL);
    
    ws.onopen = () => {
        log('Connected to Deriv API');
        loadPersistedData();
        masterAccounts.forEach(acc => {
            sendRequest('authorize', { authorize: acc.token }, handleAuthorization);
        });
    };
    
    ws.onmessage = (msg) => handleAPIResponse(JSON.parse(msg.data));
    ws.onerror = (error) => log(`WebSocket error: ${error.message}`);
    ws.onclose = () => {
        log('WebSocket closed, reconnecting...');
        setTimeout(initWebSocket, 5000);
    };
}

function sendRequest(type, data, callback) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
        log('WebSocket not connected');
        return;
    }
    
    const req = { ...data, req_id: Date.now() };
    ws.send(JSON.stringify(req));
    ws.addEventListener('message', function listener(msg) {
        const response = JSON.parse(msg.data);
        if (response.req_id === req.req_id) {
            callback(response);
            ws.removeEventListener('message', listener);
        }
    });
}

function validateClient(client) {
    const master = masterAccounts.find(a => a.allowCopiers);
    if (!master) {
        log('No master account with copiers enabled');
        return false;
    }
    return client.is_virtual === master.is_virtual;
}

function addClient() {
    const token = document.getElementById('clientToken').value.trim();
    if (!token) return log('Enter a client API token');
    if (clients.some(c => c.token === token)) return log('Client already exists');
    
    sendRequest('authorize', { authorize: token }, (res) => {
        if (res.error) return log(`Client authentication failed: ${res.error.message}`);
        
        const client = { ...res.authorize, token };
        if (validateClient(client)) {
            clients.push(client);
            saveClients();
            updateClientDisplay();
            log(`Client ${client.loginid} added`);
        }
    });
}

function startCopying() {
    const master = masterAccounts.find(a => a.allowCopiers);
    if (!master) return log('No master account with copiers enabled');
    
    clients.forEach(client => {
        sendRequest('copy_start', { copy_start: client.token, assets: ['frxUSDJPY'], max_trade_stake: 100, trade_types: ['CALL', 'PUT'] },
            (res) => log(res.copy_start === 1 ? `Copying started for ${client.loginid}` : `Copy start failed: ${res.error?.message}`)
        );
    });
}

function updateMasterDisplay() {
    const container = document.getElementById('masterAccounts');
    if (!container) return;
    container.innerHTML = masterAccounts.map(acc => `
        <div class="account-item">
            <strong>${acc.loginid}</strong> - ${acc.currency} ${acc.balance}
            <button onclick="enableCopiers('${acc.loginid}')" ${acc.allowCopiers ? 'disabled' : ''}>
                ${acc.allowCopiers ? 'Copiers Enabled' : 'Enable Copiers'}
            </button>
        </div>
    `).join('');
}

function updateClientDisplay() {
    const container = document.getElementById('clientList');
    if (!container) return;
    container.innerHTML = clients.map(client => `
        <div class="client-item">
            <strong>${client.loginid}</strong> - ${client.currency} ${client.balance}
            <div class="token-display">${client.token.slice(0, 6)}...${client.token.slice(-4)}</div>
        </div>
    `).join('');
}

function loadPersistedData() {
    masterAccounts = JSON.parse(localStorage.getItem('masterAccounts')) || [];
    clients = JSON.parse(localStorage.getItem('clients')) || [];
    updateMasterDisplay();
    updateClientDisplay();
}

document.addEventListener('DOMContentLoaded', () => {
    loadPersistedData();
    initWebSocket();
    document.getElementById('clientToken')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addClient();
    });
});
