let activeConnection = null;
let currentAccounts = [];
let selectedAccount = null;
const APP_ID = '66842'; // Replace with your actual app ID

// WebSocket connection manager
const derivWS = {
    conn: null,
    reqId: 1,
    
    connect: function(token) {
        this.conn = new WebSocket('wss://api.deriv.com/websockets/v3');
        
        this.conn.onopen = () => {
            log('🔌 WebSocket connected', 'info');
            this.authorize(token);
        };

        this.conn.onmessage = (e) => this.handleMessage(JSON.parse(e.data));
        
        this.conn.onerror = (e) => {
            log('❌ WebSocket error: ' + e.message, 'error');
        };
    },

    authorize: function(token) {
        this.send({
            authorize: token
        });
    },

    send: function(data) {
        if(this.conn.readyState === WebSocket.OPEN) {
            data.req_id = this.reqId++;
            this.conn.send(JSON.stringify(data));
            log(`📤 Sent: ${JSON.stringify(data)}`, 'info');
        } else {
            log('⚠️ WebSocket not ready', 'error');
        }
    },

    handleMessage: function(response) {
        log(`📥 Received: ${JSON.stringify(response)}`, 'info');
        
        if(response.error) {
            log(`❌ Error: ${response.error.message}`, 'error');
            return;
        }

        if(response.authorize) {
            handleAuthorization(response);
        } else if(response.set_settings) {
            handleSettingsResponse(response);
        } else if(response.copytrading_list) {
            handleCopierList(response);
        }
    }
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const tokens = parseTokensFromURL(params);
    
    if(tokens.length === 0) {
        log('⚠️ No valid accounts found in URL', 'error');
        return;
    }

    currentAccounts = tokens;
    setupAccountsDropdown();
    derivWS.connect(tokens[0].token);
});

function parseTokensFromURL(params) {
    const accounts = [];
    let i = 1;
    
    while(params.get(`acct${i}`)) {
        accounts.push({
            id: params.get(`acct${i}`),
            token: params.get(`token${i}`),
            currency: params.get(`cur${i}`),
            balance: 'Loading...',
            allowCopiers: false
        });
        i++;
    }
    
    return accounts;
}

function setupAccountsDropdown() {
    const dropdown = document.getElementById('dropdownContent');
    dropdown.innerHTML = currentAccounts.map(acc => `
        <div class="account-item">
            <div>
                <strong>${acc.id}</strong><br>
                ${acc.currency.toUpperCase()} - ${acc.balance}
            </div>
            <button class="${acc.allowCopiers ? 'disable-btn' : 'enable-btn'}" 
                    onclick="toggleCopyPermissions('${acc.id}', this)">
                ${acc.allowCopiers ? '🚫 Disallow' : '✅ Allow Copy'}
            </button>
        </div>
    `).join('');
}

function toggleCopyPermissions(accountId, button) {
    const account = currentAccounts.find(acc => acc.id === accountId);
    const newState = !account.allowCopiers;

    derivWS.send({
        set_settings: 1,
        allow_copiers: newState ? 1 : 0,
        loginid: accountId
    });

    button.classList.toggle('enable-btn');
    button.classList.toggle('disable-btn');
    button.textContent = newState ? '🚫 Disallow' : '✅ Allow Copy';
}

function refreshClients() {
    derivWS.send({ copytrading_list: 1 });
}

function logout() {
    // Disable all copiers before logout
    currentAccounts.forEach(acc => {
        if(acc.allowCopiers) {
            derivWS.send({
                set_settings: 1,
                allow_copiers: 0,
                loginid: acc.id
            });
        }
    });
    
    setTimeout(() => {
        window.location.href = 'index.html';
    }, 1000);
}

// Response handlers
function handleAuthorization(response) {
    const account = currentAccounts.find(acc => acc.token === response.echo_req.authorize);
    if(account) {
        account.balance = response.authorize.balance;
        account.allowCopiers = response.authorize.scopes.includes('admin');
        setupAccountsDropdown();
        log(`🔓 Authorized: ${account.id} - Balance: ${account.balance} ${account.currency}`, 'success');
    }
}

function handleSettingsResponse(response) {
    const account = currentAccounts.find(acc => acc.id === response.echo_req.loginid);
    if(account) {
        account.allowCopiers = response.echo_req.allow_copiers === 1;
        log(`⚙️ Settings updated for ${account.id}: Copiers ${account.allowCopiers ? 'allowed' : 'disallowed'}`, 
            account.allowCopiers ? 'success' : 'error');
    }
}

function handleCopierList(response) {
    const clientList = document.getElementById('clientList');
    clientList.innerHTML = response.copytrading_list.copiers.map(copier => `
        <div class="client-item">
            <div>${copier.name || 'Anonymous'} (${copier.loginid})</div>
            <div>${copier.balance} ${copier.currency}</div>
        </div>
    `).join('');
}

// Logging system
function log(message, type = 'info') {
    const logContainer = document.getElementById('logContainer');
    const logEntry = document.createElement('div');
    
    logEntry.className = `log-${type}`;
    logEntry.innerHTML = `[${new Date().toLocaleTimeString()}] ${message}`;
    
    logContainer.appendChild(logEntry);
    logContainer.scrollTop = logContainer.scrollHeight;
}
