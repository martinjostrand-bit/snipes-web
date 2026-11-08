// M0: a blank canvas with the title and version (spec 9, M0).
const canvas = document.querySelector<HTMLCanvasElement>("#screen");
const ctx = canvas?.getContext("2d");

if (canvas && ctx) {
  // The canvas text is invisible to screen readers and tests, so it is repeated as a label.
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `Snipes Web v${__APP_VERSION__}`);
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  ctx.fillStyle = "#ccc";
  ctx.font = "24px monospace";
  ctx.textAlign = "center";
  ctx.fillText("Snipes Web", canvas.width / 2, canvas.height / 2);
  ctx.font = "14px monospace";
  ctx.fillText(`v${__APP_VERSION__}`, canvas.width / 2, canvas.height / 2 + 28);
}
