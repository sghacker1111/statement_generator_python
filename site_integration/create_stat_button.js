(function () {
  const appUrl = window.STATEMENT_GENERATOR_URL || "/statement-generator/";
  if (document.getElementById("sunil-create-stat-link")) {
    return;
  }

  const button = document.createElement("a");
  button.id = "sunil-create-stat-link";
  button.href = appUrl;
  button.target = "_blank";
  button.rel = "noopener noreferrer";
  button.textContent = "Create Stat";

  Object.assign(button.style, {
    position: "fixed",
    top: "18px",
    right: "18px",
    zIndex: "9999",
    padding: "12px 18px",
    borderRadius: "999px",
    background: "linear-gradient(135deg, #0f6c78, #1c8793)",
    color: "#ffffff",
    textDecoration: "none",
    fontFamily: '"Aptos", "Segoe UI", sans-serif',
    fontWeight: "700",
    boxShadow: "0 14px 28px rgba(15, 108, 120, 0.22)",
  });

  button.addEventListener("mouseenter", function () {
    button.style.transform = "translateY(-1px)";
  });
  button.addEventListener("mouseleave", function () {
    button.style.transform = "translateY(0)";
  });

  document.body.append(button);
})();
