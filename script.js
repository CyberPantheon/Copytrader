let activeConnection = null;
let currentAccounts = [];
let selectedAccount = null;
const APP_ID = '68004'; // Your actual app ID

// WebSocket connection manager
const derivWS = {
    conn: null,
    reqId: 1,
    
    connect: function(token) {
        // Close existing connection if any
        if (this.conn) {
            this.conn.close();
        }

        // Initialize new WebSocket connection
        this.conn = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${APP_ID}`);
        
        this.conn.onopen = () => {
            log('🔌 WebSocket connected', 'info');
            this.authorize(token);
        };

        this.conn.onmessage = (e) => {
            try {
                const response = JSON.parse(e.data);
                this.handleMessage(response);
            } catch (error) {
                log(`❌ Error parsing WebSocket message: ${error.message}`, 'error');
            }
        };
        
        this.conn.onerror = (e) => {
            log(`❌ WebSocket error: ${e.message || 'Unknown error'}`, 'error');
        };

        this.conn.onclose = () => {
            log('🔌 WebSocket connection closed. Reconnecting...', 'warning');
            setTimeout(() => this.connect(token), 5000); // Reconnect after 5 seconds
        };
    },

    authorize: function(token) {
        this.send({
            authorize: token
        });
    },

    send: function(data) {
        if (this.conn && this.conn.readyState === WebSocket.OPEN) {
            data.req_id = this.reqId++;
            this.conn.send(JSON.stringify(data));
            log(`📤 Sent: ${JSON.stringify(data)}`, 'info');
        } else {
            log('⚠️ WebSocket not ready. Attempting to reconnect...', 'error');
            this.connect(currentAccounts[0]?.token); // Reconnect using the first account's token
        }
    },

    handleMessage: function(response) {
        log(`📥 Received: ${JSON.stringify(response)}`, 'info');
        
        if (response.error) {
            log(`❌ Error: ${response.error.message} (code: ${response.error.code})`, 'error');
            return;
        }

        if (response.authorize) {
            handleAuthorization(response);
        } else if (response.set_settings) {
            handleSettingsResponse(response);
        } else if (response.copytrading_list) {
            handleCopierList(response);
        }
    }
};

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const tokens = parseTokensFromURL(params);
    
    if (tokens.length === 0) {
        log('⚠️ No valid accounts found in URL', 'error');
        return;
    }

    currentAccounts = tokens;
    setupAccountsDropdown();
    derivWS.connect(tokens[0].token);
});

// Parse OAuth tokens from URL
function parseTokensFromURL(params) {
    const accounts = [];
    let i = 1;
    
    while (params.get(`acct${i}`)) {
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

// Setup accounts dropdown
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

// Toggle copy permissions for an account
function toggleCopyPermissions(accountId, button) {
    const account = currentAccounts.find(acc => acc.id === accountId);
    if (!account) {
        log(`❌ Account ${accountId} not found`, 'error');
        return;
    }

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

// Refresh copiers list
function refreshClients() {
    derivWS.send({ copytrading_list: 1 });
}

// Logout and clean up
function logout() {
    // Disable all copiers before logout
    currentAccounts.forEach(acc => {
        if (acc.allowCopiers) {
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
    if (account) {
        account.balance = response.authorize.balance;
        account.allowCopiers = response.authorize.scopes.includes('admin');
        setupAccountsDropdown();
        log(`🔓 Authorized: ${account.id} - Balance: ${account.balance} ${account.currency}`, 'success');
    }
}

function handleSettingsResponse(response) {
    const account = currentAccounts.find(acc => acc.id === response.echo_req.loginid);
    if (account) {
        account.allowCopiers = response.echo_req.allow_copiers === 1;
        log(`⚙️ Settings updated for ${account.id}: Copiers ${account.allowCopiers ? 'allowed' : 'disallowed'}`, 
            account.allowCopiers ? 'success' : 'error');
    }
}

function handleCopierList(response) {
    const clientList = document.getElementById('clientList');
    if (response.copytrading_list?.copiers) {
        clientList.innerHTML = response.copytrading_list.copiers.map(copier => `
            <div class="client-item">
                <div>${copier.name || 'Anonymous'} (${copier.loginid})</div>
                <div>${copier.balance} ${copier.currency}</div>
            </div>
        `).join('');
    } else {
        log('⚠️ No copiers found', 'warning');
    }
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
