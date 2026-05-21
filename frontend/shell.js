const navLinks = document.querySelectorAll("[data-shell-nav]");
const healthState = document.querySelector("[data-shell-health-state]");
const healthDetail = document.querySelector("[data-shell-health-detail]");
const healthDot = document.querySelector("[data-shell-health-dot]");

updateShellNavigation();
window.addEventListener("hashchange", updateShellNavigation);
checkShellHealth();

function updateShellNavigation() {
  const page = currentShellPage();
  for (const link of navLinks) {
    link.classList.toggle("active", link.dataset.shellNav === page);
  }
}

function currentShellPage() {
  const path = window.location.pathname.toLowerCase();
  if (path.endsWith("/assistants.html")) {
    return window.location.hash === "#gandalf" ? "gandalf" : "frodo";
  }
  if (path.endsWith("/rag.html")) return "rag";
  if (path.endsWith("/admin.html")) return "admin";
  return "docx";
}

async function checkShellHealth() {
  if (!healthState || !healthDetail || !healthDot) return;

  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    const payload = await response.json();
    const status = payload.ollamaStatus;
    const model = status?.model || payload.model || "Ollama";

    if (status?.ok) {
      setShellHealth("ready", "KI bereit", model);
      return;
    }

    setShellHealth("error", "KI nicht erreichbar", model);
  } catch {
    setShellHealth("error", "Status offen", "Backend");
  }
}

function setShellHealth(kind, label, detail) {
  healthDot.className = `status-dot ${kind}`;
  healthState.textContent = label;
  healthDetail.textContent = detail;
}
