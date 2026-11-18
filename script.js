/* Cloudflare Worker endpoint (holds the OpenAI API key securely on the server) */
const WORKER_URL = "https://solitary-moon-d2a1.ljaureg4.workers.dev/";

/* Keys used to save and restore selected products and chat history in localStorage */
const STORAGE_KEY = "lorealSelectedProducts";
const CHAT_HISTORY_KEY = "lorealConversationHistory";
const CHAT_UI_KEY = "lorealChatMessages";

/* ISO 639-1 language codes that are written right-to-left (RTL) */
const RTL_LANGUAGES = new Set([
  "ar",
  "arc",
  "dv",
  "fa",
  "ha",
  "he",
  "iw",
  "khw",
  "ks",
  "ku",
  "ps",
  "sd",
  "ug",
  "ur",
  "yi",
]);

/* System instructions that keep the advisor focused on the routine and beauty topics */
const SYSTEM_PROMPT = `You are a helpful, knowledgeable L'Oréal skincare, haircare, makeup, fragrance, and personal care advisor.
When given a list of selected products in JSON format, create a clear, easy-to-follow personalized routine explaining the best order of application, when to use each product (morning, evening, or both), and helpful tips based on each product's details.
For follow-up questions, only answer questions related to the generated routine, the selected products, or beauty and personal care topics such as skincare, haircare, hair color, hair styling, men's grooming, suncare, makeup, and fragrance.
If a user asks about anything unrelated to these topics, politely let them know you can only help with their routine and beauty or personal care questions, and invite them to ask a related question.`;

/* Get references to DOM elements */
const categoryFilter = document.getElementById("categoryFilter");
const productSearch = document.getElementById("productSearch");
const productsContainer = document.getElementById("productsContainer");
const selectedProductsList = document.getElementById("selectedProductsList");
const clearSelectedBtn = document.getElementById("clearSelected");
const generateRoutineBtn = document.getElementById("generateRoutine");
const clearChatBtn = document.getElementById("clearChat");
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const sendBtn = document.getElementById("sendBtn");
const chatWindow = document.getElementById("chatWindow");

/* Store all loaded products, saved selected products, and full chat history */
let allProducts = [];
let selectedProducts = loadSelectedProducts();
let conversationHistory = loadFromStorage(CHAT_HISTORY_KEY);
let chatUiMessages = loadFromStorage(CHAT_UI_KEY);

/* Sync page direction with language, then render initial UI */
initializeLanguageDirection();
showInitialProductsPlaceholder();
renderSelectedProducts();
restoreChatWindow();

/* Check whether a language tag (e.g. "ar", "ar-SA", "he") is an RTL language */
function isRtlLanguage(lang) {
  if (!lang) {
    return false;
  }
  const baseLang = lang.trim().toLowerCase().split(/[-_]/)[0];
  return RTL_LANGUAGES.has(baseLang);
}

/* Update the document dir attribute whenever the site language changes */
function syncDirectionWithLanguage(changedTarget) {
  const targetLang = changedTarget?.getAttribute?.("lang");
  const activeLang =
    targetLang ||
    document.body?.getAttribute("lang") ||
    document.documentElement.getAttribute("lang") ||
    "";

  if (isRtlLanguage(activeLang)) {
    document.documentElement.setAttribute("dir", "rtl");
  } else if (activeLang) {
    document.documentElement.setAttribute("dir", "ltr");
  }
}

/* Watch for site language changes (e.g., browser translation or lang attribute updates) */
function initializeLanguageDirection() {
  syncDirectionWithLanguage();

  const observer = new MutationObserver((mutations) => {
    const langMutation = mutations.find(
      (mutation) => mutation.attributeName === "lang"
    );
    if (langMutation) {
      syncDirectionWithLanguage(langMutation.target);
    }
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["lang"],
  });
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["lang"],
  });
}

/* Show initial placeholder until user chooses a category or types a search query */
function showInitialProductsPlaceholder() {
  productsContainer.innerHTML = `
    <div class="placeholder-message">
      Select a category or search by name or keyword to view products
    </div>
  `;
}

/* Generic helper to safely load an array from localStorage */
function loadFromStorage(key) {
  try {
    const saved = localStorage.getItem(key);
    if (!saved) {
      return [];
    }
    const parsed = JSON.parse(saved);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn(`Could not read ${key} from localStorage:`, error);
    return [];
  }
}

