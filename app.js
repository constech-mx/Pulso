const header = document.querySelector(".site-header");
const menuButton = document.getElementById("menu-btn");
const nav = document.getElementById("nav");

function updateHeader() {
  if (!header) return;
  header.classList.toggle("is-scrolled", window.scrollY > 12);
}

updateHeader();
window.addEventListener("scroll", updateHeader, { passive: true });

if (menuButton && nav) {
  const closeMenu = () => {
    nav.classList.remove("is-open");
    menuButton.classList.remove("is-open");
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.setAttribute("aria-label", "Abrir menú");
  };

  menuButton.addEventListener("click", () => {
    const open = !nav.classList.contains("is-open");
    nav.classList.toggle("is-open", open);
    menuButton.classList.toggle("is-open", open);
    menuButton.setAttribute("aria-expanded", String(open));
    menuButton.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
  });

  nav.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));

  document.addEventListener("click", (event) => {
    if (!nav.classList.contains("is-open")) return;
    if (event.target.closest("#nav") || event.target.closest("#menu-btn")) return;
    closeMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });
}

const reveals = document.querySelectorAll("[data-reveal]");

if ("IntersectionObserver" in window && reveals.length) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
  );

  reveals.forEach((element) => observer.observe(element));
} else {
  reveals.forEach((element) => element.classList.add("is-visible"));
}

const copyButton = document.getElementById("copy-install");
const installCommand = document.getElementById("install-command");

if (copyButton && installCommand) {
  copyButton.addEventListener("click", async () => {
    const text = installCommand.innerText.trim();
    try {
      await navigator.clipboard.writeText(text);
      copyButton.textContent = "Copiado";
      setTimeout(() => {
        copyButton.textContent = "Copiar";
      }, 1800);
    } catch {
      copyButton.textContent = "No disponible";
      setTimeout(() => {
        copyButton.textContent = "Copiar";
      }, 1800);
    }
  });
}

const year = document.getElementById("year");
if (year) year.textContent = String(new Date().getFullYear());
