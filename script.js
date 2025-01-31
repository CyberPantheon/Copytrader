const ws = new WebSocket('wss://api.deriv.com/websockets/v3');
const logContainer = document.getElementById('logContainer');
const dropdownContent = document.getElementById('dropdownContent');
const clientList = document.getElementById('clientList');
let userAccounts = [];
let selectedAccount = null;

// Logging function
function log(message, type = 'info') {
    const logEntry = document.createElement('div');
    logEntry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
    logEntry.className = `log-${type}`;
    logContainer.appendChild(logEntry);
    logContainer.scrollTop = logContainer.scrollHeight;
}

// Handle WebSocket messages
ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.error) {
        log(`❌ Error: ${data.error.message}`, 'error');
    } else if (data.authorize) {
        log(`✅ Authorized successfully!`, 'success');
        userAccounts = data.authorize.account_list;
        renderAccountsDropdown();
    } else if (data.set_settings) {
        log(`⚙️ Settings updated for account: ${selectedAccount.loginid}`, 'success');
    } else if (data.copytrading_list) {
        renderCopiers(data.copytrading_list.copiers);
    }
};

// Render accounts dropdown
function renderAccountsDropdown() {
    dropdownContent.innerHTML = userAccounts
        .map(
            (account) => `
            <div class="account-item">
                <span>${account.loginid} (${account.currency})</span>
                <button onclick="toggleAllowCopy('${account.loginid}')" class="${account.allow_copiers ? 'disable-btn' : 'enable-btn'}">
                    ${account.allow_copiers ? 'Disallow' : 'Allow Copy'}
                </button>
            </div>
        `
        )
        .join('');
    dropdownContent.style.display = 'block';
}

// Toggle allow_copiers
function toggleAllowCopy(loginid) {
    selectedAccount = userAccounts.find((acc) => acc.loginid === loginid);
    const allowCopiers = !selectedAccount.allow_copiers;
    ws.send(
        JSON.stringify({
            set_settings: 1,
            loginid: selectedAccount.loginid,
            allow_copiers: allowCopiers ? 1 : 0,
        })
    );
    log(`🔄 Toggled allow_copiers for account: ${loginid}`, 'info');
}

// Show copiers
function showCopiers() {
    ws.send(JSON.stringify({ copytrading_list: 1 }));
    log(`🔍 Fetching active copiers...`, 'info');
}

// Render copiers list
function renderCopiers(copiers) {
    clientList.innerHTML = copiers
        .map(
            (copier) => `
            <div class="client-item">
                <span>${copier.name} (${copier.loginid})</span>
                <span>Balance: ${copier.balance}</span>
            </div>
        `
        )
        .join('');
}

// Logout
function logout() {
    ws.send(JSON.stringify({ logout: 1 }));
    log(`👋 Logged out successfully!`, 'success');
    setTimeout(() => {
        window.location.href = 'index.html';
    }, 1000);
}

// Toggle dropdown
function toggleDropdown() {
    dropdownContent.style.display = dropdownContent.style.display === 'block' ? 'none' : 'block';
}

// Initialize WebSocket connection
ws.onopen = () => {
    log('🌐 WebSocket connection established!', 'success');
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    if (token) {
        ws.send(JSON.stringify({ authorize: token }));
    } else {
        log('❌ No OAuth token found in URL.', 'error');
    }
};
