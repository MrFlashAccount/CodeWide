export {};

const endpoint = process.argv[2] ?? "http://127.0.0.1:9222";
const targets = await fetch(`${endpoint}/json/list`).then((response) => response.json()) as Array<{
  title: string;
  webSocketDebuggerUrl: string;
}>;

for (const target of targets.filter(({ title }) => title === "mermaid-renderer.html")) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("Could not connect to Android WebView CDP")), { once: true });
  });

  const result = await new Promise<unknown>((resolve, reject) => {
    const id = 1;
    const timeout = setTimeout(() => reject(new Error("Android WebView CDP timed out")), 5_000);
    socket.addEventListener("message", ({ data }) => {
      const message = JSON.parse(String(data)) as { id?: number; result?: { result?: { value?: unknown } }; error?: unknown };
      if (message.id !== id) return;
      clearTimeout(timeout);
      if (message.error !== undefined) reject(message.error);
      else resolve(message.result?.result?.value);
    });
    socket.send(JSON.stringify({
      id,
      method: "Runtime.evaluate",
      params: {
        returnByValue: true,
        expression: `(() => {
          const canvas = document.querySelector('#canvas');
          const svg = document.querySelector('svg');
          const rect = (element) => element ? element.getBoundingClientRect().toJSON() : null;
          return {
            url: location.href,
            viewport: {width: document.documentElement.clientWidth, height: document.documentElement.clientHeight},
            rootMode: document.querySelector('#root')?.dataset.mode ?? null,
            canvas: rect(canvas),
            svg: rect(svg),
            viewBox: svg?.getAttribute('viewBox') ?? null,
            style: svg ? {display: getComputedStyle(svg).display, fill: getComputedStyle(svg).fill} : null,
            svgMarkup: svg?.outerHTML.slice(0, 1000) ?? null,
          };
        })()`,
      },
    }));
  });

  console.log(JSON.stringify(result, null, 2));
  socket.close();
}
