document.addEventListener("DOMContentLoaded", () => {
  const app_id = 66842; // Replace with your actual app_id
  const redirect_url = "YOUR_REDIRECT_URL"; // Replace with your app's redirect URL
  let websocket = null;
  const clientTokens = JSON.parse(localStorage.getItem("clientTokens")) || [];
  let masterToken = localStorage.getItem("masterToken") || null;

  const masterTokenInput = document.getElementById("masterToken");
  const clientTokenInput = document.getElementById("clientToken");
  const logs = document.getElementById("logs");
  const trades = document.getElementById("trades");
  const addClientButton = document.getElementById("addClient");
  const startCopying = document.getElementById("startCopying");
  const stopCopying = document.getElementById("stopCopying");
  const masterOAuthLogin = document.getElementById("masterOAuthLogin");
  const masterList = document.getElementById("masterList");
  const clientList = document.getElementById("clientList");

  /** Utility Functions */
  function logMessage(message, type = "info") {
    const p = document.createElement("p");
    p.textContent = `${new Date().toLocaleTimeString()} - ${message}`;

    if (type === "success") p.style.color = "green";
    else if (type === "error") p.style.color = "red";
    else p.style.color = "blue";

    logs.appendChild(p);
    logs.scrollTop = logs.scrollHeight;
    console.log(`${type.toUpperCase()}: ${message}`);
  }

  function saveMasterToken(token) {
    localStorage.setItem("masterToken", token);
  }

  function saveClientTokens() {
    localStorage.setItem("clientTokens", JSON.stringify(clientTokens));
  }

  function renderMasterToken() {
    masterList.innerHTML = "";

    if (masterToken) {
      const li = document.createElement("li");
      li.innerHTML = `
        <span>${masterToken}</span>
        <button class="btn-delete">Delete</button>
      `;
      masterList.appendChild(li);

      li.querySelector(".btn-delete").addEventListener("click", () => {
        masterToken = null;
        saveMasterToken(null);
        renderMasterToken();
        logMessage("Master token removed.", "info");
      });
    }
  }

  function renderClientTokens() {
    clientList.innerHTML = "";

    clientTokens.forEach((token, index) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <span>${token}</span>
        <button class="btn-delete" data-index="${index}">Delete</button>
      `;
      clientList.appendChild(li);

      li.querySelector(".btn-delete").addEventListener("click", () => {
        clientTokens.splice(index, 1);
        saveClientTokens();
        renderClientTokens();
        logMessage("Client token removed.", "info");
      });
    });
  }

  /** OAuth Login for Master */
  masterOAuthLogin.addEventListener("click", () => {
    const oauthUrl = `https://oauth.deriv.com/oauth2/authorize?app_id=${app_id}&redirect_uri=${encodeURIComponent(redirect_url)}`;
    window.location.href = oauthUrl;
  });

  // Handle OAuth Redirection
  function handleOAuthRedirect() {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get("token1"); // Extract the first token from the URL (assuming it's for the master account)

    if (token) {
      masterToken = token;
      saveMasterToken(token);
      renderMasterToken();
      logMessage("Master logged in successfully via OAuth.", "success");
    }
  }

  /** Start Copying Trades */
  function startCopyTrading() {
    if (!masterToken) {
      logMessage("No master token provided.", "error");
      return;
    }

    if (clientTokens.length === 0) {
      logMessage("No client tokens provided.", "error");
      return;
    }

    websocket = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`);

    websocket.onopen = () => {
      logMessage("WebSocket connection established for trade copying.", "info");
      websocket.send(JSON.stringify({ authorize: masterToken }));
    };

    websocket.onmessage = (event) => {
      const response = JSON.parse(event.data);
      logMessage(`Received: ${JSON.stringify(response)}`, "info");

      if (response.authorize) {
        logMessage(
          `Master Authenticated: ${response.authorize.loginid}, Balance: ${response.authorize.balance} ${response.authorize.currency}`,
          "success"
        );

        // Copy trades for each client
        clientTokens.forEach((clientToken) => {
          websocket.send(
            JSON.stringify({
              authorize: clientToken,
            })
          );
        });

        // Start copying
        websocket.send(
          JSON.stringify({
            copy_start: masterToken,
          })
        );
      }

      if (response.error) {
        logMessage(`Error: ${response.error.message}`, "error");
      }
    };

    websocket.onerror = (error) => {
      logMessage(`WebSocket Error: ${error.message}`, "error");
    };

    websocket.onclose = () => {
      logMessage("WebSocket connection closed.", "info");
    };
  }

  /** Stop Copying Trades */
  function stopCopyTrading() {
    if (!masterToken) {
      logMessage("No master token provided.", "error");
      return;
    }

    websocket.send(
      JSON.stringify({
        copy_stop: 1,
      })
    );
    logMessage("Stopped copying trades.", "success");
    websocket.close();
    websocket = null;
  }

  /** Event Listeners */
  startCopying.addEventListener("click", startCopyTrading);
  stopCopying.addEventListener("click", stopCopyTrading);

  addClientButton.addEventListener("click", () => {
    const token = clientTokenInput.value.trim();
    if (token && !clientTokens.includes(token)) {
      clientTokens.push(token);
      saveClientTokens();
      renderClientTokens();
      logMessage(`Client token added: ${token}`, "success");
      clientTokenInput.value = "";
    } else {
      logMessage("Invalid or duplicate client token.", "error");
    }
  });

  // Render Tokens on Load
  renderMasterToken();
  renderClientTokens();
  handleOAuthRedirect(); // Handle OAuth redirection on page load
});
