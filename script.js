const APP_ID = 68004;
let currentAccounts = [];
let activeCopies = new Map();
let masterAccount = null;
let ws;
let isConnected = false;

const derivWS = {
    conn: null,
    reqId: 1,
    currentToken: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 5,

    connect: function(token) {
        this.currentToken = token;
        if(this.conn) this.conn.close();

        this.conn = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${APP_ID}`);

        this.conn.onopen = () => {
            log('🔌 WebSocket connected', 'success');
            this.reconnectAttempts = 0;
            isConnected = true;
            this.sendPing();
            this.authorize(token);
        };

        this.conn.onmessage = (e) => {
            try {
                const response = JSON.parse(e.data);
                this.handleMessage(response);
            } catch (error) {
                log(`❌ Message parse error: ${error.message}`, 'error');
            }
        };

        this.conn.onerror = (e) => {
            log(`⚠️ WebSocket error: ${e.message || 'Unknown error'}`, 'error');
        };

        this.conn.onclose = (e) => {
            isConnected = false;
            if(!e.wasClean && this.reconnectAttempts < this.maxReconnectAttempts) {
                setTimeout(() => {
                    this.reconnectAttempts++;
                    this.connect(token);
                }, Math.min(5000, this.reconnectAttempts * 2000));
            }
        };
    },

    sendPing: function() {
        if(isConnected) {
            this.send({ ping: 1 });
            setTimeout(() => this.sendPing(), 30000);
        }
    },

    authorize: function(token) {
        this.currentToken = token;
        this.send({ authorize: token });
    },

    send: function(data) {
        if(this.conn?.readyState === WebSocket.OPEN) {
            data.req_id = this.reqId++;
            this.conn.send(JSON.stringify(data));
            log(`📤 Sent: ${JSON.stringify(data, null, 2)}`, 'info');
            return true;
        }
        log('⚠️ WebSocket not ready', 'warning');
        return false;
    },

    handleMessage: function(response) {
        if(response.pong) {
            log('🏓 Received pong', 'info');
            return;
        }

        log(`📥 Received: ${JSON.stringify(response, null, 2)}`, 'info');

        if(response.error) {
            this.handleError(response.error);
            return;
        }

        if(response.authorize) {
            handleAuthorization(response);
        } else if(response.account_list) {
            handleAccountList(response);
        } else if(response.set_settings) {
            handleSettingsResponse(response);
        }
    },

    handleError: function(error) {
        const errorMessages = {
            1006: 'Connection failed - check network',
            'InvalidAppID': 'Invalid application ID',
            'RateLimit': 'Too many requests - wait 60s',
            'InvalidToken': 'Session expired - relogin'
        };
        log(`❌ Error: ${errorMessages[error.code] || error.message}`, 'error`);
        
        if(error.code === 'InvalidToken') {
            localStorage.removeItem('masterAccounts');
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    const savedAccounts = JSON.parse(localStorage.getItem('masterAccounts'));
    const params = new URLSearchParams(window.location.search);
    
    currentAccounts = savedAccounts || parseTokensFromURL(params);
    if(currentAccounts.length === 0) return;

    localStorage.setItem('masterAccounts', JSON.stringify(currentAccounts));
    setupAccountsDropdown();
    derivWS.connect(currentAccounts[0].token);
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

function handleAccountList(response) {
    const serverAccounts = response.account_list.reduce((acc, curr) => {
        acc[curr.loginid] = curr;
        return acc;
    }, {});

    currentAccounts = currentAccounts.map(acc => ({
        ...acc,
        currency: serverAccounts[acc.id]?.currency || acc.currency,
        allowCopiers: serverAccounts[acc.id]?.allow_copiers === 1
    }));

    localStorage.setItem('masterAccounts', JSON.stringify(currentAccounts));
    setupAccountsDropdown();
}

function setupAccountsDropdown() {
    const dropdown = document.getElementById('dropdownContent');
    dropdown.innerHTML = currentAccounts.map(acc => `
        <div class="account-item">
            <div>
                <strong>${acc.id}</strong>
                <small>${acc.currency.toUpperCase()} • ${acc.balance}</small>
            </div>
            <button class="${acc.allowCopiers ? 'disable-btn' : 'enable-btn'}" 
                    onclick="toggleCopyPermissions('${acc.id}', this)"
                    ${acc.id === currentAccounts[0].id ? 'disabled' : ''}>
                ${acc.allowCopiers ? '🚫 Disallow' : '✅ Allow Copy'}
            </button>
        </div>
    `).join('');
}

async function toggleCopyPermissions(accountId, button) {
    const account = currentAccounts.find(acc => acc.id === accountId);
    if(!account) return;

    const newState = !account.allowCopiers;
    button.disabled = true;
    button.textContent = '⌛ Updating...';

    try {
        if(derivWS.currentToken !== account.token) {
            await new Promise((resolve) => {
                const authHandler = (e) => {
                    const res = JSON.parse(e.data);
                    if(res.authorize?.loginid === accountId) {
                        derivWS.conn.removeEventListener('message', authHandler);
                        resolve();
                    }
                };
                derivWS.conn.addEventListener('message', authHandler);
                derivWS.authorize(account.token);
            });
        }

        derivWS.send({
            set_settings: 1,
            allow_copiers: newState ? 1 : 0,
            loginid: accountId
        });

        // Update local state immediately
        account.allowCopiers = newState;
        localStorage.setItem('masterAccounts', JSON.stringify(currentAccounts));
        
        button.className = newState ? 'disable-btn' : 'enable-btn';
        button.textContent = newState ? '🚫 Disallow' : '✅ Allow Copy';

    } catch(error) {
        log(`❌ Update failed: ${error.message}`, 'error');
        button.className = account.allowCopiers ? 'disable-btn' : 'enable-btn';
        button.textContent = account.allowCopiers ? '🚫 Disallow' : '✅ Allow Copy';
    } finally {
        button.disabled = false;
        derivWS.authorize(currentAccounts[0].token); // Switch back to main account
    }
}

function handleSettingsResponse(response) {
    const accountId = response.echo_req.loginid;
    const account = currentAccounts.find(acc => acc.id === accountId);
    if(account) {
        account.allowCopiers = response.echo_req.allow_copiers === 1;
        localStorage.setItem('masterAccounts', JSON.stringify(currentAccounts));
        log(`⚙️ Copiers ${account.allowCopiers ? 'allowed' : 'disabled'} for ${accountId}`, 
            account.allowCopiers ? 'success' : 'error');
    }
}

function handleAuthorization(response) {
    const account = currentAccounts.find(acc => acc.token === response.echo_req.authorize);
    if(account) {
        account.balance = response.authorize.balance;
        account.allowCopiers = response.authorize.scopes.includes('admin');
        localStorage.setItem('masterAccounts', JSON.stringify(currentAccounts));
        setupAccountsDropdown();
    }
}

function logout() {
    currentAccounts.forEach(acc => {
        if(acc.allowCopiers) {
            derivWS.send({
                set_settings: 1,
                allow_copiers: 0,
                loginid: acc.id
            });
        }
    });
    localStorage.removeItem('masterAccounts');
    setTimeout(() => window.location.href = 'index.html', 1000);
}

function log(message, type = 'info') {
    const logContainer = document.getElementById('logContainer');
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.innerHTML = `
        [${new Date().toLocaleTimeString()}] 
        ${type === 'error' ? '❌' : type === 'success' ? '✅' : 'ℹ️'} 
        ${message}
    `;
    
    if(logContainer.children.length > 50) logContainer.firstChild.remove();
    logContainer.appendChild(entry);
    logContainer.scrollTop = logContainer.scrollHeight;
}