/* Load saved selected products from localStorage */
function loadSelectedProducts() {
  return loadFromStorage(STORAGE_KEY);
}

/* Save current selected products to localStorage */
function saveSelectedProducts() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(selectedProducts));
  } catch (error) {
    console.warn("Could not save selected products to localStorage:", error);
  }
}

/* Save both AI conversation history and visible chat messages to localStorage */
function saveChatHistory() {
  try {
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(conversationHistory));
    localStorage.setItem(CHAT_UI_KEY, JSON.stringify(chatUiMessages));
  } catch (error) {
    console.warn("Could not save chat history to localStorage:", error);
  }
}

/* Show initial welcome message in the chat window */
function showChatPlaceholder() {
  clearChatBtn.disabled = true;
  chatWindow.innerHTML = `
    <p class="chat-placeholder">
      Select products above and click "Generate Routine" to build your personalized routine, or ask a question about skincare, haircare, makeup, or fragrance.
    </p>
  `;
}

/* Restore saved chat messages into the chat window on page load */
function restoreChatWindow() {
  if (chatUiMessages.length === 0) {
    showChatPlaceholder();
    return;
  }

  chatWindow.innerHTML = "";
  chatUiMessages.forEach((msg) => {
    appendChatMessage(msg.role, msg.content, "", false);
  });
  clearChatBtn.disabled = false;
}

/* Load product data from JSON file (and cache it for quick reuse) */
async function loadProducts() {
  if (allProducts.length > 0) {
    return allProducts;
  }

  const response = await fetch("products.json");
  const data = await response.json();
  allProducts = data.products;
  return allProducts;
}

/* Check whether a product is currently selected by its ID */
function isProductSelected(productId) {
  return selectedProducts.some((product) => product.id === productId);
}

/* Toggle a product in or out of the selectedProducts array */
function toggleProductSelection(productId) {
  if (isProductSelected(productId)) {
    // Remove the product if it is already selected
    selectedProducts = selectedProducts.filter(
      (product) => product.id !== productId
    );
  } else {
    // Find the full product object and add it to selectedProducts
    const productToAdd = allProducts.find(
      (product) => product.id === productId
    );
    if (productToAdd) {
      selectedProducts.push(productToAdd);
    }
  }

  // Save updated selection, sync grid border, and re-render Selected Products
  saveSelectedProducts();
  updateCardSelectionUI(productId);
  renderSelectedProducts();
}

/* Add or remove the "selected" border class on a product card in the grid */
function updateCardSelectionUI(productId) {
  const card = productsContainer.querySelector(
    `.product-card[data-product-id="${productId}"]`
  );
  if (!card) {
    return;
  }

  const selected = isProductSelected(productId);
  card.classList.toggle("selected", selected);
  card.setAttribute("aria-pressed", String(selected));
}

/* Render the Selected Products section with remove buttons and Clear All state */
function renderSelectedProducts() {
  clearSelectedBtn.disabled = selectedProducts.length === 0;

  if (selectedProducts.length === 0) {
    selectedProductsList.innerHTML = `
      <p class="empty-selected">
        No products selected yet. Click a product card above to add it to your routine.
      </p>
    `;
    return;
  }

  selectedProductsList.innerHTML = selectedProducts
    .map(
      (product) => `
      <div class="selected-product-item">
        <img src="${product.image}" alt="${product.name}" />
        <div class="selected-product-text">
          <span class="selected-product-name">${product.name}</span>
          <span class="selected-product-brand">${product.brand}</span>
        </div>
        <button
          type="button"
          class="remove-product-btn"
          data-product-id="${product.id}"
          aria-label="Remove ${product.name}"
          title="Remove ${product.name}"
        >
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    `
    )
    .join("");
}

/* Create HTML for displaying product cards in the grid */
function displayProducts(products) {
  if (products.length === 0) {
    productsContainer.innerHTML = `
      <div class="placeholder-message">
        No products found in this category.
      </div>
    `;
    return;
  }

  productsContainer.innerHTML = products
    .map((product) => {
      const selected = isProductSelected(product.id);
      const descriptionId = `product-desc-${product.id}`;
      return `
        <div
          class="product-card ${selected ? "selected" : ""}"
          data-product-id="${product.id}"
          role="button"
          tabindex="0"
          aria-pressed="${selected}"
          aria-describedby="${descriptionId}"
        >
          <div class="product-main">
            <img src="${product.image}" alt="${product.name}">
            <div class="product-info">
              <h3>${product.name}</h3>
              <p>${product.brand}</p>
            </div>
          </div>
          <div id="${descriptionId}" class="product-description">
            <p>${product.description}</p>
          </div>
        </div>
      `;
    })
    .join("");
}

