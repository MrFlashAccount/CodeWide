const prototype = document.querySelector("[data-prototype]");
const replay = document.querySelector("[data-replay]");

function replayIllustration() {
  const illustration = prototype?.querySelector(".illustration-pane");
  if (!(illustration instanceof HTMLElement)) return;
  illustration.classList.remove("is-animating");
  void illustration.offsetWidth;
  illustration.classList.add("is-animating");
}

replay?.addEventListener("click", replayIllustration);
