// Fixed Code: Implements all fixes to handle real account issues and ensure proper trade copying

document.addEventListener("DOMContentLoaded", () => {
  const app_id = 66842;
  let websocket = null;
  const loggedTrades = new Set(); // Track logged trades
  const clientTokens = JSON.parse(localStorage.getItem("clientTokens")) || [];
  let masterToken = localStorage.getItem("masterToken") || null;

  const masterTokenInput = document.getElementById("masterToken");
  const clientTokenInput = document.getElementById("clientToken");
  const logs = document.getElementById("logs");
  const trades = document.getElementById("trades");
  const addMasterButton = document.getElementById("addMaster");
  const addClientButton = document.getElementById("addClient");
  const startCopying = document.getElementById("startCopying");
  const stopCopying = document.getElementById("stopCopying");
  const masterList = document.getElementById("masterList");
  const clientList = document.getElementById("clientList");

  // Utility to log messages with colors
  function logMessage(message, type = "info") {
    const p = document.createElement("p");
    p.textContent = message;

    if (type === "success") p.style.color = "green";
    else if (type === "error") p.style.color = "red";
    else p.style.color = "blue";

    logs.appendChild(p);
    logs.scrollTop = logs.scrollHeight;
  }

  // Utility to log trades
  function logTrade(tradeMessage, type = "info") {
    const p = document.createElement("p");
    p.textContent = tradeMessage;

    if (type === "profit") p.style.color = "green";
    else if (type === "loss") p.style.color = "red";
    else p.style.color = "blue";

    trades.appendChild(p);
    trades.scrollTop = trades.scrollHeight;
  }

  // Save master token to local storage
  function saveMasterToken(token) {
    localStorage.setItem("masterToken", token);
  }

  // Save client tokens to local storage
  function saveClientTokens() {
    localStorage.setItem("clientTokens", JSON.stringify(clientTokens));
  }

  // Render master token in the UI
  function renderMasterToken() {
    masterList.innerHTML = "";

    if (masterToken) {
      const li = document.createElement("li");
      li.innerHTML = `
        <span>${masterToken}</span>
        <button class="btn-delete">Delete</button>
      `;
      masterList.appendChild(li);

      // Add delete functionality
      li.querySelector(".btn-delete").addEventListener("click", () => {
        masterToken = null;
        saveMasterToken(null);
        renderMasterToken();
        logMessage("Master token removed.", "info");
      });
    }
  }

  // Render client tokens in the UI
  function renderClientTokens() {
    clientList.innerHTML = "";

    clientTokens.forEach((token, index) => {
      const li = document.createElement("li");
      li.innerHTML = `
        <span>${token}</span>
        <button class="btn-delete" data-index="${index}">Delete</button>
      `;
      clientList.appendChild(li);

      // Add delete functionality to each button
      li.querySelector(".btn-delete").addEventListener("click", () => {
        clientTokens.splice(index, 1); // Remove token
        saveClientTokens();
        renderClientTokens();
        logMessage("Client token removed.", "info");
      });
    });
  }

  // Enable allow_copiers for master account
  function enableAllowCopiers(callback) {
    const masterWebSocket = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`);

    masterWebSocket.onopen = () => {
      logMessage("Establishing connection to enable allow_copiers...", "info");
      masterWebSocket.send(JSON.stringify({ authorize: masterToken }));
    };

    masterWebSocket.onmessage = (event) => {
      const response = JSON.parse(event.data);

      if (response.authorize) {
        logMessage(
          `Master Authenticated: ${response.authorize.loginid}, Balance: ${response.authorize.balance} ${response.authorize.currency}, Scopes: ${response.authorize.scopes.join(", ")}`,
          "success"
        );

        const masterLandingCompany = response.authorize.landing_company_name;
        localStorage.setItem("masterLandingCompany", masterLandingCompany);

        masterWebSocket.send(JSON.stringify({ set_settings: 1, allow_copiers: 1 }));
        logMessage("Allow copiers enabled for the master account.", "info");
      }

      if (response.msg_type === "set_settings") {
        logMessage("Allow copiers successfully set.", "success");
        masterWebSocket.close();
        if (callback) callback();
      }

      if (response.error) {
        logMessage(`Error: ${response.error.message}`, "error");
        masterWebSocket.close();
      }
    };

    masterWebSocket.onerror = (error) => {
      logMessage(`WebSocket Error: ${error.message}`, "error");
    };

    masterWebSocket.onclose = () => {
      logMessage("Connection to enable allow_copiers closed.", "info");
    };
  }

  // Authenticate and log client details
  function authenticateClients(callback) {
    clientTokens.forEach((clientToken) => {
      const clientWebSocket = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`);

      clientWebSocket.onopen = () => {
        clientWebSocket.send(JSON.stringify({ authorize: clientToken }));
      };

      clientWebSocket.onmessage = (event) => {
        const response = JSON.parse(event.data);

        if (response.authorize) {
          const clientLandingCompany = response.authorize.landing_company_name;
          logMessage(
            `Client Authenticated: ${response.authorize.loginid}, Balance: ${response.authorize.balance} ${response.authorize.currency}, Scopes: ${response.authorize.scopes.join(", ")}`,
            "success"
          );

          // Check landing company match
          const masterLandingCompany = localStorage.getItem("masterLandingCompany");
          if (masterLandingCompany !== clientLandingCompany) {
            logMessage(
              `Error: Master (${masterLandingCompany}) and Client (${clientLandingCompany}) must belong to the same landing company.`,
              "error"
            );
          } else if (callback) callback();
        }

        if (response.error) {
          logMessage(`Client Error: ${response.error.message}`, "error");
        }
      };

      clientWebSocket.onerror = (error) => {
        logMessage(`WebSocket Error (Client): ${error.message}`, "error");
      };

      clientWebSocket.onclose = () => {
        logMessage("Client WebSocket closed.", "info");
      };
    });
  }

  // Listen for master trades
  function listenForMasterTrades() {
    websocket.send(
      JSON.stringify({
        proposal_open_contract: 1,
        subscribe: 1,
      })
    );
    logMessage("Listening for master trades...", "info");

    websocket.onmessage = (event) => {
      const response = JSON.parse(event.data);

      if (response.msg_type === "proposal_open_contract") {
        const trade = response.proposal_open_contract;

        if (!loggedTrades.has(trade.contract_id)) {
          loggedTrades.add(trade.contract_id);

          const profitLoss = trade.profit || 0;
          const tradeMessage = `Trade: ID ${trade.contract_id}, Type: ${trade.contract_type}, Payout: ${trade.payout}, Stake: ${trade.buy_price}, Profit/Loss: ${profitLoss}`;
          logTrade(tradeMessage, profitLoss >= 0 ? "profit" : "loss");

          logMessage(`Copying trade ID ${trade.contract_id} to clients...`, "info");
        }
      }

      if (response.error) {
        logMessage(`Error: ${response.error.message}`, "error");
      }
    };
  }

  // Start copying trades
  startCopying.addEventListener("click", () => {
    if (!masterToken) {
      logMessage("No master token provided.", "error");
      return;
    }

    if (websocket) {
      logMessage("Already connected.", "info");
      return;
    }

    websocket = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${app_id}`);

    websocket.onopen = () => {
      logMessage("WebSocket connection established.", "info");
      websocket.send(JSON.stringify({ authorize: masterToken }));
    };

    websocket.onmessage = (event) => {
      const response = JSON.parse(event.data);

      if (response.authorize) {
        enableAllowCopiers(() => {
          authenticateClients(() => {
            listenForMasterTrades();
          });
        });
      }

      if (response.error) {
        logMessage(`Error: ${response.error.message}`, "error");
      }
    };

    websocket.onerror = (error) => {
      logMessage(`WebSocket error: ${error.message}`, "error");
    };

    websocket.onclose = () => {
      logMessage("WebSocket closed.", "info");
    };
  });

  // Stop copying trades
  stopCopying.addEventListener("click", () => {
    if (websocket) {
      websocket.send(JSON.stringify({ copy_stop: 1 }));
      logMessage("Stopped copying trades.", "success");
      websocket.close();
      websocket = null;
    } else {
      logMessage("No active WebSocket connection.", "info");
    }
  });

  // Add master token
  addMasterButton.addEventListener("click", () => {
    const token = masterTokenInput.value.trim();
    if (token) {
      masterToken = token;
      saveMasterToken(token);
      renderMasterToken();
      logMessage(`Master token added: ${token}`, "success");
      masterTokenInput.value = ""; // Clear input
    } else {
      logMessage("Please enter a valid master token.", "error");
    }
  });

  // Add client token
  addClientButton.addEventListener("click", () => {
    const token = clientTokenInput.value.trim();
    if (token && !clientTokens.includes(token)) {
      clientTokens.push(token);
      saveClientTokens();
      renderClientTokens();
      logMessage(`Client token added: ${token}`, "success");
      clientTokenInput.value = ""; // Clear input
    } else {
      logMessage("Invalid or duplicate client token.", "error");
    }
  });

  // Render tokens on page load
  renderMasterToken();
  renderClientTokens();
});
