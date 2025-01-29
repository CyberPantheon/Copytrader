const API_URL = 'wss://ws.binaryws.com/websockets/v3?app_id=66842';
let ws;
let masterAccounts = JSON.parse(localStorage.getItem('masterAccounts')) || [];
let clients = JSON.parse(localStorage.getItem('clients')) || [];
let selectedAccount = null;

// Add missing handleAPIResponse function
function handleAPIResponse(response) {
    try {
        log(`Received: ${JSON.stringify(response)}`);
        
        if (response.authorize) {
            handleAuthorization(response);
        } 
        else if (response.get_settings) {
            handleGetSettings(response);
        }
        else if (response.set_settings) {
            handleSetSettings(response);
        }
        else if (response.copy_start || response.copy_stop) {
            handleCopyResponse(response);
        }
        else if (response.error) {
            log(`Error: ${response.error.message}`);
        }
    } catch (error) {
        log(`Response handling error: ${error.message}`);
    }
}

// Add missing handler functions
function handleAuthorization(response) {
    const account = masterAccounts.find(acc => acc.token === response.echo_req.authorize);
    if (account) {
        account.balance = response.authorize.balance;
        account.currency = response.authorize.currency;
        account.fullname = response.authorize.fullname;
        updateMasterDisplay();
        saveMasterAccounts();
    }
}

function handleGetSettings(response) {
    const account = masterAccounts.find(acc => acc.loginid === response.echo_req.loginid);
    if (account) {
        account.allowCopiers = response.get_settings.allow_copiers === 1;
        updateMasterDisplay();
    }
}

function handleSetSettings(response) {
    const account = masterAccounts.find(acc => acc.loginid === response.echo_req.loginid);
    if (account) {
        account.allowCopiers = response.set_settings === 1;
        updateMasterDisplay();
        log(response.set_settings === 1 ? 
            `Copiers enabled for ${account.loginid}` : 
            `Failed to enable copiers for ${account.loginid}`);
    }
}

function handleCopyResponse(response) {
    if (response.copy_start) {
        log(response.copy_start === 1 ? 
            `Copying started successfully` : 
            `Copy start failed: ${response.error.message}`);
    }
    if (response.copy_stop) {
        log(response.copy_stop === 1 ? 
            `Copying stopped successfully` : 
            `Copy stop failed: ${response.error.message}`);
    }
}

// Modified initialization flow
function initWebSocket() {
    try {
        if (ws) ws.close();
        
        ws = new WebSocket(API_URL);
        
        ws.onopen = () => {
            log('Connected to Deriv API');
            loadPersistedData();
            
            if (masterAccounts.length === 0) {
                processOAuthParams();
            } else {
                // Re-authenticate all accounts
                masterAccounts.forEach(acc => {
                    sendRequest('authorize', { authorize: acc.token }, () => {
                        updateAccountDetails(acc);
                    });
                });
            }
        };

        ws.onmessage = (msg) => {
            try {
                const response = JSON.parse(msg.data);
                handleAPIResponse(response);
            } catch (error) {
                log(`Message parsing error: ${error.message}`);
            }
        };

        ws.onerror = (error) => {
            log(`WebSocket error: ${error.message}`);
        };

        ws.onclose = () => {
            log('WebSocket connection closed');
            setTimeout(initWebSocket, 5000);
        };
    } catch (error) {
        log(`WebSocket initialization error: ${error.message}`);
    }
}

// Add missing client display update
function updateClientDisplay() {
    try {
        const container = document.getElementById('clientList');
        if (!container) {
            log('Client list container not found');
            return;
        }
        
        container.innerHTML = clients.map(client => `
            <div class="client-item">
                <div>
                    <strong>${client.loginid}</strong>
                    <div>${client.fullname}</div>
                    <div>Balance: ${client.currency} ${client.balance}</div>
                    <div>Type: ${client.is_virtual ? 'Virtual' : 'Real'}</div>
                </div>
                <div class="token-display">${client.token.slice(0, 6)}...${client.token.slice(-4)}</div>
            </div>
        `).join('');
    } catch (error) {
        log(`Client display error: ${error.message}`);
    }
}

// Add proper error handling to sendRequest
function sendRequest(type, data, callback) {
    try {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            log('WebSocket not connected');
            return;
        }
        
        const req = { ...data, req_id: Date.now() };
        ws.send(JSON.stringify(req));
        
        const listener = (msg) => {
            try {
                const response = JSON.parse(msg.data);
                if (response.req_id === req.req_id) {
                    callback(response);
                    ws.removeEventListener('message', listener);
                }
            } catch (error) {
                log(`Request response error: ${error.message}`);
            }
        };
        
        ws.addEventListener('message', listener);
    } catch (error) {
        log(`Request sending error: ${error.message}`);
    }
}

// Add proper error handling to logout
function logout() {
    try {
        localStorage.clear();
        masterAccounts = [];
        clients = [];
        if (ws?.readyState === WebSocket.OPEN) ws.close();
        window.location.href = 'index.html';
    } catch (error) {
        console.error('Logout error:', error);
    }
}

// Enhanced loadPersistedData
function loadPersistedData() {
    try {
        const storedMasters = localStorage.getItem('masterAccounts');
        if (storedMasters) {
            masterAccounts = JSON.parse(storedMasters);
            updateMasterDisplay();
        }
        
        const storedClients = localStorage.getItem('clients');
        if (storedClients) {
            clients = JSON.parse(storedClients);
            updateClientDisplay();
        }
    } catch (error) {
        log(`Data load error: ${error.message}`);
    }
}

// Initialize properly
document.addEventListener('DOMContentLoaded', () => {
    try {
        loadPersistedData();
        initWebSocket();
        
        // Add event listeners for buttons
        document.getElementById('clientToken')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') addClient();
        });
        
        log('System initialized');
    } catch (error) {
        log(`Initialization error: ${error.message}`);
    }
});
