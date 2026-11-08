// M0: a blank canvas with the title and version (spec 9, M0).
const canvas = document.querySelector<HTMLCanvasElement>("#screen");
const ctx = canvas?.getContext("2d");

if (canvas && ctx) {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  ctx.fillStyle = "#ccc";
  ctx.font = "24px monospace";
  ctx.textAlign = "center";
  ctx.fillText("Snipes Web", canvas.width / 2, canvas.height / 2);
  ctx.font = "14px monospace";
  ctx.fillText(`v${__APP_VERSION__}`, canvas.width / 2, canvas.height / 2 + 28);
}
