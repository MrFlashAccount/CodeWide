# V1 browser

This feature owns the standalone V1 in-app browser, its fullscreen surface, navigation state,
developer tools and feedback flow. The Router-owned browser session supplies a title, URL and
optional request headers. Browser components do not create tunnels or start port forwards.

Other features may request presentation only through an injected `openBrowser` capability. Ports
owns loopback qualification and tunnel creation, then invokes that callback with the resolved URL;
it must not import browser components, browser state or browser feedback internals.

Native WebView, CDP and screenshot bridges remain lower platform authorities. The browser feature
adapts those capabilities without owning their transport lifecycle.