/* Escape HTML special characters so user and AI text render safely */
function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* Format plain text / lightweight Markdown into readable HTML */
function formatMessageText(text) {
  const safeText = escapeHtml(text);
  return safeText
    .replace(/^###\s+(.+)$/gm, "<h4>$1</h4>")
    .replace(/^##\s+(.+)$/gm, "<h4>$1</h4>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\n/g, "<br>");
}

/* Add a message bubble to the chat window and optionally save it to localStorage */
function appendChatMessage(role, content, extraClass = "", shouldSave = true) {
  const placeholder = chatWindow.querySelector(".chat-placeholder");
  if (placeholder) {
    placeholder.remove();
  }

  const messageEl = document.createElement("div");
  messageEl.className = `chat-message ${role} ${extraClass}`.trim();

  if (role === "assistant") {
    messageEl.innerHTML = formatMessageText(content);
  } else {
    messageEl.textContent = content;
  }

  chatWindow.appendChild(messageEl);
  chatWindow.scrollTop = chatWindow.scrollHeight;

  // Save real conversation messages (skip temporary loading or error notices)
  if (shouldSave && !extraClass) {
    chatUiMessages.push({ role, content });
    clearChatBtn.disabled = false;
    saveChatHistory();
  }

  return messageEl;
}

/* Send the full conversation messages array to the Cloudflare Worker */
async function fetchAdvisorReply(messages) {
  const response = await fetch(WORKER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messages }),
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  const data = await response.json();
  const reply = data?.choices?.[0]?.message?.content;

  if (!reply) {
    throw new Error("No response content received from the advisor.");
  }

  return reply;
}

/* Enable or disable request controls while waiting for an API response */
function setLoadingState(isLoading) {
  generateRoutineBtn.disabled = isLoading;
  sendBtn.disabled = isLoading;
  userInput.disabled = isLoading;
}

/* Handle clicking a product card in the grid to select or unselect it */
productsContainer.addEventListener("click", (e) => {
  const card = e.target.closest(".product-card");
  if (!card) {
    return;
  }

  const productId = Number(card.dataset.productId);
  toggleProductSelection(productId);
});

/* Also support keyboard Enter / Space on focused product cards */
productsContainer.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") {
    return;
  }

  const card = e.target.closest(".product-card");
  if (!card) {
    return;
  }

  e.preventDefault();
  const productId = Number(card.dataset.productId);
  toggleProductSelection(productId);
});

/* Handle clicking the remove button directly inside Selected Products */
selectedProductsList.addEventListener("click", (e) => {
  const removeBtn = e.target.closest(".remove-product-btn");
  if (!removeBtn) {
    return;
  }

  const productId = Number(removeBtn.dataset.productId);
  selectedProducts = selectedProducts.filter(
    (product) => product.id !== productId
  );

  // Save updated list, sync the grid card border, and update Selected Products
  saveSelectedProducts();
  updateCardSelectionUI(productId);
  renderSelectedProducts();
});

/* Handle clearing all saved selected products at once */
clearSelectedBtn.addEventListener("click", () => {
  selectedProducts = [];
  saveSelectedProducts();

  // Remove the selected border from any visible product cards in the grid
  const selectedCards = productsContainer.querySelectorAll(
    ".product-card.selected"
  );
  selectedCards.forEach((card) => {
    card.classList.remove("selected");
    card.setAttribute("aria-pressed", "false");
  });

  renderSelectedProducts();
});

/* Filter and display products using both the category filter and search field */
async function filterAndDisplayProducts() {
  const selectedCategory = categoryFilter.value;
  const searchTerm = productSearch.value.trim().toLowerCase();

  // If neither a category nor a search term is active, show the initial prompt
  if (!selectedCategory && !searchTerm) {
    showInitialProductsPlaceholder();
    return;
  }

  const products = await loadProducts();

  /* Match selected category (or all categories when none/"all" is chosen)
     and match search keyword against name, brand, category, or description */
  const filteredProducts = products.filter((product) => {
    const matchesCategory =
      !selectedCategory ||
      selectedCategory === "all" ||
      product.category === selectedCategory;

    const matchesSearch =
      !searchTerm ||
      product.name.toLowerCase().includes(searchTerm) ||
      product.brand.toLowerCase().includes(searchTerm) ||
      product.category.toLowerCase().includes(searchTerm) ||
      product.description.toLowerCase().includes(searchTerm);

    return matchesCategory && matchesSearch;
  });

  displayProducts(filteredProducts);
}

