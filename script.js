const API_URL = 'wss://ws.binaryws.com/websockets/v3?app_id=66842';
let ws;
let masterAccounts = [];
let clients = JSON.parse(localStorage.getItem('clients')) || [];

// 1. Restore working initialization flow
function initWebSocket() {
    if (ws) ws.close();
    
    ws = new WebSocket(API_URL);
    
    ws.onopen = () => {
        log('Connected to Deriv API');
        processOAuthParams();
        loadPersistedData();
    };

    ws.onmessage = (msg) => {
        try {
            const response = JSON.parse(msg.data);
            handleAPIResponse(response);
        } catch (error) {
            log(`Message parsing error: ${error.message}`);
        }
    };

    ws.onerror = (error) => log(`WebSocket error: ${error.message}`);
    ws.onclose = () => {
        log('WebSocket connection closed');
        setTimeout(initWebSocket, 5000);
    };
}

// 2. Fix OAuth processing sequence
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
    }
}

// 3. Maintain original authentication flow
function authenticateMaster(accounts) {
    masterAccounts = []; // Reset existing accounts
    accounts.forEach(account => {
        sendRequest('authorize', { authorize: account.token }, (res) => {
            if (!res.error) {
                const masterAccount = {
                    ...res.authorize,
                    token: account.token,
                    loginid: account.loginid,
                    allowCopiers: false
                };
                masterAccounts.push(masterAccount);
                updateAccountDetails(masterAccount);
                updateMasterDisplay();
            }
        });
    });
}

// 4. Fix response handling chain
function handleAPIResponse(response) {
    if (response.authorize) {
        const account = masterAccounts.find(a => a.token === response.echo_req.authorize);
        if (account) {
            Object.assign(account, response.authorize);
            updateMasterDisplay();
        }
    }
    else if (response.get_settings) {
        const account = masterAccounts.find(a => a.loginid === response.echo_req.loginid);
        if (account) {
            account.allowCopiers = response.get_settings.allow_copiers === 1;
            updateMasterDisplay();
        }
    }
    else if (response.set_settings) {
        const account = masterAccounts.find(a => a.loginid === response.echo_req.loginid);
        if (account) {
            account.allowCopiers = response.set_settings === 1;
            updateMasterDisplay();
        }
    }
    else if (response.error) {
        log(`Error: ${response.error.message}`);
    }
}

// 5. Keep UI updates from original working version
function updateMasterDisplay() {
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
}

// 6. Maintain working client management from original
function updateClientDisplay() {
    const container = document.getElementById('clientList');
    if (!container) return;
    
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
}

// 7. Initialize with proper sequencing
document.addEventListener('DOMContentLoaded', () => {
    initWebSocket();
    document.getElementById('clientToken')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addClient();
    });
});