/* Re-filter products whenever category changes or the user types in search */
categoryFilter.addEventListener("change", filterAndDisplayProducts);
productSearch.addEventListener("input", filterAndDisplayProducts);

/* Clear all saved chat history and reset the chat window */
clearChatBtn.addEventListener("click", () => {
  conversationHistory = [];
  chatUiMessages = [];
  saveChatHistory();
  showChatPlaceholder();
});

/* Generate a personalized routine from the currently selected products */
generateRoutineBtn.addEventListener("click", async () => {
  if (selectedProducts.length === 0) {
    appendChatMessage(
      "assistant",
      "Please select at least one product above before generating a routine.",
      "error",
      false
    );
    return;
  }

  // Ensure the system prompt is present while preserving any previous chat messages
  if (conversationHistory.length === 0) {
    conversationHistory.push({ role: "system", content: SYSTEM_PROMPT });
  }

  // Send only the currently selected products' JSON data as the new routine request
  const selectedProductsJson = JSON.stringify(selectedProducts, null, 2);
  const routinePrompt = `Build a personalized step-by-step beauty routine using only these selected products (JSON):\n\n${selectedProductsJson}`;
  conversationHistory.push({ role: "user", content: routinePrompt });

  // Show a clean summary of the request in the chat window and save it
  const productNames = selectedProducts.map((p) => p.name).join(", ");
  appendChatMessage(
    "user",
    `Generate a routine using my selected products: ${productNames}`
  );

  const loadingBubble = appendChatMessage(
    "assistant",
    "Building your personalized routine...",
    "loading",
    false
  );
  setLoadingState(true);

  try {
    const reply = await fetchAdvisorReply(conversationHistory);
    conversationHistory.push({ role: "assistant", content: reply });
    loadingBubble.remove();
    appendChatMessage("assistant", reply);
  } catch (error) {
    console.error("Error generating routine:", error);
    // Remove only the failed routine prompt so earlier chat history stays intact
    conversationHistory.pop();
    chatUiMessages.pop();
    clearChatBtn.disabled = chatUiMessages.length === 0;
    saveChatHistory();
    loadingBubble.remove();
    appendChatMessage(
      "assistant",
      "Sorry, I couldn't generate your routine right now. Please try again in a moment.",
      "error",
      false
    );
  } finally {
    setLoadingState(false);
  }
});

/* Handle follow-up questions in the chatbox using full conversation history */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const message = userInput.value.trim();
  if (!message) {
    return;
  }

  // Initialize conversation history if the user asks a question before generating a routine
  if (conversationHistory.length === 0) {
    conversationHistory.push({ role: "system", content: SYSTEM_PROMPT });
    if (selectedProducts.length > 0) {
      conversationHistory.push({
        role: "system",
        content: `The user currently has these products selected (JSON):\n${JSON.stringify(
          selectedProducts,
          null,
          2
        )}`,
      });
    }
  }

  appendChatMessage("user", message);
  conversationHistory.push({ role: "user", content: message });
  saveChatHistory();
  userInput.value = "";

  const loadingBubble = appendChatMessage(
    "assistant",
    "Thinking...",
    "loading",
    false
  );
  setLoadingState(true);

  try {
    const reply = await fetchAdvisorReply(conversationHistory);
    conversationHistory.push({ role: "assistant", content: reply });
    loadingBubble.remove();
    appendChatMessage("assistant", reply);
  } catch (error) {
    console.error("Error sending follow-up message:", error);
    loadingBubble.remove();
    // Remove the failed user message from history so the conversation stays consistent
    conversationHistory.pop();
    chatUiMessages.pop();
    clearChatBtn.disabled = chatUiMessages.length === 0;
    saveChatHistory();
    appendChatMessage(
      "assistant",
      "Sorry, something went wrong while getting a response. Please try again.",
      "error",
      false
    );
  } finally {
    setLoadingState(false);
    userInput.focus();
  }
});
